-- Event Viewer (Logs app): each computer keeps its own Security, System and Boss logs. Built in.
-- Who can read them: the machine's owner (the account that set it up) while signed in at it, and admins.
--   Security  sign-ins, failed sign-ins, hacks and login bypasses
--   System    first-time setup, sessions starting, locking and shutting down, account resets
--   Boss      hires, fires, promotions and demotions made from the Business Manager at this computer
Config.Logs = {
  retentionDays = 30,    -- older lines are deleted (0 = keep forever)
  pageSize      = 50,    -- lines per page in the viewer
  maxMessage    = 240,   -- longest message stored
}

Config.Apps.logs = {
  store     = false,
  jobs      = nil,
  price     = 0,
  icon      = 'logs',
  tint      = '#7c3aed',
  category  = 'tools',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
