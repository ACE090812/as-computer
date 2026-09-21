-- Tiny promise-style client->server callback, dependency-free so it works
-- whether ox_lib is present or not (ESX/QBCore/Qbox all supported).

MotCallback = {}
local pending = {}
local nextId = 0

RegisterNetEvent('as-computer:client:callbackResponse', function(id, ...)
  local p = pending[id]
  if not p then return end
  pending[id] = nil
  p(...)
end)

--- @param name string  server event name (registered with MotCallback.Register on the server)
--- @param cb function  called with the server's response args
--- @param ... any      arguments forwarded to the server handler
function MotCallback.Trigger(name, cb, ...)
  nextId = nextId + 1
  local id = nextId
  pending[id] = cb
  TriggerServerEvent('as-computer:server:callback', name, id, ...)
end
