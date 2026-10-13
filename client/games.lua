-- Games (client side): relays the games' calls to the server ('gamesApi', checked there), and hands the page the sound settings.
local ALLOWED = { board = true, submit = true, stats = true, save = true, load = true, clearSave = true, prefs = true, setPrefs = true }

RegisterNUICallback('gamesApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('gamesApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)

RegisterNUICallback('gamesConfig', function(_, cb)
  local g = Config.Games or {}
  cb({ music = (g.audio and g.audio.music) or {}, chessClock = g.pvp and g.pvp.chessClock or { 5, 10, 15 }, pvp = g.pvp and g.pvp.enabled ~= false })
end)
