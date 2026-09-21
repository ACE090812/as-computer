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
    return ('%s %s'):format(p.getName and p.getName() or '', ''):gsub('^%s+', ''):gsub('%s+$', '')
  end
  local charinfo = p.PlayerData and p.PlayerData.charinfo
  if charinfo then return ('%s %s'):format(charinfo.firstname, charinfo.lastname) end
  return GetPlayerName(src)
end

--- Jobs allowed to use the computer anywhere: Config.Jobs plus any location's own `jobs`.
local allowed
function Bridge.AllowedJobs()
  if allowed then return allowed end
  allowed = {}
  local function add(list) for _, j in ipairs(list or {}) do allowed[j] = true end end
  add(Config.Jobs or (Config.MechanicJob and { Config.MechanicJob }) or {})
  for _, loc in ipairs(Config.Locations or {}) do add(loc.jobs) end
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
function Bridge.HasComputerJob(src)
  local j = Bridge.GetJob(src)
  return j ~= nil and Bridge.AllowedJobs()[j.name] == true
end
