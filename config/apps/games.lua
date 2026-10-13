-- Games: Snake, Blocks, Solitaire, Chess, Connect 4 and Tic-tac-toe. Each is its own Store app, free, and installed by each player for
-- THEMSELVES (personal = true), not for a whole job. Scores, stats and saved games follow the character to any computer.
--   Config.Games            leaderboards, saves, sanity checks, player matches and sound
--   Config.Apps.<game>      the Store entry of each game (set store = false to hand a game out to everyone, enabled = false to remove it)
--   Config.PublicApps.<game> = true (config/config.lua) lets anyone play it at any computer without installing it
Config.Games = {
  boardSize     = 25,        -- lines shown on a leaderboard
  keepDays      = 180,       -- finished games older than this are deleted (leaderboards only look at what is kept)
  maxSaveBytes  = 24000,     -- biggest saved game accepted (one slot per game per character)
  names         = 'short',   -- how leaderboards show a character: 'short' = "Mia K.", 'full' = "Mia Kane"

  -- What each leaderboard ranks: 'score' (best score) or 'wins' (number of wins). Dates reset: Today at 00:00, week on Monday.
  metric = { snake = 'score', blocks = 'score', solitaire = 'score', chess = 'wins', connect4 = 'wins', tictactoe = 'wins' },

  -- Server sanity checks on a submitted result (the page plays the game, so the server rejects impossible ones):
  --   minSeconds    shortest a game can honestly last
  --   maxPerSecond  most points that can be scored per second (score games)
  --   maxScore      hard ceiling for a score
  limits = {
    snake     = { minSeconds = 3,  maxPerSecond = 45,  maxScore = 20000 },
    blocks    = { minSeconds = 5,  maxPerSecond = 220, maxScore = 2000000 },
    solitaire = { minSeconds = 25, maxPerSecond = 40,  maxScore = 20000 },
    chess     = { minSeconds = 10 },
    connect4  = { minSeconds = 4 },
    tictactoe = { minSeconds = 2 },
  },

  -- Playing against another player (chess, Connect 4, tic-tac-toe)
  pvp = {
    enabled        = true,
    range          = 0.0,      -- metres; 0 = any player online who has the game open. Set e.g. 30.0 to limit it to the same area
    inviteSeconds  = 30,       -- how long a challenge stays open
    chessClock     = { 5, 10, 15 },   -- minutes per side offered in player chess matches
  },

  -- Music: put .ogg / .mp3 files in ui/audio/ and list them here. Effects are generated in the page, no files needed.
  audio = {
    music = {},                -- e.g. { 'track1.ogg', 'track2.ogg' }
  },
}

local function game(id, o)
  o.store, o.personal, o.manage, o.price, o.category, o.publisher, o.version = true, true, 'any', 0, 'games', 'Los Santos OS', '1.0'
  Config.Apps[id] = o
end

game('snake',     { icon = 'snake',     tint = '#2f9e5b', order = 10 })
game('blocks',    { icon = 'blocks',    tint = '#3b6fd6', order = 11 })
game('solitaire', { icon = 'solitaire', tint = '#1f6f4a', order = 12 })
game('chess',     { icon = 'chess',     tint = '#8a5a2b', order = 13 })
game('connect4',  { icon = 'connect4',  tint = '#c2410c', order = 14 })
game('tictactoe', { icon = 'tictactoe', tint = '#7c3aed', order = 15 })
