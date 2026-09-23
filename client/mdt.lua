-- MDT app (client side): relays the page's calls to the server ('mdtApi'), which checks the job,
-- the app gate (Apps.allowed) and, for a few actions, the officer's rank. Same shape as notepad.lua.
local ALLOWED = {
  boot = true, dashboard = true,
  peopleSearch = true, personGet = true, personNoteAdd = true, personNoteDelete = true, personPhotoAdd = true, personPhotoDelete = true,
  vehicleSearch = true, vehicleGet = true, vehicleSetStatus = true, vehicleToggleImpound = true,
  vehicleNoteAdd = true, vehicleNoteDelete = true, vehiclePhotoAdd = true, vehiclePhotoDelete = true,
  reportsList = true, reportGet = true, reportSave = true, reportDelete = true,
  bolosList = true, boloSave = true, boloToggle = true, boloDelete = true, boloVehicleLookup = true,
  chargesList = true,
}

RegisterNUICallback('mdtApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('mdtApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)
