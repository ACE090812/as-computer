-- MDT app (server side): dashboard, people/vehicle lookup, reports and BOLOs.
-- Ported from the old standalone as-mdt resource's server/main.lua, onto as-computer's own
-- MotCallback.Register('mdtApi', ...) dispatcher (see server/apps.lua's storeApi for the pattern)
-- and as-computer's Bridge (client/server framework bridge) instead of as-mdt's own copy of the
-- same framework-detection code.
--
-- Every branch below starts by requiring Apps.allowed(src, 'mdt') (the same gate every other
-- app's server callbacks use), so this app disappears completely if Config.EnabledApps.mdt = false,
-- if the job isn't in Config.MDT.jobs, or the App is otherwise unavailable.

-- NOTE (verify against your live server): as-computer's own Bridge (server/bridge.lua) has no
-- generic "search all citizens" helper — Apps that need one (this one) fall back to reading the
-- framework's players table directly, same as as-mdt's original code did. This local detection
-- block is new for this file; double check the qb/qbox/esx branches below against your actual
-- schema before relying on People search in production.
local FW = nil
CreateThread(function()
  if GetResourceState('qbx_core') == 'started' then FW = 'qbox'
  elseif GetResourceState('qb-core') == 'started' then FW = 'qbcore'
  elseif GetResourceState('es_extended') == 'started' then FW = 'esx' end
end)

-- ---- schema ---------------------------------------------------------------------------------
-- Table names kept identical to the old as-mdt resource so existing data isn't orphaned.
CreateThread(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_reports` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `title` VARCHAR(160) NOT NULL DEFAULT 'Report',
      `type` VARCHAR(40) NOT NULL DEFAULT 'Incident',
      `involved` VARCHAR(255) NOT NULL DEFAULT '',
      `charges` TEXT NULL,
      `narrative` TEXT NULL,
      `suspect_cid` VARCHAR(64) NULL,
      `suspect_name` VARCHAR(120) NULL,
      `author_cid` VARCHAR(64) NOT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `case_number` VARCHAR(20) NULL,
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  -- A table made before case numbers existed gets the new column (guarded, same pattern as
  -- files.lua's own migrations: check information_schema first so this is safe to run repeatedly
  -- against a table that may already have existing rows/columns).
  local hasCaseNumber = MySQL.scalar.await([[
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'mdt_reports' AND column_name = 'case_number'
  ]])
  if not hasCaseNumber or hasCaseNumber == 0 then
    pcall(function() MySQL.query.await('ALTER TABLE mdt_reports ADD COLUMN case_number VARCHAR(20) NULL') end)
  end
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_bolos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `title` VARCHAR(160) NOT NULL DEFAULT 'BOLO',
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `description` TEXT NULL,
      `active` TINYINT NOT NULL DEFAULT 1,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_bookings` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `suspect_cid` VARCHAR(64) NOT NULL,
      `suspect_name` VARCHAR(120) NOT NULL DEFAULT '',
      `charges` TEXT NULL,
      `total_months` INT NOT NULL DEFAULT 0,
      `total_fine` INT NOT NULL DEFAULT 0,
      `officer_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `report_id` INT NULL,
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_status` (
      `plate` VARCHAR(16) NOT NULL,
      `insured` TINYINT NOT NULL DEFAULT 0,
      `insurance_expiry` DATE NULL,
      `taxed` TINYINT NOT NULL DEFAULT 0,
      `tax_expiry` DATE NULL,
      `impounded` TINYINT NOT NULL DEFAULT 0,
      `impound_reason` VARCHAR(255) NULL,
      `impounded_by` VARCHAR(120) NULL,
      `updated_by` VARCHAR(120) NULL,
      `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_notes` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `note` TEXT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `plate` (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_vehicle_photos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `plate` VARCHAR(16) NOT NULL DEFAULT '',
      `url` VARCHAR(500) NOT NULL DEFAULT '',
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `plate` (`plate`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_person_notes` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `cid` VARCHAR(64) NOT NULL DEFAULT '',
      `note` TEXT NULL,
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `cid` (`cid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `mdt_person_photos` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `cid` VARCHAR(64) NOT NULL DEFAULT '',
      `url` VARCHAR(500) NOT NULL DEFAULT '',
      `author_name` VARCHAR(120) NOT NULL DEFAULT 'Officer',
      `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`),
      KEY `cid` (`cid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

-- ---- helpers ----------------------------------------------------------------------------------

--- Uses the framework's own job grade number directly, same rule as as-mdt's Config.Permissions.
local function gradeAllowed(job, minGrade)
  minGrade = minGrade or (Config.MDT and Config.MDT.adminMinGrade) or 0
  if minGrade <= 0 then return true end
  return (job and job.grade or 0) >= minGrade
end

local function normDate(v)
  if v == nil then return nil end
  local s = tostring(v)
  if s:match('^%d+$') then
    local n = tonumber(s)
    if n and n > 100000000 then
      if n > 100000000000 then n = math.floor(n / 1000) end
      return os.date('%Y-%m-%d', n)
    end
  end
  return s:sub(1, 10)
end

function MdtVehImpoundStatus(plate)
  local row = MySQL.single.await('SELECT impounded, impound_reason, impounded_by FROM mdt_vehicle_status WHERE plate = ?', { plate })
  if not row then return { impounded = false } end
  return { impounded = row.impounded == 1, reason = row.impound_reason, by = row.impounded_by }
end

-- Insurance, tax and MOT are NOT tracked by MDT itself — they live in as-browser's Los Santos
-- Government / CoverCompare websites (the same ones the in-phone browser's vehicle checker
-- reads), so MDT asks that resource for the live state via its `getVehicleStatus` export rather
-- than keeping its own copy that would drift out of sync with what the vehicle checker shows.
-- Falls back to "none" for everything if as-browser isn't running or the plate is unknown to it.
local function getRealVehicleStatus(plate)
  local none = { state = 'none' }
  local ok, status = pcall(function() return exports['as-browser']:getVehicleStatus(plate) end)
  if not ok or type(status) ~= 'table' then return none, none, nil end

  local insurance = { state = status.insured and 'valid' or 'none',
    date = status.insuranceEndsAt and os.date('%Y-%m-%d', status.insuranceEndsAt) or nil,
    provider = status.insuranceProvider }

  local tax = none
  if status.tax then
    if status.tax.status == 'exempt' then tax = { state = 'valid' }
    elseif status.tax.status == 'taxed' then tax = { state = 'valid', date = status.tax.expiry and os.date('%Y-%m-%d', status.tax.expiry) or nil }
    elseif status.tax.status == 'untaxed' then tax = { state = 'expired', date = status.tax.expiry and os.date('%Y-%m-%d', status.tax.expiry) or nil }
    end
  end

  local mot = nil
  if status.mot and status.mot.enabled then
    if status.mot.status == 'valid' then
      mot = { passed = true, expired = false, expiresAt = status.mot.expiry and os.date('%Y-%m-%d', status.mot.expiry) or nil }
    elseif status.mot.status == 'expired' then
      mot = { passed = true, expired = true, expiresAt = status.mot.expiry and os.date('%Y-%m-%d', status.mot.expiry) or nil }
    elseif status.mot.status == 'failed' then
      mot = { passed = false, expired = false }
    end
  end

  return insurance, tax, mot
end

-- ---- report file template ------------------------------------------------------------------
-- Builds the formatted HTML that gets written into the report's file in Case Files, instead of
-- one flat run-on line of "Label: value" pairs. Uses only the tags File Explorer's rich-text
-- files allow (h1-h3, b, p, br, ul/li - see server/files.lua's ALLOWED_TAGS), and escapes every
-- officer-entered value so stray '<'/'&' in a narrative can't break the layout.

local REPORT_TEMPLATES = {
  Incident          = { title = 'Incident Report' },
  Arrest            = { title = 'Arrest Report' },
  ['Traffic Stop']  = { title = 'Traffic Stop Report' },
  Investigation     = { title = 'Investigation Report' },
  ['Use of Force']  = { title = 'Use of Force Report' },
  ['Field Interview'] = { title = 'Field Interview Report' },
}

local function escHtml(s)
  return (tostring(s or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

local function nlToBr(s) return (escHtml(s):gsub('\r?\n', '<br>')) end

--- MySQL TIMESTAMP columns can come back as a unix-seconds (or -ms) number depending on the
--- driver, or as a datetime string - handle both rather than tostring()-ing a raw epoch number.
local function fmtWhen(v)
  if v == nil or v == '' then return '' end
  local n = tonumber(v)
  if n then
    if n > 100000000000 then n = n / 1000 end
    return os.date('%d %b %Y, %H:%M', math.floor(n))
  end
  return tostring(v):gsub('%.0$', ''):sub(1, 16)
end

local function chargeItems(charges)
  local items = {}
  if not charges or charges == '' then return items end
  for part in (charges .. ','):gmatch('([^,]*),') do
    local t = part:match('^%s*(.-)%s*$')
    if t ~= '' then items[#items + 1] = t end
  end
  return items
end

local function kvLine(label, value)
  if not value or value == '' then return '' end
  return '<p><b>' .. escHtml(label) .. ':</b> ' .. escHtml(value) .. '</p>'
end

local function buildReportBody(reportId, caseNumber, row)
  local tpl = REPORT_TEMPLATES[row.type] or { title = (row.type or 'Incident') .. ' Report' }
  local out = {}
  out[#out + 1] = '<h2>' .. escHtml(tpl.title) .. '</h2>'
  out[#out + 1] = '<p><b>Case ' .. escHtml(caseNumber) .. '</b> — Report #' .. escHtml(reportId) .. '</p>'
  out[#out + 1] = '<p><b>Filed by:</b> ' .. escHtml(row.author_name) .. '<br><b>Filed:</b> ' .. escHtml(fmtWhen(row.created_at)) .. '</p>'
  out[#out + 1] = '<h3>' .. escHtml(row.title ~= '' and row.title or 'Untitled') .. '</h3>'
  out[#out + 1] = kvLine('Suspect', row.suspect_name)
  out[#out + 1] = kvLine('Involved', row.involved)
  local charges = chargeItems(row.charges)
  if #charges > 0 then
    local ul = { '<p><b>Charges</b></p><ul>' }
    for _, c in ipairs(charges) do ul[#ul + 1] = '<li>' .. escHtml(c) .. '</li>' end
    ul[#ul + 1] = '</ul>'
    out[#out + 1] = table.concat(ul)
  end
  local narrative = row.narrative
  if narrative == nil or narrative == '' then
    out[#out + 1] = '<p><b>Narrative</b></p><p>(none provided)</p>'
  elseif narrative:match('^%s*<') then
    -- Written with the rich-text narrative editor (Bold/Italic/Underline/Lists, or a template) -
    -- already safe HTML from a small, controlled set of tags execCommand produces, so it's
    -- inserted as-is rather than escaped, which would otherwise dump raw tags onto the page.
    out[#out + 1] = '<p><b>Narrative</b></p><div>' .. narrative .. '</div>'
  else
    out[#out + 1] = '<p><b>Narrative</b></p><p>' .. nlToBr(narrative) .. '</p>'
  end
  return table.concat(out)
end

-- ---- case numbers ------------------------------------------------------------------------------
-- Format CASE-0001, CASE-0002, ... zero-padded to at least 4 digits (grows past 5+ digits rather
-- than truncating once a server passes 9999 reports). Multiple reports may share one case number;
-- only the auto-generate path below is allowed to mint a brand-new one.

local function nextCaseNumber()
  local rows = MySQL.query.await(
    "SELECT case_number FROM mdt_reports WHERE case_number REGEXP '^CASE-[0-9]+$'") or {}
  local best = 0
  for _, r in ipairs(rows) do
    local n = tonumber((r.case_number or ''):match('^CASE%-(%d+)$'))
    if n and n > best then best = n end
  end
  return ('CASE-%04d'):format(best + 1)
end

--- Suspect names (deduplicated, in first-added order) across every report currently filed under
--- this case number. Used to name/rename the case's shared folder in the legal group folder.
local function caseSuspectNames(caseNumber)
  if not caseNumber or caseNumber == '' then return {} end
  local rows = MySQL.query.await(
    'SELECT suspect_name FROM mdt_reports WHERE case_number = ? ORDER BY id ASC', { caseNumber }) or {}
  local seen, names = {}, {}
  for _, r in ipairs(rows) do
    local nm = r.suspect_name
    if nm and nm ~= '' and not seen[nm] then
      seen[nm] = true
      names[#names + 1] = nm
    end
  end
  return names
end

--- { {name, job, grade, cid, onDuty}, ... } for every currently-connected officer on an MDT job.
local function jobsSet()
  local set = {}
  for _, j in ipairs(Config.MDT and Config.MDT.jobs or {}) do set[j] = true end
  return set
end

local function getOnDutyUnits()
  local units, allow = {}, jobsSet()
  for _, id in ipairs(GetPlayers()) do
    local src = tonumber(id)
    local job = Bridge.GetJob(src)
    if job and allow[job.name] then
      units[#units + 1] = { name = Bridge.GetName(src), job = job.name, jobLabel = job.label, grade = job.grade or 0, onDuty = true }
    end
  end
  return units
end

-- ---- people (citizen) search: reads the framework's own players table -----------------------

local function searchCitizens(query)
  local q = '%' .. (query or '') .. '%'
  local rows = {}
  if FW == 'qbcore' or FW == 'qbox' then
    rows = MySQL.query.await([[
      SELECT citizenid, charinfo FROM players
      WHERE JSON_EXTRACT(charinfo,'$.firstname') LIKE ? OR JSON_EXTRACT(charinfo,'$.lastname') LIKE ? OR citizenid LIKE ?
      LIMIT 30
    ]], { q, q, q }) or {}
  elseif FW == 'esx' then
    rows = MySQL.query.await([[
      SELECT identifier AS citizenid, firstname, lastname, dateofbirth FROM users
      WHERE firstname LIKE ? OR lastname LIKE ? OR identifier LIKE ? LIMIT 30
    ]], { q, q, q }) or {}
  end
  local out = {}
  for _, r in ipairs(rows) do
    local first, last, dob, phone = '', '', '', ''
    if r.charinfo then
      local ok, ci = pcall(json.decode, r.charinfo)
      if ok and ci then first = ci.firstname or ''; last = ci.lastname or ''; dob = ci.birthdate or ''; phone = ci.phone or '' end
    else
      first = r.firstname or ''; last = r.lastname or ''; dob = r.dateofbirth or ''
    end
    out[#out + 1] = { cid = r.citizenid, name = (first .. ' ' .. last), dob = dob, phone = phone }
  end
  return out
end

local function getCitizen(cid)
  if not cid then return nil end
  local person = { cid = cid }
  if FW == 'qbcore' or FW == 'qbox' then
    local row = MySQL.single.await('SELECT citizenid, charinfo FROM players WHERE citizenid = ?', { cid })
    if row and row.charinfo then
      local ok, ci = pcall(json.decode, row.charinfo)
      if ok and ci then
        person.name = (ci.firstname or '') .. ' ' .. (ci.lastname or '')
        person.dob = ci.birthdate or ''; person.phone = ci.phone or ''
        -- qb/qbox store gender as either a plain string or the old 0/1 numeric convention -
        -- handle both rather than assuming one.
        if type(ci.gender) == 'number' then person.gender = ci.gender == 1 and 'Female' or 'Male'
        elseif type(ci.gender) == 'string' and ci.gender ~= '' then person.gender = ci.gender end
        person.nationality = (type(ci.nationality) == 'string' and ci.nationality ~= '') and ci.nationality or nil
      end
    end
  elseif FW == 'esx' then
    local row = MySQL.single.await('SELECT identifier, firstname, lastname, dateofbirth, phone_number FROM users WHERE identifier = ?', { cid })
    if row then
      person.name = (row.firstname or '') .. ' ' .. (row.lastname or '')
      person.dob = row.dateofbirth or ''; person.phone = row.phone_number or ''
    end
  end

  -- vehicles owned, via Bridge's own table/column helpers (already handles qb/qbox/esx).
  local vehs = {}
  local ok = pcall(function()
    vehs = MySQL.query.await(('SELECT plate, vehicle FROM %s WHERE %s = ? LIMIT 20'):format(Bridge.VehicleTable(), Bridge.VehicleOwnerColumn()), { cid }) or {}
  end)
  if ok then
    for _, v in ipairs(vehs) do v.vehicle = Bridge.VehicleModelLabel(v.vehicle) end
  end

  -- booking / criminal history: reports where this person is the named suspect, plus processed bookings.
  local reports = MySQL.query.await(
    'SELECT id, title, type, involved, charges, narrative, author_name, created_at FROM mdt_reports WHERE suspect_cid = ? ORDER BY id DESC', { cid }) or {}
  for _, r in ipairs(reports) do r.created_at = fmtWhen(r.created_at) end

  local bookings = MySQL.query.await(
    'SELECT id, charges, total_months, total_fine, officer_name, report_id, created_at FROM mdt_bookings WHERE suspect_cid = ? ORDER BY id DESC LIMIT 30', { cid }) or {}
  for _, b in ipairs(bookings) do
    b.created_at = fmtWhen(b.created_at)
    local ok2, ch = pcall(json.decode, b.charges or '[]')
    b.charges = ok2 and ch or {}
  end

  local notes = MySQL.query.await(
    'SELECT id, note, author_name, created_at FROM mdt_person_notes WHERE cid = ? ORDER BY id DESC', { cid }) or {}
  for _, n in ipairs(notes) do n.created_at = fmtWhen(n.created_at) end

  local photos = MySQL.query.await(
    'SELECT id, url, author_name, created_at FROM mdt_person_photos WHERE cid = ? ORDER BY id DESC', { cid }) or {}
  for _, ph in ipairs(photos) do ph.created_at = fmtWhen(ph.created_at) end

  person.vehicles = vehs
  person.reports = reports
  person.bookings = bookings
  person.notes = notes
  person.photos = photos
  return person
end

-- ---- vehicles -----------------------------------------------------------------------------

local function searchVehicles(query)
  local q = '%' .. (query or '') .. '%'
  local rows = {}
  local ok = pcall(function()
    rows = MySQL.query.await(([[
      SELECT plate, vehicle FROM %s WHERE plate LIKE ? LIMIT 30
    ]]):format(Bridge.VehicleTable()), { q }) or {}
  end)
  if not ok then return {} end
  local out = {}
  for _, r in ipairs(rows) do
    out[#out + 1] = { plate = r.plate, model = Bridge.VehicleModelLabel(r.vehicle) }
  end
  return out
end

local function getVehicle(plate)
  if not plate then return nil end
  local model, ownerCid = '', nil
  local ok = pcall(function()
    local row = MySQL.single.await(
      ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate = ? LIMIT 1'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { plate })
    if row then model = Bridge.VehicleModelLabel(row.vehicle) or ''; ownerCid = row.owner_cid end
  end)

  local ownerName = 'Unknown'
  if ownerCid then
    local nm = Bridge.CharacterName(ownerCid)
    if nm then ownerName = nm end
  end

  local bolos = MySQL.query.await(
    'SELECT id, title, description, active, author_name, created_at FROM mdt_bolos WHERE plate = ? ORDER BY active DESC, id DESC', { plate }) or {}
  for _, b in ipairs(bolos) do b.created_at = fmtWhen(b.created_at); b.active = (b.active == 1) end

  local insurance, tax, mot = getRealVehicleStatus(plate)

  local impound = MdtVehImpoundStatus(plate)

  local notes = MySQL.query.await(
    'SELECT id, note, author_name, created_at FROM mdt_vehicle_notes WHERE plate = ? ORDER BY id DESC', { plate }) or {}
  for _, n in ipairs(notes) do n.created_at = fmtWhen(n.created_at) end

  local photos = MySQL.query.await(
    'SELECT id, url, author_name, created_at FROM mdt_vehicle_photos WHERE plate = ? ORDER BY id DESC', { plate }) or {}
  for _, p in ipairs(photos) do p.created_at = fmtWhen(p.created_at) end

  return { plate = plate, model = model, owner = ownerName, ownerCid = ownerCid, bolos = bolos, insurance = insurance, tax = tax, mot = mot, impound = impound, notes = notes, photos = photos }
end

-- ---- dispatcher ---------------------------------------------------------------------------
-- name: 'boot' | 'dashboard' | 'peopleSearch' | 'personGet' | 'vehicleSearch' | 'vehicleGet' |
--       'vehicleSetStatus' | 'vehicleToggleImpound' | 'reportsList' | 'reportGet' | 'reportSave' |
--       'reportDelete' | 'bolosList' | 'boloSave' | 'boloToggle' | 'boloDelete' | 'chargesList'
MotCallback.Register('mdtApi', function(src, respond, name, data)
  data = type(data) == 'table' and data or {}
  local job = Bridge.GetJob(src)
  if not job or not Apps.allowed(src, 'mdt') then return respond({ ok = false, reason = 'not_authorised' }) end
  local isAdmin = gradeAllowed(job)

  if name == 'boot' then
    return respond({ ok = true, data = {
      officer = { name = Bridge.GetName(src), cid = Bridge.GetIdentifier(src), job = job.name, jobLabel = job.label, grade = job.grade or 0 },
      isAdmin = isAdmin,
      reportTypes = { 'Incident', 'Arrest', 'Traffic Stop', 'Investigation', 'Use of Force', 'Field Interview' },
    } })
  end

  if name == 'dashboard' then
    local reportCount = MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports') or 0
    local boloCount = MySQL.scalar.await('SELECT COUNT(*) FROM mdt_bolos WHERE active = 1') or 0
    local recentReports = MySQL.query.await('SELECT id, title, type, author_name, created_at FROM mdt_reports ORDER BY id DESC LIMIT 6') or {}
    for _, r in ipairs(recentReports) do r.created_at = fmtWhen(r.created_at) end
    local activeBolos = MySQL.query.await('SELECT id, title, plate, created_at FROM mdt_bolos WHERE active = 1 ORDER BY id DESC LIMIT 5') or {}
    for _, b in ipairs(activeBolos) do b.created_at = fmtWhen(b.created_at) end
    local units = getOnDutyUnits()
    return respond({ ok = true, data = {
      reportCount = reportCount, boloCount = boloCount, recentReports = recentReports, activeBolos = activeBolos,
      units = units, onDutyCount = #units,
    } })
  end

  if name == 'peopleSearch' then
    return respond({ ok = true, data = { people = searchCitizens(data.query) } })
  end

  if name == 'personGet' then
    local p = getCitizen(data.cid)
    if not p then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { person = p } })
  end

  if name == 'personNoteAdd' then
    local cid = (data.cid or ''):sub(1, 64)
    local note = (data.note or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if cid == '' or note == '' then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.insert.await('INSERT INTO mdt_person_notes (cid, note, author_name) VALUES (?, ?, ?)',
      { cid, note:sub(1, 2000), Bridge.GetName(src) })
    return respond({ ok = true, data = { person = getCitizen(cid) } })
  end

  if name == 'personNoteDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.cid then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_person_notes WHERE id = ?', { data.id })
    return respond({ ok = true, data = { person = getCitizen(data.cid) } })
  end

  if name == 'personPhotoAdd' then
    local cid = (data.cid or ''):sub(1, 64)
    local url = (data.url or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if cid == '' or url == '' then return respond({ ok = false, reason = 'invalid' }) end
    if not url:match('^https?://') then return respond({ ok = false, reason = 'invalid_url' }) end
    MySQL.insert.await('INSERT INTO mdt_person_photos (cid, url, author_name) VALUES (?, ?, ?)',
      { cid, url:sub(1, 500), Bridge.GetName(src) })
    return respond({ ok = true, data = { person = getCitizen(cid) } })
  end

  if name == 'personPhotoDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.cid then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_person_photos WHERE id = ?', { data.id })
    return respond({ ok = true, data = { person = getCitizen(data.cid) } })
  end

  if name == 'vehicleSearch' then
    return respond({ ok = true, data = { vehicles = searchVehicles(data.query) } })
  end

  if name == 'vehicleGet' then
    local v = getVehicle(data.plate)
    if not v then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { vehicle = v } })
  end

  if name == 'vehicleToggleImpound' then
    if not data.plate or data.plate == '' then return respond({ ok = false, reason = 'invalid' }) end
    local cur = MdtVehImpoundStatus(data.plate)
    local newState = not cur.impounded
    MySQL.query.await([[
      INSERT INTO mdt_vehicle_status (plate, impounded, impound_reason, impounded_by) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE impounded = VALUES(impounded), impound_reason = VALUES(impound_reason), impounded_by = VALUES(impounded_by)
    ]], { data.plate, newState and 1 or 0, newState and (data.reason or 'Flagged from MDT') or nil, newState and Bridge.GetName(src) or nil })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'vehicleNoteAdd' then
    local plate = (data.plate or ''):sub(1, 16)
    local note = (data.note or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' or note == '' then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.insert.await('INSERT INTO mdt_vehicle_notes (plate, note, author_name) VALUES (?, ?, ?)',
      { plate, note:sub(1, 2000), Bridge.GetName(src) })
    return respond({ ok = true, data = { vehicle = getVehicle(plate) } })
  end

  if name == 'vehicleNoteDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.plate then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_vehicle_notes WHERE id = ?', { data.id })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'vehiclePhotoAdd' then
    local plate = (data.plate or ''):sub(1, 16)
    local url = (data.url or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' or url == '' then return respond({ ok = false, reason = 'invalid' }) end
    if not url:match('^https?://') then return respond({ ok = false, reason = 'invalid_url' }) end
    MySQL.insert.await('INSERT INTO mdt_vehicle_photos (plate, url, author_name) VALUES (?, ?, ?)',
      { plate, url:sub(1, 500), Bridge.GetName(src) })
    return respond({ ok = true, data = { vehicle = getVehicle(plate) } })
  end

  if name == 'vehiclePhotoDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id or not data.plate then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_vehicle_photos WHERE id = ?', { data.id })
    return respond({ ok = true, data = { vehicle = getVehicle(data.plate) } })
  end

  if name == 'reportsList' then
    local rows = MySQL.query.await(
      'SELECT id, title, type, involved, suspect_cid, suspect_name, author_name, case_number, created_at FROM mdt_reports ORDER BY id DESC LIMIT 100') or {}
    for _, r in ipairs(rows) do r.created_at = fmtWhen(r.created_at) end
    return respond({ ok = true, data = { reports = rows } })
  end

  if name == 'reportGet' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local r = MySQL.single.await(
      'SELECT id, title, type, involved, charges, narrative, suspect_cid, suspect_name, author_name, case_number, created_at FROM mdt_reports WHERE id = ?', { data.id })
    if not r then return respond({ ok = false, reason = 'not_found' }) end
    r.created_at = fmtWhen(r.created_at)
    return respond({ ok = true, data = { report = r } })
  end

  if name == 'reportSave' then
    local title = (data.title and data.title ~= '') and data.title:sub(1, 160) or 'Untitled report'
    local rtype = data.type or 'Incident'
    local involved = data.involved or ''
    local charges = data.charges or ''
    local narrative = data.narrative or ''
    local authorName = Bridge.GetName(src)

    -- ---- case number: auto-generate for a brand-new report left blank, otherwise attach to an
    -- existing case (typed case numbers may never mint a new case on their own). ----
    local existingCase = nil
    if data.id then
      existingCase = MySQL.scalar.await('SELECT case_number FROM mdt_reports WHERE id = ?', { data.id })
    end
    local typed = tostring(data.case_number or ''):match('^%s*(.-)%s*$')
    local caseNumber
    if typed == '' then
      if data.id and existingCase and existingCase ~= '' then
        caseNumber = existingCase   -- editing, left blank: keep whatever it already had
      else
        caseNumber = nextCaseNumber()
      end
    else
      typed = typed:upper()
      local found = MySQL.scalar.await('SELECT id FROM mdt_reports WHERE case_number = ? LIMIT 1', { typed })
      if not found then
        return respond({ ok = false, reason = 'case_not_found' })
      end
      caseNumber = typed
    end

    local reportId = data.id
    if data.id then
      MySQL.update.await(
        'UPDATE mdt_reports SET title=?, type=?, involved=?, charges=?, narrative=?, suspect_cid=?, suspect_name=?, case_number=? WHERE id=?',
        { title, rtype, involved, charges, narrative, data.suspect_cid, data.suspect_name, caseNumber, data.id })
    else
      reportId = MySQL.insert.await(
        'INSERT INTO mdt_reports (title, type, involved, charges, narrative, suspect_cid, suspect_name, author_cid, author_name, case_number) VALUES (?,?,?,?,?,?,?,?,?,?)',
        { title, rtype, involved, charges, narrative, data.suspect_cid, data.suspect_name, Bridge.GetIdentifier(src), authorName, caseNumber })
    end

    -- Mirror the report into File Explorer's shared "legal" group folder (police + judges/lawyers/
    -- solicitors/barristers): one folder per case number (named after the case and every suspect
    -- filed under it so far), with each report as a file inside. Safely inert if Config.LegalFolder
    -- is missing/disabled, or if files.lua isn't loaded.
    if reportId and Files and Files.SyncLegalCase then
      local row = MySQL.single.await(
        'SELECT title, type, involved, charges, narrative, suspect_name, author_name, created_at FROM mdt_reports WHERE id = ?', { reportId })
      if row then
        local caseHasReports = (MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports WHERE case_number = ?', { caseNumber }) or 0) > 0
        local okSync, errSync = pcall(function() Files.SyncLegalCase(caseNumber, caseSuspectNames(caseNumber), caseHasReports) end)
        if not okSync then print(('^1[as-computer:mdt] Files.SyncLegalCase failed for case %s: %s^0'):format(tostring(caseNumber), tostring(errSync))) end
        local body = buildReportBody(reportId, caseNumber, row)
        local fname = ('Report - %s (#%s).txt'):format((row.title or 'Untitled'):gsub('[%c\\/:*?"<>|]', ''), tostring(reportId))
        local maxNm = (Config.Files and Config.Files.maxNameLength) or 80
        if #fname > maxNm then
          local suffix = (' (#%s).txt'):format(tostring(reportId))
          fname = fname:sub(1, math.max(1, maxNm - #suffix)) .. suffix
        end
        local okFile, errFile = pcall(function() Files.UpsertLegalReportFileInCase(caseNumber, reportId, fname, body, Bridge.GetIdentifier(src), authorName) end)
        if not okFile then print(('^1[as-computer:mdt] Files.UpsertLegalReportFileInCase failed for report #%s: %s^0'):format(tostring(reportId), tostring(errFile))) end
      end
    elseif reportId and not (Files and Files.SyncLegalCase) then
      print('^1[as-computer:mdt] Files.SyncLegalCase is not defined — server/files.lua may not have loaded, or loaded before this change. Case folder sync skipped.^0')
    end

    return respond({ ok = true, data = { id = reportId, caseNumber = caseNumber } })
  end

  if name == 'reportDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    local caseNumber = MySQL.scalar.await('SELECT case_number FROM mdt_reports WHERE id = ?', { data.id })
    MySQL.update.await('DELETE FROM mdt_reports WHERE id = ?', { data.id })
    if Files and Files.DeleteLegalReportFileInCase and caseNumber and caseNumber ~= '' then
      local okDel, errDel = pcall(function() Files.DeleteLegalReportFileInCase(caseNumber, data.id) end)
      if not okDel then print(('^1[as-computer:mdt] Files.DeleteLegalReportFileInCase failed for report #%s: %s^0'):format(tostring(data.id), tostring(errDel))) end
      local caseHasReports2 = (MySQL.scalar.await('SELECT COUNT(*) FROM mdt_reports WHERE case_number = ?', { caseNumber }) or 0) > 0
      local okSync2, errSync2 = pcall(function() Files.SyncLegalCase(caseNumber, caseSuspectNames(caseNumber), caseHasReports2) end)
      if not okSync2 then print(('^1[as-computer:mdt] Files.SyncLegalCase (post-delete) failed for case %s: %s^0'):format(tostring(caseNumber), tostring(errSync2))) end
    end
    return respond({ ok = true })
  end

  if name == 'boloVehicleLookup' then
    -- Used by the New BOLO form: given a plate the officer just typed/picked, look up its make,
    -- model, colour and registered owner so the description can be filled in automatically
    -- instead of the officer having to go check the vehicle record separately.
    local plate = (data.plate or ''):gsub('^%s+', ''):gsub('%s+$', '')
    if plate == '' then return respond({ ok = false, reason = 'invalid' }) end
    local model, ownerCid = '', nil
    pcall(function()
      local row = MySQL.single.await(
        ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate = ? LIMIT 1'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { plate })
      if row then model = Bridge.VehicleModelLabel(row.vehicle) or ''; ownerCid = row.owner_cid end
    end)
    -- The officer is usually still typing (this fires on every debounced keystroke), so an exact
    -- match on the partial string will normally miss. Fall back to the same LIKE search the
    -- plate suggestions dropdown uses, and resolve to that vehicle's real plate when it's the
    -- only match - this is what actually makes "type ACE, see the details fill in" work rather
    -- than requiring the officer to type the complete plate first.
    if model == '' and not ownerCid then
      local likeOk, likeRows = pcall(function()
        return MySQL.query.await(
          ('SELECT plate, vehicle, %s AS owner_cid FROM %s WHERE plate LIKE ? LIMIT 2'):format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { '%' .. plate .. '%' })
      end)
      if likeOk and type(likeRows) == 'table' and #likeRows == 1 then
        plate = likeRows[1].plate
        model = Bridge.VehicleModelLabel(likeRows[1].vehicle) or ''
        ownerCid = likeRows[1].owner_cid
      end
    end
    local ownerName = ownerCid and Bridge.CharacterName(ownerCid) or nil
    local colour, make = nil, nil
    local ok, status = pcall(function() return exports['as-browser']:getVehicleStatus(plate) end)
    if ok and type(status) == 'table' then
      colour = status.colour
      make = status.make
      if model == '' then model = status.model or '' end
    end
    if model == '' and not colour and not ownerName then return respond({ ok = false, reason = 'not_found' }) end
    return respond({ ok = true, data = { plate = plate, model = model, make = make, colour = colour, owner = ownerName } })
  end

  if name == 'bolosList' then
    local rows = MySQL.query.await(
      'SELECT id, title, plate, description, active, author_name, created_at FROM mdt_bolos ORDER BY active DESC, id DESC LIMIT 100') or {}
    for _, r in ipairs(rows) do r.created_at = fmtWhen(r.created_at); r.active = (r.active == 1) end
    return respond({ ok = true, data = { bolos = rows } })
  end

  if name == 'boloSave' then
    local title = (data.title or 'BOLO'):sub(1, 160)
    local plate = (data.plate or ''):sub(1, 16)
    local id = MySQL.insert.await('INSERT INTO mdt_bolos (title, plate, description, author_name) VALUES (?,?,?,?)',
      { title, plate, data.description or '', Bridge.GetName(src) })
    return respond({ ok = true, data = { id = id } })
  end

  if name == 'boloToggle' then
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('UPDATE mdt_bolos SET active = IF(active=1,0,1) WHERE id = ?', { data.id })
    return respond({ ok = true })
  end

  if name == 'boloDelete' then
    if not isAdmin then return respond({ ok = false, reason = 'not_authorised' }) end
    if not data.id then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.update.await('DELETE FROM mdt_bolos WHERE id = ?', { data.id })
    return respond({ ok = true })
  end

  if name == 'chargesList' then
    local out = {}
    for _, ch in ipairs(Config.MDT and Config.MDT.charges or {}) do
      out[#out + 1] = { code = ch.code, title = ch.title, type = ch.type, months = ch.months, fine = ch.fine, category = ch.category }
    end
    return respond({ ok = true, data = { charges = out } })
  end

  respond({ ok = false, reason = 'invalid' })
end)
