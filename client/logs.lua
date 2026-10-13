-- Event Viewer (client side): relays the page's calls to the server ('logsApi'); the server decides who may read the log.
local ALLOWED = { list = true, clear = true }

RegisterNUICallback('logsApi', function(data, cb)
  data = data or {}
  if type(data.name) ~= 'string' or not ALLOWED[data.name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('logsApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, data.name, type(data.data) == 'table' and data.data or {})
end)

-- The desktop tells us an app window opened; the server writes the "Application started" line (and checks it all).
RegisterNUICallback('appOpened', function(data, cb)
  cb('ok')
  if type(data) == 'table' and type(data.id) == 'string' then TriggerServerEvent('as-computer:server:appOpened', data.id) end
end)
