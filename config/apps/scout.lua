-- Scout app: the browser on the desktop. It opens the in-game websites from the as-browser
-- resource (same sites, bookmarks and history as the phone). The app only shows when that
-- resource is running. Desktop-only sites (like the parts shop) are only reachable from here.

Config.Browser = {
  enabled = true,
  resource = 'as-browser',
  -- Send every MOT test to as-browser so the government site's vehicle checker shows the
  -- MOT status and history.
  pushMotResults = true,
}

Config.Apps.browser = {
  store     = true,
  jobs      = nil,                  -- any job
  manage    = 'any',                -- who may install / remove it for their job: any employee (default is Config.Store.manage)
  price     = 0,
  icon      = 'brglobe',
  tint      = '#1b7fe0',
  category  = 'tools',
  publisher = 'Scout Web',
  version   = '1.0',
}
