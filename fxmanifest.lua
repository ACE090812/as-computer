fx_version 'cerulean'
game 'gta5'

name 'as-computer'
author 'ACE Studios'
description 'Los Santos OS: a desktop computer on a prop monitor (Store, MOT Testing Service, File Explorer, Scout browser, Calendar, Mechanic, Mail, Calculator, Notepad)'
version '0.9.0'

provide 'mot-dui'

shared_scripts {
  'config/config.lua',
  'config/mining.lua',   -- Crypto Mining Rig, Phase 1: parts/tiers/prices
  'config/hardware.lua', -- computer hardware: towers, slots, boot rules (extends the part list above)
  'config/apps/*.lua',
  'shared/locale.lua',
  'locales/*.lua',
}

client_scripts {
  '@ox_lib/init.lua',    -- Mail app: talks to sd-phone's Mail callbacks
  'client/bridge.lua',
  'client/callback.lua',
  'client/dui.lua',
  'client/placement.lua',   -- /placeprops: placed computers and TVs, Presento on TVs
  'client/boss.lua',
  'client/games.lua',
  'client/logs.lua',
  'client/hack.lua',
  'client/admin.lua',        -- /pcadmin panel (needs PlacementApi from client/placement.lua at call time)
  'client/mirror.lua',      -- live monitor view for players nearby
  'client/mechanic.lua',
  'client/mail.lua',
  'client/notepad.lua',
  'client/files.lua',
  'client/printing.lua',
  'client/evidences.lua',
  'client/mining_place.lua',   -- Crypto Mining Rig, Phase 4: player placement (needs SpawnComputer/DespawnComputer from client/dui.lua, and PC.gizmo from client/placement.lua's Config.Placement, both above)
  'client/mining_shop.lua',    -- Crypto Mining Rig, Phase 4: the physical parts/chassis shop ped
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/bridge.lua',
  'server/callback.lua',
  'server/bank.lua',
  'server/accounts.lua',   -- Phase 0.5: per-machine accounts, must load before session.lua
  'server/apps.lua',
  'server/settings.lua',
  'server/booking.lua',
  'server/mechanic.lua',
  'server/mail.lua',
  'server/notepad.lua',
  'server/files.lua',
  'server/printing.lua',
  'server/evidence_reports.lua',
  'server/logs.lua',    -- Event Viewer: defines ComputerLog() used by session/boss/admin/hacking
  'server/hack.lua',    -- minigame targets + RequestHack export (needs Apps, Bridge above)
  'server/games.lua',
  'server/games_pvp.lua',   -- player matches (needs GamesRecordPvp from games.lua)
  'server/boss.lua',    -- Business Manager (needs Apps, Bank, Bridge above)
  'server/admin.lua',   -- /pcadmin: needs Accounts + MotCallback above; defines AdminProps/AdminLog for placement.lua
  'server/admin_games.lua',   -- /pcadmin Games and Casino tabs
  'server/placement.lua',
  'server/session.lua',
  'server/mirror.lua',
  'server/mining.lua',    -- Crypto Mining Rig, Phase 1: part purchase (needs Bridge + ox_inventory, both above)
  'server/hardware.lua',   -- computer hardware: boot rule, wear, /pcbuild, first-start wipe (needs Mining from above)
  'server/mining_place.lua',   -- Crypto Mining Rig, Phase 4: player placement (needs Mining.EnsureRig from server/mining.lua, and Bridge.GetIdentifier, both above)
  'server/main.lua',
}

dependencies {
  'oxmysql',
  'ox_inventory',
}

ui_page 'ui/index.html'

files {
  'ui/index.html',
  'ui/style.css',
  'ui/app.js',
  'ui/mechanic.js',
  'ui/mechanic.css',
  'ui/mail.js',
  'ui/mail.css',
  'ui/calculator.js',
  'ui/calculator.css',
  'ui/notepad.js',
  'ui/notepad.css',
  'ui/files.css',
  'ui/kit.css',
  'ui/audio/*',
  'ui/games.js',
  'ui/games.css',
  'ui/games/snake.js',
  'ui/games/tictactoe.js',
  'ui/games/connect4.js',
  'ui/games/blocks.js',
  'ui/games/solitaire.js',
  'ui/games/chess.js',
  'ui/boss.js',
  'ui/logs.js',
  'ui/logs.css',
  'ui/hack.js',
  'ui/hack.css',
  'ui/cmd.js',
  'ui/cmd.css',
  'ui/admin.js',
  'ui/admin.css',
  'ui/evidences.js',
  'ui/mirror.html',
  'ui/vendor/html-to-image.js',
  'ui/mining.js',
  'ui/mining.css',
}
