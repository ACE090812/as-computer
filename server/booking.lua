-- MOT bookings (made on the government website). All the rules live here; as-browser's gov site only passes
-- requests through (exports at the bottom) and adds the phone side (bank line, emails).
--
-- Table computer_bookings, one row per booking. status:
--   held      slot reserved while the player is being charged (dropped after 2 minutes)
--   booked    paid and waiting
--   done      a tester recorded an MOT for that plate
--   missed    the slot passed unused
--   cancelled cancelled by the player (fee refunded)
--   moved     replaced by another booking (changed time / garage)
-- The fee is paid into the garage job's society when a booking becomes done or missed (`settled`).

Booking = {}

local busy = {}
local DAY = 86400

local function cfg() return Config.Booking or {} end
local function now() return os.time() end
local function num(v, d) v = tonumber(v); if v == nil then return d end return v end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_bookings` (
      `id` INT NOT NULL AUTO_INCREMENT,
      `garage` VARCHAR(50) NOT NULL,
      `job` VARCHAR(50) NOT NULL,
      `cid` VARCHAR(64) NOT NULL,
      `name` VARCHAR(80) DEFAULT NULL,
      `plate` VARCHAR(16) NOT NULL,
      `vehicle` VARCHAR(80) DEFAULT NULL,
      `slot_ts` INT NOT NULL,
      `date` CHAR(10) NOT NULL,
      `time` CHAR(5) NOT NULL,
      `duration` INT NOT NULL DEFAULT 30,
      `fee` INT NOT NULL DEFAULT 0,
      `status` VARCHAR(12) NOT NULL DEFAULT 'held',
      `reminded` TINYINT(1) NOT NULL DEFAULT 0,
      `settled` TINYINT(1) NOT NULL DEFAULT 0,
      `created_at` INT NOT NULL,
      PRIMARY KEY (`id`),
      KEY `idx_slot` (`garage`, `slot_ts`),
      KEY `idx_cid` (`cid`),
      KEY `idx_job_date` (`job`, `date`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

-- ---- garages and slots -------------------------------------------------------------------------------------

local garageList
--- Every location with a `booking` table.
function Booking.garages()
  if garageList then return garageList end
  garageList = {}
  local seen = {}
  for i, loc in ipairs(Config.Locations or {}) do
    local b = loc.booking
    if type(b) == 'table' and b.enabled ~= false then
      local jobs = loc.jobs or Config.Jobs or (Config.MechanicJob and { Config.MechanicJob }) or {}
      local id = tostring(b.id or i)
      local job = b.job or jobs[1]
      if not job then
        print(('^1[as-computer:booking] garage "%s" has no job (set booking.job or Config.Jobs)^0'):format(id))
      elseif seen[id] then
        print(('^1[as-computer:booking] two garages share the id "%s"; the second is ignored^0'):format(id))
      else
        seen[id] = true
        garageList[#garageList + 1] = {
          id = id, name = b.name or loc.label or id, address = b.address, job = job,
          bays = math.max(1, math.floor(num(b.bays, num(cfg().bays, 1)))),
          fee = math.max(0, math.floor(num(b.fee, num(cfg().fee, 0)))),
          slots = b.slots,
        }
      end
    end
  end
  return garageList
end

local function findGarage(id)
  id = tostring(id or '')
  for _, g in ipairs(Booking.garages()) do
    if g.id == id then return g end
  end
  return nil
end

local function on()
  return cfg().enabled ~= false and Apps.enabled('mot') and #Booking.garages() > 0
end

local function toMin(s)
  local h, m = tostring(s):match('^(%d%d?):(%d%d)$')
  if not h then return nil end
  h, m = tonumber(h), tonumber(m)
  if h > 23 or m > 59 then return nil end
  return h * 60 + m
end

--- { 'HH:MM', ... } for a garage, and how many minutes a booking lasts.
local function slotList(g)
  local def = g.slots or cfg().slots or { from = '09:00', to = '17:00', every = 30 }
  local out = {}
  local every = 30
  if def[1] ~= nil then
    for _, s in ipairs(def) do
      local m = toMin(s)
      if m then out[#out + 1] = ('%02d:%02d'):format(m // 60, m % 60) end
    end
  else
    every = math.max(5, math.floor(num(def.every, 30)))
    local from, to = toMin(def.from), toMin(def.to)
    if from and to then
      local m = from
      while m + every <= to and #out < 96 do
        out[#out + 1] = ('%02d:%02d'):format(m // 60, m % 60)
        m = m + every
      end
    end
  end
  table.sort(out)
  return out, math.max(5, math.floor(num(cfg().duration, every)))
end

local function closedDay(wd)
  for _, d in ipairs(cfg().closedWeekdays or {}) do
    if tonumber(d) == wd then return true end
  end
  return false
end

--- "YYYY-MM-DD" and weekday (0 = Sunday) for today + offset days.
local function dayInfo(offset)
  local t = os.date('*t', now() + offset * DAY)
  return ('%04d-%02d-%02d'):format(t.year, t.month, t.day), t.wday - 1, t
end

local function slotStamp(date, time)
  local y, mo, d = date:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$')
  local h, mi = time:match('^(%d%d):(%d%d)$')
  if not y or not h then return nil end
  return os.time({ year = tonumber(y), month = tonumber(mo), day = tonumber(d), hour = tonumber(h), min = tonumber(mi), sec = 0 })
end

local function horizon() return math.max(1, math.min(60, math.floor(num(cfg().daysAhead, 7)))) end

local function cancelSeconds() return math.max(0, math.floor(num(cfg().cancelMinutes, 60))) * 60 end

-- ---- rows -> what the website gets ---------------------------------------------------------------------------

local function publicBooking(r)
  local g = findGarage(r.garage)
  local dur = tonumber(r.duration) or 30
  local endMin = (toMin(r.time) or 0) + dur
  return {
    id = r.id, garage = r.garage, garageName = g and g.name or r.garage, address = g and g.address or nil,
    plate = r.plate, vehicle = r.vehicle, date = r.date, time = r.time,
    endTime = ('%02d:%02d'):format(math.min(23, endMin // 60), endMin % 60),
    slotTs = r.slot_ts, fee = tonumber(r.fee) or 0, status = r.status,
    canCancel = r.status == 'booked' and (tonumber(r.slot_ts) or 0) - now() >= cancelSeconds(),
  }
end

local function cleanPlate(p)
  return (tostring(p or ''):upper():gsub('[^A-Z0-9]', ''))
end

-- ---- availability ---------------------------------------------------------------------------------------------

--- The next `daysAhead` days for a garage, each with its slots and whether they are free.
function Booking.availability(garageId)
  if not on() then return nil, 'disabled' end
  local g = findGarage(garageId)
  if not g then return nil, 'no_garage' end
  local slots = slotList(g)
  local first, last = dayInfo(0), dayInfo(horizon() - 1)
  local taken = {}
  local rows = MySQL.query.await(
    [[SELECT slot_ts, COUNT(*) AS c FROM computer_bookings
      WHERE garage = ? AND status IN ('held', 'booked') AND date BETWEEN ? AND ? GROUP BY slot_ts]],
    { g.id, first, last }) or {}
  for _, r in ipairs(rows) do taken[tonumber(r.slot_ts)] = tonumber(r.c) or 0 end

  local earliest = now() + math.max(0, math.floor(num(cfg().minNoticeMinutes, 30))) * 60
  local days = {}
  for i = 0, horizon() - 1 do
    local date, wd = dayInfo(i)
    local closed = closedDay(wd)
    local list = {}
    if not closed then
      for _, tm in ipairs(slots) do
        local ts = slotStamp(date, tm)
        list[#list + 1] = { time = tm, free = ts ~= nil and ts >= earliest and (taken[ts] or 0) < g.bays }
      end
    end
    days[#days + 1] = { date = date, weekday = wd, closed = closed, slots = list }
  end
  return { garage = { id = g.id, name = g.name, address = g.address, fee = g.fee }, days = days }
end

--- Is this date + time a real, open, future slot? Returns its timestamp, or nil + reason.
local function validSlot(g, date, time)
  if type(date) ~= 'string' or type(time) ~= 'string' then return nil, 'bad_slot' end
  local ok = false
  local slots = slotList(g)
  for _, tm in ipairs(slots) do if tm == time then ok = true end end
  if not ok then return nil, 'bad_slot' end
  for i = 0, horizon() - 1 do
    local d, wd = dayInfo(i)
    if d == date then
      if closedDay(wd) then return nil, 'bad_slot' end
      local ts = slotStamp(date, time)
      if not ts then return nil, 'bad_slot' end
      if ts < now() + math.max(0, math.floor(num(cfg().minNoticeMinutes, 30))) * 60 then return nil, 'too_soon' end
      return ts
    end
  end
  return nil, 'bad_slot'
end

-- ---- create ---------------------------------------------------------------------------------------------------

--- Reserves a slot. status 'held' waits for confirm(); pass status = 'booked' to book straight away (a move).
local function insert(d, status, feeOverride, ignoreId)
  local g = findGarage(d.garage)
  if not g then return nil, 'no_garage' end
  local ts, why = validSlot(g, d.date, d.time)
  if not ts then return nil, why end

  local key = g.id .. ':' .. ts
  if busy[key] then return nil, 'slot_taken' end
  busy[key] = true
  local ok, res, err = pcall(function()
    MySQL.update.await("DELETE FROM computer_bookings WHERE status = 'held' AND created_at < ?", { now() - 120 })
    local plate = cleanPlate(d.plate)
    local ig = tonumber(ignoreId) or 0

    local mine = MySQL.scalar.await(
      "SELECT COUNT(*) FROM computer_bookings WHERE cid = ? AND status IN ('held', 'booked') AND id <> ?", { d.cid, ig })
    if (tonumber(mine) or 0) >= math.max(1, math.floor(num(cfg().maxActivePerPlayer, 3))) then return nil, 'too_many' end

    local samePlate = MySQL.scalar.await(
      "SELECT COUNT(*) FROM computer_bookings WHERE UPPER(REPLACE(plate, ' ', '')) = ? AND status IN ('held', 'booked') AND id <> ?",
      { plate, ig })
    if (tonumber(samePlate) or 0) > 0 then return nil, 'plate_booked' end

    local taken = MySQL.scalar.await(
      "SELECT COUNT(*) FROM computer_bookings WHERE garage = ? AND slot_ts = ? AND status IN ('held', 'booked') AND id <> ?",
      { g.id, ts, ig })
    if (tonumber(taken) or 0) >= g.bays then return nil, 'slot_taken' end

    local _, dur = slotList(g)
    local id = MySQL.insert.await(
      [[INSERT INTO computer_bookings (garage, job, cid, name, plate, vehicle, slot_ts, date, time, duration, fee, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)]],
      { g.id, g.job, d.cid, tostring(d.name or ''):sub(1, 80), plate:sub(1, 16), tostring(d.vehicle or ''):sub(1, 80),
        ts, d.date, d.time, dur, feeOverride or g.fee, status, now() })
    return MySQL.single.await('SELECT * FROM computer_bookings WHERE id = ?', { id })
  end)
  busy[key] = nil
  if not ok then
    print(('^1[as-computer:booking] reserving a slot failed: %s^0'):format(tostring(res)))
    return nil, 'error'
  end
  if not res then return nil, err or 'error' end
  return res
end

--- d = { cid, name, plate, vehicle, garage, date, time }. Returns the held booking (with its fee) or nil + reason.
function Booking.hold(d)
  if not on() then return nil, 'disabled' end
  if type(d) ~= 'table' or type(d.cid) ~= 'string' or d.cid == '' or cleanPlate(d.plate) == '' then return nil, 'invalid' end
  local row, err = insert(d, 'held')
  if not row then return nil, err end
  return publicBooking(row)
end

function Booking.confirm(id)
  local n = MySQL.update.await("UPDATE computer_bookings SET status = 'booked' WHERE id = ? AND status = 'held'", { tonumber(id) })
  return (tonumber(n) or 0) > 0
end

function Booking.release(id)
  MySQL.update.await("DELETE FROM computer_bookings WHERE id = ? AND status = 'held'", { tonumber(id) })
  return true
end

-- ---- reading ----------------------------------------------------------------------------------------------------

--- { upcoming = { ... }, past = { ... } } for a character.
function Booking.mine(cid)
  if type(cid) ~= 'string' then return { upcoming = {}, past = {} } end
  local up = MySQL.query.await(
    "SELECT * FROM computer_bookings WHERE cid = ? AND status = 'booked' ORDER BY slot_ts LIMIT 20", { cid }) or {}
  local past = MySQL.query.await(
    "SELECT * FROM computer_bookings WHERE cid = ? AND status IN ('done', 'missed', 'cancelled', 'moved') ORDER BY slot_ts DESC LIMIT 8", { cid }) or {}
  local out = { upcoming = {}, past = {} }
  for _, r in ipairs(up) do out.upcoming[#out.upcoming + 1] = publicBooking(r) end
  for _, r in ipairs(past) do out.past[#out.past + 1] = publicBooking(r) end
  return out
end

--- The next waiting booking for a plate at a job (shown on the MOT app when the plate is looked up).
function Booking.nextFor(plate, job)
  local key = cleanPlate(plate)
  if key == '' then return nil end
  local r = MySQL.single.await(
    [[SELECT * FROM computer_bookings WHERE UPPER(REPLACE(plate, ' ', '')) = ? AND job = ? AND status = 'booked'
      ORDER BY slot_ts LIMIT 1]], { key, job })
  if not r then return nil end
  local b = publicBooking(r)
  b.customer = r.name
  return b
end

--- Waiting bookings of a job in a date range, shaped like Calendar events.
function Booking.forCalendar(job, from, to)
  local rows = MySQL.query.await(
    [[SELECT * FROM computer_bookings WHERE job = ? AND date BETWEEN ? AND ? AND status IN ('booked', 'done')
      ORDER BY date, time LIMIT 300]], { job, from, to }) or {}
  local out = {}
  for _, r in ipairs(rows) do
    local b = publicBooking(r)
    local extra = { L('cal_booking_customer', r.name or '—') }
    extra[#extra + 1] = L('cal_booking_vehicle', (r.vehicle and r.vehicle ~= '') and r.vehicle or '—')
    extra[#extra + 1] = L('cal_booking_garage', b.garageName)
    if r.status == 'done' then extra[#extra + 1] = L('cal_booking_done') end
    out[#out + 1] = {
      id = 'b' .. r.id, title = L('cal_booking_title', r.plate), notes = table.concat(extra, '\n'),
      color = cfg().colour or 'orange', date = r.date, startTime = r.time, endTime = b.endTime,
      createdBy = r.name, mine = false, allDay = false, booking = true, status = r.status,
    }
  end
  return out
end

-- ---- cancel / change ----------------------------------------------------------------------------------------------

local function lock(id)
  local key = 'b:' .. tostring(id)
  if busy[key] then return nil end
  busy[key] = true
  return function() busy[key] = nil end
end

--- Cancels a booking for its owner. Returns { refund, booking } (the website gives the money back) or nil + reason.
function Booking.cancel(cid, id)
  id = tonumber(id)
  if not id or type(cid) ~= 'string' then return nil, 'invalid' end
  local unlock = lock(id)
  if not unlock then return nil, 'error' end
  local ok, res, err = pcall(function()
    local r = MySQL.single.await("SELECT * FROM computer_bookings WHERE id = ? AND cid = ? AND status = 'booked'", { id, cid })
    if not r then return nil, 'not_found' end
    if (tonumber(r.slot_ts) or 0) - now() < cancelSeconds() then return nil, 'too_late' end
    local n = MySQL.update.await("UPDATE computer_bookings SET status = 'cancelled', settled = 1 WHERE id = ? AND status = 'booked'", { id })
    if (tonumber(n) or 0) == 0 then return nil, 'not_found' end
    r.status = 'cancelled'
    return { refund = tonumber(r.fee) or 0, booking = publicBooking(r) }
  end)
  unlock()
  if not ok then
    print(('^1[as-computer:booking] cancel failed: %s^0'):format(tostring(res)))
    return nil, 'error'
  end
  if not res then return nil, err or 'error' end
  return res
end

--- Moves a booking to another slot / garage, keeping what was paid. Returns the new booking or nil + reason.
function Booking.move(cid, id, garage, date, time)
  id = tonumber(id)
  if not on() then return nil, 'disabled' end
  if not id or type(cid) ~= 'string' then return nil, 'invalid' end
  local unlock = lock(id)
  if not unlock then return nil, 'error' end
  local ok, res, err = pcall(function()
    local old = MySQL.single.await("SELECT * FROM computer_bookings WHERE id = ? AND cid = ? AND status = 'booked'", { id, cid })
    if not old then return nil, 'not_found' end
    if (tonumber(old.slot_ts) or 0) - now() < cancelSeconds() then return nil, 'too_late' end
    local row, why = insert({ cid = cid, name = old.name, plate = old.plate, vehicle = old.vehicle, garage = garage, date = date, time = time },
      'booked', tonumber(old.fee) or 0, id)
    if not row then return nil, why end
    local n = MySQL.update.await("UPDATE computer_bookings SET status = 'moved', settled = 1 WHERE id = ? AND status = 'booked'", { id })
    if (tonumber(n) or 0) == 0 then
      MySQL.update.await('DELETE FROM computer_bookings WHERE id = ?', { row.id })
      return nil, 'not_found'
    end
    return publicBooking(row)
  end)
  unlock()
  if not ok then
    print(('^1[as-computer:booking] change failed: %s^0'):format(tostring(res)))
    return nil, 'error'
  end
  if not res then return nil, err or 'error' end
  return res
end

-- ---- money and closing ----------------------------------------------------------------------------------------

--- Pays a finished booking's fee into the garage job's society. Retried by the sweep until it goes through.
local function settle(r)
  if tonumber(r.settled) == 1 then return end
  local fee = tonumber(r.fee) or 0
  if fee > 0 and Bank.name() then
    local ok = Bank.add(Apps.account(r.job), fee, L('booking_bank_note', r.plate))
    if not ok then
      print(('^1[as-computer:booking] could not pay booking %s into the %s account; will retry^0'):format(r.id, r.job))
      return
    end
  end
  MySQL.update.await('UPDATE computer_bookings SET settled = 1 WHERE id = ?', { r.id })
end

--- A tester recorded an MOT for this plate: close the waiting booking (called by submitInspection).
function Booking.complete(plate, job)
  local key = cleanPlate(plate)
  if key == '' or not job then return end
  local r = MySQL.single.await(
    [[SELECT * FROM computer_bookings WHERE UPPER(REPLACE(plate, ' ', '')) = ? AND job = ? AND status = 'booked'
      ORDER BY slot_ts LIMIT 1]], { key, job })
  if not r then return end
  local n = MySQL.update.await("UPDATE computer_bookings SET status = 'done' WHERE id = ? AND status = 'booked'", { r.id })
  if (tonumber(n) or 0) > 0 then r.status = 'done'; settle(r) end
end

CreateThread(function()
  while true do
    Wait(60000)
    pcall(function()
      MySQL.update.await("DELETE FROM computer_bookings WHERE status = 'held' AND created_at < ?", { now() - 120 })
      local grace = math.max(0, math.floor(num(cfg().noShowGraceMinutes, 30))) * 60
      local rows = MySQL.query.await(
        "SELECT * FROM computer_bookings WHERE status = 'booked' AND slot_ts + duration * 60 + ? < ? LIMIT 50", { grace, now() }) or {}
      for _, r in ipairs(rows) do
        local n = MySQL.update.await("UPDATE computer_bookings SET status = 'missed' WHERE id = ? AND status = 'booked'", { r.id })
        if (tonumber(n) or 0) > 0 then r.status = 'missed'; settle(r) end
      end
      local open = MySQL.query.await(
        "SELECT * FROM computer_bookings WHERE status IN ('done', 'missed') AND settled = 0 LIMIT 20") or {}
      for _, r in ipairs(open) do settle(r) end
    end)
  end
end)

--- A vehicle got a new registration: keep its bookings on it (oldKey / newPlate: upper case).
function Booking.renamePlate(oldKey, newPlate)
  MySQL.update.await(
    'UPDATE computer_bookings SET plate = ? WHERE UPPER(REPLACE(plate, " ", "")) = ?',
    { cleanPlate(newPlate), oldKey })
end

-- ---- exports (used by as-browser's government site) -----------------------------------------------------------

-- One return value only (exports are safest that way): a table, or { error = 'reason' }.
local function pack(res, err)
  if res then return res end
  return { error = err or 'error' }
end

exports('bookingConfig', function()
  local gs = {}
  for _, g in ipairs(Booking.garages()) do gs[#gs + 1] = { id = g.id, name = g.name, address = g.address, fee = g.fee } end
  return {
    enabled = on(), garages = gs, daysAhead = horizon(),
    cancelMinutes = math.floor(cancelSeconds() / 60), maxActive = math.max(1, math.floor(num(cfg().maxActivePerPlayer, 3))),
  }
end)
exports('bookingAvailability', function(garage) return pack(Booking.availability(garage)) end)
exports('bookingHold', function(d) return pack(Booking.hold(d)) end)
exports('bookingConfirm', function(id) return Booking.confirm(id) end)
exports('bookingRelease', function(id) return Booking.release(id) end)
exports('bookingMine', function(cid) return Booking.mine(cid) end)
exports('bookingCancel', function(cid, id) return pack(Booking.cancel(cid, id)) end)
exports('bookingMove', function(cid, id, garage, date, time) return pack(Booking.move(cid, id, garage, date, time)) end)

--- Bookings whose reminder is due (starting soon, not reminded yet).
exports('bookingDueReminders', function()
  local mins = math.floor(num(cfg().remindMinutes, 30))
  if mins <= 0 then return {} end
  local rows = MySQL.query.await(
    "SELECT * FROM computer_bookings WHERE status = 'booked' AND reminded = 0 AND slot_ts > ? AND slot_ts - ? <= ? LIMIT 50",
    { now(), now(), mins * 60 }) or {}
  local out = {}
  for _, r in ipairs(rows) do
    local b = publicBooking(r)
    b.cid = r.cid
    b.name = r.name
    out[#out + 1] = b
  end
  return out
end)
exports('bookingMarkReminded', function(id)
  MySQL.update.await('UPDATE computer_bookings SET reminded = 1 WHERE id = ?', { tonumber(id) })
  return true
end)
