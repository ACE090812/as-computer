-- Hacking minigames (client side): relays the Command Prompt's server calls and runs the minigames for other scripts.
--   exports['as-computer']:StartHack(game, level, title)  -> true | false   (blocks until the player finishes)
--   exports['as-computer']:HackGames()                    -> { { id, name } }
-- ui/hack.js plays the games. In the Command Prompt the page starts them itself; for an export (no computer open) this file takes
-- the NUI focus for the length of the game and gives it back.

local ALLOWED = { targets = true, begin = true, finish = true }

RegisterNUICallback('cmdApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('cmdApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)

local GAMES = {
  { id = 'maze', name = 'Network Maze' }, { id = 'capture', name = 'Node Capture' }, { id = 'cipher', name = 'Cipher Lock' },
  { id = 'snake', name = 'Data Worm' }, { id = 'firewall', name = 'Firewall Defense' }, { id = 'evasion', name = 'Highway Evasion' },
  { id = 'typing', name = 'Code Injection' }, { id = 'signal', name = 'Signal Replay' }, { id = 'pipe', name = 'Packet Routing' },
  { id = 'breakout', name = 'ICE Breaker' },
}

local waiting = {}   -- id -> promise
local nextId = 0

RegisterNUICallback('hackDone', function(data, cb)
  cb('ok')
  data = data or {}
  local p = waiting[data.id]
  if p then waiting[data.id] = nil; p:resolve(data.success == true) end
end)

local function startHack(game, level, title)
  nextId = nextId + 1
  local id = nextId
  local p = promise.new()
  waiting[id] = p
  local ownFocus = not IsTerminalOpen()
  if ownFocus then SetNuiFocus(true, true) end
  SendNuiMessage(json.encode({ action = 'hackStart', id = id, game = game or 'random', level = level or 3, title = title, strings = LocaleTable() }))
  SetTimeout(10 * 60 * 1000, function()   -- give up after ten minutes
    if waiting[id] then waiting[id] = nil; p:resolve(false); SendNuiMessage(json.encode({ action = 'hackAbort' })) end
  end)
  local ok = Citizen.Await(p)
  if ownFocus and not IsTerminalOpen() then SetNuiFocus(false, false) end
  return ok == true
end

exports('StartHack', function(game, level, title) return startHack(game, level, title) end)
exports('HackGames', function() return GAMES end)

-- server/hack.lua's RequestHack export: run the game and report back with the token.
RegisterNetEvent('as-computer:client:hack', function(token, game, level, title)
  CreateThread(function()
    local ok = startHack(game, level, title ~= '' and title or nil)
    TriggerServerEvent('as-computer:server:hackReport', token, ok)
  end)
end)
