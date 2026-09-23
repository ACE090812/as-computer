-- Live monitor view: passes the picture of a computer's screen from the person using it to players nearby.
-- The last picture of each computer is kept (memory only) so people arriving later see it too, until the user
-- chooses Shut down (MirrorClear) or someone else sits down and sends new pictures.

local M = Config.Mirror or {}
local frames = {}   -- key -> data URL
local lastAt = {}   -- source -> GetGameTimer() of their last frame

local function coordsOf(key)
  local kind, n = tostring(key):match('^([cp])(%d+)$')
  n = tonumber(n)
  if kind == 'c' then local l = Config.Locations[n]; return l and l.coords end
  if kind == 'p' and PlacedCoords then return PlacedCoords(n) end
  return nil
end

local function playerNear(pid, c, range)
  local ped = GetPlayerPed(pid)
  return ped and ped ~= 0 and #(GetEntityCoords(ped) - c) <= range
end

local function send(pid, key, data)
  TriggerLatentClientEvent('as-computer:client:mirrorFrame', pid, M.bps or 200000, key, data)
end

RegisterNetEvent('as-computer:server:mirrorFrame', function(key, data)
  local src = source
  if M.enabled == false or type(key) ~= 'string' or not key:match('^[cp]%d+$') then return end
  if type(data) ~= 'string' or #data > (M.maxBytes or 250000) or data:sub(1, 23) ~= 'data:image/jpeg;base64,' then return end
  local now = GetGameTimer()
  if now - (lastAt[src] or 0) < math.max(300, (M.interval or 1000) * 0.5) then return end
  lastAt[src] = now
  if not (ComputerSessionIs and ComputerSessionIs(key, src)) then return end   -- only whoever is signed in there
  local c = coordsOf(key)
  if not c or not playerNear(src, c, 6.0) then return end                    -- and actually sitting at it
  frames[key] = data
  local range = (M.range or 15.0) + 5.0
  for _, id in ipairs(GetPlayers()) do
    local pid = tonumber(id)
    if pid and playerNear(pid, c, range) then send(pid, key, data) end
  end
end)

-- A player walked up to a computer: send the last picture if there is one.
RegisterNetEvent('as-computer:server:mirrorWant', function(key)
  local src = source
  local data = type(key) == 'string' and frames[key]
  if not data then return end
  local c = coordsOf(key)
  if c and playerNear(src, c, (M.range or 15.0) + 5.0) then send(src, key, data) end
end)

--- The computer was shut down or removed: back to its normal screen for everyone.
function MirrorClear(key)
  if frames[key] == nil then return end
  frames[key] = nil
  TriggerClientEvent('as-computer:client:mirrorClear', -1, key)
end

AddEventHandler('playerDropped', function() lastAt[source] = nil end)
