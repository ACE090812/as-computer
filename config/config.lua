-- as-computer: core settings (the desktop itself, the monitors and who may use them).
-- Every app on the desktop has its own file in config/apps/ (mot, explorer, scout, calendar, store).
-- To add an app, drop a new file in config/apps/ that fills Config.<YourApp> and it is loaded automatically.
Config = {}

-- Enables /computer_coords, /computer_goto and spawn logging. Turn off for production.
Config.Debug = false

-- Draw the interaction box in-world (ox_target debug). Only useful when tuning target.size/offset.
Config.DebugZone = false

-- How players interact with the terminal:
--   'key'    = walk up and press Config.InteractKey (works with no target resource)
--   'target' = ox_target / qb-target box on the screen
--   'both'
Config.Interaction = 'both'
Config.InteractKey = 38        -- 38 = E
Config.InteractDistance = 1.8  -- metres from the screen

-- true  = camera zooms onto the monitor and the terminal is drawn over its screen
-- false = terminal opens fullscreen
Config.UseCamera = true

Config.DebugScreen = false

-- Fixed to match ui/index.html's html/body width & height (1920x1080).
-- If you resize the page, update these to match or the texture will stretch.
Config.DuiWidth  = 1920
Config.DuiHeight = 1080

-- Locations, each with a prop the DUI texture is drawn onto.
-- txd/txn are the ORIGINAL texture dictionary/name on that prop model that
-- you want to replace with the live DUI output (use a texture viewer /
-- OpenIV-style tool on the prop model to find these).
Config.Locations = {
  {
    label   = "Vinewood Auto Centre — MOT Bay",
    coords  = vector3(-347.2, -136.8, 39.0),
    heading = 70.0,
    prop    = `lgmods_sinner_monitor`, -- your custom terminal model
    txd     = { "lgmods_sinner_monitor", "lgmods_sinnertextures" }, -- swap applies to every name listed (embedded ydr dict + the ytyp's shared txd)
    txn     = "securitymonitor",       -- your screen texture name
    -- The monitor's screen surface, in the prop's LOCAL space (x = right, y = forward, z = up).
    -- The terminal UI is drawn exactly over this rectangle while a camera frames it.
    -- Tune live with /computer_screen (Config.Debug) and paste the printed line back here.
    screen  = {
      offset = vector3(0.0, -0.07, 0.396), -- centre of the screen surface
      size   = vector2(0.79, 0.483),       -- visible screen width, height (metres)
      bleed  = 0.02,                       -- overscan (fraction per side) so the original texture can't peek out at the edges
      front  = -1,                        -- local Y direction the screen faces: -1 or 1 (flip if the camera ends up behind the monitor)
      cam    = { dist = 0.85, fov = 35.0 },
    },
    -- jobs = { 'mechanic' },          -- optional: jobs allowed at THIS computer (default Config.Jobs)
    -- Makes this garage bookable on the government website (settings in config/apps/booking.lua). Remove to opt out.
    booking = {
      id      = 'vinewood',                    -- unique per garage (kept in the database)
      name    = 'Vinewood Auto Centre',        -- shown to players
      address = 'Vinewood, Los Santos',
      -- job  = 'mechanic',                    -- whose Calendar / society account gets it (default: first job of this location)
      -- bays = 1, fee = 40, slots = { ... },  -- optional per-garage overrides of config/apps/booking.lua
    },
    target  = { -- interaction box, centred on the screen (offset is from the prop origin)
      size   = vector3(1.3, 1.3, 1.0), -- roughly square so heading/orientation doesn't matter
      offset = vector3(0.0, -0.02, 0.33),
    },
  },
  -- add more stations here
}

-- Jobs that may use the computer at all (bridged across QBCore / Qbox / ESX in bridge.lua).
-- A location can override this with its own `jobs = { ... }`.
-- WHICH APPS a job gets is decided by the Store: see config/apps/store.lua and each app's Config.Apps entry.
Config.Jobs = { 'mechanic' }

-- Apps anyone may use on any computer, whatever their job (no Store install needed). Job apps (MOT, Mechanic,
-- MDT, Mail ...) stay limited to Config.Jobs. Leave the table empty to keep computers job-only.
-- Scout ('browser') is what gives everyone Presento and the other websites.
Config.PublicApps = {
  browser    = true,
  notepad    = true,
  calculator = true,
  settings   = true,
}

-- App registry. Filled by config/apps/*.lua, one entry per app: Config.Apps.<id> = { store, jobs, price, ... }
-- (see config/apps/mot.lua for every field).
Config.Apps = {}

-- Turn apps off for your region / server type. Set an app to false and it vanishes: no desktop icon, not in the
-- Store, and the server refuses everything it would have done. Anything not listed stays on. (An app's own
-- config/apps/<app>.lua entry can also say `enabled = false`.)
-- Ids: mot, mechanic, mail, calculator, notepad, calendar, browser, store, settings, explorer.
-- Example for a US server: no MOT (a UK roadworthiness test). Also switch the matching bits off in as-browser
-- (Config.Sites.gov / lsplates / lsvehiclecheck) and Config.Booking.enabled below, see the README.
Config.EnabledApps = {
  mot      = true,   -- UK MOT testing service (also feeds the government site's vehicle checker and MOT bookings)
  mechanic = true,   -- job cards, quotes, invoices, parts stock
  mail     = true,   -- the phone's Mail accounts on the desktop
  calculator = true, -- standard calculator with memory and history
  notepad  = true,   -- the character's own notes, saved on the server
  calendar = true,
  browser  = true,   -- Scout
  -- store = true, settings = true, explorer = true,
}

-- ---------------------------------------------------------------------------------------------
-- PLACEMENT: admins put computers and TVs down in-game with /placeprops (uses object_gizmo), saved in the
-- database and spawned for everyone. Needs:  add_ace group.admin command.placeprops allow
-- A placed computer works like a Config.Locations one (target / E prompt). A placed TV can show a Presento
-- presentation cast from any computer's Scout (as-browser), controlled with the clicker keys below.
-- ---------------------------------------------------------------------------------------------
Config.Placement = {
  enabled   = true,
  command   = 'placeprops',
  gizmo     = 'object_gizmo',       -- resource with exports:useGizmo(entity)

  -- Monitors the menu can place. Same fields as Config.Locations (prop, txd, txn, screen, target).
  computers = {
    {
      label  = 'Office monitor',
      prop   = `lgmods_sinner_monitor`,
      txd    = { 'lgmods_sinner_monitor', 'lgmods_sinnertextures' },
      txn    = 'securitymonitor',
      screen = { offset = vector3(0.0, -0.07, 0.396), size = vector2(0.79, 0.483), bleed = 0.02, front = -1, cam = { dist = 0.85, fov = 35.0 } },
      target = { size = vector3(1.3, 1.3, 1.0), offset = vector3(0.0, -0.02, 0.33) },
    },
  },

  -- TVs / screens the menu can place. txd + txn are the model's screen texture that gets replaced by the
  -- presentation (check with CodeWalker / OpenIV if a model shows nothing). The texture swap is per MODEL,
  -- so two TVs of the same model close together both show whichever is nearest to you.
  tvs = {
    { label = 'Flat TV (wall)',   prop = `prop_tv_flat_michael`, txd = 'prop_tv_flat_michael', txn = 'script_rt_tvscreen' },
    { label = 'Flat TV (small)',  prop = `prop_tv_flat_02`,      txd = 'prop_tv_flat_02',      txn = 'script_rt_tvscreen' },
    { label = 'Cinema screen',    prop = `v_ilev_cin_screen`,    txd = 'v_ilev_cin_screen',    txn = 'script_rt_cinscreen' },
  },

  tvPage          = 'https://cfx-nui-as-browser/sites/presento/tv.html',  -- page drawn on the TV
  tvRange         = 20.0,     -- metres: you must be this close to cast to a TV or use the clicker
  tvDrawDistance  = 30.0,     -- metres: players this close see what the TV shows
  castIdleMinutes = 30,       -- a TV nobody has moved on for this long switches off
  clicker = { next = 'PAGEDOWN', prev = 'PAGEUP' },  -- default keys (players can rebind in Settings > Key Bindings > FiveM)
}

-- Walking away (Esc) leaves your apps open: come back to the same computer and it is exactly as you left it,
-- unless someone else used it in between or you chose Start > Power > Shut down. Lock keeps the apps but opens
-- on the lock screen. resumeMinutes: how long a session is kept (0 = until the server restarts).
Config.Session = { resumeMinutes = 60 }

-- Live monitor view: while someone uses a computer, players nearby see their screen on the monitor (updated
-- about once a second). The page draws itself to a small JPEG (ui/vendor/html-to-image.js); Scout websites draw
-- themselves via as-browser's SDK. After they walk away the last picture stays; Shut down clears it.
-- A location can opt out with `mirror = false`.
Config.Mirror = {
  enabled  = false,      -- true = live monitor view is on (default: off for performance)
  interval = 1000,     -- ms between pictures
  width    = 960,      -- picture width in pixels (height follows the screen)
  quality  = 0.6,      -- JPEG quality 0.1 - 1.0
  range    = 15.0,     -- metres: players this close see it
  maxViews = 4,        -- most live screens one player draws at once (nearest first)
  maxBytes = 250000,   -- largest picture accepted
  bps      = 200000,   -- latent event speed (bytes/second) per player
}

-- Show the Los Santos OS lock screen (click / Enter to sign in) before the desktop appears.
Config.LockScreen = true

-- Language code; strings live in locales/<code>.lua (copy en.lua to add one).
Config.Locale = 'en'

-- Optional: route notifications through your own system instead of the
-- auto-detected framework/ox_lib one. ntype = 'inform' | 'success' | 'error'
-- Config.Notify = function(message, ntype)
--   exports['my_notify']:Send(message, ntype)
-- end