-- Business Manager (server side). One callback, 'bossApi' (name, data). Every call re-checks, on the server:
-- the app is allowed (Apps.allowed -> computer job + boss grade) and the player is the boss of the job they act on.
--   overview   -> { job, grade, staff, online, payroll, balance, currency, bank }
--   employees  -> { rows = { { id, name, grade, gradeLabel, online, canManage, self } }, grades = { { grade, label, pay } }, maxGrade }
--   setGrade   { id, grade }         -> promote / demote someone below your own grade
--   fire       { id }                -> move them to Config.Boss.fireJob
--   nearby     -> { rows = { { src, name, grade, job } } }
--   hire       { src | id | cid, grade }
--   finances   -> { balance, currency, bank, history = { { at, balance } }, payroll }

local function cfg() return Config.Boss or {} end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_boss_balance` (
      `job` VARCHAR(50) NOT NULL,
      `at` INT NOT NULL,
      `balance` BIGINT NOT NULL,
      KEY `idx_job_at` (`job`, `at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

local function currency() return Config.Store and Config.Store.currency or '$' end

local function accountOf(jobName)
  return Apps.account and Apps.account(jobName) or jobName
end

local function balanceOf(jobName)
  if not (Bank and Bank.name()) then return nil end
  return Bank.balance(accountOf(jobName))
end

--- Records a balance sample for the chart (at most one per job per snapshotMinutes / 3).
local lastSample = {}
local function sample(jobName, balance)
  if balance == nil then return end
  local now = os.time()
  local gap = math.max(60, (tonumber(cfg().snapshotMinutes) or 30) * 60 / 3)
  if lastSample[jobName] and now - lastSample[jobName] < gap then return end
  lastSample[jobName] = now
  MySQL.insert('INSERT INTO computer_boss_balance (job, at, balance) VALUES (?, ?, ?)', { jobName, now, math.floor(balance) })
end

CreateThread(function()
  Wait(15000)
  while true do
    local keep = os.time() - (tonumber(cfg().keepDays) or 30) * 86400
    MySQL.update('DELETE FROM computer_boss_balance WHERE at < ?', { keep })
    -- only jobs a boss has looked at recently are sampled in the background
    local rows = MySQL.query.await('SELECT DISTINCT job FROM computer_boss_balance WHERE at > ?', { os.time() - 14 * 86400 }) or {}
    for _, r in ipairs(rows) do sample(r.job, balanceOf(r.job)) end
    Wait(math.max(5, tonumber(cfg().snapshotMinutes) or 30) * 60000)
  end
end)

local function note(src, action, detail)
  if ComputerLog then ComputerLog(Apps.computerOf(src), 'boss', action, detail, src) end
end

--- The acting boss: their job table, or nil + reason.
local function actor(src)
  if not Apps.allowed(src, 'boss') then return nil, 'not_authorised' end
  local j = Bridge.GetJob(src)
  if not j or not j.isBoss then return nil, 'not_boss' end
  local jobs = cfg().jobs
  if type(jobs) == 'table' and #jobs > 0 then
    local okJob = false
    for _, n in ipairs(jobs) do if n == j.name then okJob = true end end
    if not okJob then return nil, 'not_authorised' end
  end
  return j
end

--- Highest grade this boss may hand out.
local function maxGrade(j)
  local m = tonumber(cfg().maxHireGrade)
  if m then return math.min(m, j.grade) end
  return math.max(0, j.grade - 1)
end

local last = {}   -- src -> GetGameTimer() of the last change, so a runaway page cannot hammer the database
local function throttled(src)
  local t = GetGameTimer()
  if last[src] and t - last[src] < 400 then return true end
  last[src] = t
  return false
end
AddEventHandler('playerDropped', function() last[source] = nil end)

local function payrollOf(members, grades)
  local pay = {}
  for _, g in ipairs(grades) do pay[g.grade] = g.pay end
  local total = 0
  for _, m in ipairs(members) do total = total + (pay[m.grade] or 0) end
  return total
end

local function identifierOk(id) return type(id) == 'string' and #id > 0 and #id <= 64 and not id:find('[%c]') end

MotCallback.Register('bossApi', function(src, respond, name, data)
  local j, why = actor(src)
  if not j then return respond({ ok = false, reason = why }) end
  data = type(data) == 'table' and data or {}
  local me = Bridge.GetIdentifier(src)

  if name == 'overview' or name == 'finances' then
    local grades = Bridge.JobGrades(j.name)
    local members = Bridge.JobMembers(j.name)
    local balance = balanceOf(j.name)
    sample(j.name, balance)
    local online = 0
    for _, m in ipairs(members) do if m.online then online = online + 1 end end
    local out = {
      job = { name = j.name, label = j.label }, grade = j.grade, staff = #members, online = online,
      payroll = payrollOf(members, grades), balance = balance, currency = currency(), bank = Bank and Bank.name() or nil,
    }
    if name == 'finances' then
      local since = os.time() - 14 * 86400
      out.history = MySQL.query.await('SELECT at, balance FROM computer_boss_balance WHERE job = ? AND at > ? ORDER BY at ASC LIMIT 800', { j.name, since }) or {}
    end
    return respond({ ok = true, data = out })
  end

  if name == 'employees' then
    local grades = Bridge.JobGrades(j.name)
    local rows = {}
    for _, m in ipairs(Bridge.JobMembers(j.name)) do
      rows[#rows + 1] = {
        id = m.id, name = m.name, grade = m.grade, gradeLabel = m.gradeLabel, online = m.online ~= nil,
        self = m.id == me, canManage = m.id ~= me and m.grade < j.grade,
      }
    end
    return respond({ ok = true, data = { rows = rows, grades = grades, maxGrade = maxGrade(j), myGrade = j.grade } })
  end

  if name == 'setGrade' or name == 'fire' then
    if throttled(src) then return respond({ ok = false, reason = 'busy' }) end
    local id = data.id
    if not identifierOk(id) or id == me then return respond({ ok = false, reason = 'invalid' }) end
    local target
    for _, m in ipairs(Bridge.JobMembers(j.name)) do if m.id == id then target = m break end end
    if not target or target.grade >= j.grade then return respond({ ok = false, reason = 'invalid' }) end

    if name == 'fire' then
      local ok = Bridge.SetJob(id, cfg().fireJob or 'unemployed', cfg().fireGrade or 0)
      if not ok then return respond({ ok = false, reason = 'error' }) end
      note(src, 'fire', ('%s fired %s'):format(Bridge.GetName(src) or '?', target.name or id))
      return respond({ ok = true })
    end

    local grade = math.floor(tonumber(data.grade) or -1)
    local valid = false
    for _, g in ipairs(Bridge.JobGrades(j.name)) do if g.grade == grade then valid = true end end
    if not valid or grade > maxGrade(j) or grade == target.grade then return respond({ ok = false, reason = 'invalid' }) end
    local ok = Bridge.SetJob(id, j.name, grade)
    if not ok then return respond({ ok = false, reason = 'error' }) end
    note(src, grade > target.grade and 'promote' or 'demote', ('%s: %s -> %s'):format(target.name or id, tostring(target.gradeLabel), tostring(grade)))
    return respond({ ok = true })
  end

  if name == 'nearby' then
    local ped = GetPlayerPed(src)
    local here = ped ~= 0 and GetEntityCoords(ped) or nil
    local rows = {}
    if here then
      for _, pid in ipairs(GetPlayers()) do
        local other = tonumber(pid)
        local op = GetPlayerPed(other)
        if other ~= src and op ~= 0 and #(GetEntityCoords(op) - here) <= (tonumber(cfg().nearbyDistance) or 5.0) then
          local oj = Bridge.GetJob(other)
          if oj and oj.name ~= j.name then
            rows[#rows + 1] = { src = other, name = Bridge.GetName(other) or GetPlayerName(other), job = oj.label }
          end
        end
      end
    end
    return respond({ ok = true, data = { rows = rows } })
  end

  if name == 'hire' then
    if throttled(src) then return respond({ ok = false, reason = 'busy' }) end
    local grade = math.floor(tonumber(data.grade) or tonumber(cfg().hireGrade) or 0)
    local valid = false
    for _, g in ipairs(Bridge.JobGrades(j.name)) do if g.grade == grade then valid = true end end
    if not valid or grade > maxGrade(j) then return respond({ ok = false, reason = 'invalid' }) end

    local ident
    if tonumber(data.src) then
      local target = math.floor(tonumber(data.src))
      local ped, mine = GetPlayerPed(target), GetPlayerPed(src)
      if target == src or ped == 0 or mine == 0 or #(GetEntityCoords(ped) - GetEntityCoords(mine)) > (tonumber(cfg().nearbyDistance) or 5.0) + 1.0 then
        return respond({ ok = false, reason = 'far' })
      end
      ident = Bridge.GetIdentifier(target)
    elseif tonumber(data.serverId) then
      local target = math.floor(tonumber(data.serverId))
      if target == src or GetPlayerPed(target) == 0 then return respond({ ok = false, reason = 'not_found' }) end
      ident = Bridge.GetIdentifier(target)
    elseif identifierOk(data.cid) then
      ident = data.cid
    end
    if not ident or ident == me then return respond({ ok = false, reason = 'not_found' }) end

    local tsrc = Bridge.FindSource(ident)
    local cur = tsrc and Bridge.GetJob(tsrc)
    if cur and cur.name == j.name then return respond({ ok = false, reason = 'already' }) end
    if not tsrc then
      -- offline character: make sure they exist and are not on this job already
      for _, m in ipairs(Bridge.JobMembers(j.name)) do if m.id == ident then return respond({ ok = false, reason = 'already' }) end end
      if not Bridge.CharacterName(ident) then return respond({ ok = false, reason = 'not_found' }) end
    end
    local ok = Bridge.SetJob(ident, j.name, grade)
    if not ok then return respond({ ok = false, reason = 'error' }) end
    local who = (tsrc and Bridge.GetName(tsrc)) or Bridge.CharacterName(ident) or ident
    note(src, 'hire', ('%s hired %s at grade %d'):format(Bridge.GetName(src) or '?', who, grade))
    if tsrc then TriggerClientEvent('as-computer:client:notify', tsrc, L('boss_hired', j.label)) end
    return respond({ ok = true })
  end

  respond({ ok = false, reason = 'invalid' })
end)
