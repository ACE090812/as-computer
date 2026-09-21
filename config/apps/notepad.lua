-- Notepad app: the character's own notes, saved on the server so they are there on any computer.
-- Personal to the character (not to the job). Built in by default; set store = true to hand it out through the Store,
-- or turn it off with Config.EnabledApps.notepad = false in config/config.lua.
Config.Notepad = {
  maxNotes  = 50,       -- notes one character may keep
  maxLength = 20000,    -- characters in one note
}

Config.Apps.notepad = {
  store     = false,
  jobs      = nil,
  price     = 0,
  icon      = 'notepad',
  tint      = '#f5c542',
  category  = 'tools',
  publisher = 'Los Santos OS',
  version   = '1.0',
}
