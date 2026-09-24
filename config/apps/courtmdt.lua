-- Court MDT: judge/prosecution/defence sign-on, each solicitor's private case workspace, motions,
-- scheduling and verdicts - a SEPARATE app/icon from the police MDT ('mdt'), because judges and
-- solicitors should never need the police MDT installed just to reach this. Built in (not
-- purchasable from the Store), gated to Config.CourtMDT.jobs the same way Config.Apps.mdt is
-- gated to Config.MDT.jobs.
--
-- EDIT the job names below to your server's real judge/solicitor/barrister jobs.
Config.CourtMDT = {
  jobs = { 'judge', 'lawyer', 'solicitor', 'barrister' },
}

Config.Apps.courtmdt = {
  store     = false,
  jobs      = Config.CourtMDT.jobs,
  icon      = 'courtmdt',
  tint      = '#8a6a34',      -- brass, matching the Court MDT's own colour scheme
  category  = 'work',
  publisher = 'Los Santos OS',
  version   = '1.0',
  label     = 'Court MDT',
}

-- config/apps/courtfolder.lua loads before this file (alphabetically), so its writeJobs list is
-- set here instead of being hand-duplicated - keeps it permanently in sync with Config.CourtMDT.jobs
-- above. Edit Config.CourtMDT.jobs (not courtfolder.lua) when your court job list changes.
if Config.CourtFolder then
  Config.CourtFolder.writeJobs = Config.CourtMDT.jobs
end
