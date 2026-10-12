-- Police and court job lists. These used to live in the built-in MDT / Court MDT configs; the MDT now
-- ships as its own resource (as-mdt-v2), but as-computer's forensics apps and File Explorer case
-- folders still need to know which jobs are police and which are court staff.
--
-- Loads after config/apps/{courtfolder,evidences,legalfolder}.lua (alphabetical order), so it can
-- fill in their job lists below instead of hand-duplicating them. EDIT the job names to your
-- server's real ones.

Config.PoliceJobs = {
  -- 'mechanic' is temporarily included so it can be tested at the existing garage computer — remove it
  -- and add your real police job name(s) here AND to Config.Jobs in config/config.lua when ready.
  'police', 'sheriff', 'lspd', 'bcso', 'sast', 'mechanic',
}

Config.CourtJobs = { 'judge', 'lawyer', 'solicitor', 'barrister' }

-- Police forensics apps (Fingerprint, DNA, Firearms Registry, Ballistics, Wiretap).
for _, id in ipairs({ 'fingerprint', 'dna', 'firearms_registry', 'ballistics', 'wiretap' }) do
  if Config.Apps[id] then Config.Apps[id].jobs = Config.PoliceJobs end
end

-- Case Files (legal) folder: police can write.
if Config.LegalFolder then Config.LegalFolder.writeJobs = Config.PoliceJobs end

-- Court Files folder: court staff can write.
if Config.CourtFolder then Config.CourtFolder.writeJobs = Config.CourtJobs end
