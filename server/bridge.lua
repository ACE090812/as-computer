Bridge = {}

local framework = nil -- "qbox" | "qbcore" | "esx"

CreateThread(function()
  if GetResourceState('qbx_core') == 'started' then
    framework = 'qbox'
  elseif GetResourceState('qb-core') == 'started' then
    framework = 'qbcore'
  elseif GetResourceState('es_extended') == 'started' then
    framework = 'esx'
  end
end)

-- Table + column names for owned vehicles. qb/qbox both use player_vehicles;
-- esx traditionally uses owned_vehicles. Override in config.lua if your
-- server customised these.
function Bridge.VehicleTable()
  if framework == 'esx' then return 'owned_vehicles' end
  return 'player_vehicles' -- qbcore / qbox default
end

-- Owner column on that table: esx's owned_vehicles uses `owner` (an identifier), qb/qbox's
-- player_vehicles uses `citizenid`. Never hardcode either name directly in a query.
function Bridge.VehicleOwnerColumn()
  if framework == 'esx' then return 'owner' end
  return 'citizenid' -- qbcore / qbox default
end

-- qb/qbox's `vehicle` column on player_vehicles is a plain spawn name string (e.g. "ninef").
-- esx's `vehicle` column on owned_vehicles is a JSON blob of the vehicle's full saved props
-- (mods, colours, dirt level, ...) - the model is a HASH buried inside it (`.model`), not a
-- name, and that JSON is not something to show a player directly (this is what was leaking
-- straight onto the MOT Testing Service page as raw text - nothing to do with any language
-- file). Resolve it against esx's own `vehicles` table (name/model columns), same joaat-hash
-- match as-browser already uses for its own vehicle listings.
local function joaat(str)
  str = tostring(str):lower()
  local h = 0
  for i = 1, #str do
    h = (h + str:byte(i)) & 0xFFFFFFFF
    h = (h + (h << 10)) & 0xFFFFFFFF
    h = (h ~ (h >> 6)) & 0xFFFFFFFF
  end
  h = (h + (h << 3)) & 0xFFFFFFFF
  h = (h ~ (h >> 11)) & 0xFFFFFFFF
  h = (h + (h << 15)) & 0xFFFFFFFF
  return h
end

local esxModelsByHash
local function buildEsxModels()
  if esxModelsByHash then return end
  esxModelsByHash = {}
  local ok, rows = pcall(function() return MySQL.query.await('SELECT name, model FROM vehicles') end)
  if ok and type(rows) == 'table' then
    for _, v in ipairs(rows) do
      if v.model and v.name then esxModelsByHash[joaat(v.model)] = v.name end
    end
  end
end

--- Turns the raw value stored in the owned-vehicles table's "vehicle" column into a display label.
--- qb/qbox: already a plain spawn name, returned unchanged. esx: decodes the props JSON and looks
--- its model hash up against the `vehicles` table; falls back to the hash itself if that table
--- doesn't know it, and to the raw value if it isn't JSON at all (an already-customised column).
function Bridge.VehicleModelLabel(raw)
  if type(raw) ~= 'string' or raw == '' then return raw end
  if framework ~= 'esx' or raw:sub(1, 1) ~= '{' then return raw end
  local ok, data = pcall(json.decode, raw)
  if not ok or type(data) ~= 'table' then return raw end
  local hash = tonumber(data.model or data.modelName or data.MODEL)
  if not hash then return raw end
  -- Vehicle hashes are unsigned 32-bit, but this column stores them as a SIGNED int (MySQL/JSON have
  -- no unsigned type), and joaat() above only ever produces the unsigned form - so a hash above
  -- 0x7FFFFFFF comes back here negative (e.g. -225539375) and must be masked back to unsigned before
  -- comparing, or it never matches and, worse, %X on a raw negative Lua integer sign-extends to a
  -- garbled 16-digit 64-bit hex string (that's the "MODEL 0XFFFFFFFFF28E8AD1" bug).
  hash = hash & 0xFFFFFFFF
  buildEsxModels()
  return esxModelsByHash[hash] or ('model 0x%08X'):format(hash)
end

function Bridge.GetPlayer(src)
  if framework == 'qbox' then
    return exports.qbx_core:GetPlayer(src)
  elseif framework == 'qbcore' then
    return exports['qb-core']:GetCoreObject().Functions.GetPlayer(src)
  elseif framework == 'esx' then
    return exports.es_extended:getSharedObject().GetPlayerFromId(src)
  end
  return nil
end

function Bridge.GetIdentifier(src)
  local p = Bridge.GetPlayer(src)
  if not p then return tostring(src) end
  if framework == 'esx' then return p.identifier end
  return p.PlayerData and p.PlayerData.citizenid or tostring(src)
end

function Bridge.GetName(src)
  local p = Bridge.GetPlayer(src)
  if not p then return GetPlayerName(src) end
  if framework == 'esx' then
    -- string.gsub returns (result, count), so a bare chained-gsub return here would leak that count
    -- as a second value - harmless almost everywhere it's called, but fatal when this ends up as the
    -- LAST item in a parameter table (e.g. server/apps.lua's install query), where Lua splices every
    -- return value from a table constructor's final expression, turning a 5-column INSERT into 6.
    local full = ('%s %s'):format(p.getName and p.getName() or '', '')
    full = full:gsub('^%s+', '')
    full = (full:gsub('%s+$', ''))
    return full
  end
  local charinfo = p.PlayerData and p.PlayerData.charinfo
  if charinfo then return ('%s %s'):format(charinfo.firstname, charinfo.lastname) end
  return GetPlayerName(src)
end

--- Is this player a server admin? Console (0) always is. Checks the ace for the admin command, then the
--- framework's own admin permission (QBCore / QBox permission, ESX group). Used by /pcadmin and /placeprops.
function Bridge.IsAdmin(src)
  src = tonumber(src) or 0
  if src == 0 then return true end
  local cmd = (Config.Admin and Config.Admin.command) or 'pcadmin'
  if IsPlayerAceAllowed(src, 'command.' .. cmd) or IsPlayerAceAllowed(src, 'command.' .. ((Config.Placement and Config.Placement.command) or 'placeprops')) then
    return true
  end
  local ok, res = pcall(function()
    if framework == 'qbcore' then
      local f = exports['qb-core']:GetCoreObject().Functions
      return f.HasPermission(src, 'admin') or f.HasPermission(src, 'god')
    elseif framework == 'qbox' then
      return IsPlayerAceAllowed(src, 'group.admin') or IsPlayerAceAllowed(src, 'qbox.admin') or IsPlayerAceAllowed(src, 'admin')
    elseif framework == 'esx' then
      local p = exports.es_extended:getSharedObject().GetPlayerFromId(src)
      local g = p and p.getGroup and p.getGroup()
      return g == 'admin' or g == 'superadmin'
    end
    return false
  end)
  return ok and res == true
end

--- Jobs allowed to use the computer anywhere: Config.Jobs plus any location's own `jobs`.
local allowed
function Bridge.AllowedJobs()
  if allowed then return allowed end
  allowed = {}
  local function add(list) for _, j in ipairs(list or {}) do allowed[j] = true end end
  add(Config.Jobs or (Config.MechanicJob and { Config.MechanicJob }) or {})
  for _, loc in ipairs(Config.Locations or {}) do add(loc.jobs) end
  -- Config.AllJobs: every job counts as a computer job (Store, File Explorer, Calendar, Mail...) except
  -- Config.ExcludeJobs. Job-specific apps (MOT, Mechanic, MDT, Court MDT) are still limited by their own
  -- Config.Apps.<id>.jobs list, so this only opens up the apps that have no `jobs` restriction.
  if Config.AllJobs then
    local ex = Config.ExcludeJobs or { unemployed = true }
    setmetatable(allowed, { __index = function(_, name)
      if type(name) ~= 'string' or name == '' or ex[name] then return nil end
      return true
    end })
  end
  return allowed
end

--- { name, label, grade (number), isBoss } of the player's job, or nil.
function Bridge.GetJob(src)
  local p = Bridge.GetPlayer(src)
  if not p then return nil end
  if framework == 'esx' then
    local j = p.getJob and p.getJob()
    if not j then return nil end
    return { name = j.name, label = j.label or j.name, grade = tonumber(j.grade) or 0, isBoss = j.grade_name == 'boss' }
  end
  local j = p.PlayerData and p.PlayerData.job
  if not j then return nil end
  local g = type(j.grade) == 'table' and j.grade or {}
  return { name = j.name, label = j.label or j.name, grade = tonumber(g.level) or tonumber(j.grade) or 0,
           isBoss = j.isboss == true or g.isboss == true }
end

--- Display name for a job name ("mechanic" -> "Mechanic"), using the framework's job list when it has one.
function Bridge.JobLabel(name)
  local label
  pcall(function()
    if framework == 'qbox' then
      local jobs = exports.qbx_core:GetJobs()
      label = jobs and jobs[name] and jobs[name].label
    elseif framework == 'qbcore' then
      local jobs = exports['qb-core']:GetCoreObject().Shared.Jobs
      label = jobs and jobs[name] and jobs[name].label
    elseif framework == 'esx' then
      local esx = exports.es_extended:getSharedObject()
      local jobs = esx.GetJobs and esx.GetJobs()
      label = jobs and jobs[name] and jobs[name].label
    end
  end)
  if label and label ~= '' then return label end
  return (tostring(name):gsub('[_-]', ' '):gsub('^%l', string.upper))
end

--- Is the player on a job that may use the computer? (Which apps they have is server/apps.lua.)
function Bridge.HasJobComputer(src)
  local j = Bridge.GetJob(src)
  return j ~= nil and Bridge.AllowedJobs()[j.name] == true
end

--- May the player sit at a computer at all? A computer job, or anyone when Config.PublicApps has apps on.
function Bridge.HasComputerJob(src)
  for _, on in pairs(Config.PublicApps or {}) do if on then return true end end
  return Bridge.HasJobComputer(src)
end


-- ---- helpers used by the Boss app -----------------------------------------------------------------------

function Bridge.Framework() return framework end

local function jsonOf(v)
  if type(v) == 'table' then return v end
  if type(v) == 'string' and v ~= '' then
    local ok, t = pcall(json.decode, v)
    if ok and type(t) == 'table' then return t end
  end
  return {}
end

--- Raw job table from the framework's shared data (or nil): { label, grades = { [level] = { name, payment/salary, isboss } } }.
local function sharedJob(name)
  local j
  pcall(function()
    if framework == 'qbox' then
      j = exports.qbx_core:GetJob(name)
    elseif framework == 'qbcore' then
      j = exports['qb-core']:GetCoreObject().Shared.Jobs[name]
    elseif framework == 'esx' then
      j = exports.es_extended:getSharedObject().GetJobs()[name]
    end
  end)
  return j
end

--- Every grade of a job, lowest first: { { grade = number, label, pay, isBoss } }.
function Bridge.JobGrades(name)
  local sj = sharedJob(name)
  local out = {}
  if not sj or type(sj.grades) ~= 'table' then return out end
  local topEsx = 0
  for k, g in pairs(sj.grades) do
    local lvl = tonumber(k)
    if lvl then
      if lvl > topEsx then topEsx = lvl end
      out[#out + 1] = {
        grade = lvl, label = g.name or g.label or tostring(lvl), pay = tonumber(g.payment or g.salary) or 0,
        isBoss = g.isboss == true or g.name == 'boss' or g.grade_name == 'boss',
      }
    end
  end
  table.sort(out, function(a, b) return a.grade < b.grade end)
  return out
end

local function gradeLabelOf(grades, level)
  for _, g in ipairs(grades) do if g.grade == level then return g.label end end
  return tostring(level)
end

--- Everyone on a job, online or not: { { id = identifier, name, grade, gradeLabel, online = src|nil } }.
function Bridge.JobMembers(name)
  local grades = Bridge.JobGrades(name)
  local byId, order = {}, {}
  local function put(r) if not byId[r.id] then order[#order + 1] = r.id end byId[r.id] = r end

  local ok = pcall(function()
    if framework == 'esx' then
      for _, r in ipairs(MySQL.query.await('SELECT identifier, firstname, lastname, job_grade FROM users WHERE job = ? LIMIT 500', { name }) or {}) do
        put({ id = r.identifier, name = ((r.firstname or '') .. ' ' .. (r.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''), grade = tonumber(r.job_grade) or 0 })
      end
    elseif framework then
      for _, r in ipairs(MySQL.query.await(
        "SELECT citizenid, charinfo, job FROM players WHERE JSON_UNQUOTE(JSON_EXTRACT(job, '$.name')) = ? LIMIT 500", { name }) or {}) do
        local ci, jb = jsonOf(r.charinfo), jsonOf(r.job)
        local g = type(jb.grade) == 'table' and jb.grade or {}
        put({ id = r.citizenid, name = ((ci.firstname or '') .. ' ' .. (ci.lastname or '')):gsub('^%s+', ''):gsub('%s+$', ''),
              grade = tonumber(g.level) or tonumber(jb.grade) or 0 })
      end
    end
  end)
  if not ok then print('^1[as-computer:boss] could not read the job members from the database^0') end

  -- Online players are the truth: add / correct them, and drop an offline row for someone who has since changed job.
  for _, pid in ipairs(GetPlayers()) do
    local src = tonumber(pid)
    local id = Bridge.GetIdentifier(src)
    local j = Bridge.GetJob(src)
    if j and id then
      if j.name == name then
        put({ id = id, name = Bridge.GetName(src), grade = j.grade })
        byId[id].name, byId[id].grade = Bridge.GetName(src), j.grade
        byId[id].online = src
      elseif byId[id] then
        byId[id] = nil
      end
    end
  end

  local out = {}
  for _, id in ipairs(order) do
    local r = byId[id]
    if r then
      r.gradeLabel = gradeLabelOf(grades, r.grade)
      out[#out + 1] = r
    end
  end
  table.sort(out, function(a, b) if a.grade ~= b.grade then return a.grade > b.grade end return (a.name or '') < (b.name or '') end)
  return out
end

--- Puts a character (online or offline) on a job at a grade. true on success.
function Bridge.SetJob(identifier, jobName, grade)
  grade = math.floor(tonumber(grade) or 0)
  local src = Bridge.FindSource(identifier)
  local ok, res = pcall(function()
    if framework == 'qbox' then
      return exports.qbx_core:SetJob(identifier, jobName, grade) ~= false
    elseif framework == 'qbcore' then
      if src then
        local p = Bridge.GetPlayer(src)
        return p.Functions.SetJob(jobName, grade) ~= false
      end
      local sj = sharedJob(jobName)
      local g = sj and sj.grades and (sj.grades[tostring(grade)] or sj.grades[grade])
      if not sj or not g then return false end
      local blob = json.encode({
        name = jobName, label = sj.label, payment = g.payment or 0, type = sj.type, onduty = true,
        isboss = g.isboss == true, grade = { name = g.name, level = grade },
      })
      return (MySQL.update.await('UPDATE players SET job = ? WHERE citizenid = ?', { blob, identifier }) or 0) > 0
    elseif framework == 'esx' then
      if src then
        local p = Bridge.GetPlayer(src)
        p.setJob(jobName, grade)
        return true
      end
      return (MySQL.update.await('UPDATE users SET job = ?, job_grade = ? WHERE identifier = ?', { jobName, grade, identifier }) or 0) > 0
    end
    return false
  end)
  return ok and res == true
end

-- ---- helpers used by the Mechanic app ---------------------------------------------------------------

--- Server id of the online player with this character id, or nil.
function Bridge.FindSource(identifier)
  if not identifier then return nil end
  for _, id in ipairs(GetPlayers()) do
    local src = tonumber(id)
    if src and Bridge.GetIdentifier(src) == identifier then return src end
  end
  return nil
end

--- { identifier, name, phone } of an online player, or nil.
function Bridge.Character(src)
  local p = Bridge.GetPlayer(src)
  if not p then return nil end
  local phone
  if framework ~= 'esx' then
    local ci = p.PlayerData and p.PlayerData.charinfo
    phone = ci and ci.phone or nil
  end
  return { identifier = Bridge.GetIdentifier(src), name = Bridge.GetName(src), phone = phone }
end

--- In-character name of a character that may be offline (best effort), or nil.
function Bridge.CharacterName(identifier)
  if not identifier then return nil end
  local ok, name = pcall(function()
    if framework == 'esx' then
      local r = MySQL.single.await('SELECT firstname, lastname FROM users WHERE identifier = ?', { identifier })
      return r and ((r.firstname or '') .. ' ' .. (r.lastname or '')) or nil
    end
    local r = MySQL.single.await('SELECT charinfo FROM players WHERE citizenid = ?', { identifier })
    local ci = r and r.charinfo
    if type(ci) == 'string' then ci = json.decode(ci) end
    if type(ci) == 'table' then return (ci.firstname or '') .. ' ' .. (ci.lastname or '') end
    return nil
  end)
  if ok and type(name) == 'string' then
    name = name:gsub('^%s+', ''):gsub('%s+$', '')
    if name ~= '' then return name end
  end
  return nil
end

function Bridge.GetMoney(src, account)
  local p = Bridge.GetPlayer(src)
  if not p then return 0 end
  if framework == 'esx' then
    local acc = p.getAccount and p.getAccount(account)
    return acc and acc.money or 0
  end
  return p.PlayerData and p.PlayerData.money and p.PlayerData.money[account] or 0
end

--- Takes money from a player's account. true when the full amount was taken.
function Bridge.RemoveMoney(src, account, amount, reason)
  amount = math.floor(tonumber(amount) or 0)
  if amount <= 0 then return true end
  local p = Bridge.GetPlayer(src)
  if not p or Bridge.GetMoney(src, account) < amount then return false end
  if framework == 'esx' then
    p.removeAccountMoney(account, amount)
    return true
  end
  return p.Functions.RemoveMoney(account, amount, reason or 'as-computer') == true
end

--- Gives money back (refund after a failed step).
function Bridge.AddMoney(src, account, amount, reason)
  amount = math.floor(tonumber(amount) or 0)
  if amount <= 0 then return true end
  local p = Bridge.GetPlayer(src)
  if not p then return false end
  if framework == 'esx' then p.addAccountMoney(account, amount) return true end
  p.Functions.AddMoney(account, amount, reason or 'as-computer')
  return true
end
