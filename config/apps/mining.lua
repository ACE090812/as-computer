-- Crypto Mining Rig app registration. Every app on this desktop needs a Config.Apps.<id> entry to be
-- granted to ANY computer at all (server/apps.lua's Apps.def/Apps.enabled) - the Mining Rig app's
-- backend (server/mining.lua's miningApp/'miningApi') and UI (ui/mining.js, self-registers via
-- LSOS.registerApp) were both built in earlier phases, but this file was never added, so the app was
-- invisible on every computer, mining monitor included, until now.
--
-- Built in for everyone (store = false, jobs = nil), matching the locked spec's "open to all players,
-- no licence/job gate" - it isn't a job tool like Mechanic, it's tied to owning the physical hardware,
-- which server/mining.lua's own ownership checks already gate on their own.
Config.Apps.mining = {
  store     = true,
  jobs      = nil,
  price     = 0,
  icon      = 'mining',
  tint      = '#22c55e',
  category  = 'tools',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
