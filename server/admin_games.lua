-- Admin panel, Games and Casino tabs (server side). Same rule as server/admin.lua: Bridge.IsAdmin is checked on every call.
--   admin:games        -> per game: plays, players, installs, on or off
--   admin:gamesToggle  { game, enabled } -> switch a computer game on or off for everyone
--   admin:gamesReset   { game }          -> clear that game's leaderboard and stats (saved games are kept)
--   admin:casino       { action, data }  -> the Diamond Online casino in as-browser (overview, setOpen, accounts, freeze, bets)
local AD = Config.Admin or {}
if AD.enabled == false then return end

GamesDisabled = GamesDisabled or {}   -- game id -> true while switched off (read by server/apps.lua)
local GAMES = { 'snake', 'blocks', 'solitaire', 'chess', 'connect4', 'tictactoe' }
local VALID = {}
for _, g in ipairs(GAMES) do VALID[g] = true end

MySQL.ready(function()
  MySQL.query.await([[
    CREATE TABLE IF NOT EXISTS `computer_game_flags` (
      `game` VARCHAR(16) NOT NULL PRIMARY KEY,
      `enabled` TINYINT NOT NULL DEFAULT 1
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  ]])
  for _, r in ipairs(MySQL.query.await('SELECT game, enabled FROM computer_game_flags') or {}) do
    if r.enabled == 0 then GamesDisabled[r.game] = true end
  end
end)

local function guard(src, respond)
  if not Bridge.IsAdmin(src) then respond({ ok = false, reason = 'not_authorised' }) return false end
  return true
end

MotCallback.Register('admin:games', function(src, respond)
  if not guard(src, respond) then return end
  local rows = {}
  local runs = MySQL.query.await('SELECT game, COUNT(*) AS plays, COUNT(DISTINCT cid) AS players, SUM(at >= ?) AS recent FROM computer_game_runs GROUP BY game', { os.time() - 86400 }) or {}
  local byGame = {}
  for _, r in ipairs(runs) do byGame[r.game] = r end
  local installs = {}
  local ok, inst = pcall(function() return MySQL.query.await('SELECT app, COUNT(*) AS n FROM computer_apps_personal GROUP BY app') or {} end)
  if ok then for _, r in ipairs(inst) do installs[r.app] = tonumber(r.n) or 0 end end
  for _, g in ipairs(GAMES) do
    local r = byGame[g] or {}
    local def = Config.Apps and Config.Apps[g]
    rows[#rows + 1] = { id = g, name = def and def.name or g, enabled = not GamesDisabled[g], plays = tonumber(r.plays) or 0, players = tonumber(r.players) or 0,
      recent = tonumber(r.recent) or 0, installs = installs[g] or 0 }
  end
  respond({ ok = true, games = rows })
end)

MotCallback.Register('admin:gamesToggle', function(src, respond, d)
  if not guard(src, respond) then return end
  d = type(d) == 'table' and d or {}
  if not VALID[d.game] then return respond({ ok = false, reason = 'invalid' }) end
  local on = d.enabled == true
  GamesDisabled[d.game] = (not on) or nil
  MySQL.update('INSERT INTO computer_game_flags (game, enabled) VALUES (?, ?) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)', { d.game, on and 1 or 0 })
  if AdminLog then AdminLog(src, on and 'game_on' or 'game_off', d.game) end
  respond({ ok = true })
end)

MotCallback.Register('admin:gamesReset', function(src, respond, d)
  if not guard(src, respond) then return end
  d = type(d) == 'table' and d or {}
  if not VALID[d.game] then return respond({ ok = false, reason = 'invalid' }) end
  MySQL.update.await('DELETE FROM computer_game_runs WHERE game = ?', { d.game })
  if AdminLog then AdminLog(src, 'game_reset', d.game) end
  respond({ ok = true })
end)

local CASINO_ACTIONS = { overview = true, setOpen = true, accounts = true, freeze = true, bets = true }
MotCallback.Register('admin:casino', function(src, respond, d)
  if not guard(src, respond) then return end
  d = type(d) == 'table' and d or {}
  if not CASINO_ACTIONS[d.action] then return respond({ ok = false, reason = 'invalid' }) end
  if GetResourceState('as-browser') ~= 'started' then return respond({ ok = false, reason = 'no_casino' }) end
  local ok, res = pcall(function() return exports['as-browser']:casinoAdmin(d.action, d.data) end)
  if not ok or type(res) ~= 'table' or res.ok == false then return respond({ ok = false, reason = 'no_casino' }) end
  if d.action == 'setOpen' and AdminLog then AdminLog(src, res.open and 'casino_on' or 'casino_off', 'Diamond Online') end
  if d.action == 'freeze' and AdminLog then AdminLog(src, res.status == 'frozen' and 'casino_freeze' or 'casino_unfreeze', tostring(d.data and d.data.cid or '')) end
  res.reason = nil
  respond(res)
end)
