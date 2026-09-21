fx_version 'cerulean'
game 'gta5'

name 'as-computer'
author 'ACE Studios'
description 'Los Santos OS: a desktop computer on a prop monitor (Store, MOT Testing Service, File Explorer, Scout browser, Calendar)'
version '0.5.1'

provide 'mot-dui'

shared_scripts {
  'config/config.lua',   
  'config/apps/*.lua',   
  'shared/locale.lua',
  'locales/*.lua',
}

client_scripts {
  'client/bridge.lua',
  'client/callback.lua',
  'client/dui.lua',
}

server_scripts {
  '@oxmysql/lib/MySQL.lua',
  'server/bridge.lua',
  'server/callback.lua',
  'server/bank.lua',
  'server/apps.lua',
  'server/settings.lua',
  'server/booking.lua',
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
  'stream/mot_monitor.ytyp',
}

data_file 'DLC_ITYP_REQUEST' 'stream/mot_monitor.ytyp'
