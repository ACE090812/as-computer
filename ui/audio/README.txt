Put music for the games here (.ogg or .mp3), then list the file names in config/apps/games.lua under Config.Games.audio.music, e.g.
  music = { 'track1.ogg', 'track2.ogg' }
and add them to the `files` list in fxmanifest.lua (this folder is already included: 'ui/audio/*').
Sound effects (moves, clears, wins) are generated in the page and need no files.
