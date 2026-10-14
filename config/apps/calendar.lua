-- Calendar app: one app with "My calendar" (personal, reminders, sharing) and the job's shared team calendar (bookings).

Config.Calendar = {
  enabled = true,
  weekStart = 1,   -- 1 = Monday, 0 = Sunday
}

-- Built in by default. Set store = true (and jobs / price if you like) to make the Store hand it out instead.
-- Each job has its own calendar.
Config.Apps.calendar = {
  store     = false,
  jobs      = nil,
  price     = 0,
  icon      = 'calendar',
  tint      = '#0f6cbd',
  category  = 'work',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
