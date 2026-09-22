-- File Explorer: Documents, Downloads and a shared job folder (folders, text files, and links to images / media).
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
  maxDepth       = 8,        -- folders inside folders: how deep
  maxTotal       = 1000,     -- files and folders in one place (Documents, Downloads, or the job's shared folder)
  -- Deleted files go to the Recycle Bin (the same one the MOT certificates use) and can be restored. In the shared folder the
  -- author or the boss can restore or empty them. binDays = how long they stay (0 = until someone empties the bin).
  recycleBin     = true,     -- false = deleting a file removes it for good
  binDays        = 30,
  -- Images, video, audio and other files are LINKS to media hosted somewhere (the server keeps the address, never the file).
  -- A player's browser/game loads the link when they open it, which shows the host their address, so only hosts you list
  -- can be used. '*.example.com' allows every sub-domain. Set allowAnyHost = true to allow any https link (not recommended).
  allowedHosts   = { 'i.imgur.com', 'cdn.discordapp.com', 'media.discordapp.net', '*.fivemanage.com', 'upload.wikimedia.org' },
  allowAnyHost   = false,
  -- Photos from the character's phone (sd-phone Photos) can be imported, and images sent back to it. Photos already on the
  -- phone are hosted where sd-phone put them, so they do not need to be in allowedHosts.
  phoneImport    = true,
  phoneResource  = 'sd-phone',
}
