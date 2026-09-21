-- File Explorer: Documents, Downloads and a shared job folder (text files kept on the server).
--   Documents and Downloads belong to the character and follow them to any computer.
--   The shared folder belongs to the job: everyone on the job can open, add and copy files; only the author (or the boss,
--   if bossManagesAll is on) can rename or delete a file.
-- Turn the whole thing off with Config.Files.enabled = false. The MOT certificates part of the Explorer is not affected.
Config.Files = {
  enabled        = true,
  maxPerFolder   = 200,      -- files in one folder (per character, or per job for the shared folder)
  maxLength      = 50000,    -- characters in one file
  maxNameLength  = 80,
  sharedFolders  = 'auto',   -- 'auto' = every job that may use the computer, or a list like { mechanic = true, police = true }
  excludeJobs    = { unemployed = true },
  bossManagesAll = true,     -- the job's boss can rename / delete anyone's file in the shared folder
}
