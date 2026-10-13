-- Business Manager (Boss app): the boss grade of a job manages staff and sees the society's money. Built in,
-- but only the job's boss grade ever sees it on the desktop (bossOnly = true). Jobs only (no gangs).
--   Overview   job summary, staff online, payroll, balance
--   Employees  promote, demote, fire (everyone below the boss's own grade)
--   Hiring     hire a player standing nearby, or by server id / character id
--   Finances   society balance and a chart (view only; money moves in your banking resource)
-- The society account comes from the Store's bank settings (config/apps/store.lua: Config.Store.accountFor / bank).
Config.Boss = {
  jobs            = nil,             -- nil = every job that may use the computer; or { 'police', 'mechanic' }
  fireJob         = 'unemployed',    -- fired staff go here
  fireGrade       = 0,
  hireGrade       = 0,               -- grade a new hire starts on (a boss can pick another, up to maxHireGrade)
  maxHireGrade    = nil,             -- highest grade a boss may hire / promote someone to; nil = one below their own
  nearbyDistance  = 5.0,             -- metres: who counts as "nearby" for hiring
  snapshotMinutes = 30,              -- how often society balances are sampled for the Finances chart
  keepDays        = 30,              -- how long the chart's samples are kept
}

Config.Apps.boss = {
  store     = false,
  bossOnly  = true,
  jobs      = nil,
  price     = 0,
  icon      = 'boss',
  tint      = '#0f6cbd',
  category  = 'business',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
