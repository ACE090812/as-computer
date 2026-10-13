-- Games (server side): leaderboards, stats, saved games and per-game settings for Snake, Blocks, Solitaire, Chess, Connect 4 and
-- Tic-tac-toe. Everything belongs to the CHARACTER. Installing a game is the Store's job (server/apps.lua, personal apps).
-- One callback, 'gamesApi' (name, data):
--   board    { game, period = 'day'|'week'|'all' } -> { rows = { { rank, name, value, at, me } }, mine = { rank, value }, metric }
--   submit   { game, score, result, seconds, level, mode } -> { rank = { day, week, all } , best }    result: 1 win, 0 loss, 2 draw (score games: omit)
--   stats    -> { games = { [id] = { played, best, wins, losses, draws, seconds, week = rank } }, totals }
--   save     { game, state } / load { game } / clearSave { game }
--   prefs    { game } / setPrefs { game, prefs }

local function cfg() return Config.Games or {} end
local GAME_IDS = { 'snake', 'blocks', 'solitaire', 'chess', 'connect4', 'tictactoe' }
local IS_GAME = {}
for _, g in ipairs(GAME_IDS) do IS_GAME[g] = true end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_game_runs` (
      `id` INT AUTO_INCREMENT PRIMARY KEY,
      `game` VARCHAR(16) NOT NULL,
      `cid` VARCHAR(64) NOT NULL,
      `name` VARCHAR(80) NOT NULL,
      `score` INT NOT NULL DEFAULT 0,
      `result` TINYINT NOT NULL DEFAULT -1,
      `seconds` INT NOT NULL DEFAULT 0,
      `level` TINYINT NOT NULL DEFAULT 0,
      `mode` VARCHAR(8) NOT NULL DEFAULT 'solo',
      `at` INT NOT NULL,
      KEY `idx_game_at` (`game`, `at`),
      KEY `idx_cid` (`cid`, `game`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_game_saves` (
      `cid` VARCHAR(64) NOT NULL,
      `game` VARCHAR(16) NOT NULL,
      `state` MEDIUMTEXT NOT NULL,
      `saved_at` INT NOT NULL,
      PRIMARY KEY (`cid`, `game`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_game_prefs` (
      `cid` VARCHAR(64) NOT NULL,
      `game` VARCHAR(16) NOT NULL,
      `prefs` VARCHAR(600) NOT NULL,
      PRIMARY KEY (`cid`, `game`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
end)

CreateThread(function()   -- old finished games are deleted
  Wait(30000)
  while true do
    local days = tonumber(cfg().keepDays) or 180
    if days > 0 then MySQL.update('DELETE FROM computer_game_runs WHERE at < ?', { os.time() - days * 86400 }) end
    Wait(6 * 3600 * 1000)
  end
end)

--- Start of today (00:00) and of this week (Monday 00:00), server time.
local function periodStart(period)
  local now = os.time()
  local t = os.date('*t', now)
  local day = os.time({ year = t.year, month = t.month, day = t.day, hour = 0, min = 0, sec = 0 })
  if period == 'day' then return day end
  if period == 'week' then
    local wday = (t.wday + 5) % 7   -- Monday = 0
    return day - wday * 86400
  end
  return 0
end

local function displayName(src)
  local full = (Bridge.GetName(src) or GetPlayerName(src) or '?'):gsub('%s+', ' ')
  if cfg().names == 'full' then return full:sub(1, 80) end
  local first, last = full:match('^(%S+)%s+(%S+)')
  if first and last then return ((first .. ' ' .. last:sub(1, 1) .. '.')):sub(1, 80) end
  return full:sub(1, 80)
end

local function shortName(full)
  full = tostring(full or '?')
  if cfg().names == 'full' then return full end
  local first, last = full:match('^(%S+)%s+(%S+)')
  return first and last and (first .. ' ' .. last:sub(1, 1) .. '.') or full
end

local function metricOf(game) return (cfg().metric and cfg().metric[game]) or 'score' end

--- value column and filter for a game's leaderboard
local function boardSql(game, since)
  if metricOf(game) == 'wins' then
    return 'SELECT cid, MAX(name) AS name, SUM(result = 1) AS v, MAX(at) AS at FROM computer_game_runs WHERE game = ? AND at >= ? AND result >= 0 GROUP BY cid HAVING v > 0 ORDER BY v DESC, at ASC', { game, since }
  end
  return 'SELECT cid, MAX(name) AS name, MAX(score) AS v, MAX(at) AS at FROM computer_game_runs WHERE game = ? AND at >= ? AND score > 0 GROUP BY cid ORDER BY v DESC, at ASC', { game, since }
end

local function rankOf(game, cid, since)
  local sql, args = boardSql(game, since)
  local rows = MySQL.query.await(sql .. ' LIMIT 1000', args) or {}
  for i, r in ipairs(rows) do if r.cid == cid then return i, tonumber(r.v) or 0 end end
  return nil, 0
end

local lastSubmit = {}
AddEventHandler('playerDropped', function() lastSubmit[source] = nil end)

local function clampInt(v, lo, hi) v = math.floor(tonumber(v) or 0); return math.max(lo, math.min(hi, v)) end

MotCallback.Register('gamesApi', function(src, respond, name, data)
  local cid = Bridge.GetIdentifier(src)
  if not cid or cid == '' then return respond({ ok = false, reason = 'error' }) end
  data = type(data) == 'table' and data or {}
  local game = data.game
  if name ~= 'stats' and not IS_GAME[game] then return respond({ ok = false, reason = 'invalid' }) end
  if game and not Apps.allowed(src, game) then return respond({ ok = false, reason = 'not_authorised' }) end

  if name == 'board' then
    local period = (data.period == 'day' or data.period == 'week') and data.period or 'all'
    local size = math.max(5, math.min(100, tonumber(cfg().boardSize) or 25))
    local sql, args = boardSql(game, periodStart(period))
    local all = MySQL.query.await(sql .. ' LIMIT 1000', args) or {}
    local rows, mine = {}, nil
    for i, r in ipairs(all) do
      if r.cid == cid then mine = { rank = i, value = tonumber(r.v) or 0, at = r.at } end
      if i <= size then rows[#rows + 1] = { rank = i, name = shortName(r.name), value = tonumber(r.v) or 0, at = r.at, me = r.cid == cid } end
    end
    return respond({ ok = true, data = { rows = rows, mine = mine, metric = metricOf(game), period = period } })
  end

  if name == 'submit' then
    local t = GetGameTimer()
    if lastSubmit[src] and t - lastSubmit[src] < 1500 then return respond({ ok = false, reason = 'busy' }) end
    lastSubmit[src] = t
    local lim = (cfg().limits or {})[game] or {}
    local seconds = clampInt(data.seconds, 0, 86400)
    local metric = metricOf(game)
    local score = clampInt(data.score, 0, tonumber(lim.maxScore) or 2000000000)
    local result = (data.result == 1 or data.result == 0 or data.result == 2) and data.result or -1
    local ok = true
    if seconds < (tonumber(lim.minSeconds) or 0) then ok = false end
    if lim.maxPerSecond and score > (seconds + 1) * lim.maxPerSecond then ok = false end
    if metric == 'wins' and result == -1 then return respond({ ok = false, reason = 'invalid' }) end
    local level = clampInt(data.level, 0, 5)
    local mode = data.mode == 'pvp' and 'pvp' or 'solo'
    if not ok then
      -- an impossible result is not saved (and not an error the player needs to see)
      return respond({ ok = true, data = { saved = false } })
    end
    if mode == 'pvp' then return respond({ ok = false, reason = 'invalid' }) end   -- player matches are recorded by server/games_pvp.lua only
    MySQL.insert.await('INSERT INTO computer_game_runs (game, cid, name, score, result, seconds, level, mode, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      { game, cid, displayName(src), score, result, seconds, level, mode, os.time() })
    local out = { saved = true }
    local best = MySQL.scalar.await('SELECT MAX(score) FROM computer_game_runs WHERE game = ? AND cid = ?', { game, cid }) or 0
    out.best = tonumber(best) or 0
    out.rank = {}
    for _, p in ipairs({ 'day', 'week', 'all' }) do out.rank[p] = (rankOf(game, cid, periodStart(p))) end
    return respond({ ok = true, data = out })
  end

  if name == 'stats' then
    local rows = MySQL.query.await(
      'SELECT game, COUNT(*) AS played, MAX(score) AS best, SUM(seconds) AS seconds, SUM(result = 1) AS wins, SUM(result = 0) AS losses, SUM(result = 2) AS draws FROM computer_game_runs WHERE cid = ? GROUP BY game',
      { cid }) or {}
    local out, totals = {}, { played = 0, seconds = 0, wins = 0 }
    for _, r in ipairs(rows) do
      if IS_GAME[r.game] then
        out[r.game] = { played = tonumber(r.played) or 0, best = tonumber(r.best) or 0, seconds = tonumber(r.seconds) or 0,
          wins = tonumber(r.wins) or 0, losses = tonumber(r.losses) or 0, draws = tonumber(r.draws) or 0 }
        totals.played = totals.played + out[r.game].played
        totals.seconds = totals.seconds + out[r.game].seconds
        if metricOf(r.game) == 'wins' then totals.wins = totals.wins + out[r.game].wins end
        out[r.game].week = (rankOf(r.game, cid, periodStart('week')))
      end
    end
    return respond({ ok = true, data = { games = out, totals = totals, metrics = cfg().metric } })
  end

  if name == 'save' then
    local state = data.state
    if type(state) ~= 'string' or #state > (tonumber(cfg().maxSaveBytes) or 24000) then return respond({ ok = false, reason = 'too_long' }) end
    if not json.decode(state) then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.query.await('INSERT INTO computer_game_saves (cid, game, state, saved_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE state = VALUES(state), saved_at = VALUES(saved_at)',
      { cid, game, state, os.time() })
    return respond({ ok = true })
  end
  if name == 'load' then
    local r = MySQL.single.await('SELECT state, saved_at FROM computer_game_saves WHERE cid = ? AND game = ?', { cid, game })
    return respond({ ok = true, data = { state = r and r.state or nil, at = r and r.saved_at or nil } })
  end
  if name == 'clearSave' then
    MySQL.query.await('DELETE FROM computer_game_saves WHERE cid = ? AND game = ?', { cid, game })
    return respond({ ok = true })
  end

  if name == 'prefs' then
    local r = MySQL.scalar.await('SELECT prefs FROM computer_game_prefs WHERE cid = ? AND game = ?', { cid, game })
    return respond({ ok = true, data = { prefs = r and json.decode(r) or {} } })
  end
  if name == 'setPrefs' then
    local p = type(data.prefs) == 'table' and data.prefs or {}
    local clean = {
      master = clampInt(p.master, 0, 100), music = clampInt(p.music, 0, 100), effects = clampInt(p.effects, 0, 100),
      mute = p.mute == true, track = clampInt(p.track, 0, 20), difficulty = clampInt(p.difficulty, 0, 3),
    }
    MySQL.query.await('INSERT INTO computer_game_prefs (cid, game, prefs) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)', { cid, game, json.encode(clean) })
    return respond({ ok = true })
  end

  respond({ ok = false, reason = 'invalid' })
end)

--- For server/games_pvp.lua: record a finished player match for one player.
function GamesRecordPvp(cid, name, game, result, seconds, level)
  if not IS_GAME[game] then return end
  MySQL.insert('INSERT INTO computer_game_runs (game, cid, name, score, result, seconds, level, mode, at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
    { game, cid, shortName(name), result, math.floor(seconds or 0), level or 0, 'pvp', os.time() })
end
