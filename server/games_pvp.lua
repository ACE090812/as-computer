-- Games: player matches (chess, Connect 4, Tic-tac-toe). Keeps the lobby of players who have the game open, passes challenges and
-- moves between the two players, and records the result. The games' rules run in both players' pages: the server only checks that
-- a move comes from whoever's turn it is, and records a result when both players report the same outcome. A player who leaves
-- (closes the game, disconnects) mid-match forfeits: the opponent wins. All messages use the net event 'as-computer:server:gamesPvp'
-- and come back to the page as { game, t = 'list'|'invite'|'invite_cancel'|'start'|'move'|'end'|'declined'|'rematch'|'error', ... }.

local function cfg() return (Config.Games or {}).pvp or {} end
local PVP_GAMES = { chess = true, connect4 = true, tictactoe = true }

local lobby = {}     -- game -> src -> { name, cid }
local matches = {}   -- match id -> { game, a, b, first, turn, reported = {}, rematch = {}, finished, clock, at }
local inMatch = {}   -- src -> match id
local invites = {}   -- invite id -> { game, from, to, clock }
local nextId = 0
local statCache = {} -- 'cid:game' -> { at, w, l }

local function send(src, game, msg) msg.game = game; TriggerClientEvent('as-computer:client:gamesPvp', src, msg) end

local function shortName(src)
  local full = (Bridge.GetName(src) or GetPlayerName(src) or '?'):gsub('%s+', ' ')
  local first, last = full:match('^(%S+)%s+(%S+)')
  if first and last and ((Config.Games or {}).names ~= 'full') then return first .. ' ' .. last:sub(1, 1) .. '.' end
  return full
end

local function record(cid, name, game, res, secs) if GamesRecordPvp then GamesRecordPvp(cid, name, game, res, secs, 0) end end

local function stat(cid, game)
  local key = cid .. ':' .. game
  local c = statCache[key]
  if c and os.time() - c.at < 60 then return c end
  local r = MySQL.single.await('SELECT SUM(result = 1) AS w, SUM(result = 0) AS l FROM computer_game_runs WHERE cid = ? AND game = ? AND mode = ?', { cid, game, 'pvp' }) or {}
  c = { at = os.time(), w = tonumber(r.w) or 0, l = tonumber(r.l) or 0 }
  statCache[key] = c
  return c
end

local function inRange(a, b)
  local range = tonumber(cfg().range) or 0
  if range <= 0 then return true end
  local pa, pb = GetPlayerPed(a), GetPlayerPed(b)
  if pa == 0 or pb == 0 then return false end
  return #(GetEntityCoords(pa) - GetEntityCoords(pb)) <= range
end

local function startMatch(game, a, b, clock, first)
  nextId = nextId + 1
  local id = nextId
  first = first or (math.random(2) == 1 and a or b)
  matches[id] = { game = game, a = a, b = b, first = first, turn = first, reported = {}, rematch = {}, clock = clock or 0, at = os.time() }
  inMatch[a], inMatch[b] = id, id
  send(a, game, { t = 'start', match = id, opp = shortName(b), first = first == a, clock = clock or 0 })
  send(b, game, { t = 'start', match = id, opp = shortName(a), first = first == b, clock = clock or 0 })
end

local function other(m, src) return m.a == src and m.b or m.a end

--- A player leaves a match that is not finished: the other one wins.
local function forfeit(src)
  local id = inMatch[src]; if not id then return end
  local m = matches[id]; inMatch[src] = nil
  if not m then return end
  local opp = other(m, src)
  if not m.finished then
    m.finished = true
    local secs = os.time() - m.at
    local c1, c2 = Bridge.GetIdentifier(src), Bridge.GetIdentifier(opp)
    if c1 and c2 and secs >= 3 then
      record(c1, Bridge.GetName(src) or '?', m.game, 0, secs)
      record(c2, Bridge.GetName(opp) or '?', m.game, 1, secs)
    end
    send(opp, m.game, { t = 'end', reason = 'left' })
  end
  inMatch[opp] = nil
  matches[id] = nil
end

local function leave(src, game)
  forfeit(src)
  if game and lobby[game] then lobby[game][src] = nil end
  for id, inv in pairs(invites) do
    if inv.from == src or inv.to == src then
      invites[id] = nil
      send(inv.to == src and inv.from or inv.to, inv.game, { t = inv.to == src and 'declined' or 'invite_cancel', id = id })
    end
  end
end

RegisterNetEvent('as-computer:server:gamesPvp', function(msg)
  local src = source
  if type(msg) ~= 'table' or type(msg.a) ~= 'string' then return end
  local game = msg.game
  if cfg().enabled == false or not PVP_GAMES[game] or not Apps.allowed(src, game) then return end

  if msg.a == 'join' then
    lobby[game] = lobby[game] or {}
    lobby[game][src] = { name = shortName(src), cid = Bridge.GetIdentifier(src) }
    return
  end
  if msg.a == 'leave' then return leave(src, game) end

  if msg.a == 'list' then
    local out = {}
    for p, info in pairs(lobby[game] or {}) do
      if p ~= src and GetPlayerPing(p) > 0 and inRange(src, p) then
        local s = stat(info.cid or tostring(p), game)
        out[#out + 1] = { src = p, name = info.name, w = s.w, l = s.l, busy = inMatch[p] ~= nil }
      end
    end
    table.sort(out, function(x, y) return x.name < y.name end)
    return send(src, game, { t = 'list', players = out })
  end

  if msg.a == 'challenge' then
    local target = math.floor(tonumber(msg.target) or -1)
    if not (lobby[game] and lobby[game][src] and lobby[game][target]) or target == src or inMatch[src] or inMatch[target] or not inRange(src, target) then
      return send(src, game, { t = 'error' })
    end
    for _, inv in pairs(invites) do if inv.to == target or inv.from == src then return send(src, game, { t = 'error' }) end end
    nextId = nextId + 1
    local id = nextId
    local clock = game == 'chess' and math.max(0, math.min(60, math.floor(tonumber(msg.clock) or 0))) or 0
    invites[id] = { game = game, from = src, to = target, clock = clock }
    send(target, game, { t = 'invite', id = id, from = shortName(src), clock = clock })
    SetTimeout((tonumber(cfg().inviteSeconds) or 30) * 1000, function()
      local inv = invites[id]
      if inv then invites[id] = nil; send(inv.to, game, { t = 'invite_cancel', id = id }); send(inv.from, game, { t = 'declined', id = id }) end
    end)
    return
  end

  if msg.a == 'respond' then
    local id = math.floor(tonumber(msg.id) or -1)
    local inv = invites[id]
    if not inv or inv.to ~= src or inv.game ~= game then return end
    invites[id] = nil
    if msg.accept == true and not inMatch[inv.from] and not inMatch[src] and GetPlayerPing(inv.from) > 0 then
      return startMatch(game, inv.from, src, inv.clock)
    end
    return send(inv.from, game, { t = 'declined', id = id })
  end

  local id = math.floor(tonumber(msg.match) or -1)
  local m = matches[id]
  if not m or m.game ~= game or (m.a ~= src and m.b ~= src) then return end

  if msg.a == 'move' then
    if m.finished or m.turn ~= src or type(msg.move) ~= 'table' then return end
    local ok, enc = pcall(json.encode, msg.move)
    if not ok or #enc > 200 then return end
    m.turn = other(m, src)
    return send(other(m, src), game, { t = 'move', move = msg.move })
  end

  if msg.a == 'result' then
    local res = msg.res
    if res ~= 0 and res ~= 1 and res ~= 2 then return end
    m.reported[src] = res
    local opp = other(m, src)
    if m.reported[opp] ~= nil and not m.finished then
      local r1, r2 = m.reported[src], m.reported[opp]
      if (r1 == 1 and r2 == 0) or (r1 == 0 and r2 == 1) or (r1 == 2 and r2 == 2) then
        m.finished = true
        local secs = os.time() - m.at
        if secs >= 2 then
          record(Bridge.GetIdentifier(src), Bridge.GetName(src) or '?', game, r1, secs)
          record(Bridge.GetIdentifier(opp), Bridge.GetName(opp) or '?', game, r2, secs)
        end
        statCache = {}
      else
        m.finished = true   -- the two pages disagree: nothing is recorded
      end
    end
    return
  end

  if msg.a == 'rematch' then
    m.rematch[src] = true
    local opp = other(m, src)
    if m.rematch[opp] then
      matches[id] = nil; inMatch[src], inMatch[opp] = nil, nil
      return startMatch(game, m.a, m.b, m.clock, other(m, m.first))
    end
    return send(opp, game, { t = 'rematch' })
  end
end)

AddEventHandler('playerDropped', function()
  local src = source
  for game in pairs(lobby) do leave(src, game) end
  forfeit(src)
end)
