-- File Explorer app: rename / delete / recycle bin for MOT certificates.

-- false = testers can only rename or delete tests they carried out themselves.
Config.ManageOthers = false

-- Emptying the Recycle Bin: false = certificates just disappear from File Explorer but the
-- MOT record is kept (vehicle history, GetMOTStatus and police checks are unaffected).
-- true = the database row is deleted for good.
Config.PurgeRemovesRecords = false

-- Built in. (Its MOT Certificates folder only shows for jobs that have the MOT app.)
Config.Apps.explorer = { store = false }
