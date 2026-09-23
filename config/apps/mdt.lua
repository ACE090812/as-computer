-- MDT (Mobile Data Terminal): dashboard, people/vehicle lookup, reports and BOLOs, for police jobs.
-- Built in (not purchasable from the Store), but gated to Config.MDT.jobs the same way every other
-- app is gated to its own job list (see server/apps.lua Apps.jobAllowed).

Config.MDT = {
  -- Jobs allowed to use the MDT (ported from as-mdt's Config.Jobs).
  -- 'mechanic' is temporarily included so it can be tested at the existing garage computer
  -- (Config.Jobs in config/config.lua currently only allows 'mechanic' to use any as-computer device
  -- at all) — remove 'mechanic' here and add your real police job name(s) to both this list AND
  -- Config.Jobs in config/config.lua once you're ready to test with an actual police character/computer.
  jobs = { 'police', 'sheriff', 'lspd', 'bcso', 'sast', 'mechanic' },

  -- Uses your framework's own job grade numbers directly (qb/qbox job.grade.level, esx job.grade),
  -- same as as-mdt's Config.Permissions.adminMinGrade. Anyone with grade >= adminMinGrade can:
  -- delete reports/BOLOs, void insurance/tax. Set to 0 to disable (everyone with MDT access can do everything).
  adminMinGrade = 3,

  -- Penal code shown in the Charges list. Edit freely.
  -- type: 'F' felony, 'M' misdemeanor, 'I' infraction
  charges = {
    { code = '10-31', title = 'Assault', type = 'M', months = 15, fine = 1500, category = 'Person' },
    { code = '10-32', title = 'Aggravated Assault', type = 'F', months = 45, fine = 5000, category = 'Person' },
    { code = '10-40', title = 'Murder', type = 'F', months = 240, fine = 25000, category = 'Person' },
    { code = '10-41', title = 'Attempted Murder', type = 'F', months = 120, fine = 15000, category = 'Person' },
    { code = '20-10', title = 'Petty Theft', type = 'M', months = 10, fine = 1000, category = 'Property' },
    { code = '20-11', title = 'Grand Theft', type = 'F', months = 30, fine = 4000, category = 'Property' },
    { code = '20-20', title = 'Burglary', type = 'F', months = 35, fine = 4500, category = 'Property' },
    { code = '20-30', title = 'Robbery', type = 'F', months = 50, fine = 6000, category = 'Property' },
    { code = '20-31', title = 'Armed Robbery', type = 'F', months = 75, fine = 9000, category = 'Property' },
    { code = '30-10', title = 'Possession of a Controlled Substance', type = 'M', months = 15, fine = 1500, category = 'Drugs' },
    { code = '30-20', title = 'Distribution of a Controlled Substance', type = 'F', months = 60, fine = 8000, category = 'Drugs' },
    { code = '40-10', title = 'Reckless Driving', type = 'M', months = 5, fine = 750, category = 'Traffic' },
    { code = '40-11', title = 'Evading a Peace Officer', type = 'F', months = 25, fine = 3000, category = 'Traffic' },
    { code = '40-20', title = 'Driving Under the Influence', type = 'M', months = 20, fine = 2000, category = 'Traffic' },
    { code = '50-10', title = 'Possession of an Illegal Firearm', type = 'F', months = 40, fine = 5000, category = 'Weapons' },
    { code = '50-20', title = 'Brandishing a Firearm', type = 'M', months = 18, fine = 2000, category = 'Weapons' },
    { code = '60-10', title = 'Resisting Arrest', type = 'M', months = 12, fine = 1250, category = 'Public Order' },
    { code = '60-11', title = 'Obstruction of Justice', type = 'M', months = 15, fine = 1500, category = 'Public Order' },
    { code = '60-20', title = 'Disorderly Conduct', type = 'I', months = 0, fine = 500, category = 'Public Order' },
  },
}

Config.Apps.mdt = {
  store     = false,          -- built-in: always available to Config.MDT.jobs, never bought from the Store
  jobs      = Config.MDT.jobs,
  icon      = 'mdt',
  tint      = '#1d4ed8',      -- police blue
  category  = 'work',
  publisher = 'Los Santos OS',
  version   = '1.0',
  label     = 'MDT',
}

-- config/apps/legalfolder.lua loads before this file (alphabetically), so its writeJobs list is set
-- here instead of being hand-duplicated — keeps it permanently in sync with Config.MDT.jobs above.
-- Edit Config.MDT.jobs (not legalfolder.lua) when your police job list changes.
if Config.LegalFolder then
  Config.LegalFolder.writeJobs = Config.MDT.jobs
end
