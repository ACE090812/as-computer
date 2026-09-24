/* Court MDT app for Los Santos OS: judge/prosecution/defence sign-on, each solicitor's private
   case workspace (witnesses, notes, disclosure), motions, scheduling and verdicts. A separate app
   from the police MDT (ui/mdt.js) - registers its own icon via LSOS.registerApp and talks to the
   server through its own 'courtMdtApi' callback (client/courtmdt.lua -> server/courtmdt.lua).
   Reuses mdt.css's classes (mdt-cmdbar/mdt-split/mdt-btn/mdt-field/...) for a consistent look,
   rather than shipping a second stylesheet. No framework, same render()-from-state shape as mdt.js. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#8a6a34"/><path d="M12 4v16M6 8l-2.5 5a3.4 3.4 0 0 0 7 0zM18 8l-2.5 5a3.4 3.4 0 0 0 7 0zM6 8h12" stroke="#fff" stroke-width="1.4" fill="none"/></svg>';
  var BRAND_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3v18M5 8l-3 6a4 4 0 0 0 8 0l-3-6M19 8l-3 6a4 4 0 0 0 8 0l-3-6M5 8h14" fill="none" stroke="#c9a869" stroke-width="1.4"/></svg>';

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/courtMdtApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  var ERR = {
    not_authorised: ['cm_err_not_authorised', 'You are not authorised to use the Court MDT.'],
    invalid: ['cm_err_invalid', 'That could not be saved.'],
    not_found: ['cm_err_not_found', 'Not found.'],
    network: ['cm_err_network', 'Could not reach the server.'],
    error: ['cm_err_error', 'Something went wrong.'],
    already_assigned: ['cm_err_already_assigned', 'That seat is already filled.'],
    not_a_party: ['cm_err_not_a_party', 'You are not signed on to this case.'],
    disclosed_locked: ['cm_err_disclosed_locked', 'You have already disclosed - un-disclose first to edit.'],
    not_all_signed: ['cm_err_not_all_signed', 'Judge, prosecution and defence must all sign on first.'],
    already_ruled: ['cm_err_already_ruled', 'That motion has already been ruled on.'],
    already_resolved: ['cm_err_already_resolved', 'This case has already been resolved.']
  };
  function errText(res) { var e = ERR[res && res.reason] || ERR.error; return T(e[0], e[1]); }
  function chip(cls, label) { return '<span class="mdt-chip ' + cls + '">' + esc(label) + '</span>'; }
  function pagehead(title, sub, actionHtml) {
    return '<div class="mdt-pagehead"><div><h1>' + esc(title) + '</h1><p>' + esc(sub || '') + '</p></div><div>' + (actionHtml || '') + '</div></div>';
  }
  function errBox() { return M.error ? '<div class="mdt-err">' + esc(M.error) + '</div>' : ''; }
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '').toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
  }

  var STATUS_LABEL = {
    awaiting_assignment: ['cm_status_awaiting', 'Awaiting Assignment'],
    ready: ['cm_status_ready', 'Ready to Schedule'],
    scheduled: ['cm_status_scheduled', 'Scheduled'],
    resolved: ['cm_status_resolved', 'Resolved']
  };
  function statusLabel(s) { var e = STATUS_LABEL[s] || ['cm_status_unknown', s || '—']; return T(e[0], e[1]); }

  var M;
  function fresh() {
    M = { loading: false, error: '', boot: null, cases: [], casesLoaded: false, cur: null, curId: null };
  }
  fresh();

  function boot(cb) {
    api('boot').then(function (res) {
      if (!res.ok) { M.error = errText(res); render(); return; }
      M.boot = res.data;
      if (cb) cb();
    });
  }
  function loadCases() {
    M.loading = true; render();
    api('casesList').then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.cases = res.data.cases || []; M.casesLoaded = true; M.error = '';
      render();
    });
  }
  function openCase(id) {
    M.loading = true; M.filePicker = null; render();
    api('courtCaseGet', { id: id }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.cur = res.data; M.curId = id; M.error = '';
      render();
    });
  }
  function refreshCase() { if (M.curId) openCase(M.curId); }

  function signOn(role) {
    if (!M.curId) return;
    M.loading = true; render();
    api('courtSignOn', { id: M.curId, role: role }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function addWitness() {
    var nameEl = $('cm-w-name'), noteEl = $('cm-w-note');
    var name = nameEl && nameEl.value.trim();
    if (!name || !M.curId) return;
    api('courtWitnessAdd', { id: M.curId, name: name, note: noteEl ? noteEl.value.trim() : '' }).then(function (res) {
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function deleteWitness(id) {
    api('courtWitnessDelete', { witnessId: id }).then(function (res) {
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function saveNotes() {
    var el = $('cm-notes');
    if (!el || !M.curId) return;
    api('courtNotesSave', { id: M.curId, text: el.value }).then(function (res) {
      if (!res.ok) { M.error = errText(res); return render(); }
      M.error = '';
    });
  }
  // "Attach from File Explorer": lets a solicitor pull in a text file they already wrote
  // (Documents, their job folder, or the court folder) instead of retyping it into Case Notes.
  // Picking one overwrites the notes textarea and saves immediately, same as typing + Save Notes.
  function openFilePicker() {
    M.filePicker = { loading: true, files: [] };
    render();
    api('courtFilesList').then(function (res) {
      M.filePicker = { loading: false, files: (res.ok && res.data.files) || [] };
      render();
    });
  }
  function closeFilePicker() { M.filePicker = null; render(); }
  function pickFile(id) {
    if (!M.curId) return;
    M.filePicker = null;
    M.loading = true; render();
    api('courtNotesImport', { id: M.curId, fileId: id }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.error = '';
      refreshCase();
    });
  }
  function toggleDisclose() {
    if (!M.curId) return;
    M.loading = true; render();
    api('courtDisclose', { id: M.curId }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function fileMotion() {
    var el = $('cm-motion-text');
    var text = el && el.value.trim();
    if (!text || !M.curId) return;
    M.loading = true; render();
    api('courtMotionFile', { id: M.curId, text: text }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function ruleMotion(motionId, approve) {
    M.loading = true; render();
    api('courtMotionRule', { motionId: motionId, approve: approve, rulingText: '' }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase();
    });
  }
  function setSchedule() {
    var roomEl = $('cm-sch-room'), dateEl = $('cm-sch-date'), timeEl = $('cm-sch-time');
    if (!M.curId || !dateEl || !dateEl.value) return;
    var when = new Date(dateEl.value + 'T' + (timeEl && timeEl.value ? timeEl.value : '12:00'));
    if (isNaN(when.getTime())) return;
    M.loading = true; render();
    api('courtScheduleSet', { id: M.curId, courtroom: roomEl ? roomEl.value.trim() : '', court_date: Math.floor(when.getTime() / 1000) }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase(); loadCases();
    });
  }
  function finalizeVerdict(verdict) {
    var minsEl = $('cm-v-mins'), fineEl = $('cm-v-fine'), sumEl = $('cm-v-summary');
    if (!M.curId) return;
    M.loading = true; render();
    api('courtVerdictFinalize', {
      id: M.curId, verdict: verdict,
      sentence_minutes: minsEl ? minsEl.value : 0, fine: fineEl ? fineEl.value : 0,
      summary: sumEl ? sumEl.value : ''
    }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      refreshCase(); loadCases();
    });
  }

  // ------------------------------------------------------------------ markup
  var HTML =
    '<div class="mdt" id="cm">' +
    '<div class="mdt-cmdbar">' +
    '<div class="mdt-brand">' + BRAND_SVG + '<div><b>' + esc(T('cm_app_name', 'Court MDT')) + '</b><span>' + esc(T('cm_records', 'Judiciary')) + '</span></div></div>' +
    '<div class="mdt-div"></div>' +
    '<div class="mdt-user" id="cm-user"></div>' +
    '</div>' +
    '<div class="mdt-main"><div class="mdt-body" id="cm-body"></div></div></div>';

  function renderUser() {
    var u = $('cm-user'); if (!u) return;
    var o = M.boot && M.boot.officer;
    u.innerHTML = o
      ? '<div class="mdt-ava">' + esc(initials(o.name)) + '</div><div><b>' + esc(o.name) + '</b><span><span class="mdt-dot"></span>' + esc(o.jobLabel || o.job) + '</span></div>'
      : '<div class="mdt-ava">--</div><div><b>' + esc(T('cm_loading', 'Loading…')) + '</b></div>';
  }

  function caseBadges(c) {
    var b = '';
    if (c.status === 'resolved') b += chip('plain', statusLabel(c.status));
    else if (c.status === 'scheduled') b += chip('active', statusLabel(c.status));
    else if (c.status === 'ready') b += chip('amber', statusLabel(c.status));
    else b += chip('plain', statusLabel(c.status));
    return b;
  }

  function renderList() {
    var body = $('cm-body');
    var listHtml;
    if (M.loading && !M.cases.length) listHtml = '<div class="mdt-empty">' + esc(T('cm_loading', 'Loading…')) + '</div>';
    else if (!M.cases.length) listHtml = '<div class="mdt-empty">' + esc(T('cm_no_cases', 'No open court cases.')) + '</div>';
    else listHtml = M.cases.map(function (c) {
      var on = M.curId != null && String(M.curId) === String(c.id);
      return '<div class="mdt-srow' + (on ? ' on' : '') + '" data-case="' + esc(String(c.id)) + '"><div class="t1"><span>' +
        esc((c.case_number || ('#' + c.id)) + ' — ' + (c.suspect_name || T('cm_unknown_defendant', 'Unknown'))) + '</span>' + caseBadges(c) + '</div>' +
        '<div class="t2">' + esc(T('cm_submitted', 'Submitted')) + ' ' + esc(c.submitted_at || '') + '</div></div>';
    }).join('');

    body.innerHTML = pagehead(T('cm_nav_cases', 'Court Cases'), T('cm_cases_sub', 'Cases sent to court, awaiting a judge, prosecution and defence')) +
      errBox() +
      '<div class="mdt-split">' +
      '<div class="mdt-split-list"><div class="mdt-split-rows">' + listHtml + '</div></div>' +
      '<div class="mdt-split-detail">' + (M.cur ? renderCaseDetail() : '<div class="mdt-empty-detail">' + esc(T('cm_select_case', 'Select a case')) + '</div>') + '</div>' +
      '</div>';
  }

  function roleSeat(label, name, roleKey, myRole) {
    var filled = !!name;
    var mine = myRole === roleKey;
    var btn = filled
      ? '<span class="mdt-chip plain">' + esc(mine ? T('cm_thats_you', 'That’s you') : T('cm_signed_on', 'Signed on')) + '</span>'
      : (myRole ? '' : '<button type="button" class="mdt-btn" data-signon="' + roleKey + '">' + esc(T('cm_sign_on', 'Sign On')) + '</button>');
    return '<div class="mdt-row"><div style="flex-grow:1"><b>' + esc(label) + '</b><div class="t2">' + esc(filled ? name : T('cm_awaiting_signon', 'Awaiting sign-on')) + '</div></div>' + btn + '</div>';
  }

  function renderCaseDetail() {
    var c = M.cur.case, role = M.cur.myRole;
    var html = '<div class="mdt-dhead"><div class="badges">' + (c.case_number ? chip('plain', c.case_number) : '') + caseBadges(c) + '</div>' +
      '<h2>' + esc(c.suspect_name || T('cm_unknown_defendant', 'Unknown')) + '</h2>' +
      '<div class="mdt-dmeta">' +
      (c.courtroom ? '<div>' + esc(T('cm_courtroom', 'Courtroom')) + '<b>' + esc(c.courtroom) + '</b></div>' : '') +
      (c.court_date ? '<div>' + esc(T('cm_court_date', 'Court Date')) + '<b>' + esc(c.court_date) + '</b></div>' : '') +
      '</div></div><div class="mdt-dbody">';

    html += '<h4 class="mdt-sec">' + esc(T('cm_role_signon', 'Role Sign-On')) + '</h4>';
    html += roleSeat(T('cm_role_judge', 'Judge'), c.judge_name, 'judge', role);
    html += roleSeat(T('cm_role_prosecution', 'Prosecution'), c.prosecution_name, 'prosecution', role);
    html += roleSeat(T('cm_role_defense', 'Defence'), c.defense_name, 'defense', role);

    if (!role) {
      html += '<div class="mdt-empty">' + esc(T('cm_not_signed_on', 'Sign on to a role above to see this case’s workspace.')) + '</div></div>';
      return html;
    }

    if (role === 'prosecution' || role === 'defense') {
      var mineDisclosed = role === 'prosecution' ? c.prosecutionDisclosed : c.defenseDisclosed;
      var otherDisclosed = role === 'prosecution' ? c.defenseDisclosed : c.prosecutionDisclosed;
      html += '<h4 class="mdt-sec">' + esc(T('cm_my_notes', 'My Case Notes')) + '</h4>';
      html += '<textarea id="cm-notes" class="mdt-ta"' + (mineDisclosed ? ' disabled' : '') + ' placeholder="' + esc(T('cm_notes_ph', 'Draft your argument here — private until you disclose.')) + '">' + esc(M.cur.myNotes || '') + '</textarea>';
      if (!mineDisclosed) {
        html += '<div class="mdt-actions"><button type="button" class="mdt-btn pri" data-a="save-notes">' + esc(T('cm_save_notes', 'Save Notes')) + '</button>' +
          '<button type="button" class="mdt-btn" data-a="attach-file">' + esc(T('cm_attach_file', 'Attach from File Explorer')) + '</button></div>';
        if (M.filePicker) {
          html += '<div class="mdt-ac-list" style="position:static;display:block;margin-top:.4rem">';
          if (M.filePicker.loading) {
            html += '<div class="t2" style="padding:.5rem">' + esc(T('cm_loading', 'Loading…')) + '</div>';
          } else if (!M.filePicker.files.length) {
            html += '<div class="t2" style="padding:.5rem">' + esc(T('cm_no_text_files', 'No text files found in your Documents, job folder or Court Files.')) + '</div>';
          } else {
            html += M.filePicker.files.map(function (f) {
              return '<div class="mdt-ac-opt" data-file-pick="' + f.id + '">' + esc(f.name) +
                '<span>' + esc(f.place || '') + '</span></div>';
            }).join('');
          }
          html += '<div class="mdt-actions" style="padding:.4rem"><button type="button" class="mdt-btn" data-a="cancel-attach">' + esc(T('cm_cancel', 'Cancel')) + '</button></div>';
          html += '</div>';
        }
        html += '<div class="t2" style="margin-top:.3rem">' + esc(T('cm_attach_hint', 'Attaching a file replaces your notes above with that file’s text and saves it.')) + '</div>';
      }

      html += '<h4 class="mdt-sec">' + esc(T('cm_opposing_side', 'Opposing Side')) + '</h4>';
      html += otherDisclosed
        ? '<div class="mdt-narrative">' + esc(M.cur.otherNotes || '—') + '</div>'
        : '<div class="mdt-empty">' + esc(T('cm_other_hidden', 'Hidden until they disclose.')) + '</div>';

      html += '<h4 class="mdt-sec">' + esc(T('cm_witnesses', 'My Witness List')) + '</h4>';
      var myWitnesses = (M.cur.witnesses || []).filter(function (w) { return w.side === role; });
      html += '<div class="mdt-notes">' + (myWitnesses.length ? myWitnesses.map(function (w) {
        return '<div class="mdt-note"><b>' + esc(w.name) + '</b>' + (w.note ? ' — ' + esc(w.note) : '') +
          (mineDisclosed ? '' : ' <button type="button" class="mdt-btn" style="height:1.6rem;padding:0 .5rem;margin-left:.5rem" data-del-witness="' + w.id + '">' + esc(T('cm_remove', 'Remove')) + '</button>') + '</div>';
      }).join('') : '<div class="t2">' + esc(T('cm_no_witnesses', 'No witnesses added yet.')) + '</div>') + '</div>';
      if (!mineDisclosed) {
        html += '<div class="mdt-photoform"><input class="mdt-inp" id="cm-w-name" placeholder="' + esc(T('cm_witness_name_ph', 'Witness name')) + '">' +
          '<input class="mdt-inp" id="cm-w-note" placeholder="' + esc(T('cm_witness_note_ph', 'What they’ll testify to')) + '">' +
          '<button type="button" class="mdt-btn" data-a="add-witness">' + esc(T('cm_add', 'Add')) + '</button></div>';
      }

      var otherWitnesses = (M.cur.witnesses || []).filter(function (w) { return w.side !== role; });
      if (otherDisclosed && otherWitnesses.length) {
        html += '<h4 class="mdt-sec">' + esc(T('cm_other_witnesses', 'Opposing Witness List')) + '</h4>';
        html += '<div class="mdt-notes">' + otherWitnesses.map(function (w) {
          return '<div class="mdt-note"><b>' + esc(w.name) + '</b>' + (w.note ? ' — ' + esc(w.note) : '') + '</div>';
        }).join('') + '</div>';
      }

      html += '<div class="mdt-actions"><button type="button" class="mdt-btn' + (mineDisclosed ? '' : ' pri') + '" data-a="toggle-disclose">' +
        esc(mineDisclosed ? T('cm_undisclose', 'Un-Disclose') : T('cm_disclose', 'Disclose to Other Side')) + '</button></div>';
      html += '<div class="t2" style="margin-top:.4rem">' + esc(T('cm_disclose_hint', 'Disclosing shows your notes and witnesses to the other side and locks them. Un-disclosing re-locks both sides.')) + '</div>';
    }

    html += '<h4 class="mdt-sec">' + esc(T('cm_motions', 'Motions')) + '</h4>';
    var motions = M.cur.motions || [];
    html += '<div class="mdt-notes">' + (motions.length ? motions.map(function (m) {
      var badge = m.status === 'pending' ? chip('amber', T('cm_pending', 'Pending')) : m.status === 'approved' ? chip('active', T('cm_approved', 'Approved')) : chip('plain', T('cm_denied', 'Denied'));
      var ruleBtns = (role === 'judge' && m.status === 'pending')
        ? '<div class="mdt-actions"><button type="button" class="mdt-btn" data-motion-approve="' + m.id + '">' + esc(T('cm_approve', 'Approve')) + '</button>' +
          '<button type="button" class="mdt-btn" data-motion-deny="' + m.id + '">' + esc(T('cm_deny', 'Deny')) + '</button></div>' : '';
      return '<div class="mdt-note"><div style="display:flex;justify-content:space-between;gap:.5rem"><b>' + esc(m.filed_by_name) + '</b>' + badge + '</div>' +
        '<div class="t2" style="margin:.3rem 0">' + esc(m.text) + '</div>' + ruleBtns + '</div>';
    }).join('') : '<div class="t2">' + esc(T('cm_no_motions', 'No motions filed.')) + '</div>') + '</div>';
    if (role === 'prosecution' || role === 'defense') {
      html += '<div class="mdt-photoform"><textarea class="mdt-ta" id="cm-motion-text" style="min-height:70px" placeholder="' + esc(T('cm_motion_ph', 'Describe the motion you’re filing to the judge')) + '"></textarea></div>';
      html += '<div class="mdt-actions"><button type="button" class="mdt-btn" data-a="file-motion">' + esc(T('cm_file_motion', 'Submit to Judge')) + '</button></div>';
    }

    if (role === 'judge' && c.status === 'ready') {
      html += '<h4 class="mdt-sec">' + esc(T('cm_schedule', 'Schedule Court Date')) + '</h4>';
      html += '<label class="mdt-field">' + esc(T('cm_courtroom_field', 'Courtroom')) + '</label><input class="mdt-inp" id="cm-sch-room" placeholder="Courtroom 1">';
      html += '<div style="display:flex;gap:.5rem;margin-top:.6rem"><input class="mdt-inp" id="cm-sch-date" type="date"><input class="mdt-inp" id="cm-sch-time" type="time" value="12:00"></div>';
      html += '<div class="mdt-actions"><button type="button" class="mdt-btn pri" data-a="set-schedule">' + esc(T('cm_confirm_date', 'Confirm Court Date')) + '</button></div>';
    }

    if (role === 'judge' && (c.status === 'scheduled' || c.status === 'ready')) {
      html += '<h4 class="mdt-sec">' + esc(T('cm_verdict', 'Verdict')) + '</h4>';
      html += '<label class="mdt-field">' + esc(T('cm_sentence_mins', 'Sentence (minutes)')) + '</label><input class="mdt-inp" id="cm-v-mins" type="number" min="0" value="0">';
      html += '<label class="mdt-field">' + esc(T('cm_fine_field', 'Fine ($)')) + '</label><input class="mdt-inp" id="cm-v-fine" type="number" min="0" value="0">';
      html += '<label class="mdt-field">' + esc(T('cm_summary_field', 'Summary for the Record')) + '</label><textarea class="mdt-ta" id="cm-v-summary" style="min-height:90px"></textarea>';
      html += '<div class="mdt-actions"><button type="button" class="mdt-btn" data-a="verdict-guilty">' + esc(T('cm_verdict_guilty', 'GUILTY')) + '</button>' +
        '<button type="button" class="mdt-btn" data-a="verdict-notguilty">' + esc(T('cm_verdict_notguilty', 'NOT GUILTY')) + '</button></div>';
    }

    if (c.status === 'resolved') {
      html += '<h4 class="mdt-sec">' + esc(T('cm_verdict', 'Verdict')) + '</h4>';
      html += '<div class="mdt-narrative"><b>' + esc(c.verdict === 'guilty' ? T('cm_verdict_guilty', 'GUILTY') : T('cm_verdict_notguilty', 'NOT GUILTY')) + '</b>' +
        (c.sentence_minutes ? ' — ' + esc(c.sentence_minutes) + ' ' + esc(T('cm_minutes', 'minutes')) : '') +
        (c.fine ? ' — $' + esc(c.fine) : '') +
        (c.summary ? '<br>' + esc(c.summary) : '') + '</div>';
    }

    html += '</div>';
    return html;
  }

  function render() {
    if (!$('cm')) return;
    renderUser();
    renderList();
  }

  var bound = false;
  function bind() {
    if (bound || !$('cm')) return;
    bound = true;
    $('cm').addEventListener('click', function (e) {
      var sp = e.target.closest('[data-case]'); if (sp) return openCase(+sp.dataset.case);
      var so = e.target.closest('[data-signon]'); if (so) return signOn(so.dataset.signon);
      var dw = e.target.closest('[data-del-witness]'); if (dw) return deleteWitness(+dw.dataset.delWitness);
      var ma = e.target.closest('[data-motion-approve]'); if (ma) return ruleMotion(+ma.dataset.motionApprove, true);
      var md = e.target.closest('[data-motion-deny]'); if (md) return ruleMotion(+md.dataset.motionDeny, false);
      var fp = e.target.closest('[data-file-pick]'); if (fp) return pickFile(+fp.dataset.filePick);
      var a = e.target.closest('[data-a]');
      if (a) {
        var act = a.dataset.a;
        if (act === 'save-notes') return saveNotes();
        if (act === 'attach-file') return openFilePicker();
        if (act === 'cancel-attach') return closeFilePicker();
        if (act === 'add-witness') return addWitness();
        if (act === 'toggle-disclose') return toggleDisclose();
        if (act === 'file-motion') return fileMotion();
        if (act === 'set-schedule') return setSchedule();
        if (act === 'verdict-guilty') return finalizeVerdict('guilty');
        if (act === 'verdict-notguilty') return finalizeVerdict('not_guilty');
      }
    });
  }

  var root = S.registerApp({
    id: 'courtmdt', icon: ICON_APP, titleKey: 'cm_app_name', titleDef: 'Court MDT', w: 1180, h: 720, html: HTML,
    onOpen: function () {
      bind();
      if (!M.boot) boot(function () { loadCases(); });
      else render();
    },
    onClose: function () {},
    onReset: function () { fresh(); if ($('cm')) render(); },
    onLocale: function () { render(); }
  });
  if (root) bind();
})();
