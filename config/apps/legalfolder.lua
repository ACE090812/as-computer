-- Shared "legal" folder in File Explorer: visible to police + judges/lawyers/solicitors/barristers,
-- for MDT reports and other case paperwork. writeJobs may add/rename/delete; readJobs can only open/read.
-- Fill in your real job names for the legal side below (left as placeholders for now).
--
-- NOTE: do not reference Config.MDT at this (top) level -- config/apps/*.lua files load in
-- glob/alphabetical order and mdt.lua may not have loaded yet. Config.MDT.jobs is only read from
-- inside a function body in server/files.lua, never here.
Config.LegalFolder = {
  enabled   = true,
  label     = 'Case Files',        -- folder name as it appears in File Explorer's sidebar
  writeJobs = { 'police', 'sheriff', 'lspd', 'bcso', 'sast' },   -- same list as Config.MDT.jobs; keep in sync
  readJobs  = { 'judge', 'lawyer', 'solicitor', 'barrister' },   -- EDIT to your server's real job names
}
