-- Evidences apps: each of evidences' own tools gets its own desktop icon/window (see ui/evidences.js),
-- instead of one "Evidences" app nesting the whole laptop UI. Evidences' own permission system
-- (config.permissions.access, checked in its own client/dui/focus.lua export) still decides which of
-- the unlocked tools a given job can actually use once the app is reachable at all - but at the
-- as-computer level these are police apps: their `jobs` list is set from config/apps/policejobs.lua (which
-- loads after this file) to Config.PoliceJobs, instead of being hand-duplicated here. Edit
-- Config.PoliceJobs (not this file) to change who can use them.
--
-- workOnly = true: these are only granted for free (Apps.has/Apps.allowed) on a /placeprops computer
-- that is job-locked (see server/placement.lua's PlacedJobLock) to the player's own job - never on a
-- home/personal computer or an unlocked one.

-- 'citizens' was removed on purpose: its data shows in the MDT's People section (the separate as-mdt-v2
-- resource) instead of a separate app (same underlying citizenid records, since evidences' config.citizens.synced = true).

Config.Apps.fingerprint = {
  store     = false,
  workOnly  = true,
  icon      = 'fingerprint',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Fingerprint',
}

Config.Apps.dna = {
  store     = false,
  workOnly  = true,
  icon      = 'dna',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'DNA',
}

Config.Apps.firearms_registry = {
  store     = false,
  workOnly  = true,
  icon      = 'firearms_registry',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Firearms Registry',
}

Config.Apps.ballistics = {
  store     = false,
  workOnly  = true,
  icon      = 'ballistics',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Ballistics',
}

Config.Apps.wiretap = {
  store     = false,
  workOnly  = true,
  icon      = 'wiretap',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Wiretap',
}
