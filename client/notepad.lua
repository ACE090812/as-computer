-- Notepad app (client side): relays the page's calls to the server ('notesApi'), which checks the job and the character.
local ALLOWED = { list = true, get = true, save = true, delete = true }

RegisterNUICallback('notesApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('notesApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)
