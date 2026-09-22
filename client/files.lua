-- File Explorer files (client side): relays the page's calls to the server ('filesApi'), which checks the job and the character.
local ALLOWED = {
  folders = true, tree = true, list = true, get = true, save = true, folder = true, link = true, rename = true, delete = true,
  copy = true, move = true, phoneList = true, phoneImport = true, toPhone = true,
  binList = true, restore = true, purge = true, binEmpty = true,
}

RegisterNUICallback('filesApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('filesApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)
