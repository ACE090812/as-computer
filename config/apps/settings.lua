-- Settings app (built in, not in the Store). Personal settings are saved per CHARACTER, so a player keeps their
-- wallpaper, theme and clock format on any computer they sign into.

Config.Apps.settings = { store = false, icon = 'settings', tint = '#0f6cbd', publisher = 'Los Santos OS' }

Config.Settings = {
  -- What a character sees until they change something. Anything a player has not touched follows this list,
  -- so editing it here changes the look for everyone who has not picked their own.
  defaults = {
    wallpaper     = 'bloom',     -- id of a built-in wallpaper (see ui/app.js WALLPAPERS) or one from `wallpapers` below
    fit           = 'fill',      -- 'fill' | 'fit' | 'stretch' | 'tile' | 'center'
    mode          = 'light',     -- 'light' | 'dark'  (colours of the taskbar, Start, window title bars and Settings)
    accent        = '#0f6cbd',
    accentBars    = false,       -- show the accent colour on the taskbar and Start
    taskbarAlign  = 'center',    -- 'center' | 'left'
    search        = 'box',       -- taskbar search: 'box' | 'icon' | 'hidden'
    brightness    = 100,         -- 10 - 100
    night         = false,       -- night light
    nightStrength = 40,          -- 0 - 100
    clock24       = true,        -- 24-hour clock
    dateFormat    = 'dmy',       -- 'dmy' | 'mdy' | 'ymd'
    -- lockShow = true,           -- leave out to follow Config.LockScreen
    -- weekStart = 1,             -- leave out to follow Config.Calendar.weekStart (0 = Sunday, 1 = Monday, 6 = Saturday)
    -- lang = 'en',               -- leave out to follow Config.Locale
  },

  -- Extra picture wallpapers offered next to the built-in ones. url must be https.
  wallpapers = {
    -- { id = 'city', label = 'City at night', url = 'https://example.com/city.jpg' },
  },

  -- Let players paste their own image address (Personalisation > Background).
  allowCustomWallpaper = true,
  -- Limit custom images to these websites. nil = any https address.
  customWallpaperHosts = nil,   -- e.g. { 'i.imgur.com', 'cdn.discordapp.com' }

  -- Shown on System > About. The computer name is per monitor location.
  device = {
    name         = function(loc, index) return ('LSOS-PC-%02d'):format(index or 1) end,
    manufacturer = 'Los Santos Systems',
    model        = 'Workstation 9',
    processor    = 'LS Core i7-12700   2.10 GHz',
    ram          = '16.0 GB',
    graphics     = 'LS Graphics 4 GB',
    systemType   = '64-bit operating system, x64-based processor',
    edition      = 'Los Santos OS Pro',
  },

  -- Shown on Network & internet. Whether the computer is "online" follows the as-browser resource (Scout needs it).
  network = {
    ssid     = 'LS-Corp',
    band     = '5 GHz',
    protocol = 'Wi-Fi 6 (802.11ax)',
    security = 'WPA3-Personal',
  },
}
