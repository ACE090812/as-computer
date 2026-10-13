-- Admin panel (/pcadmin): every computer, TV, printer and custom prop on the server in one NUI window.
-- Who may open it: the ace `command.pcadmin` (or `command.placeprops`), or the framework's own admin permission
-- (QBCore / QBox permission 'admin' or 'god', ESX group 'admin' or 'superadmin'). See Bridge.IsAdmin.
Config.Admin = {
  enabled      = true,
  command      = 'pcadmin',
  refreshMs    = 5000,    -- ms between refreshes while the panel is open (who is sitting at which computer)
  maxProps     = 64,      -- most custom props that can be added from the Props tab
  maxLog       = 500,     -- admin actions kept in the database (older ones are pruned)
  showLog      = 100,     -- rows shown in the panel's log
}
