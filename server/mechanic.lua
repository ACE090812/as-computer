-- Mechanic app (server side): customers, job cards, quotes and invoices, parts stock, vehicle history.
--
-- One NUI/server callback, 'mechanicApi', with a name and a data table (see the handlers H['...'] below).
-- Every query is scoped to the caller's job, and every value coming from the page is validated here.
-- Money is whole pounds. Times are unix seconds (real server time).

Mechanic = {}

local H = {}          -- handlers: H['jobs.save'] = function(ctx, data, respond) ... return result end
local busy = {}

local function cfg() return Config.Mechanic or {} end
local function now() return os.time() end

local function num(v, d)
  v = tonumber(v)
  if v == nil or v ~= v or v == math.huge or v == -math.huge then return d end
  return v
end

local function int(v, d, lo, hi)
  v = num(v, d)
  if v == nil then return nil end
  v = math.floor(v)
  if lo and v < lo then v = lo end
  if hi and v > hi then v = hi end
  return v
end

--- One-line text: control characters removed, spaces collapsed, cut to `max`.
local function str(v, max)
  if type(v) ~= 'string' then return '' end
  v = v:gsub('%c', ' '):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', '')
  return v:sub(1, max)
end

--- Multi-line text (notes, descriptions).
local function text(v, max)
  if type(v) ~= 'string' then return '' end
  v = v:gsub('\r', ''):gsub('%c', function(c) return c == '\n' and c or ' ' end)
  v = v:gsub('[ \t]+', ' '):gsub(' ?\n ?', '\n'):gsub('\n\n\n+', '\n\n'):gsub('^%s+', ''):gsub('%s+$', '')
  return v:sub(1, max)
end

local function plateKey(p)
  local s = tostring(p or ''):upper():gsub('[^A-Z0-9]', '')
  return s:sub(1, 12)
end
Mechanic.plateKey = plateKey

local function lock(key)
  if busy[key] then return nil end
  busy[key] = true
  return function() busy[key] = nil end
end

local function currency() return Config.Store and Config.Store.currency or '£' end

local function ref(kind, n)
  local p = cfg().prefixes or {}
  local prefix = p[kind] or ({ job = 'JC-', quote = 'Q-', invoice = 'INV-' })[kind] or ''
  return ('%s%04d'):format(prefix, tonumber(n) or 0)
end

--- 'boss' | 'any' | a minimum grade: may this player do it?
local function permitted(ctx, rule)
  if rule == nil then rule = cfg().deleteRule or 'boss' end
  if rule == 'any' then return true end
  if type(rule) == 'number' then return (ctx.jobInfo.grade or 0) >= rule end
  return ctx.jobInfo.isBoss == true
end

local JOB_STATUS = { open = true, in_progress = true, waiting_parts = true, ready = true, completed = true, cancelled = true }
local ACTIVE_STATUSES = "('open', 'in_progress', 'waiting_parts', 'ready')"
local LINE_KINDS = { labour = true, part = true, other = true }
local QUOTE_FLOW = {
  draft = { sent = true },
  sent = { accepted = true, declined = true, draft = true },
  accepted = { sent = true, declined = true },
  declined = { sent = true, draft = true },
}
local MAX_LINES, MAX_CUSTOMERS, MAX_PARTS = 40, 3000, 3000

-- ---- tables -----------------------------------------------------------------------------------------------

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_customers` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `job` VARCHAR(50) NOT NULL,
      `name` VARCHAR(80) NOT NULL,
      `phone` VARCHAR(30) DEFAULT NULL,
      `email` VARCHAR(120) DEFAULT NULL,
      `cid` VARCHAR(64) DEFAULT NULL,
      `notes` VARCHAR(300) DEFAULT NULL,
      `created_at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_job` (`job`),
      KEY `idx_cid` (`job`, `cid`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_jobs` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `job` VARCHAR(50) NOT NULL,
      `num` INT NOT NULL,
      `customer_id` INT DEFAULT NULL,
      `plate` VARCHAR(16) NOT NULL,
      `vehicle` VARCHAR(80) DEFAULT NULL,
      `mileage` INT DEFAULT NULL,
      `title` VARCHAR(100) NOT NULL,
      `description` VARCHAR(600) DEFAULT NULL,
      `status` VARCHAR(16) NOT NULL DEFAULT 'open',
      `assigned_cid` VARCHAR(64) DEFAULT NULL,
      `assigned_name` VARCHAR(80) DEFAULT NULL,
      `tasks` TEXT DEFAULT NULL,
      `created_by` VARCHAR(64) DEFAULT NULL,
      `created_name` VARCHAR(80) DEFAULT NULL,
      `created_at` INT NOT NULL,
      `updated_at` INT NOT NULL,
      `completed_at` INT DEFAULT NULL,
      PRIMARY KEY (`id`),
      UNIQUE KEY `uq_job_num` (`job`, `num`),
      KEY `idx_plate` (`plate`),
      KEY `idx_status` (`job`, `status`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_docs` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `job` VARCHAR(50) NOT NULL,
      `kind` VARCHAR(8) NOT NULL,
      `num` INT NOT NULL,
      `customer_id` INT DEFAULT NULL,
      `job_card_id` INT DEFAULT NULL,
      `converted_from` INT DEFAULT NULL,
      `plate` VARCHAR(16) DEFAULT NULL,
      `vehicle` VARCHAR(80) DEFAULT NULL,
      `status` VARCHAR(10) NOT NULL DEFAULT 'draft',
      `notes` VARCHAR(600) DEFAULT NULL,
      `vat_rate` INT NOT NULL DEFAULT 0,
      `subtotal` INT NOT NULL DEFAULT 0,
      `vat` INT NOT NULL DEFAULT 0,
      `total` INT NOT NULL DEFAULT 0,
      `created_by` VARCHAR(64) DEFAULT NULL,
      `created_name` VARCHAR(80) DEFAULT NULL,
      `created_at` INT NOT NULL,
      `updated_at` INT NOT NULL,
      `issued_at` INT DEFAULT NULL,
      `due_at` INT DEFAULT NULL,
      `paid_at` INT DEFAULT NULL,
      `paid_method` VARCHAR(10) DEFAULT NULL,
      `paid_by` VARCHAR(80) DEFAULT NULL,
      `stock_applied` TINYINT(1) NOT NULL DEFAULT 0,
      `settled` TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (`id`),
      UNIQUE KEY `uq_doc_num` (`job`, `kind`, `num`),
      KEY `idx_plate` (`plate`),
      KEY `idx_customer` (`customer_id`),
      KEY `idx_jobcard` (`job_card_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_lines` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `doc_id` INT NOT NULL,
      `sort` INT NOT NULL DEFAULT 0,
      `kind` VARCHAR(8) NOT NULL DEFAULT 'other',
      `description` VARCHAR(120) NOT NULL,
      `qty` DECIMAL(8,2) NOT NULL DEFAULT 1,
      `unit_price` INT NOT NULL DEFAULT 0,
      `part_id` INT DEFAULT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_doc` (`doc_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_parts` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `job` VARCHAR(50) NOT NULL,
      `sku` VARCHAR(30) DEFAULT NULL,
      `name` VARCHAR(80) NOT NULL,
      `category` VARCHAR(30) DEFAULT NULL,
      `qty` INT NOT NULL DEFAULT 0,
      `min_qty` INT NOT NULL DEFAULT 0,
      `cost` INT NOT NULL DEFAULT 0,
      `price` INT NOT NULL DEFAULT 0,
      `supplier` VARCHAR(60) DEFAULT NULL,
      `active` TINYINT(1) NOT NULL DEFAULT 1,
      `updated_at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_job` (`job`, `active`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_mech_stock_log` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `job` VARCHAR(50) NOT NULL,
      `part_id` INT NOT NULL,
      `delta` INT NOT NULL,
      `reason` VARCHAR(80) DEFAULT NULL,
      `by_name` VARCHAR(80) DEFAULT NULL,
      `at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_part` (`part_id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

-- ---- row -> page shapes ---------------------------------------------------------------------------------------

local function decodeTasks(v)
  if type(v) ~= 'string' or v == '' then return {} end
  local ok, t = pcall(json.decode, v)
  if not ok or type(t) ~= 'table' then return {} end
  local out = {}
  for _, x in ipairs(t) do
    if type(x) == 'table' and type(x.t) == 'string' then out[#out + 1] = { t = x.t, done = x.done == true } end
  end
  return out
end

local function customerOut(r)
  return { id = r.id, name = r.name, phone = r.phone, email = r.email, linked = r.cid ~= nil and r.cid ~= '',
           notes = r.notes, createdAt = r.created_at }
end

local function jobOut(r, ctx)
  return {
    id = r.id, num = r.num, ref = ref('job', r.num), customerId = r.customer_id, customer = r.customer_name,
    plate = r.plate, vehicle = r.vehicle, mileage = r.mileage, title = r.title, description = r.description,
    status = r.status, assigned = r.assigned_name, assignedMine = ctx ~= nil and r.assigned_cid ~= nil and r.assigned_cid == ctx.me,
    tasks = decodeTasks(r.tasks), createdBy = r.created_name, createdAt = r.created_at, updatedAt = r.updated_at,
    completedAt = r.completed_at,
  }
end

local function docOut(r)
  local overdue = r.kind == 'invoice' and r.status == 'issued' and r.due_at ~= nil and r.due_at < now()
  return {
    id = r.id, kind = r.kind, num = r.num, ref = ref(r.kind, r.num), customerId = r.customer_id, customer = r.customer_name,
    jobCardId = r.job_card_id, jobRef = r.job_num and ref('job', r.job_num) or nil, convertedFrom = r.converted_from,
    plate = r.plate, vehicle = r.vehicle, status = r.status, notes = r.notes, vatRate = r.vat_rate,
    subtotal = r.subtotal, vat = r.vat, total = r.total, createdBy = r.created_name, createdAt = r.created_at,
    updatedAt = r.updated_at, issuedAt = r.issued_at, dueAt = r.due_at, paidAt = r.paid_at, paidMethod = r.paid_method,
    paidBy = r.paid_by, overdue = overdue,
  }
end

local function partOut(r)
  local qty, min = tonumber(r.qty) or 0, tonumber(r.min_qty) or 0
  return { id = r.id, sku = r.sku, name = r.name, category = r.category, qty = qty, minQty = min, cost = r.cost, price = r.price,
           supplier = r.supplier, low = min > 0 and qty <= min, updatedAt = r.updated_at }
end

local function business(job, jobLabel)
  local b = cfg().business and cfg().business[job] or {}
  return { name = b.name or jobLabel or job, address = b.address, phone = b.phone, vatNumber = b.vatNumber }
end

local function loadDoc(job, id)
  id = tonumber(id)
  if not id then return nil end
  return MySQL.single.await(
    [[SELECT d.*, c.name AS customer_name, j.num AS job_num
      FROM computer_mech_docs d
      LEFT JOIN computer_mech_customers c ON c.id = d.customer_id
      LEFT JOIN computer_mech_jobs j ON j.id = d.job_card_id
      WHERE d.id = ? AND d.job = ?]], { id, job })
end

local function loadLines(docId)
  local rows = MySQL.query.await(
    'SELECT id, kind, description, qty, unit_price, part_id FROM computer_mech_lines WHERE doc_id = ? ORDER BY sort, id', { docId }) or {}
  local out = {}
  for _, r in ipairs(rows) do
    local qty, price = tonumber(r.qty) or 0, tonumber(r.unit_price) or 0
    out[#out + 1] = { kind = r.kind, description = r.description, qty = qty, unitPrice = price,
                      total = math.floor(qty * price + 0.5), partId = r.part_id }
  end
  return out
end

local function loadCustomer(job, id)
  id = tonumber(id)
  if not id then return nil end
  return MySQL.single.await('SELECT * FROM computer_mech_customers WHERE id = ? AND job = ?', { id, job })
end

local function loadJob(job, id)
  id = tonumber(id)
  if not id then return nil end
  return MySQL.single.await(
    [[SELECT j.*, c.name AS customer_name FROM computer_mech_jobs j
      LEFT JOIN computer_mech_customers c ON c.id = j.customer_id WHERE j.id = ? AND j.job = ?]], { id, job })
end

local function like(q)
  q = str(q, 40):lower():gsub('[%%_\\]', '')
  if q == '' then return nil end
  return '%' .. q .. '%'
end

-- ---- numbering ------------------------------------------------------------------------------------------------

--- Runs insertFn(nextNumber) with a per-sequence lock. The unique keys on (job, num) make a clash impossible; the
--- loop retries if one happens anyway.
local function numbered(seq, nextSql, params, insertFn)
  local unlock
  for _ = 1, 40 do
    unlock = lock('seq:' .. seq)
    if unlock then break end
    Wait(50)
  end
  if not unlock then return nil end
  local id
  for _ = 1, 4 do
    local ok, res = pcall(function()
      local n = tonumber(MySQL.scalar.await(nextSql, params)) or 1
      return insertFn(n)
    end)
    if ok and res then id = res break end
  end
  unlock()
  return id
end

-- ---- side effects ---------------------------------------------------------------------------------------------

local function notifyCustomer(cRow, msg)
  if not cRow or not cRow.cid then return end
  local target = Bridge.FindSource(cRow.cid)
  if target then TriggerClientEvent('as-computer:client:mechanicNotify', target, msg) end
end

--- Emails the customer's phone (sd-phone Mail). Best effort: anything that goes wrong is only logged.
local function sendMail(cRow, from, subject, body)
  local m = cfg().mail
  if not m or m.enabled == false or not cRow or not cRow.cid then return false end
  local res = m.resource or 'sd-phone'
  if GetResourceState(res) ~= 'started' then return false end
  local ok, err = pcall(function()
    local email
    local target = Bridge.FindSource(cRow.cid)
    if target then
      local live = exports[res]:getMailAccounts(target)
      if type(live) == 'table' and live[1] then email = live[1].email end
    end
    if not email then
      local saved = exports[res]:getMailAddresses(cRow.cid)
      if type(saved) == 'table' and saved[1] then email = saved[1].email end
    end
    if not email then return end
    local sender = { name = from, email = m.from and m.from.email or nil }
    local attempts = { sender, { name = from }, false }
    for i = 1, 3 do
      local s = attempts[i]
      if s ~= nil then
        local mail = { to = email, subject = subject, body = body }
        if s then mail.from = s end
        local r = exports[res]:sendMail(mail)
        if type(r) == 'table' and r.delivered and r.delivered > 0 then return end
      end
    end
  end)
  if not ok then print(('^1[as-computer:mechanic] mail failed: %s^0'):format(tostring(err))) end
  return ok
end

local function money(n) return currency() .. tostring(math.floor(tonumber(n) or 0)) end

local function docMail(d, lines, biz, customerName)
  local out = {}
  local rows = {}
  for _, l in ipairs(lines) do
    local q = l.qty == math.floor(l.qty) and tostring(math.floor(l.qty)) or tostring(l.qty)
    rows[#rows + 1] = ('%s x %s  %s'):format(q, l.description, money(l.total))
  end
  out[#out + 1] = L('mx_mail_hello', customerName or '')
  if d.kind == 'invoice' then out[#out + 1] = L('mx_mail_invoice_intro', biz.name, d.ref)
  else out[#out + 1] = L('mx_mail_quote_intro', biz.name, d.ref) end
  if d.plate and d.plate ~= '' then out[#out + 1] = L('mx_mail_vehicle', d.vehicle and d.vehicle ~= '' and (d.vehicle .. ' ') or '', d.plate) end
  out[#out + 1] = ''
  for _, r in ipairs(rows) do out[#out + 1] = r end
  out[#out + 1] = ''
  if (d.vat or 0) > 0 then out[#out + 1] = L('mx_mail_vat', d.vatRate, money(d.vat)) end
  out[#out + 1] = L('mx_mail_total', money(d.total))
  if d.kind == 'invoice' and d.dueAt then out[#out + 1] = L('mx_mail_due', os.date('%d/%m/%Y', d.dueAt)) end
  if biz.address and biz.address ~= '' then out[#out + 1] = '' out[#out + 1] = biz.name .. ', ' .. biz.address end
  return table.concat(out, '\n')
end

local function fire(hookName, eventName, payload)
  TriggerEvent(eventName, payload)
  local hook = cfg()[hookName]
  if type(hook) == 'function' then
    local ok, err = pcall(hook, payload)
    if not ok then print(('^1[as-computer:mechanic] %s failed: %s^0'):format(hookName, tostring(err))) end
  end
end

local function browserResource()
  local b = Config.Browser
  local res = b and b.resource or 'as-browser'
  if GetResourceState(res) ~= 'started' then return nil end
  return res
end

local function logHistory(plate, textLine)
  if cfg().logToHistory == false then return end
  local res = browserResource()
  if not res or plate == '' then return end
  local ok, err = pcall(function() return exports[res]:logVehicleEvent(plate, 'service', textLine) end)
  if not ok and Config.Debug then print(('[as-computer:mechanic] history log failed: %s'):format(tostring(err))) end
end

local function liveMileage(plate)
  if GetResourceState('jg-vehiclemileage') ~= 'started' then return nil, nil end
  local ok, r = pcall(function() return exports['jg-vehiclemileage']:getMileageByPlate(plate) end)
  if not ok or not r then return nil, nil end
  local uok, unit = pcall(function() return exports['jg-vehiclemileage']:getUnit() end)
  return math.floor(r), (uok and unit) or 'miles'
end

-- ---- stock ---------------------------------------------------------------------------------------------------

--- Moves stock by `delta` (negative = used). Returns true, or false when there is not enough.
local function stockMove(job, partId, delta, reason, who)
  local n
  if delta < 0 and not cfg().allowNegativeStock then
    n = MySQL.update.await(
      'UPDATE computer_mech_parts SET qty = qty + ?, updated_at = ? WHERE id = ? AND job = ? AND qty + ? >= 0',
      { delta, now(), partId, job, delta })
  else
    n = MySQL.update.await('UPDATE computer_mech_parts SET qty = qty + ?, updated_at = ? WHERE id = ? AND job = ?',
      { delta, now(), partId, job })
  end
  if (tonumber(n) or 0) == 0 then return false end
  MySQL.insert.await('INSERT INTO computer_mech_stock_log (job, part_id, delta, reason, by_name, at) VALUES (?, ?, ?, ?, ?, ?)',
    { job, partId, delta, str(reason, 80), str(who, 80), now() })
  return true
end

-- ================================================================ handlers

-- ---- overview -------------------------------------------------------------------------------------------------

H['overview'] = function(ctx)
  local job = ctx.job
  local counts = {}
  for _, r in ipairs(MySQL.query.await('SELECT status, COUNT(*) AS c FROM computer_mech_jobs WHERE job = ? GROUP BY status', { job }) or {}) do
    counts[r.status] = tonumber(r.c) or 0
  end
  local unpaid = MySQL.single.await(
    "SELECT COUNT(*) AS c, COALESCE(SUM(total), 0) AS s FROM computer_mech_docs WHERE job = ? AND kind = 'invoice' AND status = 'issued'", { job }) or {}
  local overdue = MySQL.scalar.await(
    "SELECT COUNT(*) FROM computer_mech_docs WHERE job = ? AND kind = 'invoice' AND status = 'issued' AND due_at IS NOT NULL AND due_at < ?", { job, now() })
  local quotes = MySQL.scalar.await("SELECT COUNT(*) FROM computer_mech_docs WHERE job = ? AND kind = 'quote' AND status = 'sent'", { job })
  local week = MySQL.scalar.await(
    "SELECT COALESCE(SUM(total), 0) FROM computer_mech_docs WHERE job = ? AND kind = 'invoice' AND status = 'paid' AND paid_at >= ?",
    { job, now() - 7 * 86400 })
  local low = MySQL.scalar.await(
    'SELECT COUNT(*) FROM computer_mech_parts WHERE job = ? AND active = 1 AND min_qty > 0 AND qty <= min_qty', { job })
  local recent = {}
  for _, r in ipairs(MySQL.query.await(
    ([[SELECT j.*, c.name AS customer_name FROM computer_mech_jobs j LEFT JOIN computer_mech_customers c ON c.id = j.customer_id
       WHERE j.job = ? AND j.status IN %s ORDER BY j.updated_at DESC LIMIT 8]]):format(ACTIVE_STATUSES), { job }) or {}) do
    recent[#recent + 1] = jobOut(r, ctx)
  end
  local bookings = {}
  local today = os.date('%Y-%m-%d')
  if Booking and Booking.forCalendar then
    local ok, list = pcall(Booking.forCalendar, job, today, today)
    if ok and type(list) == 'table' then
      for _, b in ipairs(list) do
        bookings[#bookings + 1] = { time = b.startTime, endTime = b.endTime, title = b.title, who = b.createdBy, status = b.status }
      end
    end
  end
  return {
    ok = true, currency = currency(), counts = counts,
    unpaidCount = tonumber(unpaid.c) or 0, unpaidTotal = tonumber(unpaid.s) or 0, overdue = tonumber(overdue) or 0,
    quotesWaiting = tonumber(quotes) or 0, paidWeek = tonumber(week) or 0, lowStock = tonumber(low) or 0,
    recent = recent, bookings = bookings, me = ctx.myName, vatRate = tonumber(cfg().vatRate) or 0,
    labourRate = tonumber(cfg().labourRate) or 60, categories = cfg().partCategories or {},
    canDelete = permitted(ctx),
    methods = { card = cfg().allowCard ~= false and Bank.name() ~= nil, manual = cfg().allowManual ~= false },
  }
end

H['staff.list'] = function(ctx)
  local out = {}
  for _, id in ipairs(GetPlayers()) do
    local src = tonumber(id)
    local j = src and Bridge.GetJob(src)
    if j and j.name == ctx.job then out[#out + 1] = { cid = Bridge.GetIdentifier(src), name = Bridge.GetName(src) } end
  end
  return { ok = true, staff = out }
end

-- ---- customers ------------------------------------------------------------------------------------------------

H['customers.list'] = function(ctx, d)
  local pattern = like(d.q)
  local sql = [[SELECT c.*,
      (SELECT COUNT(*) FROM computer_mech_jobs j WHERE j.customer_id = c.id) AS job_count,
      (SELECT COALESCE(SUM(x.total), 0) FROM computer_mech_docs x WHERE x.customer_id = c.id AND x.kind = 'invoice' AND x.status = 'issued') AS owed
    FROM computer_mech_customers c WHERE c.job = ?]]
  local params = { ctx.job }
  if pattern then
    sql = sql .. ' AND (LOWER(c.name) LIKE ? OR LOWER(COALESCE(c.phone, \'\')) LIKE ? OR LOWER(COALESCE(c.email, \'\')) LIKE ?)'
    params[#params + 1] = pattern params[#params + 1] = pattern params[#params + 1] = pattern
  end
  sql = sql .. ' ORDER BY c.name LIMIT 300'
  local items = {}
  for _, r in ipairs(MySQL.query.await(sql, params) or {}) do
    local c = customerOut(r)
    c.jobs = tonumber(r.job_count) or 0
    c.owed = tonumber(r.owed) or 0
    items[#items + 1] = c
  end
  return { ok = true, items = items }
end

local function vehiclesOfCustomer(job, customerId)
  local out, seen = {}, {}
  for _, r in ipairs(MySQL.query.await(
    [[SELECT plate, vehicle, MAX(at) AS last_at FROM (
        SELECT plate, vehicle, updated_at AS at FROM computer_mech_jobs WHERE job = ? AND customer_id = ?
        UNION ALL
        SELECT plate, vehicle, updated_at AS at FROM computer_mech_docs WHERE job = ? AND customer_id = ? AND plate IS NOT NULL AND plate <> ''
      ) t GROUP BY plate, vehicle ORDER BY last_at DESC LIMIT 30]], { job, customerId, job, customerId }) or {}) do
    if not seen[r.plate] then
      seen[r.plate] = true
      out[#out + 1] = { plate = r.plate, vehicle = r.vehicle, last = r.last_at }
    end
  end
  return out
end

H['customers.get'] = function(ctx, d)
  local c = loadCustomer(ctx.job, d.id)
  if not c then return { ok = false, reason = 'not_found' } end
  local jobs, docs = {}, {}
  for _, r in ipairs(MySQL.query.await(
    [[SELECT j.*, NULL AS customer_name FROM computer_mech_jobs j WHERE j.job = ? AND j.customer_id = ? ORDER BY j.updated_at DESC LIMIT 30]],
    { ctx.job, c.id }) or {}) do jobs[#jobs + 1] = jobOut(r, ctx) end
  for _, r in ipairs(MySQL.query.await(
    [[SELECT d.*, NULL AS customer_name, NULL AS job_num FROM computer_mech_docs d WHERE d.job = ? AND d.customer_id = ? ORDER BY d.updated_at DESC LIMIT 30]],
    { ctx.job, c.id }) or {}) do docs[#docs + 1] = docOut(r) end
  local spent = MySQL.scalar.await(
    "SELECT COALESCE(SUM(total), 0) FROM computer_mech_docs WHERE job = ? AND customer_id = ? AND kind = 'invoice' AND status = 'paid'", { ctx.job, c.id })
  local owed = MySQL.scalar.await(
    "SELECT COALESCE(SUM(total), 0) FROM computer_mech_docs WHERE job = ? AND customer_id = ? AND kind = 'invoice' AND status = 'issued'", { ctx.job, c.id })
  return { ok = true, customer = customerOut(c), jobs = jobs, docs = docs, vehicles = vehiclesOfCustomer(ctx.job, c.id),
           spent = tonumber(spent) or 0, owed = tonumber(owed) or 0 }
end

H['customers.save'] = function(ctx, d)
  local name = str(d.name, 80)
  if name == '' then return { ok = false, reason = 'invalid' } end
  local phone, email, notes = str(d.phone, 30), str(d.email, 120), text(d.notes, 300)
  local id = tonumber(d.id)
  if id then
    local c = loadCustomer(ctx.job, id)
    if not c then return { ok = false, reason = 'not_found' } end
    MySQL.update.await("UPDATE computer_mech_customers SET name = ?, phone = NULLIF(?, ''), email = NULLIF(?, ''), notes = NULLIF(?, '') WHERE id = ? AND job = ?",
      { name, phone, email, notes, id, ctx.job })
    return { ok = true, id = id }
  end
  local count = tonumber(MySQL.scalar.await('SELECT COUNT(*) FROM computer_mech_customers WHERE job = ?', { ctx.job })) or 0
  if count >= MAX_CUSTOMERS then return { ok = false, reason = 'limit' } end
  local newId = MySQL.insert.await(
    "INSERT INTO computer_mech_customers (job, name, phone, email, notes, created_at) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?)",
    { ctx.job, name, phone, email, notes, now() })
  return { ok = true, id = newId }
end

H['customers.delete'] = function(ctx, d)
  if not permitted(ctx) then return { ok = false, reason = 'not_boss' } end
  local c = loadCustomer(ctx.job, d.id)
  if not c then return { ok = false, reason = 'not_found' } end
  MySQL.update.await('UPDATE computer_mech_jobs SET customer_id = NULL WHERE job = ? AND customer_id = ?', { ctx.job, c.id })
  MySQL.update.await('UPDATE computer_mech_docs SET customer_id = NULL WHERE job = ? AND customer_id = ?', { ctx.job, c.id })
  MySQL.update.await('DELETE FROM computer_mech_customers WHERE id = ? AND job = ?', { c.id, ctx.job })
  return { ok = true }
end

--- Finds or creates this job's customer for a character id (linked, so it can be emailed / charged).
local function upsertCharacter(job, cid, name, phone)
  local existing = MySQL.single.await('SELECT * FROM computer_mech_customers WHERE job = ? AND cid = ?', { job, cid })
  if existing then return existing.id, false end
  local count = tonumber(MySQL.scalar.await('SELECT COUNT(*) FROM computer_mech_customers WHERE job = ?', { job })) or 0
  if count >= MAX_CUSTOMERS then return nil end
  name = str(name, 80)
  if name == '' then name = 'Customer' end
  local id = MySQL.insert.await(
    "INSERT INTO computer_mech_customers (job, name, phone, cid, created_at) VALUES (?, ?, NULLIF(?, ''), ?, ?)",
    { job, name, phone and str(tostring(phone), 30) or '', cid, now() })
  return id, true
end

--- "Add the person next to me": needs their server id and that they are close by.
H['customers.fromPlayer'] = function(ctx, d)
  local target = int(d.serverId, nil, 1, 65535)
  if not target or GetPlayerName(target) == nil then return { ok = false, reason = 'no_player' } end
  local ch = Bridge.Character(target)
  if not ch then return { ok = false, reason = 'no_player' } end
  local okd, close = pcall(function()
    local a, b = GetEntityCoords(GetPlayerPed(ctx.src)), GetEntityCoords(GetPlayerPed(target))
    return #(a - b) <= (tonumber(cfg().playerRange) or 15.0)
  end)
  if okd and not close then return { ok = false, reason = 'too_far' } end
  local id = upsertCharacter(ctx.job, ch.identifier, ch.name, ch.phone)
  if not id then return { ok = false, reason = 'limit' } end
  return { ok = true, id = id }
end

-- ---- vehicles -------------------------------------------------------------------------------------------------

local function ownedRow(plate)
  local ok, row = pcall(function()
    -- esx's owned_vehicles has no `citizenid` column (it's `owner`); alias whichever this
    -- framework actually uses back to `citizenid` so every caller below keeps working unchanged.
    return MySQL.single.await(
      ('SELECT plate, vehicle, `%s` AS citizenid FROM `%s` WHERE UPPER(REPLACE(plate, " ", "")) = ?')
        :format(Bridge.VehicleOwnerColumn(), Bridge.VehicleTable()), { plate })
  end)
  if ok then return row end
  return nil
end

local function motStatus(plate)
  local ok, r = pcall(function() return exports['as-computer']:GetMOTStatus(plate) end)
  if ok and type(r) == 'table' then return r end
  return nil
end

local function vehicleFlags(plate)
  local res = browserResource()
  if not res then return {} end
  local ok, r = pcall(function() return exports[res]:getVehicleFlags(plate) end)
  if ok and type(r) == 'table' then return r end
  return {}
end

H['vehicles.lookup'] = function(ctx, d)
  local plate = plateKey(d.plate)
  if plate == '' then return { ok = false, reason = 'empty' } end
  local row = ownedRow(plate)
  local out = { ok = true, plate = plate, found = row ~= nil }
  if row then
    out.model = row.vehicle
    out.ownerCid = nil
    local c = row.citizenid and MySQL.single.await('SELECT id, name FROM computer_mech_customers WHERE job = ? AND cid = ?', { ctx.job, row.citizenid })
    if c then out.customer = { id = c.id, name = c.name, linked = true }
    elseif row.citizenid then
      local n = Bridge.CharacterName(row.citizenid)
      if n then out.owner = { name = n } end
    end
  end
  local prev = MySQL.single.await(
    [[SELECT customer_id, vehicle FROM computer_mech_jobs WHERE job = ? AND plate = ? ORDER BY updated_at DESC LIMIT 1]], { ctx.job, plate })
  if prev then
    out.lastVehicle = prev.vehicle
    if not out.customer and prev.customer_id then
      local c = loadCustomer(ctx.job, prev.customer_id)
      if c then out.customer = { id = c.id, name = c.name, linked = c.cid ~= nil } end
    end
  end
  out.visits = tonumber(MySQL.scalar.await('SELECT COUNT(*) FROM computer_mech_jobs WHERE job = ? AND plate = ?', { ctx.job, plate })) or 0
  local mot = motStatus(plate)
  if mot then out.mot = { status = mot.status, expiresAt = mot.expiresAt } end
  local m, unit = liveMileage(plate)
  out.mileage, out.unit = m, unit
  local flags = {}
  for _, f in ipairs(vehicleFlags(plate)) do flags[#flags + 1] = { flag = f.flag, note = f.note } end
  out.flags = flags
  return out
end

--- Creates / finds the customer that owns a registered vehicle (linked to their character).
H['customers.fromVehicle'] = function(ctx, d)
  local plate = plateKey(d.plate)
  local row = plate ~= '' and ownedRow(plate) or nil
  if not row or not row.citizenid then return { ok = false, reason = 'not_found' } end
  local name = Bridge.CharacterName(row.citizenid)
  local phone
  local target = Bridge.FindSource(row.citizenid)
  if target then local ch = Bridge.Character(target); phone = ch and ch.phone end
  local id = upsertCharacter(ctx.job, row.citizenid, name or 'Customer', phone)
  if not id then return { ok = false, reason = 'limit' } end
  return { ok = true, id = id }
end

H['vehicles.recent'] = function(ctx)
  local items = {}
  for _, r in ipairs(MySQL.query.await(
    [[SELECT plate, vehicle, COUNT(*) AS visits, MAX(updated_at) AS last_at FROM computer_mech_jobs WHERE job = ?
      GROUP BY plate, vehicle ORDER BY last_at DESC LIMIT 60]], { ctx.job }) or {}) do
    items[#items + 1] = { plate = r.plate, vehicle = r.vehicle, visits = tonumber(r.visits) or 0, last = r.last_at }
  end
  return { ok = true, items = items }
end

H['vehicles.history'] = function(ctx, d)
  local plate = plateKey(d.plate)
  if plate == '' then return { ok = false, reason = 'empty' } end
  local timeline = {}
  for _, r in ipairs(MySQL.query.await(
    [[SELECT j.*, c.name AS customer_name FROM computer_mech_jobs j LEFT JOIN computer_mech_customers c ON c.id = j.customer_id
      WHERE j.job = ? AND j.plate = ? ORDER BY j.created_at DESC LIMIT 50]], { ctx.job, plate }) or {}) do
    local j = jobOut(r, ctx)
    timeline[#timeline + 1] = { kind = 'job', id = j.id, ts = j.completedAt or j.createdAt, title = j.title, ref = j.ref, status = j.status,
                                mileage = j.mileage, who = j.customer, sub = j.assigned }
  end
  for _, r in ipairs(MySQL.query.await(
    [[SELECT d.*, c.name AS customer_name, NULL AS job_num FROM computer_mech_docs d LEFT JOIN computer_mech_customers c ON c.id = d.customer_id
      WHERE d.job = ? AND d.plate = ? AND d.status <> 'draft' ORDER BY d.created_at DESC LIMIT 50]], { ctx.job, plate }) or {}) do
    local x = docOut(r)
    timeline[#timeline + 1] = { kind = x.kind, id = x.id, ts = x.paidAt or x.issuedAt or x.createdAt, title = x.ref, ref = x.ref, status = x.status,
                                total = x.total, who = x.customer }
  end
  local okm, mot = pcall(function() return exports['as-computer']:getMotRecords(plate) end)
  if okm and type(mot) == 'table' then
    for _, m in ipairs(mot.records or {}) do
      if m.testedAt then
        timeline[#timeline + 1] = { kind = 'mot', ts = m.testedAt, title = m.passed and 'pass' or 'fail', status = m.passed and 'passed' or 'failed',
                                    mileage = m.mileage, unit = m.unit, sub = m.location }
      end
    end
  end
  table.sort(timeline, function(a, b) return (a.ts or 0) > (b.ts or 0) end)
  local lookup = H['vehicles.lookup'](ctx, { plate = plate })
  local vehicle = lookup.model
  local last = MySQL.single.await('SELECT vehicle FROM computer_mech_jobs WHERE job = ? AND plate = ? AND vehicle IS NOT NULL ORDER BY updated_at DESC LIMIT 1', { ctx.job, plate })
  return { ok = true, plate = plate, info = lookup, vehicle = last and last.vehicle or nil, model = vehicle, timeline = timeline }
end

-- ---- job cards ------------------------------------------------------------------------------------------------

H['jobs.list'] = function(ctx, d)
  local sql = [[SELECT j.*, c.name AS customer_name FROM computer_mech_jobs j
                LEFT JOIN computer_mech_customers c ON c.id = j.customer_id WHERE j.job = ?]]
  local params = { ctx.job }
  local status = tostring(d.status or 'active')
  if status == 'active' then sql = sql .. ' AND j.status IN ' .. ACTIVE_STATUSES
  elseif JOB_STATUS[status] then sql = sql .. ' AND j.status = ?' params[#params + 1] = status end
  if d.mine == true then sql = sql .. ' AND j.assigned_cid = ?' params[#params + 1] = ctx.me end
  local plate = plateKey(d.plate)
  if plate ~= '' then sql = sql .. ' AND j.plate = ?' params[#params + 1] = plate end
  local pattern = like(d.q)
  if pattern then
    sql = sql .. [[ AND (LOWER(j.plate) LIKE ? OR LOWER(j.title) LIKE ? OR LOWER(COALESCE(j.vehicle, '')) LIKE ?
                    OR LOWER(COALESCE(c.name, '')) LIKE ?)]]
    for _ = 1, 4 do params[#params + 1] = pattern end
  end
  sql = sql .. ' ORDER BY j.updated_at DESC LIMIT 200'
  local items = {}
  for _, r in ipairs(MySQL.query.await(sql, params) or {}) do items[#items + 1] = jobOut(r, ctx) end
  return { ok = true, items = items }
end

H['jobs.get'] = function(ctx, d)
  local r = loadJob(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  local docs = {}
  for _, x in ipairs(MySQL.query.await(
    [[SELECT d.*, NULL AS customer_name, NULL AS job_num FROM computer_mech_docs d WHERE d.job = ? AND d.job_card_id = ? ORDER BY d.created_at]],
    { ctx.job, r.id }) or {}) do docs[#docs + 1] = docOut(x) end
  local customer = r.customer_id and loadCustomer(ctx.job, r.customer_id) or nil
  return { ok = true, job = jobOut(r, ctx), docs = docs, customer = customer and customerOut(customer) or nil }
end

local function cleanTasks(input)
  local out = {}
  if type(input) ~= 'table' then return out end
  for _, x in ipairs(input) do
    if #out >= 20 then break end
    if type(x) == 'table' then
      local t = str(x.t, 80)
      if t ~= '' then out[#out + 1] = { t = t, done = x.done == true } end
    end
  end
  return out
end

local function staffCid(ctx, cid)
  if type(cid) ~= 'string' or cid == '' then return nil end
  if cid == ctx.me then return cid, ctx.myName end
  local target = Bridge.FindSource(cid)
  local j = target and Bridge.GetJob(target)
  if j and j.name == ctx.job then return cid, Bridge.GetName(target) end
  return nil
end

H['jobs.save'] = function(ctx, d)
  local plate = plateKey(d.plate)
  local title = str(d.title, 100)
  if plate == '' or title == '' then return { ok = false, reason = 'invalid' } end
  local customerId = tonumber(d.customerId)
  if customerId and not loadCustomer(ctx.job, customerId) then customerId = nil end
  customerId = customerId or 0                       -- 0 = none (NULLIF in the SQL: nil parameters are avoided on purpose)
  local vehicle = str(d.vehicle, 80)
  local mileage = (d.mileage ~= nil and d.mileage ~= '') and int(d.mileage, -1, 0, 9999999) or -1   -- -1 = unknown
  local desc = text(d.description, 600)
  local tasks = json.encode(cleanTasks(d.tasks))
  local acid, aname = staffCid(ctx, d.assignedCid)
  acid, aname = acid or '', aname or ''
  local id = tonumber(d.id)

  if id then
    local old = loadJob(ctx.job, id)
    if not old then return { ok = false, reason = 'not_found' } end
    MySQL.update.await(
      [[UPDATE computer_mech_jobs SET customer_id = NULLIF(?, 0), plate = ?, vehicle = NULLIF(?, ''), mileage = NULLIF(?, -1), title = ?,
        description = NULLIF(?, ''), tasks = ?, assigned_cid = NULLIF(?, ''), assigned_name = NULLIF(?, ''), updated_at = ? WHERE id = ? AND job = ?]],
      { customerId, plate, vehicle, mileage, title, desc, tasks, acid, aname, now(), id, ctx.job })
    return { ok = true, id = id }
  end

  local newId = numbered(ctx.job .. ':job', 'SELECT COALESCE(MAX(num), 0) + 1 FROM computer_mech_jobs WHERE job = ?', { ctx.job }, function(n)
    return MySQL.insert.await(
      [[INSERT INTO computer_mech_jobs (job, num, customer_id, plate, vehicle, mileage, title, description, status, assigned_cid, assigned_name,
        tasks, created_by, created_name, created_at, updated_at)
        VALUES (?, ?, NULLIF(?, 0), ?, NULLIF(?, ''), NULLIF(?, -1), ?, NULLIF(?, ''), 'open', NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?)]],
      { ctx.job, n, customerId, plate, vehicle, mileage, title, desc, acid, aname, tasks, ctx.me or '', ctx.myName or '', now(), now() })
  end)
  if not newId then return { ok = false, reason = 'error' } end
  return { ok = true, id = newId }
end

H['jobs.tasks'] = function(ctx, d)
  local r = loadJob(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  MySQL.update.await('UPDATE computer_mech_jobs SET tasks = ?, updated_at = ? WHERE id = ? AND job = ?',
    { json.encode(cleanTasks(d.tasks)), now(), r.id, ctx.job })
  return { ok = true }
end

H['jobs.status'] = function(ctx, d)
  local status = tostring(d.status or '')
  if not JOB_STATUS[status] then return { ok = false, reason = 'invalid' } end
  local r = loadJob(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.status == status then return { ok = true } end
  local completedAt = status == 'completed' and now() or 0
  MySQL.update.await('UPDATE computer_mech_jobs SET status = ?, updated_at = ?, completed_at = NULLIF(?, 0) WHERE id = ? AND job = ?',
    { status, now(), completedAt, r.id, ctx.job })
  if status == 'completed' then
    local out = jobOut(r, ctx)
    out.status = status
    out.completedAt = completedAt
    out.by = ctx.myName
    logHistory(r.plate, L('mx_history_text', out.ref, r.title, ctx.jobInfo.label or ctx.job))
    fire('onJobCompleted', 'as-computer:mechanic:jobCompleted', out)
  end
  return { ok = true }
end

H['jobs.delete'] = function(ctx, d)
  if not permitted(ctx) then return { ok = false, reason = 'not_boss' } end
  local r = loadJob(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  MySQL.update.await('UPDATE computer_mech_docs SET job_card_id = NULL WHERE job = ? AND job_card_id = ?', { ctx.job, r.id })
  MySQL.update.await('DELETE FROM computer_mech_jobs WHERE id = ? AND job = ?', { r.id, ctx.job })
  return { ok = true }
end

-- ---- quotes and invoices ---------------------------------------------------------------------------------------

--- Validated lines from the page, or nil + reason. Part lines must point at this job's stock.
local function cleanLines(job, input)
  if type(input) ~= 'table' then return nil, 'invalid' end
  local out, partSeen = {}, {}
  for i, l in ipairs(input) do
    if i > MAX_LINES then return nil, 'too_many_lines' end
    if type(l) ~= 'table' then return nil, 'invalid' end
    local kind = LINE_KINDS[l.kind] and l.kind or 'other'
    local desc = str(l.description, 120)
    local qty = num(l.qty, 1)
    qty = math.floor(qty * 100 + 0.5) / 100
    local price = int(l.unitPrice, 0, 0, 1000000)
    local partId
    if kind == 'part' and l.partId ~= nil then
      partId = tonumber(l.partId)
      if partId then
        if partSeen[partId] == nil then
          partSeen[partId] = MySQL.single.await('SELECT id FROM computer_mech_parts WHERE id = ? AND job = ?', { partId, job }) ~= nil
        end
        if not partSeen[partId] then partId = nil end
      end
      qty = math.floor(qty)      -- stock is counted in whole units
    end
    if desc == '' or qty <= 0 or qty > 9999 then return nil, 'invalid_line' end
    out[#out + 1] = { kind = kind, description = desc, qty = qty, unit_price = price, part_id = partId }
  end
  if #out == 0 then return nil, 'no_lines' end
  return out
end

local function totalsOf(lines, vatRate)
  local sub = 0
  for _, l in ipairs(lines) do sub = sub + math.floor(l.qty * l.unit_price + 0.5) end
  local vat = math.floor(sub * (vatRate or 0) / 100 + 0.5)
  return sub, vat, sub + vat
end

local function lineQueries(docId, lines)
  local q = { { 'DELETE FROM computer_mech_lines WHERE doc_id = ?', { docId } } }
  for i, l in ipairs(lines) do
    q[#q + 1] = { 'INSERT INTO computer_mech_lines (doc_id, sort, kind, description, qty, unit_price, part_id) VALUES (?, ?, ?, ?, ?, ?, NULLIF(?, 0))',
                  { docId, i, l.kind, l.description, l.qty, l.unit_price, l.part_id or 0 } }
  end
  return q
end

H['docs.list'] = function(ctx, d)
  local kind = d.kind == 'quote' and 'quote' or (d.kind == 'invoice' and 'invoice' or nil)
  local sql = [[SELECT d.*, c.name AS customer_name, j.num AS job_num FROM computer_mech_docs d
                LEFT JOIN computer_mech_customers c ON c.id = d.customer_id
                LEFT JOIN computer_mech_jobs j ON j.id = d.job_card_id WHERE d.job = ?]]
  local params = { ctx.job }
  if kind then sql = sql .. ' AND d.kind = ?' params[#params + 1] = kind end
  local status = tostring(d.status or 'all')
  if status == 'open' then
    sql = sql .. " AND d.status IN ('draft', 'sent', 'accepted', 'issued')"
  elseif status == 'overdue' then
    sql = sql .. " AND d.kind = 'invoice' AND d.status = 'issued' AND d.due_at IS NOT NULL AND d.due_at < ?"
    params[#params + 1] = now()
  elseif status ~= 'all' then
    sql = sql .. ' AND d.status = ?' params[#params + 1] = status
  end
  local cid = tonumber(d.customerId)
  if cid then sql = sql .. ' AND d.customer_id = ?' params[#params + 1] = cid end
  local jid = tonumber(d.jobCardId)
  if jid then sql = sql .. ' AND d.job_card_id = ?' params[#params + 1] = jid end
  local plate = plateKey(d.plate)
  if plate ~= '' then sql = sql .. ' AND d.plate = ?' params[#params + 1] = plate end
  local pattern = like(d.q)
  if pattern then
    sql = sql .. " AND (LOWER(COALESCE(d.plate, '')) LIKE ? OR LOWER(COALESCE(c.name, '')) LIKE ? OR LOWER(COALESCE(d.vehicle, '')) LIKE ?)"
    for _ = 1, 3 do params[#params + 1] = pattern end
  end
  sql = sql .. ' ORDER BY d.updated_at DESC LIMIT 200'
  local items = {}
  for _, r in ipairs(MySQL.query.await(sql, params) or {}) do items[#items + 1] = docOut(r) end
  return { ok = true, items = items }
end

H['docs.get'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  local customer = r.customer_id and loadCustomer(ctx.job, r.customer_id) or nil
  local doc = docOut(r)
  local c = customer and customerOut(customer) or nil
  local canCard = cfg().allowCard ~= false and c ~= nil and c.linked and Bank.name() ~= nil
  return { ok = true, doc = doc, lines = loadLines(r.id), customer = c,
           business = business(ctx.job, ctx.jobInfo.label),
           canCard = canCard, canMail = c ~= nil and c.linked and (cfg().mail == nil or cfg().mail.enabled ~= false),
           canDelete = permitted(ctx) or doc.status == 'draft' }
end

H['docs.save'] = function(ctx, d)
  local id = tonumber(d.id)
  local kind = d.kind == 'invoice' and 'invoice' or 'quote'
  local existing
  if id then
    existing = loadDoc(ctx.job, id)
    if not existing then return { ok = false, reason = 'not_found' } end
    kind = existing.kind
    local editable = existing.status == 'draft' or (kind == 'quote' and (existing.status == 'sent' or existing.status == 'accepted'))
    if not editable then return { ok = false, reason = 'locked' } end
  end
  local lines, why = cleanLines(ctx.job, d.lines)
  if not lines then return { ok = false, reason = why } end

  local customerId = tonumber(d.customerId)
  if customerId and not loadCustomer(ctx.job, customerId) then customerId = nil end
  customerId = customerId or 0
  local jobCardId = tonumber(d.jobCardId)
  if jobCardId and not loadJob(ctx.job, jobCardId) then jobCardId = nil end
  jobCardId = jobCardId or 0
  local plate = plateKey(d.plate)
  local vehicle = str(d.vehicle, 80)
  local notes = text(d.notes, 600)
  local vatRate = existing and existing.vat_rate or int(cfg().vatRate, 0, 0, 100)
  local sub, vat, total = totalsOf(lines, vatRate)

  if existing then
    MySQL.update.await(
      [[UPDATE computer_mech_docs SET customer_id = NULLIF(?, 0), job_card_id = NULLIF(?, 0), plate = NULLIF(?, ''), vehicle = NULLIF(?, ''),
        notes = NULLIF(?, ''), subtotal = ?, vat = ?, total = ?, updated_at = ? WHERE id = ? AND job = ?]],
      { customerId, jobCardId, plate, vehicle, notes, sub, vat, total, now(), existing.id, ctx.job })
    local ok, res = pcall(function() return MySQL.transaction.await(lineQueries(existing.id, lines)) end)
    if not ok or res == false then return { ok = false, reason = 'error' } end
    return { ok = true, id = existing.id }
  end

  local newId = numbered(ctx.job .. ':' .. kind, 'SELECT COALESCE(MAX(num), 0) + 1 FROM computer_mech_docs WHERE job = ? AND kind = ?',
    { ctx.job, kind }, function(n)
      return MySQL.insert.await(
        [[INSERT INTO computer_mech_docs (job, kind, num, customer_id, job_card_id, plate, vehicle, status, notes, vat_rate, subtotal, vat, total,
          created_by, created_name, created_at, updated_at)
          VALUES (?, ?, ?, NULLIF(?, 0), NULLIF(?, 0), NULLIF(?, ''), NULLIF(?, ''), 'draft', NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?)]],
        { ctx.job, kind, n, customerId, jobCardId, plate, vehicle, notes, vatRate, sub, vat, total, ctx.me or '', ctx.myName or '', now(), now() })
    end)
  if not newId then return { ok = false, reason = 'error' } end
  local ok, res = pcall(function() return MySQL.transaction.await(lineQueries(newId, lines)) end)
  if not ok or res == false then
    MySQL.update.await('DELETE FROM computer_mech_docs WHERE id = ?', { newId })
    return { ok = false, reason = 'error' }
  end
  return { ok = true, id = newId }
end

--- Sends the quote / invoice to the customer (in-game notice + email). Quiet when nothing can be sent.
local function deliver(ctx, r)
  local c = r.customer_id and loadCustomer(ctx.job, r.customer_id) or nil
  if not c or not c.cid then return false end
  local doc = docOut(r)
  local biz = business(ctx.job, ctx.jobInfo.label)
  local msg = doc.kind == 'invoice' and L('mx_notify_invoice', doc.ref, money(doc.total), biz.name) or L('mx_notify_quote', doc.ref, money(doc.total), biz.name)
  notifyCustomer(c, msg)
  local subject = (doc.kind == 'invoice' and L('mx_mail_invoice_subject', doc.ref, biz.name)) or L('mx_mail_quote_subject', doc.ref, biz.name)
  local from = (cfg().mail and cfg().mail.from and cfg().mail.from.name) or biz.name
  sendMail(c, from, subject, docMail(doc, loadLines(r.id), biz, c.name))
  return true
end

H['docs.email'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.status == 'draft' then return { ok = false, reason = 'invalid' } end
  if not deliver(ctx, r) then return { ok = false, reason = 'no_customer' } end
  return { ok = true }
end

H['docs.status'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.kind ~= 'quote' then return { ok = false, reason = 'invalid' } end
  local to = tostring(d.status or '')
  local flow = QUOTE_FLOW[r.status]
  if not flow or not flow[to] then return { ok = false, reason = 'invalid' } end
  MySQL.update.await('UPDATE computer_mech_docs SET status = ?, updated_at = ? WHERE id = ? AND job = ?', { to, now(), r.id, ctx.job })
  if to == 'sent' and r.status == 'draft' and cfg().mail and cfg().mail.autoSend ~= false then r.status = 'sent' deliver(ctx, r) end
  return { ok = true }
end

H['docs.convert'] = function(ctx, d)
  local q = loadDoc(ctx.job, d.id)
  if not q then return { ok = false, reason = 'not_found' } end
  if q.kind ~= 'quote' or q.status == 'invoiced' or q.status == 'declined' then return { ok = false, reason = 'invalid' } end
  local unlock = lock('convert:' .. q.id)
  if not unlock then return { ok = false, reason = 'error' } end
  local lines = loadLines(q.id)
  local conv = {}
  for _, l in ipairs(lines) do
    conv[#conv + 1] = { kind = l.kind, description = l.description, qty = l.qty, unit_price = l.unitPrice, part_id = l.partId }
  end
  local vatRate = int(cfg().vatRate, 0, 0, 100)
  local sub, vat, total = totalsOf(conv, vatRate)
  local newId = numbered(ctx.job .. ':invoice', "SELECT COALESCE(MAX(num), 0) + 1 FROM computer_mech_docs WHERE job = ? AND kind = 'invoice'",
    { ctx.job }, function(n)
      return MySQL.insert.await(
        [[INSERT INTO computer_mech_docs (job, kind, num, customer_id, job_card_id, converted_from, plate, vehicle, status, notes, vat_rate, subtotal,
          vat, total, created_by, created_name, created_at, updated_at)
          VALUES (?, 'invoice', ?, NULLIF(?, 0), NULLIF(?, 0), ?, NULLIF(?, ''), NULLIF(?, ''), 'draft', NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?)]],
        { ctx.job, n, q.customer_id or 0, q.job_card_id or 0, q.id, q.plate or '', q.vehicle or '', q.notes or '', vatRate, sub, vat, total,
          ctx.me or '', ctx.myName or '', now(), now() })
    end)
  if not newId then unlock() return { ok = false, reason = 'error' } end
  local ok, res = pcall(function() return MySQL.transaction.await(lineQueries(newId, conv)) end)
  if not ok or res == false then
    MySQL.update.await('DELETE FROM computer_mech_docs WHERE id = ?', { newId })
    unlock()
    return { ok = false, reason = 'error' }
  end
  MySQL.update.await("UPDATE computer_mech_docs SET status = 'invoiced', updated_at = ? WHERE id = ? AND job = ?", { now(), q.id, ctx.job })
  unlock()
  return { ok = true, id = newId }
end

H['docs.issue'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.kind ~= 'invoice' or r.status ~= 'draft' then return { ok = false, reason = 'invalid' } end
  local unlock = lock('doc:' .. r.id)
  if not unlock then return { ok = false, reason = 'error' } end

  local lines = loadLines(r.id)
  if #lines == 0 then unlock() return { ok = false, reason = 'no_lines' } end

  -- take the parts out of stock (all or nothing)
  local need = {}
  for _, l in ipairs(lines) do
    if l.partId then need[l.partId] = (need[l.partId] or 0) + math.floor(l.qty) end
  end
  local taken = {}
  local ok, failedPart = true, nil
  local ref_ = ref('invoice', r.num)
  for partId, qty in pairs(need) do
    if stockMove(ctx.job, partId, -qty, ref_, ctx.myName) then
      taken[#taken + 1] = { partId, qty }
    else
      ok, failedPart = false, partId
      break
    end
  end
  if not ok then
    for _, t in ipairs(taken) do stockMove(ctx.job, t[1], t[2], ref_ .. ' (undo)', ctx.myName) end
    local p = MySQL.single.await('SELECT name FROM computer_mech_parts WHERE id = ? AND job = ?', { failedPart, ctx.job })
    unlock()
    return { ok = false, reason = 'no_stock', part = p and p.name or nil }
  end

  local dueDays = int(cfg().dueDays, 14, 0, 365)
  local n = MySQL.update.await(
    [[UPDATE computer_mech_docs SET status = 'issued', issued_at = ?, due_at = ?, stock_applied = 1, updated_at = ?
      WHERE id = ? AND job = ? AND status = 'draft']], { now(), now() + dueDays * 86400, now(), r.id, ctx.job })
  if (tonumber(n) or 0) == 0 then
    for _, t in ipairs(taken) do stockMove(ctx.job, t[1], t[2], ref_ .. ' (undo)', ctx.myName) end
    unlock()
    return { ok = false, reason = 'error' }
  end
  unlock()

  local fresh = loadDoc(ctx.job, r.id)
  local payload = docOut(fresh)
  payload.job = ctx.job
  payload.lines = lines
  fire('onInvoiceIssued', 'as-computer:mechanic:invoiceIssued', payload)
  if cfg().mail and cfg().mail.autoSend ~= false then deliver(ctx, fresh) end
  return { ok = true }
end

H['docs.void'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.kind ~= 'invoice' or r.status ~= 'issued' then return { ok = false, reason = 'invalid' } end
  local unlock = lock('doc:' .. r.id)
  if not unlock then return { ok = false, reason = 'error' } end
  local n = MySQL.update.await("UPDATE computer_mech_docs SET status = 'void', updated_at = ? WHERE id = ? AND job = ? AND status = 'issued'",
    { now(), r.id, ctx.job })
  if (tonumber(n) or 0) > 0 and tonumber(r.stock_applied) == 1 then
    local back = {}
    for _, l in ipairs(loadLines(r.id)) do
      if l.partId then back[l.partId] = (back[l.partId] or 0) + math.floor(l.qty) end
    end
    for partId, qty in pairs(back) do stockMove(ctx.job, partId, qty, ref('invoice', r.num) .. ' (void)', ctx.myName) end
  end
  unlock()
  return { ok = true }
end

H['docs.delete'] = function(ctx, d)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  local removable = r.status == 'draft' or (permitted(ctx) and (r.status == 'declined' or r.status == 'void'))
  if not removable then return { ok = false, reason = 'locked' } end
  MySQL.update.await('DELETE FROM computer_mech_lines WHERE doc_id = ?', { r.id })
  MySQL.update.await('DELETE FROM computer_mech_docs WHERE id = ? AND job = ?', { r.id, ctx.job })
  -- a quote that was turned into a (now deleted) draft invoice can be converted again
  MySQL.update.await("UPDATE computer_mech_docs SET status = 'accepted' WHERE job = ? AND id = ? AND status = 'invoiced'", { ctx.job, r.converted_from or 0 })
  return { ok = true }
end

-- ---- taking payment --------------------------------------------------------------------------------------------

local pendingPay = {}     -- token -> { target, docId, job, respond, unlock, amount }
local payToken = 0

local function markPaid(job, docId, method, by, settled)
  local n = MySQL.update.await(
    "UPDATE computer_mech_docs SET status = 'paid', paid_at = ?, paid_method = ?, paid_by = ?, settled = ?, updated_at = ? WHERE id = ? AND job = ? AND status = 'issued'",
    { now(), method, str(by, 80), settled and 1 or 0, now(), docId, job })
  return (tonumber(n) or 0) > 0
end

local function paidEvent(job, docId)
  local fresh = loadDoc(job, docId)
  if not fresh then return end
  local payload = docOut(fresh)
  payload.job = job
  fire('onInvoicePaid', 'as-computer:mechanic:invoicePaid', payload)
end

H['docs.pay'] = function(ctx, d, respond)
  local r = loadDoc(ctx.job, d.id)
  if not r then return { ok = false, reason = 'not_found' } end
  if r.kind ~= 'invoice' or r.status ~= 'issued' then return { ok = false, reason = 'invalid' } end
  local method = tostring(d.method or '')
  local total = tonumber(r.total) or 0

  if method == 'manual' then
    if cfg().allowManual == false then return { ok = false, reason = 'method_off' } end
    local unlock = lock('doc:' .. r.id)
    if not unlock then return { ok = false, reason = 'error' } end
    local credited = false
    if cfg().manualPaysSociety == true and total > 0 and Bank.name() then
      credited = Bank.add(Apps.account(ctx.job), total, L('mx_bank_note', ref('invoice', r.num)))
    end
    local done = markPaid(ctx.job, r.id, 'manual', ctx.myName, credited)
    unlock()
    if not done then
      if credited then Bank.remove(Apps.account(ctx.job), total, L('mx_bank_note', ref('invoice', r.num))) end
      return { ok = false, reason = 'error' }
    end
    paidEvent(ctx.job, r.id)
    return { ok = true }
  end

  if method ~= 'card' then return { ok = false, reason = 'invalid' } end
  if cfg().allowCard == false then return { ok = false, reason = 'method_off' } end
  if not Bank.name() then return { ok = false, reason = 'no_bank' } end
  local c = r.customer_id and loadCustomer(ctx.job, r.customer_id) or nil
  if not c or not c.cid then return { ok = false, reason = 'no_customer' } end
  local target = Bridge.FindSource(c.cid)
  if not target then return { ok = false, reason = 'customer_offline' } end
  local okd, close = pcall(function()
    local a, b = GetEntityCoords(GetPlayerPed(ctx.src)), GetEntityCoords(GetPlayerPed(target))
    return #(a - b) <= (tonumber(cfg().playerRange) or 15.0)
  end)
  if okd and not close then return { ok = false, reason = 'too_far' } end
  local unlock = lock('doc:' .. r.id)
  if not unlock then return { ok = false, reason = 'error' } end

  payToken = payToken + 1
  local token = ('%d:%d'):format(payToken, now())
  local secs = int(cfg().payPromptSeconds, 30, 10, 120)
  pendingPay[token] = { target = target, docId = r.id, job = ctx.job, respond = respond, unlock = unlock, amount = total,
                        by = ctx.myName, ref = ref('invoice', r.num), jobLabel = ctx.jobInfo.label or ctx.job }
  local biz = business(ctx.job, ctx.jobInfo.label)
  TriggerClientEvent('as-computer:client:mechanicPayPrompt', target, token,
    { ref = ref('invoice', r.num), amount = total, business = biz.name, seconds = secs, symbol = currency() })
  CreateThread(function()
    Wait((secs + 3) * 1000)
    local p = pendingPay[token]
    if p then
      pendingPay[token] = nil
      p.unlock()
      p.respond({ ok = false, reason = 'no_answer' })
    end
  end)
  return nil     -- answered later (accept / decline / timeout)
end

RegisterNetEvent('as-computer:server:mechanicPayReply', function(token, accept)
  local src = source
  local p = type(token) == 'string' and pendingPay[token] or nil
  if not p or p.target ~= src then return end
  pendingPay[token] = nil
  if accept ~= true then
    p.unlock()
    return p.respond({ ok = false, reason = 'declined' })
  end
  local account = Apps.account(p.job)
  local reason = L('mx_bank_note', p.ref)
  if not Bridge.RemoveMoney(src, 'bank', p.amount, reason) then
    p.unlock()
    TriggerClientEvent('as-computer:client:mechanicNotify', src, L('mx_notify_no_funds'))
    return p.respond({ ok = false, reason = 'no_funds' })
  end
  local done = markPaid(p.job, p.docId, 'card', p.by, false)
  if not done then
    Bridge.AddMoney(src, 'bank', p.amount, reason)
    p.unlock()
    return p.respond({ ok = false, reason = 'error' })
  end
  if Bank.add(account, p.amount, reason) then
    MySQL.update.await('UPDATE computer_mech_docs SET settled = 1 WHERE id = ? AND job = ?', { p.docId, p.job })
  else
    print(('^1[as-computer:mechanic] could not pay %s into the %s account; will retry^0'):format(p.ref, p.job))
  end
  p.unlock()
  TriggerClientEvent('as-computer:client:mechanicNotify', src, L('mx_notify_paid', p.ref, money(p.amount)))
  paidEvent(p.job, p.docId)
  p.respond({ ok = true })
end)

-- card payments whose society deposit failed are retried
CreateThread(function()
  while true do
    Wait(60000)
    pcall(function()
      local rows = MySQL.query.await(
        "SELECT id, job, num, total FROM computer_mech_docs WHERE kind = 'invoice' AND status = 'paid' AND paid_method = 'card' AND settled = 0 LIMIT 20") or {}
      for _, r in ipairs(rows) do
        if Bank.name() and Bank.add(Apps.account(r.job), tonumber(r.total) or 0, L('mx_bank_note', ref('invoice', r.num))) then
          MySQL.update.await('UPDATE computer_mech_docs SET settled = 1 WHERE id = ?', { r.id })
        end
      end
    end)
  end
end)

-- ---- parts stock ----------------------------------------------------------------------------------------------

H['parts.list'] = function(ctx, d)
  local sql = 'SELECT * FROM computer_mech_parts WHERE job = ? AND active = 1'
  local params = { ctx.job }
  if d.low == true then sql = sql .. ' AND min_qty > 0 AND qty <= min_qty' end
  local cat = str(d.category, 30)
  if cat ~= '' then sql = sql .. ' AND category = ?' params[#params + 1] = cat end
  local pattern = like(d.q)
  if pattern then
    sql = sql .. " AND (LOWER(name) LIKE ? OR LOWER(COALESCE(sku, '')) LIKE ? OR LOWER(COALESCE(supplier, '')) LIKE ?)"
    for _ = 1, 3 do params[#params + 1] = pattern end
  end
  sql = sql .. ' ORDER BY name LIMIT 500'
  local items = {}
  for _, r in ipairs(MySQL.query.await(sql, params) or {}) do items[#items + 1] = partOut(r) end
  local value = MySQL.scalar.await('SELECT COALESCE(SUM(qty * cost), 0) FROM computer_mech_parts WHERE job = ? AND active = 1 AND qty > 0', { ctx.job })
  return { ok = true, items = items, stockValue = tonumber(value) or 0 }
end

H['parts.save'] = function(ctx, d)
  local name = str(d.name, 80)
  if name == '' then return { ok = false, reason = 'invalid' } end
  local sku, category, supplier = str(d.sku, 30), str(d.category, 30), str(d.supplier, 60)
  local minQty = int(d.minQty, 0, 0, 1000000)
  local cost, price = int(d.cost, 0, 0, 1000000), int(d.price, 0, 0, 1000000)
  local id = tonumber(d.id)
  if id then
    local n = MySQL.update.await(
      [[UPDATE computer_mech_parts SET sku = NULLIF(?, ''), name = ?, category = NULLIF(?, ''), min_qty = ?, cost = ?, price = ?,
        supplier = NULLIF(?, ''), updated_at = ? WHERE id = ? AND job = ? AND active = 1]],
      { sku, name, category, minQty, cost, price, supplier, now(), id, ctx.job })
    if (tonumber(n) or 0) == 0 then
      local exists = MySQL.scalar.await('SELECT COUNT(*) FROM computer_mech_parts WHERE id = ? AND job = ? AND active = 1', { id, ctx.job })
      if (tonumber(exists) or 0) == 0 then return { ok = false, reason = 'not_found' } end
    end
    return { ok = true, id = id }
  end
  local count = tonumber(MySQL.scalar.await('SELECT COUNT(*) FROM computer_mech_parts WHERE job = ? AND active = 1', { ctx.job })) or 0
  if count >= MAX_PARTS then return { ok = false, reason = 'limit' } end
  local qty = int(d.qty, 0, 0, 1000000)
  local newId = MySQL.insert.await(
    [[INSERT INTO computer_mech_parts (job, sku, name, category, qty, min_qty, cost, price, supplier, active, updated_at)
      VALUES (?, NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''), 1, ?)]],
    { ctx.job, sku, name, category, qty, minQty, cost, price, supplier, now() })
  if qty > 0 then
    MySQL.insert.await('INSERT INTO computer_mech_stock_log (job, part_id, delta, reason, by_name, at) VALUES (?, ?, ?, ?, ?, ?)',
      { ctx.job, newId, qty, L('mx_stock_opening'), ctx.myName, now() })
  end
  return { ok = true, id = newId }
end

H['parts.adjust'] = function(ctx, d)
  local id = tonumber(d.id)
  local delta = int(d.delta, 0, -1000000, 1000000)
  if not id or delta == 0 then return { ok = false, reason = 'invalid' } end
  local p = MySQL.single.await('SELECT * FROM computer_mech_parts WHERE id = ? AND job = ? AND active = 1', { id, ctx.job })
  if not p then return { ok = false, reason = 'not_found' } end
  if delta < 0 and (tonumber(p.qty) or 0) + delta < 0 then return { ok = false, reason = 'no_stock' } end
  local reason = str(d.reason, 80)
  if reason == '' then reason = delta > 0 and L('mx_stock_received') or L('mx_stock_removed') end
  if not stockMove(ctx.job, id, delta, reason, ctx.myName) then return { ok = false, reason = 'no_stock' } end
  return { ok = true }
end

H['parts.log'] = function(ctx, d)
  local id = tonumber(d.id)
  if not id then return { ok = false, reason = 'invalid' } end
  local items = {}
  for _, r in ipairs(MySQL.query.await(
    'SELECT delta, reason, by_name, at FROM computer_mech_stock_log WHERE job = ? AND part_id = ? ORDER BY at DESC, id DESC LIMIT 30', { ctx.job, id }) or {}) do
    items[#items + 1] = { delta = r.delta, reason = r.reason, by = r.by_name, at = r.at }
  end
  return { ok = true, items = items }
end

H['parts.delete'] = function(ctx, d)
  if not permitted(ctx) then return { ok = false, reason = 'not_boss' } end
  local id = tonumber(d.id)
  if not id then return { ok = false, reason = 'invalid' } end
  MySQL.update.await('UPDATE computer_mech_parts SET active = 0, updated_at = ? WHERE id = ? AND job = ?', { now(), id, ctx.job })
  return { ok = true }
end

-- ================================================================ entry point

MotCallback.Register('mechanicApi', function(src, respond, name, data)
  if not Apps.allowed(src, 'mechanic') then return respond({ ok = false, reason = 'not_authorised' }) end
  local h = type(name) == 'string' and H[name] or nil
  if not h then return respond({ ok = false, reason = 'invalid' }) end
  local jobInfo = Bridge.GetJob(src)
  if not jobInfo then return respond({ ok = false, reason = 'not_authorised' }) end
  local ctx = { src = src, job = jobInfo.name, jobInfo = jobInfo, me = Bridge.GetIdentifier(src), myName = Bridge.GetName(src) }
  local ok, res = pcall(h, ctx, type(data) == 'table' and data or {}, respond)
  if not ok then
    print(('^1[as-computer:mechanic] %s failed: %s^0'):format(name, tostring(res)))
    return respond({ ok = false, reason = 'error' })
  end
  if res ~= nil then respond(res) end
end)

-- ---- for other resources ---------------------------------------------------------------------------------------

--- Completed job cards for a plate (all garages), newest first. For police / MDT screens and history checks.
---   exports['as-computer']:getServiceHistory('AB12CDE')  ->  { records = { { ref, title, completedAt, mileage, garage }, ... } }
exports('getServiceHistory', function(plateInput)
  local plate = plateKey(plateInput)
  if plate == '' then return { records = {} } end
  local rows = MySQL.query.await(
    "SELECT job, num, title, mileage, completed_at FROM computer_mech_jobs WHERE plate = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 40", { plate }) or {}
  local out = {}
  for _, r in ipairs(rows) do
    out[#out + 1] = { ref = ref('job', r.num), title = r.title, completedAt = r.completed_at, mileage = r.mileage, garage = r.job }
  end
  return { records = out }
end)

--- A vehicle got a new registration (government site): keep its job cards and documents on it.
function Mechanic.renamePlate(oldKey, newPlate)
  local new = plateKey(newPlate)
  local old = plateKey(oldKey)
  if old == '' or new == '' or old == new then return end
  MySQL.update.await('UPDATE computer_mech_jobs SET plate = ? WHERE plate = ?', { new, old })
  MySQL.update.await('UPDATE computer_mech_docs SET plate = ? WHERE plate = ?', { new, old })
end

AddEventHandler('as-browser:plateChanged', function(oldDisplay, display)
  Mechanic.renamePlate(oldDisplay, display)
end)
