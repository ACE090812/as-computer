fx_version 'cerulean'
game 'gta5'

name 'as-computer'
author 'ACE Studios'
description 'Los Santos OS: a desktop computer on a prop monitor (Store, MOT Testing Service, File Explorer, Scout browser, Calendar, Mechanic, Mail, Calculator, Notepad, MDT)'
version '0.9.0'

provide 'mot-dui'

shared_scripts {
  'config/config.lua',
  'config/mining.lua',   -- Crypto Mining Rig, Phase 1: parts/tiers/prices
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
  'client/mirror.lua',      -- live monitor view for players nearby
  'client/mechanic.lua',
  'client/mail.lua',
  'client/notepad.lua',
  'client/files.lua',
  'client/printing.lua',
  'client/mdt.lua',
  'client/courtmdt.lua',
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
  'server/mdt.lua',
  'server/courtmdt.lua',
  'server/evidence_reports.lua',
  'server/placement.lua',
  'server/session.lua',
  'server/mirror.lua',
  'server/mining.lua',    -- Crypto Mining Rig, Phase 1: part purchase (needs Bridge + ox_inventory, both above)
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
  'ui/mdt.js',
  'ui/mdt.css',
  'ui/courtmdt.js',
  'ui/evidences.js',
  'ui/mirror.html',
  'ui/vendor/html-to-image.js',
  'ui/mining.js',
  'ui/mining.css',
}
