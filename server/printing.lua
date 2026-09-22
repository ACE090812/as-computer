-- Print from the computer (server side). Every call goes to the as-printer resource; this file only decides who may, and builds the document.
--   options -> { available, printers = { { key, label, distance, paper, black, colour, allowed } }, designs, letterheads }
--   text    { title, text, printer, colour, design, letterhead }
--   image   { title, url, printer, colour, design, letterhead }
--   cert    { testNumber, printer, colour, design, letterhead }          an MOT certificate (read here from the database, cannot be copied)

PrintBridge = {}

local function on() return (Config.Printing or {}).enabled ~= false end
local function up() return on() and GetResourceState('as-printer') == 'started' end
PrintBridge.up = up

local function cut(s, n)
  s = tostring(s or '')
  local len = utf8.len(s)
  if not len or len <= n then return s end
  return s:sub(1, (utf8.offset(s, n + 1) or (#s + 1)) - 1)
end
local function line(s, n) return cut((tostring(s or ''):gsub('%c', ' '):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', '')), n) end

local function pick(data)
  return {
    printer = line(data.printer, 64), colour = data.colour == true,
    design = line(data.design, 24), letterhead = line(data.letterhead, 48),
  }
end

local function sendDoc(src, respond, doc, data)
  local res = exports['as-printer']:print(src, doc, pick(data))
  if type(res) ~= 'table' or not res.ok then
    return respond({ ok = false, reason = 'print', message = type(res) == 'table' and res.error or nil, code = type(res) == 'table' and res.code or nil })
  end
  respond({ ok = true, data = { pages = res.pages, seconds = res.seconds, printer = res.printer } })
end
PrintBridge.sendDoc = sendDoc

-- ---- MOT certificate -------------------------------------------------------------------------------
local function dateOf(v)
  if type(v) == 'number' then v = os.date('%Y-%m-%d %H:%M:%S', math.floor(v > 1e11 and v / 1000 or v)) end
  local y, m, d = tostring(v or ''):match('^(%d+)-(%d+)-(%d+)')
  if not y then return '' end
  local names = { 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' }
  return ('%d %s %s'):format(tonumber(d), names[tonumber(m)] or m, y)
end
PrintBridge.dateOf = dateOf

local function passedOf(v, row)
  if v == 1 or v == true or v == '1' then return true end
  if v == 0 or v == false or v == '0' then return false end
  return row ~= nil and row.expires_at ~= nil
end

local function labelled(idsJson, notesJson)
  local ok, ids = pcall(json.decode, idsJson or '[]')
  if not ok or type(ids) ~= 'table' then ids = {} end
  local nok, notes = pcall(json.decode, notesJson or '{}')
  if not nok or type(notes) ~= 'table' then notes = {} end
  local out = {}
  for _, id in ipairs(ids) do
    local it = (Config.ChecklistById or {})[id]
    out[#out + 1] = { section = it and it.section or '', label = it and it.label or tostring(id), note = type(notes[id]) == 'string' and notes[id] or nil }
  end
  return out
end

local function certData(row, model)
  local passed = passedOf(row.passed, row)
  local mileage = row.mileage and (tostring(row.mileage) .. ' ' .. tostring(row.mileage_unit or 'miles')) or ''
  return {
    testNumber = row.test_number, plate = row.plate, model = model or '', mileage = mileage,
    issuedAt = dateOf(row.issued_at), expiresAt = dateOf(row.expires_at), station = row.location_label, tester = row.tester_name,
    passed = passed, failed = labelled(row.failed_items, row.notes), advisories = labelled(row.advisory_items, row.notes),
  }
end
PrintBridge.certData = certData

-- ---- calls -------------------------------------------------------------------------------------------
MotCallback.Register('printApi', function(src, respond, name, data)
  if not Bridge.HasComputerJob(src) then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}
  if name == 'options' then
    if not up() then return respond({ ok = true, data = { available = false } }) end
    local o = exports['as-printer']:options(src) or {}
    return respond({ ok = true, data = { available = true, printers = exports['as-printer']:nearbyPrinters(src, 50.0) or {},
      designs = o.designs or {}, letterheads = o.letterheads or {} } })
  end
  if not up() then return respond({ ok = false, reason = 'no_printer' }) end

  if name == 'text' then
    if type(data.text) ~= 'string' or data.text:match('^%s*$') then return respond({ ok = false, reason = 'invalid' }) end
    return sendDoc(src, respond, { title = line(data.title, 80), text = cut(data.text, 50000), kind = 'file' }, data)
  end

  if name == 'image' then
    local url = tostring(data.url or '')
    if not url:match('^https://') then return respond({ ok = false, reason = 'invalid' }) end
    return sendDoc(src, respond, { title = line(data.title, 80), pages = { { t = 'image', v = url } }, kind = 'image' }, data)
  end

  if name == 'cert' then
    if not Apps.allowed(src, 'mot') then return respond({ ok = false, reason = 'not_authorised' }) end
    local tn = tostring(data.testNumber or '')
    if #tn > 20 then return respond({ ok = false, reason = 'invalid' }) end
    local row = MySQL.single.await('SELECT * FROM mot_history WHERE test_number = ? AND COALESCE(bin_state, 0) <> 2 LIMIT 1', { tn })
    if not row then return respond({ ok = false, reason = 'invalid' }) end
    local model
    pcall(function()
      local v = MySQL.single.await(('SELECT vehicle FROM `%s` WHERE UPPER(REPLACE(plate, " ", "")) = ? LIMIT 1'):format(Bridge.VehicleTable()),
        { (tostring(row.plate or ''):upper():gsub('%s+', '')) })
      model = v and v.vehicle
    end)
    local pd = exports['as-printer']
    local res = pd:printTemplate(src, 'mot_certificate', certData(row, model), pick(data))
    if type(res) ~= 'table' or not res.ok then
      return respond({ ok = false, reason = 'print', message = type(res) == 'table' and res.error or nil, code = type(res) == 'table' and res.code or nil })
    end
    return respond({ ok = true, data = { pages = res.pages, seconds = res.seconds, printer = res.printer } })
  end

  respond({ ok = false, reason = 'invalid' })
end)
