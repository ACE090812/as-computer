-- Minimal bridge: job check + notifications. Extend as the rest of the
-- resource grows (payments, etc.)

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

--- Name of the player's current job (nil until the framework is detected).
function Bridge.CurrentJob()
  local name = nil
  pcall(function()
    if framework == 'qbox' then
      local p = exports.qbx_core:GetPlayerData()
      name = p and p.job and p.job.name
    elseif framework == 'qbcore' then
      local p = exports['qb-core']:GetCoreObject().Functions.GetPlayerData()
      name = p and p.job and p.job.name
    elseif framework == 'esx' then
      local p = exports.es_extended:getSharedObject().GetPlayerData()
      name = p and p.job and p.job.name
    end
  end)
  return name
end

--- Jobs allowed at a location: its own `jobs`, else Config.Jobs.
function Bridge.JobsFor(loc)
  return (loc and loc.jobs) or Config.Jobs or (Config.MechanicJob and { Config.MechanicJob }) or {}
end

--- Anything in Config.PublicApps switched on? Then anyone may sit at any computer (they get those apps only).
function Bridge.HasPublicApps()
  for _, on in pairs(Config.PublicApps or {}) do if on then return true end end
  return false
end

function Bridge.HasComputerJob(loc)
  if Bridge.HasPublicApps() then return true end
  local job = Bridge.CurrentJob()
  if not job then return false end
  for _, j in ipairs(Bridge.JobsFor(loc)) do
    if j == job then return true end
  end
  return false
end

--- Debug only (Config.Debug): which framework was detected and the player's current job name.
function Bridge.DebugInfo()
  local job = nil
  pcall(function()
    if framework == 'qbox' then
      local p = exports.qbx_core:GetPlayerData()
      job = p and p.job and p.job.name
    elseif framework == 'qbcore' then
      local p = exports['qb-core']:GetCoreObject().Functions.GetPlayerData()
      job = p and p.job and p.job.name
    elseif framework == 'esx' then
      local p = exports.es_extended:getSharedObject().GetPlayerData()
      job = p and p.job and p.job.name
    end
  end)
  return tostring(framework), tostring(job)
end

--- Show an in-game notification using whatever the server runs.
--- Order: Config.Notify override -> framework -> ox_lib -> GTA feed.
--- @param message string
--- @param ntype string 'inform' | 'success' | 'error' (default 'inform')
function Bridge.Notify(message, ntype)
  ntype = ntype or 'inform'

  if type(Config.Notify) == 'function' then
    return Config.Notify(message, ntype)
  end

  if framework == 'qbox' then
    return exports.qbx_core:Notify(message, ntype)
  elseif framework == 'qbcore' then
    local qbType = ntype == 'inform' and 'primary' or ntype
    return exports['qb-core']:GetCoreObject().Functions.Notify(message, qbType)
  elseif framework == 'esx' then
    local esxType = ntype == 'inform' and 'info' or ntype
    return exports.es_extended:getSharedObject().ShowNotification(message, esxType)
  end

  if GetResourceState('ox_lib') == 'started' then
    return TriggerEvent('ox_lib:notify', { description = message, type = ntype })
  end

  BeginTextCommandThefeedPost('STRING')
  AddTextComponentSubstringPlayerName(message)
  EndTextCommandThefeedPostTicker(false, true)
end
