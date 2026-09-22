-- Creates the mot_history table on first start (same schema as sql/install.sql),
-- so a missing manual SQL import can't break lookups.
MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mot_history` (
      `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      `plate` VARCHAR(15) NOT NULL,
      `vin` VARCHAR(32) DEFAULT NULL,
      `passed` TINYINT(1) NOT NULL DEFAULT 0,
      `failed_items` JSON DEFAULT NULL,
      `advisory_items` JSON DEFAULT NULL,
      `mileage` INT UNSIGNED DEFAULT NULL,
      `mileage_unit` VARCHAR(12) DEFAULT NULL,
      `tester_identifier` VARCHAR(64) DEFAULT NULL,
      `tester_name` VARCHAR(64) DEFAULT NULL,
      `location_label` VARCHAR(64) DEFAULT NULL,
      `test_number` VARCHAR(20) DEFAULT NULL,
      `issued_at` DATETIME NOT NULL,
      `expires_at` DATETIME DEFAULT NULL,
      PRIMARY KEY (`id`),
      INDEX `idx_plate` (`plate`),
      INDEX `idx_expires` (`expires_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])

  -- Columns added after the first release (added to existing tables on start).
  local function EnsureColumn(name, ddl)
    local has = MySQL.scalar.await(
      "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mot_history' AND COLUMN_NAME = ?",
      { name }
    )
    if (tonumber(has) or 0) == 0 then
      MySQL.query.await('ALTER TABLE `mot_history` ADD COLUMN ' .. ddl)
    end
  end
  EnsureColumn('notes',        '`notes` TEXT DEFAULT NULL')                      -- tester notes per advisory / fail
  EnsureColumn('display_name', '`display_name` VARCHAR(60) DEFAULT NULL')        -- File Explorer rename
  EnsureColumn('bin_state',    '`bin_state` TINYINT NOT NULL DEFAULT 0')         -- 0 normal, 1 Recycle Bin, 2 emptied
  EnsureColumn('deleted_at',   '`deleted_at` DATETIME DEFAULT NULL')
  EnsureColumn('deleted_by',   '`deleted_by` VARCHAR(64) DEFAULT NULL')
end)

-- notes column comes back as a JSON string -> { itemId = text }
local function DecodeNotes(v)
  if type(v) ~= 'string' or v == '' then return {} end
  local ok, t = pcall(json.decode, v)
  if ok and type(t) == 'table' then return t end
  return {}
end

local function GenerateTestNumber()
  local function block() return tostring(math.random(1000, 9999)) end
  return ('%s %s %s'):format(block(), block(), block())
end

-- oxmysql can hand DATETIME columns back as unix-ms numbers instead of strings.
-- Everything below (and the UI) works with "YYYY-MM-DD HH:MM:SS" strings, so normalise once.
local function DateStr(v)
  if type(v) == 'number' then
    return os.date('%Y-%m-%d %H:%M:%S', math.floor(v > 1e11 and v / 1000 or v))
  end
  return v
end

-- oxmysql may return TINYINT(1) as boolean, number or string. If the value is
-- unreadable, fall back to the schema rule: a pass always has an expiry date.
local printedPassType = false
local function IsPassed(v, row)
  if Config.Debug and not printedPassType then
    printedPassType = true
    print(('[as-computer] mot_history.passed comes back as %s (%s)'):format(type(v), tostring(v)))
  end
  if v == 1 or v == true or v == '1' then return true end
  if v == 0 or v == false or v == '0' then return false end
  return row ~= nil and row.expires_at ~= nil
end

local function NormRow(row)
  row.issued_at  = DateStr(row.issued_at)
  row.expires_at = DateStr(row.expires_at)
  row.deleted_at = DateStr(row.deleted_at)
  return row
end

-- Live mileage from jg-vehiclemileage if it's installed and running; nil if
-- not installed, or if the plate isn't in its DB. Falls back gracefully so
-- this resource still works standalone.
local function GetLiveMileage(plate)
  if GetResourceState('jg-vehiclemileage') ~= 'started' then return nil, nil end
  local ok, result = pcall(function()
    return exports['jg-vehiclemileage']:getMileageByPlate(plate)
  end)
  if not ok or result == false or result == nil then return nil, nil end
  local unitOk, unit = pcall(function() return exports['jg-vehiclemileage']:getUnit() end)
  return math.floor(result), (unitOk and unit) or 'miles'
end

-- ---- Lookup ---------------------------------------------------------------
-- Returns { found, plate, vin, ownerIdentifier, status, expiresAt, history = {...} }

MotCallback.Register('lookupVehicle', function(src, respond, plateInput)
  if not Apps.allowed(src, 'mot') then
    return respond({ found = false, reason = 'not_authorised' })
  end

  local plate = (plateInput or ''):upper():gsub('%s+', '')
  if plate == '' then return respond({ found = false, reason = 'empty' }) end

  local vehicleTable = Bridge.VehicleTable()
  local ownerColumn = Bridge.VehicleOwnerColumn()
  local vehicleRow = MySQL.single.await(
    ('SELECT plate, vehicle, `%s` AS owner_ref FROM `%s` WHERE UPPER(REPLACE(plate, " ", "")) = ?'):format(ownerColumn, vehicleTable),
    { plate }
  )

  if not vehicleRow then
    return respond({ found = false, reason = 'no_vehicle' })
  end

  local rows = MySQL.query.await(
    'SELECT * FROM mot_history WHERE UPPER(REPLACE(plate, " ", "")) = ? ORDER BY issued_at DESC',
    { plate }
  ) or {}
  for _, row in ipairs(rows) do NormRow(row) end

  local latest = rows[1]
  local status, expiresAt = 'never_tested', nil
  if latest then
    if IsPassed(latest.passed, latest) then
      expiresAt = latest.expires_at
      status = 'unknown'
      -- Compare expiry to now (MySQL DATETIME string -> os.time via pattern)
      if latest.expires_at then
        local y, mo, d, h, mi, s = latest.expires_at:match('(%d+)-(%d+)-(%d+) (%d+):(%d+):(%d+)')
        if y then
          local expiryTime = os.time({ year = y, month = mo, day = d, hour = h, min = mi, sec = s })
          status = (expiryTime >= os.time()) and 'valid' or 'expired'
        end
      end
    else
      status = 'failed_last_test'
    end
  end

  local history = {}
  for _, row in ipairs(rows) do
    history[#history + 1] = {
      passed        = IsPassed(row.passed, row),
      failedItems   = json.decode(row.failed_items or '[]'),
      advisoryItems = json.decode(row.advisory_items or '[]'),
      notes         = DecodeNotes(row.notes),
      mileage       = row.mileage,
      mileageUnit   = row.mileage_unit,
      testerName    = row.tester_name,
      locationLabel = row.location_label,
      testNumber    = row.test_number,
      issuedAt      = row.issued_at,
      expiresAt     = row.expires_at,
    }
  end

  local liveMileage, liveUnit = GetLiveMileage(plate)

  respond({
    found  = true,
    plate  = vehicleRow.plate,
    model  = vehicleRow.vehicle, -- model name/hash string as stored by your framework; map to a label client-side or here if you keep a vehicles.json
    status = status,
    history = history,
    currentMileage = liveMileage,
    mileageUnit = liveUnit,
    testerName = Bridge.GetName(src), -- shown on the checklist screen
    booking = Booking.nextFor(plate, (Bridge.GetJob(src) or {}).name),
  })
end)

-- ---- Submit inspection ------------------------------------------------------
-- results = { [itemId] = "pass" | "advise" | "fail", ... }

MotCallback.Register('submitInspection', function(src, respond, plateInput, results, manualMileage, locationLabel, notesInput)
  if not Apps.allowed(src, 'mot') then
    return respond({ ok = false, reason = 'not_authorised' })
  end

  local plate = (plateInput or ''):upper():gsub('%s+', '')
  if plate == '' then return respond({ ok = false, reason = 'empty' }) end

  -- Every checklist item must have an answer — an untouched item would
  -- otherwise count as a pass.
  for itemId in pairs(Config.ChecklistById) do
    local r = results and results[itemId]
    if r ~= 'pass' and r ~= 'advise' and r ~= 'fail' then
      return respond({ ok = false, reason = 'incomplete' })
    end
  end

  local failedItems, advisoryItems = {}, {}
  for itemId, result in pairs(results or {}) do
    if not Config.ChecklistById[itemId] then goto continue end -- ignore unknown ids
    if result == 'fail' then failedItems[#failedItems + 1] = itemId end
    if result == 'advise' then advisoryItems[#advisoryItems + 1] = itemId end
    ::continue::
  end

  -- Notes only count for items that were marked advise / fail; trimmed + length-capped.
  local maxLen = Config.MaxNoteLength or 200
  local notes = {}
  for _, itemId in ipairs(failedItems) do
    local n = type(notesInput) == 'table' and notesInput[itemId]
    if type(n) == 'string' then n = n:gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', ''):sub(1, maxLen) end
    if type(n) == 'string' and n ~= '' then notes[itemId] = n end
  end
  for _, itemId in ipairs(advisoryItems) do
    local n = type(notesInput) == 'table' and notesInput[itemId]
    if type(n) == 'string' then n = n:gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', ''):sub(1, maxLen) end
    if type(n) == 'string' and n ~= '' then notes[itemId] = n end
  end
  if Config.RequireNotes then
    for _, list in ipairs({ failedItems, advisoryItems }) do
      for _, itemId in ipairs(list) do
        if not notes[itemId] then return respond({ ok = false, reason = 'notes_required' }) end
      end
    end
  end

  local passed = #failedItems == 0
  local now = os.date('%Y-%m-%d %H:%M:%S')
  local expiresAt = nil
  if passed then
    expiresAt = os.date('%Y-%m-%d %H:%M:%S', os.time() + (Config.MOTExpiryDays * 86400))
  end

  local testNumber = GenerateTestNumber()

  -- jg-vehiclemileage, when installed, is trusted over whatever the tester
  -- typed in — falls back to the manual value if it's not running or the
  -- plate isn't in its DB yet.
  local liveMileage, liveUnit = GetLiveMileage(plate)
  manualMileage = tonumber(manualMileage)
  if manualMileage then manualMileage = math.max(0, math.floor(manualMileage)) end
  local mileage = liveMileage or manualMileage
  local mileageUnit = liveMileage and liveUnit or (manualMileage and 'miles' or nil)

  MySQL.insert.await(
    [[INSERT INTO mot_history
      (plate, vin, passed, failed_items, advisory_items, notes, mileage, mileage_unit, tester_identifier, tester_name, location_label, test_number, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)]],
    {
      plate, nil, passed and 1 or 0,
      json.encode(failedItems), json.encode(advisoryItems), json.encode(notes),
      mileage, mileageUnit, Bridge.GetIdentifier(src), Bridge.GetName(src),
      locationLabel, testNumber, now, expiresAt,
    }
  )

  -- Feed as-browser's government site (vehicle checker: MOT status + history).
  PushMotToBrowser(plate, passed, failedItems, advisoryItems, testNumber)
  -- A waiting website booking for this plate is now done (its fee goes to the garage's society account).
  local tj = Bridge.GetJob(src)
  Booking.complete(plate, tj and tj.name)

  respond({
    ok = true,
    passed = passed,
    failedItems = failedItems,
    advisoryItems = advisoryItems,
    notes = notes,
    testNumber = testNumber,
    issuedAt = now,
    expiresAt = expiresAt,
    mileage = mileage,
    mileageUnit = mileageUnit,
    testerName = Bridge.GetName(src),
    locationLabel = locationLabel,
  })
end)

-- ---- Scout (as-browser) -----------------------------------------------------
-- The Browser app on Los Santos OS uses as-browser's sites. Requests arrive here from the page, the job
-- is checked, then they are handed to as-browser's `handle` export with the real player source.

local BROWSER_CALLS = {
  ['sites']            = 'as-browser:sites',
  ['player']           = 'as-browser:player',
  ['siteCall']         = 'as-browser:siteCall',
  ['bookmarks:list']   = 'as-browser:bookmarks:list',
  ['bookmarks:add']    = 'as-browser:bookmarks:add',
  ['bookmarks:remove'] = 'as-browser:bookmarks:remove',
  ['history:list']     = 'as-browser:history:list',
  ['history:add']      = 'as-browser:history:add',
  ['history:clear']    = 'as-browser:history:clear',
}

local function BrowserResource()
  local b = Config.Browser
  if not b or b.enabled ~= true then return nil end
  local res = b.resource or 'as-browser'
  if GetResourceState(res) ~= 'started' then return nil end
  return res
end

Apps.available.browser = function() return BrowserResource() ~= nil end

local function SafeArg(v)
  local ty = type(v)
  if ty == 'string' then return v:sub(1, 400) end
  if ty == 'number' or ty == 'boolean' or ty == 'table' then return v end
  return nil
end

MotCallback.Register('browserApi', function(src, respond, name, a, b, c)
  if not Apps.allowed(src, 'browser') then return respond(nil) end
  local res = BrowserResource()
  if not res or type(name) ~= 'string' then return respond(nil) end

  if name == 'shellInfo' then
    local ok, info = pcall(function() return exports[res]:shellInfo() end)
    return respond(ok and info or nil)
  end

  local cbName = BROWSER_CALLS[name]
  if not cbName then return respond(nil) end
  local ok, r1, r2 = pcall(function() return exports[res]:handle(cbName, src, SafeArg(a), SafeArg(b), SafeArg(c)) end)
  if not ok then
    if Config.Debug then print(('[as-computer] browserApi %s failed: %s'):format(name, tostring(r1))) end
    return respond(nil)
  end
  if name == 'bookmarks:add' then return respond({ ok = r1 == true, error = r2 }) end
  respond(r1)
end)

--- Sends a finished test to as-browser (setMotResult) so the vehicle checker shows it.
function PushMotToBrowser(plate, passed, failedItems, advisoryItems, testNumber)
  local res = BrowserResource()
  if not res or (Config.Browser and Config.Browser.pushMotResults == false) then return end
  local function labels(list)
    local out = {}
    for _, id in ipairs(list) do
      local it = Config.ChecklistById[id]
      out[#out + 1] = it and it.label or id
    end
    return table.concat(out, ', ')
  end
  local details = ('MOT test %s'):format(testNumber)
  if #failedItems > 0 then details = details .. '. Failed: ' .. labels(failedItems) end
  if #advisoryItems > 0 then details = details .. '. Advisories: ' .. labels(advisoryItems) end
  local expiry = passed and (os.time() + (Config.MOTExpiryDays or 30) * 86400) or nil
  local ok, done, err = pcall(function() return exports[res]:setMotResult(plate, passed, expiry, details) end)
  if Config.Debug and (not ok or done == false) then
    print(('[as-computer] as-browser setMotResult(%s) failed: %s'):format(plate, tostring(ok and err or done)))
  end
end

-- ---- Calendar (Los Santos OS) ---------------------------------------------------------------
-- One shared team calendar PER JOB: everyone on the job can add, edit and delete its events.

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mot_calendar` (
      `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      `title` VARCHAR(80) NOT NULL,
      `notes` VARCHAR(300) DEFAULT NULL,
      `color` VARCHAR(12) NOT NULL DEFAULT 'blue',
      `event_date` DATE NOT NULL,
      `start_time` CHAR(5) DEFAULT NULL,
      `end_time` CHAR(5) DEFAULT NULL,
      `created_by` VARCHAR(64) DEFAULT NULL,
      `created_name` VARCHAR(64) DEFAULT NULL,
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      INDEX `idx_date` (`event_date`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- Each job has its own calendar. Events from before jobs existed go to the first configured job.
  local has = MySQL.scalar.await(
    "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'mot_calendar' AND COLUMN_NAME = 'job'")
  if (tonumber(has) or 0) == 0 then
    MySQL.query.await('ALTER TABLE `mot_calendar` ADD COLUMN `job` VARCHAR(50) DEFAULT NULL, ADD INDEX `idx_job` (`job`)')
  end
  local first = (Config.Jobs and Config.Jobs[1]) or Config.MechanicJob
  if first then MySQL.update.await('UPDATE mot_calendar SET job = ? WHERE job IS NULL', { first }) end
end)

local CAL_COLORS = { blue = true, green = true, red = true, orange = true, purple = true, grey = true }

--- "YYYY-MM-DD" that is a real calendar date, else nil.
local function ValidDate(d)
  if type(d) ~= 'string' then return nil end
  local y, m, day = d:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  if not y then return nil end
  y, m, day = tonumber(y), tonumber(m), tonumber(day)
  if y < 2000 or y > 2100 then return nil end
  local ts = os.time({ year = y, month = m, day = day, hour = 12 })
  if not ts or os.date('%Y-%m-%d', ts) ~= d then return nil end
  return d
end

--- "HH:MM" (24h) or nil.
local function ValidTime(v)
  if type(v) ~= 'string' then return nil end
  local h, m = v:match('^(%d%d):(%d%d)$')
  if not h or tonumber(h) > 23 or tonumber(m) > 59 then return nil end
  return v
end

local function CleanText(v, max)
  if type(v) ~= 'string' then return '' end
  v = v:gsub('[%c]', ' '):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', '')
  return v:sub(1, max)
end

local function CalendarEnabled()
  return not (Config.Calendar and Config.Calendar.enabled == false)
end

MotCallback.Register('calendarApi', function(src, respond, name, data)
  if not Apps.allowed(src, 'calendar') then return respond({ ok = false, reason = 'not_authorised' }) end
  if not CalendarEnabled() or type(data) ~= 'table' then return respond({ ok = false, reason = 'invalid' }) end
  local me = Bridge.GetIdentifier(src)
  local jobInfo = Bridge.GetJob(src)
  local job = jobInfo and jobInfo.name
  if not job then return respond({ ok = false, reason = 'not_authorised' }) end

  if name == 'list' then
    local from, to = ValidDate(data.from), ValidDate(data.to)
    if not from or not to or from > to then return respond({ ok = false, reason = 'invalid' }) end
    -- a screen never needs more than ~6 weeks
    local span = os.time({ year = tonumber(to:sub(1, 4)), month = tonumber(to:sub(6, 7)), day = tonumber(to:sub(9, 10)), hour = 12 })
               - os.time({ year = tonumber(from:sub(1, 4)), month = tonumber(from:sub(6, 7)), day = tonumber(from:sub(9, 10)), hour = 12 })
    if span > 62 * 86400 then return respond({ ok = false, reason = 'invalid' }) end
    local rows = MySQL.query.await(
      [[SELECT id, title, notes, color, DATE_FORMAT(event_date, '%Y-%m-%d') AS date,
               start_time AS startTime, end_time AS endTime, created_by, created_name AS createdBy
        FROM mot_calendar WHERE event_date BETWEEN ? AND ? AND job = ?
        ORDER BY event_date, (start_time IS NULL) DESC, start_time, id LIMIT 600]],
      { from, to, job }) or {}
    for _, r in ipairs(rows) do
      r.mine = r.created_by == me
      r.created_by = nil
      r.allDay = r.startTime == nil
    end
    -- MOT bookings made on the government website (read-only)
    for _, b in ipairs(Booking.forCalendar(job, from, to)) do rows[#rows + 1] = b end
    table.sort(rows, function(a, b)
      if a.date ~= b.date then return a.date < b.date end
      return (a.startTime or '') < (b.startTime or '')
    end)
    return respond({ ok = true, items = rows })
  end

  if name == 'save' then
    local title = CleanText(data.title, 80)
    local date = ValidDate(data.date)
    if title == '' or not date then return respond({ ok = false, reason = 'invalid' }) end
    local notes = CleanText(data.notes, 300)
    local color = CAL_COLORS[data.color] and data.color or 'blue'
    local startT, endT = ValidTime(data.startTime), ValidTime(data.endTime)
    if not startT then endT = nil end
    if startT and endT and endT < startT then return respond({ ok = false, reason = 'invalid' }) end

    local id = tonumber(data.id)
    if id then
      local n = MySQL.update.await(
        'UPDATE mot_calendar SET title = ?, notes = ?, color = ?, event_date = ?, start_time = ?, end_time = ? WHERE id = ? AND job = ?',
        { title, notes ~= '' and notes or nil, color, date, startT, endT, id, job })
      if (tonumber(n) or 0) == 0 then
        -- an unchanged row reports 0 affected rows; make sure it exists before calling it missing
        local exists = MySQL.scalar.await('SELECT COUNT(*) FROM mot_calendar WHERE id = ? AND job = ?', { id, job })
        if (tonumber(exists) or 0) == 0 then return respond({ ok = false, reason = 'not_found' }) end
      end
      return respond({ ok = true, id = id })
    end

    local count = MySQL.scalar.await('SELECT COUNT(*) FROM mot_calendar WHERE event_date = ? AND job = ?', { date, job })
    if (tonumber(count) or 0) >= 40 then return respond({ ok = false, reason = 'invalid' }) end
    local newId = MySQL.insert.await(
      'INSERT INTO mot_calendar (title, notes, color, event_date, start_time, end_time, created_by, created_name, job) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      { title, notes ~= '' and notes or nil, color, date, startT, endT, me, Bridge.GetName(src), job })
    return respond({ ok = true, id = newId })
  end

  if name == 'delete' then
    local id = tonumber(data.id)
    if not id then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mot_calendar WHERE id = ? AND job = ?', { id, job })
    return respond({ ok = true })
  end

  respond({ ok = false, reason = 'invalid' })
end)

-- ---- Certificates (File Explorer) ---------------------------------------------
-- Every stored test, newest first, with the vehicle's model name joined in.

MotCallback.Register('whoami', function(src, respond)
  respond({ name = Bridge.GetName(src) })
end)

MotCallback.Register('listCertificates', function(src, respond)
  if not Bridge.HasComputerJob(src) then
    return respond({ ok = false, reason = 'not_authorised' })
  end
  -- Certificates belong to the MOT app: a job without it simply has an empty folder.
  if not Apps.allowed(src, 'mot') then return respond({ ok = true, items = {} }) end

  local rows = MySQL.query.await('SELECT * FROM mot_history WHERE COALESCE(bin_state, 0) <> 2 ORDER BY issued_at DESC LIMIT 300') or {}

  -- Model names come from the framework's vehicle table (separate query: avoids
  -- cross-table collation trouble a JOIN on plate could hit).
  local plates, seen = {}, {}
  for _, row in ipairs(rows) do
    if row.plate and not seen[row.plate] then seen[row.plate] = true; plates[#plates + 1] = row.plate end
  end
  local models = {}
  if #plates > 0 then
    local ok, vehicles = pcall(function()
      return MySQL.query.await(
        ('SELECT plate, vehicle FROM `%s` WHERE UPPER(REPLACE(plate, " ", "")) IN (?)'):format(Bridge.VehicleTable()),
        { plates }
      )
    end)
    if ok and vehicles then
      for _, v in ipairs(vehicles) do models[(v.plate or ''):upper():gsub('%s+', '')] = v.vehicle end
    end
  end

  local me = Bridge.GetIdentifier(src)
  local items = {}
  for _, row in ipairs(rows) do
    NormRow(row)
    items[#items + 1] = {
      testNumber    = row.test_number,
      name          = row.display_name,
      deleted       = (tonumber(row.bin_state) or 0) == 1,
      deletedAt     = row.deleted_at,
      deletedBy     = row.deleted_by,
      plate         = row.plate,
      model         = models[row.plate],
      passed        = IsPassed(row.passed, row),
      issuedAt      = row.issued_at,
      expiresAt     = row.expires_at,
      mileage       = row.mileage,
      mileageUnit   = row.mileage_unit,
      testerName    = row.tester_name,
      locationLabel = row.location_label,
      failedItems   = json.decode(row.failed_items or '[]') or {},
      advisoryItems = json.decode(row.advisory_items or '[]') or {},
      notes         = DecodeNotes(row.notes),
      mine          = row.tester_identifier ~= nil and row.tester_identifier == me,
    }
  end
  respond({ ok = true, items = items })
end)


-- ---- File Explorer actions: Recycle Bin + rename -----------------------------------
-- bin_state: 0 = normal, 1 = in the Recycle Bin, 2 = emptied (hidden from File Explorer, record kept
-- unless Config.PurgeRemovesRecords). Vehicle history / GetMOTStatus always read every row.

local function CleanList(list)
  local out, seen = {}, {}
  if type(list) ~= 'table' then return out end
  for _, v in ipairs(list) do
    if type(v) == 'string' and #v <= 20 and not seen[v] and #out < 300 then
      seen[v] = true
      out[#out + 1] = v
    end
  end
  return out
end

-- Ids of the rows in `list` that are currently in `binState` and that this player may change.
local function ManageableIds(src, list, binState)
  local ids, blocked = {}, 0
  if #list == 0 then return ids, blocked end
  local rows = MySQL.query.await(
    'SELECT id, tester_identifier, bin_state FROM mot_history WHERE test_number IN (?)', { list }
  ) or {}
  local me = Bridge.GetIdentifier(src)
  for _, row in ipairs(rows) do
    if (tonumber(row.bin_state) or 0) == binState then
      if Config.ManageOthers == true or (row.tester_identifier ~= nil and row.tester_identifier == me) then
        ids[#ids + 1] = row.id
      else
        blocked = blocked + 1
      end
    end
  end
  return ids, blocked
end

local function RegisterBinAction(name, fromState, apply)
  MotCallback.Register(name, function(src, respond, listInput)
    if not Apps.allowed(src, 'mot') then return respond({ ok = false, reason = 'not_authorised' }) end
    local ids, blocked = ManageableIds(src, CleanList(listInput), fromState)
    if #ids > 0 then apply(src, ids) end
    if #ids == 0 and blocked > 0 then return respond({ ok = false, reason = 'not_yours' }) end
    respond({ ok = true, changed = #ids })
  end)
end

RegisterBinAction('certDelete', 0, function(src, ids)
  local who = Bridge.GetName(src)
  MySQL.update.await(
    'UPDATE mot_history SET bin_state = 1, deleted_at = ?, deleted_by = ? WHERE id IN (?)',
    { os.date('%Y-%m-%d %H:%M:%S'), who, ids }
  )
end)

RegisterBinAction('certRestore', 1, function(_, ids)
  MySQL.update.await('UPDATE mot_history SET bin_state = 0, deleted_at = NULL, deleted_by = NULL WHERE id IN (?)', { ids })
end)

RegisterBinAction('certPurge', 1, function(_, ids)
  if Config.PurgeRemovesRecords then
    MySQL.update.await('DELETE FROM mot_history WHERE id IN (?)', { ids })
  else
    MySQL.update.await('UPDATE mot_history SET bin_state = 2 WHERE id IN (?)', { ids })
  end
end)

MotCallback.Register('certRename', function(src, respond, testNumber, nameInput)
  if not Apps.allowed(src, 'mot') then return respond({ ok = false, reason = 'not_authorised' }) end
  if type(testNumber) ~= 'string' then return respond({ ok = false, reason = 'error' }) end
  local ids, blocked = ManageableIds(src, CleanList({ testNumber }), 0)
  if #ids == 0 then return respond({ ok = false, reason = blocked > 0 and 'not_yours' or 'error' }) end

  local name = ''
  if type(nameInput) == 'string' then
    name = nameInput:gsub('%c', ''):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', ''):sub(1, 60)
  end
  MySQL.update.await("UPDATE mot_history SET display_name = NULLIF(?, '') WHERE id = ?", { name, ids[1] })
  respond({ ok = true })
end)

-- ---- Export for other resources (e.g. a future police/ANPR script) --------

exports('GetMOTStatus', function(plateInput)
  local plate = (plateInput or ''):upper():gsub('%s+', '')
  local row = MySQL.single.await(
    'SELECT passed, expires_at FROM mot_history WHERE UPPER(REPLACE(plate, " ", "")) = ? ORDER BY issued_at DESC LIMIT 1',
    { plate }
  )
  if not row then return { status = 'never_tested' } end
  NormRow(row)
  if not IsPassed(row.passed, row) then return { status = 'failed_last_test' } end
  if not row.expires_at then return { status = 'valid' } end

  local y, mo, d, h, mi, s = row.expires_at:match('(%d+)-(%d+)-(%d+) (%d+):(%d+):(%d+)')
  local expiryTime = os.time({ year = y, month = mo, day = d, hour = h, min = mi, sec = s })
  return { status = (expiryTime >= os.time()) and 'valid' or 'expired', expiresAt = row.expires_at }
end)

-- Every MOT test on a plate, newest first, for the government site's vehicle history check. Times are unix seconds.
--   exports['as-computer']:getMotRecords('AB12CDE')  ->  { records = { { testedAt, passed, expiresAt, mileage, unit, location }, ... } }
local function ToUnix(str)
  if type(str) ~= 'string' then return nil end
  local y, mo, d, h, mi, sec = str:match('(%d+)-(%d+)-(%d+) (%d+):(%d+):(%d+)')
  if not y then return nil end
  return os.time({ year = y, month = mo, day = d, hour = h, min = mi, sec = sec })
end

exports('getMotRecords', function(plateInput)
  local plate = tostring(plateInput or ''):upper():gsub('%s+', '')
  if plate == '' then return { records = {} } end
  local rows = MySQL.query.await(
    'SELECT passed, mileage, mileage_unit, location_label, issued_at, expires_at FROM mot_history WHERE UPPER(REPLACE(plate, " ", "")) = ? ORDER BY issued_at DESC LIMIT 40',
    { plate }
  ) or {}
  local out = {}
  for _, row in ipairs(rows) do
    NormRow(row)
    out[#out + 1] = {
      testedAt  = ToUnix(row.issued_at),
      passed    = IsPassed(row.passed, row),
      expiresAt = ToUnix(row.expires_at),
      mileage   = tonumber(row.mileage),
      unit      = row.mileage_unit,
      location  = row.location_label,
    }
  end
  return { records = out }
end)

-- A vehicle got a new registration (the government site's personalised plates): move its MOT records and garage
-- bookings over. Anything already filed under the new plate belonged to a vehicle that no longer exists.
exports('renamePlate', function(oldPlate, newPlate)
  local oldKey = tostring(oldPlate or ''):upper():gsub('%s+', '')
  local newKey = tostring(newPlate or ''):upper():gsub('%s+', '')
  if oldKey == '' or newKey == '' or oldKey == newKey then return false end
  MySQL.update.await('DELETE FROM mot_history WHERE UPPER(REPLACE(plate, " ", "")) = ?', { newKey })
  MySQL.update.await('UPDATE mot_history SET plate = ? WHERE UPPER(REPLACE(plate, " ", "")) = ?', { tostring(newPlate):upper():sub(1, 15), oldKey })
  Booking.renamePlate(oldKey, tostring(newPlate):upper())
  return true
end)
