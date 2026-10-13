-- Hacking minigames (server side): your own targets (Config.Hack.targets) for the Command Prompt, and the RequestHack export.
-- The minigames run in the page, so the server never trusts a bare "I won": every attempt starts with a challenge token, is timed,
-- and a win reported faster than Config.Hack.minSeconds counts as failed.
--   cmdApi 'targets'  -> { targets = { { id, label, dist } } }
--   cmdApi 'begin'    { id }              -> { token, game, level, label }
--   cmdApi 'finish'   { token, success }  -> { success }   (fires the target's event on a win)

local function cfg() return Config.Hack or {} end

local GAMES = { 'maze', 'capture', 'cipher', 'snake', 'firewall', 'evasion', 'typing', 'signal', 'pipe', 'breakout' }
local GAME_SET = {}
for _, g in ipairs(GAMES) do GAME_SET[g] = true end
local function gameOf(g) if GAME_SET[g] then return g end return GAMES[math.random(#GAMES)] end
local function levelOf(l) return math.max(1, math.min(5, math.floor(tonumber(l) or 3))) end

local challenges = {}   -- token -> { src, id, game, level, label, started }
local pending = {}      -- token -> { src, cb, started }   (RequestHack from other scripts)

local function token()
  local t = {}
  for i = 1, 16 do t[i] = ('%x'):format(math.random(0, 15)) end
  return table.concat(t)
end

local function targetById(id)
  for _, t in ipairs(cfg().targets or {}) do if t.id == id then return t end end
end

local function distTo(src, c)
  local ped = GetPlayerPed(src)
  if not ped or ped == 0 then return math.huge end
  return #(GetEntityCoords(ped) - vector3(c.x, c.y, c.z))
end

local function jobOk(src, t)
  if type(t.jobs) ~= 'table' or #t.jobs == 0 then return true end
  local j = Bridge.GetJob(src)
  if not j then return false end
  for _, n in ipairs(t.jobs) do if n == j.name then return true end end
  return false
end

AddEventHandler('playerDropped', function()
  local src = source
  for t, c in pairs(challenges) do if c.src == src then challenges[t] = nil end end
  for t, c in pairs(pending) do if c.src == src then pending[t] = nil end end
end)

CreateThread(function()   -- forget challenges nobody finished
  while true do
    Wait(60000)
    local limit = ((tonumber(cfg().challengeSeconds) or 300) + 30) * 1000
    local now = GetGameTimer()
    for t, c in pairs(challenges) do if now - c.started > limit then challenges[t] = nil end end
    for t, c in pairs(pending) do if now - c.started > limit then pending[t] = nil end end
  end
end)

MotCallback.Register('cmdApi', function(src, respond, name, data)
  if cfg().enabled == false or not Apps.allowed(src, 'cmd') then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}

  if name == 'targets' then
    local list = {}
    for _, t in ipairs(cfg().targets or {}) do
      local d = t.coords and distTo(src, t.coords) or 0
      if jobOk(src, t) and (not t.coords or d <= (tonumber(t.radius) or 25.0)) then
        list[#list + 1] = { id = t.id, label = t.label or t.id, dist = t.coords and math.floor(d + 0.5) or nil }
      end
    end
    return respond({ ok = true, data = { targets = list } })
  end

  if name == 'begin' then
    local t = targetById(tostring(data.id or ''))
    if not t then return respond({ ok = false, reason = 'unknown' }) end
    if not jobOk(src, t) then return respond({ ok = false, reason = 'not_authorised' }) end
    if t.coords and distTo(src, t.coords) > (tonumber(t.radius) or 25.0) then return respond({ ok = false, reason = 'far' }) end
    for tk, c in pairs(challenges) do if c.src == src then challenges[tk] = nil end end   -- one attempt at a time
    local tk = token()
    challenges[tk] = { src = src, id = t.id, game = gameOf(t.game), level = levelOf(t.level), label = t.label or t.id, started = GetGameTimer() }
    local c = challenges[tk]
    return respond({ ok = true, data = { token = tk, game = c.game, level = c.level, label = c.label } })
  end

  if name == 'finish' then
    local tk = tostring(data.token or '')
    local c = challenges[tk]
    if not c or c.src ~= src then return respond({ ok = false, reason = 'invalid' }) end
    challenges[tk] = nil
    local elapsed = (GetGameTimer() - c.started) / 1000
    local success = data.success == true and elapsed >= (tonumber(cfg().minSeconds) or 4) and elapsed <= (tonumber(cfg().challengeSeconds) or 300)
    TriggerEvent('as-computer:server:hackResult', src, c.id, success, c.game)
    if success then
      local t = targetById(c.id)
      if t and t.event then TriggerEvent(t.event, src, t.id) end
    end
    return respond({ ok = true, data = { success = success } })
  end

  respond({ ok = false, reason = 'invalid' })
end)

-- ---- for other scripts ----------------------------------------------------------------------------------------------

--- Starts a minigame for a player and calls cb(true|false) when they finish. opts = { game, level, title }.
exports('RequestHack', function(src, opts, cb)
  opts = type(opts) == 'table' and opts or {}
  local tk = token()
  pending[tk] = { src = src, cb = cb, started = GetGameTimer() }
  TriggerClientEvent('as-computer:client:hack', src, tk, gameOf(opts.game), levelOf(opts.level), tostring(opts.title or ''))
end)

RegisterNetEvent('as-computer:server:hackReport', function(tk, success)
  local src = source
  local p = pending[tostring(tk)]
  if not p or p.src ~= src then return end
  pending[tostring(tk)] = nil
  local ok = success == true and (GetGameTimer() - p.started) / 1000 >= (tonumber(cfg().minSeconds) or 4)
  if p.cb then pcall(p.cb, ok) end
end)
