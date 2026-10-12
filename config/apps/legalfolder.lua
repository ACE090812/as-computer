-- Shared "legal" folder in File Explorer: visible to police + judges/lawyers/solicitors/barristers,
-- for MDT reports (written by the separate as-mdt-v2 resource) and other case paperwork. writeJobs may add/rename/delete; readJobs can only open/read.
-- Fill in your real job names for the legal side below (left as placeholders for now).
--
-- NOTE: writeJobs is overwritten by config/apps/policejobs.lua (Config.PoliceJobs), which loads after this file.
Config.LegalFolder = {
  enabled   = true,
  label     = 'Case Files',        -- folder name as it appears in File Explorer's sidebar
  writeJobs = { 'police', 'sheriff', 'lspd', 'bcso', 'sast' },   -- overwritten by Config.PoliceJobs
  readJobs  = { 'judge', 'lawyer', 'solicitor', 'barrister' },   -- EDIT to your server's real job names
}
