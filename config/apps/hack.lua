-- Hacking minigames for your own scripts and heists. Ten minigames live in ui/hack.js; the Command Prompt can practise them
-- (hack play <program>) and run YOUR targets below (hack <id>).
--
-- Targets are things you define: a vault terminal, an alarm panel, a robbery step. A won hack fires a SERVER event your own script
-- listens to. The page only plays the game; the server hands out a challenge, times it, and decides the result.
--
-- From another script:
--   client:  local ok = exports['as-computer']:StartHack('cipher', 3, 'Vault door')   -- game id or 'random', level 1-5; blocks, returns true/false
--            exports['as-computer']:HackGames()                                        -- { { id, name } ... }
--   server:  exports['as-computer']:RequestHack(src, { game = 'maze', level = 2, title = 'Alarm panel' }, function(success) ... end)
-- Every finished Command Prompt hack also fires the server event  'as-computer:server:hackResult'  (src, targetId, success, game).
Config.Hack = {
  enabled          = true,
  minSeconds       = 4,     -- a win reported faster than this counts as failed (nobody beats a minigame that quickly)
  challengeSeconds = 300,   -- a started hack must be finished within this long

  -- game: 'maze' 'capture' 'cipher' 'snake' 'firewall' 'evasion' 'typing' 'signal' 'pipe' 'breakout' or 'random'
  -- level: 1 (easy) to 5 (hard)
  -- coords + radius: optional, the player must be this close (metres). Leave coords out to allow it from any computer.
  -- event: SERVER event fired on a win with (src, id).   jobs: optional list of jobs that may try it.
  targets = {
    -- { id = 'vault', label = 'Fleeca Vault Terminal', game = 'cipher', level = 3,
    --   coords = vector3(311.0, -284.0, 54.0), radius = 25.0, event = 'myscript:vaultHacked', jobs = nil },
  },
}
