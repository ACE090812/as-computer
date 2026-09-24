-- Court MDT app (server side): judge/prosecution/defence sign-on, each solicitor's private
-- workspace (witnesses, notes, disclosure), motions, scheduling and verdicts, on top of the
-- mdt_court_cases/mdt_court_witnesses/mdt_court_motions tables server/mdt.lua's reportSendToCourt
-- creates rows into. A completely separate app from the police MDT ('mdt') - gated to
-- Config.CourtMDT.jobs (judge/lawyer/solicitor/barrister by default) via Apps.allowed, never to
-- Config.MDT.jobs, since judges/solicitors do not and should not have the police MDT installed.
-- Same MotCallback.Register(...) dispatcher pattern as server/mdt.lua, just its own callback name
-- ('courtMdtApi') and its own client/courtmdt.lua allow-list.

local function escHtml(s)
  return (tostring(s or ''):gsub('&', '&amp;'):gsub('<', '&lt;'):gsub('>', '&gt;'))
end

--- MySQL TIMESTAMP columns can come back as a unix-seconds (or -ms) number depending on the
--- driver, or as a datetime string - same helper as server/mdt.lua's fmtWhen.
local function fmtWhen(v)
  if v == nil or v == '' then return '' end
  local n = tonumber(v)
  if n then
    if n > 100000000000 then n = n / 1000 end
    return os.date('%d %b %Y, %H:%M', math.floor(n))
  end
  return tostring(v):gsub('%.0$', ''):sub(1, 16)
end

local function chargeItems(charges)
  local items = {}
  if not charges or charges == '' then return items end
  for part in (charges .. ','):gmatch('([^,]*),') do
    local t = part:match('^%s*(.-)%s*$')
    if t ~= '' then items[#items + 1] = t end
  end
  return items
end

-- Same "CODE - Title" parsing server/mdt.lua's own resolvedCharges does, resolved against the
-- same Config.MDT.charges list, so a case's charges read identically here and on the report.
local function resolvedCharges(charges)
  local out = {}
  for _, entry in ipairs(chargeItems(charges)) do
    local code, title = entry:match('^(%S+)%s*%-%s*(.+)$')
    local def = nil
    if code then
      for _, ch in ipairs(Config.MDT and Config.MDT.charges or {}) do
        if ch.code == code then def = ch; break end
      end
    end
    out[#out + 1] = {
      code = code, title = def and def.title or (title or entry),
      type = def and def.type or nil, months = def and def.months or nil, fine = def and def.fine or nil,
    }
  end
  return out
end

MotCallback.Register('courtMdtApi', function(src, respond, name, data)
  if not Apps.allowed(src, 'courtmdt') then return respond({ ok = false, reason = 'not_authorised' }) end
  data = type(data) == 'table' and data or {}
  local job = Bridge.GetJob(src)

  if name == 'boot' then
    return respond({ ok = true, data = {
      officer = { name = Bridge.GetName(src), cid = Bridge.GetIdentifier(src), job = job and job.name, jobLabel = job and (job.label or job.name) },
    } })
  end

  if name == 'casesList' then
    local cid = Bridge.GetIdentifier(src)
    local rows = MySQL.query.await(
      "SELECT id, case_number, suspect_name, status, judge_name, prosecution_name, defense_name, submitted_at, court_date, courtroom " ..
      "FROM mdt_court_cases WHERE status != 'resolved' OR resolved_at > ? ORDER BY id DESC LIMIT 100",
      { os.time() - 86400 }) or {}
    for _, r in ipairs(rows) do
      r.submitted_at = fmtWhen(r.submitted_at)
      if r.court_date then r.court_date = fmtWhen(r.court_date) end
    end
    return respond({ ok = true, data = { cases = rows } })
  end

  --- The viewer's role on this court case, or nil if they're not signed on to any of the three seats.
  local function courtRoleOf(cc, cid)
    if cc.judge_cid == cid then return 'judge' end
    if cc.prosecution_cid == cid then return 'prosecution' end
    if cc.defense_cid == cid then return 'defense' end
    return nil
  end

  local function getCourtCase(id)
    if type(id) ~= 'number' then return nil end
    return MySQL.single.await('SELECT * FROM mdt_court_cases WHERE id = ?', { id })
  end

  if name == 'courtCaseGet' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local cid = Bridge.GetIdentifier(src)
    local role = courtRoleOf(cc, cid)
    local prosVisible = role == 'prosecution' or role == 'judge' or cc.prosecution_disclosed == 1
    local defVisible = role == 'defense' or role == 'judge' or cc.defense_disclosed == 1
    local witnesses = MySQL.query.await('SELECT id, side, name, note FROM mdt_court_witnesses WHERE court_case_id = ? ORDER BY id ASC', { cc.id }) or {}
    local visibleWitnesses = {}
    for _, w in ipairs(witnesses) do
      if (w.side == 'prosecution' and prosVisible) or (w.side == 'defense' and defVisible) then
        visibleWitnesses[#visibleWitnesses + 1] = w
      end
    end
    local motions = MySQL.query.await(
      'SELECT id, side, filed_by_name, text, status, ruling_text, ruled_by_name, filed_at, ruled_at FROM mdt_court_motions WHERE court_case_id = ? ORDER BY id DESC', { cc.id }) or {}
    for _, m in ipairs(motions) do
      m.filed_at = fmtWhen(m.filed_at)
      if m.ruled_at then m.ruled_at = fmtWhen(m.ruled_at) end
    end
    return respond({ ok = true, data = {
      case = {
        id = cc.id, case_number = cc.case_number, suspect_name = cc.suspect_name, charges = cc.charges,
        status = cc.status, courtroom = cc.courtroom, court_date = cc.court_date and fmtWhen(cc.court_date) or nil,
        judge_name = cc.judge_name, prosecution_name = cc.prosecution_name, defense_name = cc.defense_name,
        verdict = cc.verdict, sentence_minutes = cc.sentence_minutes, fine = cc.fine, summary = cc.summary,
        prosecutionDisclosed = cc.prosecution_disclosed == 1, defenseDisclosed = cc.defense_disclosed == 1,
      },
      myRole = role,
      myNotes = role == 'prosecution' and cc.prosecution_notes or (role == 'defense' and cc.defense_notes or nil),
      otherNotes = (role == 'prosecution' and defVisible and cc.defense_notes)
        or (role == 'defense' and prosVisible and cc.prosecution_notes) or nil,
      witnesses = visibleWitnesses,
      motions = motions,
    } })
  end

  if name == 'courtSignOn' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local role = data.role
    if role ~= 'judge' and role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'invalid' }) end
    local col = role == 'judge' and 'judge' or (role == 'prosecution' and 'prosecution' or 'defense')
    if cc[col .. '_cid'] and cc[col .. '_cid'] ~= '' then return respond({ ok = false, reason = 'already_assigned' }) end
    local cid, cname = Bridge.GetIdentifier(src), Bridge.GetName(src)
    MySQL.update.await('UPDATE mdt_court_cases SET ' .. col .. '_cid = ?, ' .. col .. '_name = ? WHERE id = ?', { cid, cname, cc.id })
    if cc.judge_cid and cc.prosecution_cid and cc.defense_cid then
      MySQL.update.await("UPDATE mdt_court_cases SET status = 'ready' WHERE id = ? AND status = 'awaiting_assignment'", { cc.id })
    elseif role == 'judge' and cc.prosecution_cid and cc.defense_cid then
      MySQL.update.await("UPDATE mdt_court_cases SET status = 'ready' WHERE id = ? AND status = 'awaiting_assignment'", { cc.id })
    elseif role == 'prosecution' and cc.judge_cid and cc.defense_cid then
      MySQL.update.await("UPDATE mdt_court_cases SET status = 'ready' WHERE id = ? AND status = 'awaiting_assignment'", { cc.id })
    elseif role == 'defense' and cc.judge_cid and cc.prosecution_cid then
      MySQL.update.await("UPDATE mdt_court_cases SET status = 'ready' WHERE id = ? AND status = 'awaiting_assignment'", { cc.id })
    end
    return respond({ ok = true, data = { name = cname } })
  end

  if name == 'courtWitnessAdd' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local cid = Bridge.GetIdentifier(src)
    local role = courtRoleOf(cc, cid)
    if role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'not_a_party' }) end
    local disclosed = role == 'prosecution' and cc.prosecution_disclosed == 1 or cc.defense_disclosed == 1
    if disclosed then return respond({ ok = false, reason = 'disclosed_locked' }) end
    local wname = tostring(data.name or ''):sub(1, 120)
    if wname == '' then return respond({ ok = false, reason = 'invalid' }) end
    local wnote = data.note and tostring(data.note):sub(1, 255) or nil
    MySQL.insert.await(
      'INSERT INTO mdt_court_witnesses (court_case_id, side, name, note, added_by, added_by_name, added_at) VALUES (?,?,?,?,?,?,?)',
      { cc.id, role, wname, wnote, cid, Bridge.GetName(src), os.time() })
    return respond({ ok = true })
  end

  if name == 'courtWitnessDelete' then
    local wid = math.floor(tonumber(data.witnessId) or 0)
    if wid < 1 then return respond({ ok = false, reason = 'invalid' }) end
    local w = MySQL.single.await('SELECT id, added_by, court_case_id FROM mdt_court_witnesses WHERE id = ?', { wid })
    if not w then return respond({ ok = false, reason = 'not_found' }) end
    if w.added_by ~= Bridge.GetIdentifier(src) then return respond({ ok = false, reason = 'not_authorised' }) end
    MySQL.query.await('DELETE FROM mdt_court_witnesses WHERE id = ?', { wid })
    return respond({ ok = true })
  end

  if name == 'courtNotesSave' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local role = courtRoleOf(cc, Bridge.GetIdentifier(src))
    if role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'not_a_party' }) end
    local disclosed = role == 'prosecution' and cc.prosecution_disclosed == 1 or cc.defense_disclosed == 1
    if disclosed then return respond({ ok = false, reason = 'disclosed_locked' }) end
    local text = tostring(data.text or '')
    if utf8.len(text) and utf8.len(text) > 8000 then text = text:sub(1, 8000) end
    MySQL.update.await('UPDATE mdt_court_cases SET ' .. role .. '_notes = ? WHERE id = ?', { text, cc.id })
    return respond({ ok = true })
  end

  -- Lets a solicitor pull an already-written text file in from File Explorer (their Documents,
  -- their job folder, or the court folder) instead of retyping it into Case Notes.
  if name == 'courtFilesList' then
    return respond({ ok = true, data = { files = Files.ListTextFilesFor(src, Bridge.GetIdentifier(src)) } })
  end

  if name == 'courtNotesImport' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local role = courtRoleOf(cc, Bridge.GetIdentifier(src))
    if role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'not_a_party' }) end
    local disclosed = role == 'prosecution' and cc.prosecution_disclosed == 1 or cc.defense_disclosed == 1
    if disclosed then return respond({ ok = false, reason = 'disclosed_locked' }) end
    local text = Files.GetTextFileBodyFor(src, Bridge.GetIdentifier(src), data.fileId)
    if not text then return respond({ ok = false, reason = 'not_found' }) end
    if utf8.len(text) and utf8.len(text) > 8000 then text = text:sub(1, 8000) end
    MySQL.update.await('UPDATE mdt_court_cases SET ' .. role .. '_notes = ? WHERE id = ?', { text, cc.id })
    return respond({ ok = true, data = { text = text } })
  end

  --- Recompiles the (court-bucket-only) bundle from everything disclosed so far - called any time
  -- both sides are disclosed, so it's always current rather than needing a manual "compile" step.
  local function compileCourtBundle(cc)
    if cc.prosecution_disclosed ~= 1 or cc.defense_disclosed ~= 1 then return end
    local L = {}
    local function add(s) L[#L + 1] = s end
    add('<h1>Court Bundle</h1>')
    add(('<p><b>Case Number:</b> %s</p>'):format(escHtml(cc.case_number or '')))
    add(('<p><b>Defendant:</b> %s</p>'):format(escHtml(cc.suspect_name or 'Unknown')))
    add('<h2>Charges</h2>')
    for _, c in ipairs(resolvedCharges(cc.charges)) do
      add(('<p>%s</p>'):format(escHtml((c.code and (c.code .. ' - ') or '') .. (c.title or ''))))
    end
    local witnesses = MySQL.query.await('SELECT side, name, note FROM mdt_court_witnesses WHERE court_case_id = ? ORDER BY side, id ASC', { cc.id }) or {}
    add('<h2>Witnesses</h2>')
    for _, w in ipairs(witnesses) do
      add(('<p>[%s] %s%s</p>'):format(w.side == 'prosecution' and 'Prosecution' or 'Defence', escHtml(w.name), w.note and (' — ' .. escHtml(w.note)) or ''))
    end
    add('<h2>Prosecution Brief</h2>')
    add(('<p>%s</p>'):format(escHtml(cc.prosecution_notes or '')))
    add('<h2>Defence Brief</h2>')
    add(('<p>%s</p>'):format(escHtml(cc.defense_notes or '')))
    add('<h2>Judge\'s Notes</h2>')
    add('<p><br></p><p><br></p>')
    Files.UpsertCaseNamedFile('court', cc.case_number, { cc.suspect_name }, 'Court Bundle.txt', table.concat(L, ''))
  end

  if name == 'courtDisclose' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local role = courtRoleOf(cc, Bridge.GetIdentifier(src))
    if role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'not_a_party' }) end
    local col = role .. '_disclosed'
    local mine = cc[col] == 1
    if mine then
      -- Un-disclosing is a one-way-out-for-both action: blind disclosure only means anything when
      -- both sides stay locked together, so retracting yours re-locks the other side too.
      MySQL.update.await('UPDATE mdt_court_cases SET prosecution_disclosed = 0, defense_disclosed = 0 WHERE id = ?', { cc.id })
    else
      MySQL.update.await('UPDATE mdt_court_cases SET ' .. col .. ' = 1 WHERE id = ?', { cc.id })
      cc = getCourtCase(cc.id)
      compileCourtBundle(cc)
    end
    return respond({ ok = true, data = { disclosed = not mine } })
  end

  if name == 'courtMotionFile' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    local cid = Bridge.GetIdentifier(src)
    local role = courtRoleOf(cc, cid)
    if role ~= 'prosecution' and role ~= 'defense' then return respond({ ok = false, reason = 'not_a_party' }) end
    local text = tostring(data.text or ''):sub(1, 500)
    if text == '' then return respond({ ok = false, reason = 'invalid' }) end
    MySQL.insert.await(
      'INSERT INTO mdt_court_motions (court_case_id, side, filed_by, filed_by_name, text, filed_at) VALUES (?,?,?,?,?,?)',
      { cc.id, role, cid, Bridge.GetName(src), text, os.time() })
    return respond({ ok = true })
  end

  if name == 'courtMotionRule' then
    local mid = math.floor(tonumber(data.motionId) or 0)
    local m = MySQL.single.await('SELECT id, court_case_id, status FROM mdt_court_motions WHERE id = ?', { mid })
    if not m then return respond({ ok = false, reason = 'not_found' }) end
    local cc = getCourtCase(m.court_case_id)
    if not cc or courtRoleOf(cc, Bridge.GetIdentifier(src)) ~= 'judge' then return respond({ ok = false, reason = 'not_authorised' }) end
    if m.status ~= 'pending' then return respond({ ok = false, reason = 'already_ruled' }) end
    local approve = data.approve == true
    local ruling = tostring(data.rulingText or ''):sub(1, 255)
    MySQL.update.await(
      'UPDATE mdt_court_motions SET status = ?, ruling_text = ?, ruled_by_name = ?, ruled_at = ? WHERE id = ?',
      { approve and 'approved' or 'denied', ruling, Bridge.GetName(src), os.time(), mid })
    return respond({ ok = true })
  end

  if name == 'courtScheduleSet' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    if courtRoleOf(cc, Bridge.GetIdentifier(src)) ~= 'judge' then return respond({ ok = false, reason = 'not_authorised' }) end
    if not (cc.judge_cid and cc.prosecution_cid and cc.defense_cid) then return respond({ ok = false, reason = 'not_all_signed' }) end
    local courtDate = math.floor(tonumber(data.court_date) or 0)
    if courtDate <= 0 then return respond({ ok = false, reason = 'invalid' }) end
    local courtroom = tostring(data.courtroom or ''):sub(1, 60)
    MySQL.update.await("UPDATE mdt_court_cases SET courtroom = ?, court_date = ?, status = 'scheduled' WHERE id = ?", { courtroom, courtDate, cc.id })
    return respond({ ok = true })
  end

  if name == 'courtVerdictFinalize' then
    local cc = getCourtCase(math.floor(tonumber(data.id) or 0))
    if not cc then return respond({ ok = false, reason = 'not_found' }) end
    if courtRoleOf(cc, Bridge.GetIdentifier(src)) ~= 'judge' then return respond({ ok = false, reason = 'not_authorised' }) end
    if cc.status == 'resolved' then return respond({ ok = false, reason = 'already_resolved' }) end
    local verdict = data.verdict == 'guilty' and 'guilty' or (data.verdict == 'not_guilty' and 'not_guilty' or nil)
    if not verdict then return respond({ ok = false, reason = 'invalid' }) end
    local minutes = math.floor(tonumber(data.sentence_minutes) or 0)
    local fine = math.floor(tonumber(data.fine) or 0)
    local summary = tostring(data.summary or ''):sub(1, 2000)
    local now = os.time()

    if verdict == 'guilty' and minutes > 0 then
      local targetSrc = Bridge.FindSource(cc.suspect_cid)
      if targetSrc and GetResourceState('xt-prison') == 'started' then
        pcall(function() exports['xt-prison']:SetJailTime(targetSrc, minutes) end)
      end
      if GetResourceState('as-browser') == 'started' then
        local judgeName = Bridge.GetName(src)
        for _, c in ipairs(resolvedCharges(cc.charges)) do
          local offence = c.code and (c.code .. ' - ' .. c.title) or (c.title or 'Unknown offence')
          pcall(function()
            exports['as-browser']:addCriminalRecord(cc.suspect_cid, {
              offence = offence, sentence = minutes .. ' months', issuedBy = judgeName,
              notes = (cc.case_number and cc.case_number ~= '') and ('Case ' .. cc.case_number .. ' (court verdict)') or '',
            })
          end)
        end
      end
      MySQL.update.await('UPDATE mdt_reports SET jailed_at = COALESCE(jailed_at, ?) WHERE id = ?', { now, cc.report_id })
    end

    MySQL.update.await(
      "UPDATE mdt_court_cases SET status = 'resolved', verdict = ?, sentence_minutes = ?, fine = ?, summary = ?, resolved_at = ? WHERE id = ?",
      { verdict, minutes > 0 and minutes or nil, fine > 0 and fine or nil, summary, now, cc.id })

    if cc.case_number and cc.case_number ~= '' then
      local L = {}
      local function add(s) L[#L + 1] = s end
      add('<h1>Verdict</h1>')
      add(('<p><b>Case Number:</b> %s</p>'):format(escHtml(cc.case_number)))
      add(('<p><b>Defendant:</b> %s</p>'):format(escHtml(cc.suspect_name or 'Unknown')))
      add(('<p><b>Judge:</b> %s</p>'):format(escHtml(cc.judge_name or Bridge.GetName(src))))
      add(('<p><b>Outcome:</b> %s</p>'):format(verdict == 'guilty' and 'Guilty' or 'Not Guilty'))
      if verdict == 'guilty' then
        if minutes > 0 then add(('<p><b>Sentence:</b> %d minutes</p>'):format(minutes)) end
        if fine > 0 then add(('<p><b>Fine:</b> $%d</p>'):format(fine)) end
      end
      add('<h2>Summary</h2>')
      add(('<p>%s</p>'):format(escHtml(summary ~= '' and summary or '—')))
      Files.UpsertCaseNamedFile('legal', cc.case_number, { cc.suspect_name }, 'Verdict.txt', table.concat(L, ''))
    end

    return respond({ ok = true, data = { verdict = verdict } })
  end

  return respond({ ok = false, reason = 'invalid' })
end)
