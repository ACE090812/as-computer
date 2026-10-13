-- Event Viewer (Logs app): each computer keeps its own event logs, read in a Windows-style viewer (log tree, event grid,
-- details pane, actions). Built in. Who can read them: the machine's owner (the account that set it up) while signed in
-- at it, and admins.
--   Application  apps started, file actions, and any event another script writes with the LogEvent export
--   Security     sign-ins (Audit Success), failed sign-ins (Audit Failure), hacks and login bypasses
--   System       first-time setup, locking, unlocking and shutting down, admin actions, a cleared log
--   Boss         hires, fires, promotions and demotions made from the Business Manager at this computer
--
-- Other scripts write their own events (shown under Application unless you say otherwise):
--   exports['as-computer']:LogEvent('p3', { source = 'my-heist', eventId = 9100, level = 'warning', message = 'Vault alarm tripped',
--                                           data = { door = 2 } }, optionalPlayerSource)
--   level: 'information' (default) | 'warning' | 'error' | 'success' | 'failure'      kind: 'application' (default) | 'security' | 'system'
--   exports['as-computer']:ComputerKeyOf(src)  -> the key of the computer that player last opened ('c1', 'p3'...), or nil
Config.Logs = {
  retentionDays = 30,    -- older lines are deleted at start and every 6 hours (0 = keep forever)
  pageSize      = 100,   -- lines loaded at a time ("Load more events" fetches the next page)
  maxMessage    = 240,   -- longest message stored

  allowClear    = true,  -- the owner / an admin may clear a log. A clear is itself logged (event 1102) so a wiped log shows who did it
  appLaunch     = true,  -- "Application started" each time an app window opens
  fileActions   = true,  -- File Explorer: files and folders created, renamed, moved, copied, deleted, restored
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
