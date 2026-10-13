-- Business Manager (client side): relays the page's calls to the server ('bossApi'); the server checks the job and boss grade.
local ALLOWED = { overview = true, finances = true, employees = true, setGrade = true, fire = true, nearby = true, hire = true }

RegisterNUICallback('bossApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('bossApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)

RegisterNetEvent('as-computer:client:notify', function(msg)
  if type(msg) == 'string' and msg ~= '' then Bridge.Notify(msg, 'inform') end
end)
