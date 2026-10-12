-- Shared "court" folder in File Explorer: visible ONLY to judges/prosecution/defence job-holders,
-- for court bundles, briefs, witness lists and motions. Regular police/legal-folder readers never
-- see this bucket exists — it is a separate owner group from Config.LegalFolder, not a subfolder of it.
-- Filing.txt / Verdict.txt for a case still get written into the normal Case Files (legal) folder so
-- officers keep seeing case outcomes; only the working court material lives here.
--
-- NOTE: writeJobs is overwritten by config/apps/policejobs.lua (Config.CourtJobs), which loads after this file.
Config.CourtFolder = {
  enabled   = true,
  label     = 'Court Files',       -- folder name as it appears in File Explorer's sidebar
  writeJobs = { 'judge', 'lawyer', 'solicitor', 'barrister', 'mechanic' },   -- EDIT to your server's real job names
  readJobs  = {},                                                -- anyone needing read-only court access, if ever
}
