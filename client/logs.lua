-- Event Viewer (client side): relays the page's calls to the server ('logsApi'); the server decides who may read the log.
RegisterNUICallback('logsApi', function(data, cb)
  data = data or {}
  if data.name ~= 'list' then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('logsApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, 'list', type(data.data) == 'table' and data.data or {})
end)
