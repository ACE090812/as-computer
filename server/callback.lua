MotCallback = {}
local handlers = {}

function MotCallback.Register(name, handler)
  handlers[name] = handler
end

RegisterNetEvent('as-computer:server:callback', function(name, id, ...)
  local src = source
  local handler = handlers[name]
  if not handler then return end
  local function respond(...)
    TriggerClientEvent('as-computer:client:callbackResponse', src, id, ...)
  end
  handler(src, respond, ...)
end)
