-- Print from the computer (client side): relays the page's calls to the server ('printApi').
local ALLOWED = { options = true, text = true, image = true, cert = true }

RegisterNUICallback('printApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('printApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)
