fx_version 'cerulean'
game 'gta5'

name 'as-computer'
author 'ACE Studios'
description 'Los Santos OS: a desktop computer on a prop monitor (Store, MOT Testing Service, File Explorer, Scout browser, Calendar, Mechanic, Mail, Calculator, Notepad)'
version '0.9.0'

provide 'mot-dui'

shared_scripts {
  'config/config.lua',   
  'config/apps/*.lua',   
  'shared/locale.lua',
  'locales/*.lua',
}

client_scripts {
  '@ox_lib/init.lua',    -- Mail app: talks to sd-phone's Mail callbacks
  'client/bridge.lua',
  'client/callback.lua',
  'client/dui.lua',
  'client/mechanic.lua',
  'client/mail.lua',
  'client/notepad.lua',
  'client/files.lua',
  'client/printing.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/bridge.lua',
  'server/callback.lua',
  'server/bank.lua',
  'server/apps.lua',
  'server/settings.lua',
  'server/booking.lua',
  'server/mechanic.lua',
  'server/mail.lua',
  'server/notepad.lua',
  'server/files.lua',
  'server/printing.lua',
  'server/main.lua',
}

dependencies {
  'oxmysql',
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
  'stream/mot_monitor.ytyp',
}

data_file 'DLC_ITYP_REQUEST' 'stream/mot_monitor.ytyp'
