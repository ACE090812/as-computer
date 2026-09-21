-- Calculator app: a standard calculator with memory and a history tape. Runs entirely in the page, nothing is saved.
-- Built in by default (everyone who may use the computer has it). Set store = true to hand it out through the Store,
-- or turn it off with Config.EnabledApps.calculator = false in config/config.lua.
Config.Apps.calculator = {
  store     = false,
  jobs      = nil,
  price     = 0,
  icon      = 'calculator',
  tint      = '#4b5563',
  category  = 'tools',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
