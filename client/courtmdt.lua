-- Court MDT app (client side): relays the page's calls to the server ('courtMdtApi'), which checks
-- the job and the app gate (Apps.allowed(src, 'courtmdt')). Same shape as client/mdt.lua, its own
-- callback name so the police MDT and the Court MDT never share one gate.
local ALLOWED = {
  boot = true, casesList = true,
  courtCaseGet = true, courtSignOn = true,
  courtWitnessAdd = true, courtWitnessDelete = true,
  courtNotesSave = true, courtDisclose = true,
  courtFilesList = true, courtNotesImport = true,
  courtMotionFile = true, courtMotionRule = true,
  courtScheduleSet = true, courtVerdictFinalize = true,
}

RegisterNUICallback('courtMdtApi', function(data, cb)
  data = data or {}
  local name = data.name
  if type(name) ~= 'string' or not ALLOWED[name] then return cb({ ok = false, reason = 'invalid' }) end
  MotCallback.Trigger('courtMdtApi', function(res)
    cb(type(res) == 'table' and res or { ok = false, reason = 'error' })
  end, name, type(data.data) == 'table' and data.data or {})
end)
