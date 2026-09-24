-- Evidences apps: each of evidences' own tools gets its own desktop icon/window (see ui/evidences.js),
-- instead of one "Evidences" app nesting the whole laptop UI. Access control is entirely evidences'
-- own (config.permissions.access, checked in its own client/dui/focus.lua export), so none of these
-- carry a `jobs` restriction at the as-computer level — same as the single app entry they replace.

-- 'citizens' was removed on purpose: its data now shows on MDT's own People section instead of a
-- separate app (same underlying citizenid records, since evidences' config.citizens.synced = true).
-- See ui/mdt.js / server/mdt.lua.

Config.Apps.fingerprint = {
  store     = false,
  icon      = 'fingerprint',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Fingerprint',
}

Config.Apps.dna = {
  store     = false,
  icon      = 'dna',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'DNA',
}

Config.Apps.firearms_registry = {
  store     = false,
  icon      = 'firearms_registry',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Firearms Registry',
}

Config.Apps.ballistics = {
  store     = false,
  icon      = 'ballistics',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Ballistics',
}

Config.Apps.wiretap = {
  store     = false,
  icon      = 'wiretap',
  tint      = '#334155',
  category  = 'work',
  publisher = 'noobsystems',
  version   = '1.3.1',
  label     = 'Wiretap',
}
