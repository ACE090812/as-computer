/* MDT app for Los Santos OS: police mobile data terminal (Dashboard, People, Vehicles, Reports, BOLOs).
   Registers itself with LSOS.registerApp. Every call goes through the 'mdtApi' NUI callback
   (client/mdt.lua -> server/mdt.lua).

   Layout: a top command bar (brand + nav tabs + officer) replaces the old left sidebar; People,
   Vehicles, Reports and BOLOs use a master-detail split view (record list on the left, full
   detail/editor on the right) instead of separate list/detail pages. Dashboard uses a small
   "briefing strip" instead of a stat-tile grid. Still no framework: render() functions rebuild
   fixed DOM containers from state, same as notepad.js. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#2c53a8"/><path d="M12 5 6.5 7.7v3.6c0 3.9 2.5 6.7 5.5 7.7 3-1 5.5-3.8 5.5-7.7V7.7z" fill="#fff"/></svg>';
  var BRAND_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 4 5.5v5c0 5.6 3.4 9.4 8 11 4.6-1.6 8-5.4 8-11v-5z" fill="#2c53a8" stroke="#0a0d12" stroke-width="1"/></svg>';

  var ICN = {
    dashboard: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z" fill="currentColor" stroke="none"/>',
    people: '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-4 3.2-6.5 7-6.5S19 16 19 20"/>',
    vehicles: '<path d="M4 16 5.5 9.5A2 2 0 0 1 7.4 8h9.2a2 2 0 0 1 1.9 1.5L20 16M4 16h16M4 16v3h2v-3m12 0v3h2v-3"/><circle cx="7.5" cy="16" r="1.4"/><circle cx="16.5" cy="16" r="1.4"/>',
    reports: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>',
    bolos: '<path d="M12 2 3 6v6c0 5.5 4 9.7 9 11 5-1.3 9-5.5 9-11V6z"/><path d="M9 12l2 2 4-4"/>'
  };
  var NAV = [
    { key: 'dashboard', label: 'md_nav_dashboard', def: 'Dashboard' },
    { key: 'people', label: 'md_nav_people', def: 'People' },
    { key: 'vehicles', label: 'md_nav_vehicles', def: 'Vehicles' },
    { key: 'reports', label: 'md_nav_reports', def: 'Reports' },
    { key: 'bolos', label: 'md_nav_bolos', def: 'BOLOs' }
  ];

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/mdtApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  var ERR = {
    not_authorised: ['md_err_not_authorised', 'You are not authorised to use the MDT.'],
    invalid: ['md_err_invalid', 'That could not be saved.'],
    not_found: ['md_err_not_found', 'Not found.'],
    network: ['md_err_network', 'Could not reach the server.'],
    error: ['md_err_error', 'Something went wrong.'],
    case_not_found: ['md_err_case_not_found', 'No existing case with that number — leave blank to start a new one, or check the number and try again.'],
    no_suspect: ['md_err_no_suspect', 'This report has no suspect to jail.'],
    invalid_time: ['md_err_invalid_time', 'Enter a jail time above zero.'],
    offline: ['md_err_offline', 'The suspect must be online to jail them.'],
    jail_unavailable: ['md_err_jail_unavailable', 'The jail system is not running on this server.'],
    jail_failed: ['md_err_jail_failed', 'Could not jail the suspect — check the server console.'],
    sent_to_court: ['md_err_sent_to_court', 'This case has been sent to court — it cannot be jailed directly.'],
    already_jailed: ['md_err_already_jailed', 'This suspect has already been jailed for this report.'],
    already_sent_to_court: ['md_err_already_sent_to_court', 'This report has already been sent to court.'],
    no_evidences: ['md_err_no_evidences', 'The evidences resource is not running.'],
    unknown_code: ['md_err_unknown_code', "That sample is no longer in your inventory — reopen the picker and try again."]
  };
  function errText(res) { var e = ERR[res && res.reason] || ERR.error; return T(e[0], e[1]); }

  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/);
    return ((parts[0] || '')[0] || '').toUpperCase() + ((parts[1] || '')[0] || '').toUpperCase();
  }
  function stamp(v) {
    if (!v) return '';
    var d = new Date(String(v).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function chip(cls, label) { return '<span class="mdt-chip ' + cls + '">' + esc(label) + '</span>'; }

  var M;
  function fresh() {
    M = {
      view: 'dashboard', loading: false, error: '', boot: null,
      dash: null,
      peopleQ: '', people: [], peopleLoaded: false, personCur: null,
      vehQ: '', vehicles: [], vehiclesLoaded: false, vehicleCur: null,
      reports: [], reportsLoaded: false, reportCur: null, reportEdit: null, reportCaseErr: '',
      bolos: [], bolosLoaded: false, boloNew: null, boloCtx: null,
      confirmDel: false, evidencePicker: null, phonePicker: null, bioPicker: null
    };
  }
  fresh();

  // ------------------------------------------------------------------ data loaders
  function boot(cb) {
    api('boot').then(function (res) {
      if (!res.ok) { M.error = errText(res); render(); return; }
      M.boot = res.data;
      if (cb) cb();
    });
  }
  function loadDashboard() {
    M.loading = true; render();
    api('dashboard').then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.dash = res.data; M.error = '';
      render();
    });
  }
  function loadPeople() {
    M.loading = true; render();
    api('peopleSearch', { query: M.peopleQ }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.people = res.data.people || []; M.peopleLoaded = true; M.error = '';
      render();
    });
  }
  function openPerson(cid) {
    M.loading = true; render();
    api('personGet', { cid: cid }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.personCur = res.data.person; M.error = ''; M.confirmDel = false; M.bioPicker = null;
      render();
    });
  }
  function toggleBioPicker(type) {
    if (M.bioPicker && M.bioPicker.type === type) { M.bioPicker = null; return render(); }
    M.bioPicker = { type: type, samples: null }; render();
    api('personLinkBiometric', { mode: 'list', type: type }).then(function (res) {
      if (!M.bioPicker || M.bioPicker.type !== type) return; // closed / switched before this returned
      if (!res.ok) { M.error = errText(res); M.bioPicker = null; return render(); }
      M.bioPicker.samples = res.data.samples || [];
      render();
    });
  }
  function pickBio(code) {
    if (!M.personCur || !M.bioPicker) return;
    var type = M.bioPicker.type;
    M.loading = true; render();
    api('personLinkBiometric', { mode: 'link', type: type, cid: M.personCur.cid, code: code }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.personCur = res.data.person;
      M.bioPicker = null;
      render();
    });
  }
  function toggleEvidencePicker() {
    if (M.evidencePicker) { M.evidencePicker = null; return render(); }
    M.evidencePicker = []; render();
    api('evidenceUnlinked').then(function (res) {
      if (!res.ok) { M.error = errText(res); M.evidencePicker = null; return render(); }
      M.evidencePicker = res.data.folders || [];
      render();
    });
  }
  function pickEvidence(folderId) {
    if (!M.reportCur || !M.reportCur.case_number) return;
    M.loading = true; render();
    api('evidenceLink', { folderId: folderId, case_number: M.reportCur.case_number }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.evidence = res.data.evidence || [];
      M.evidencePicker = null;
      render();
    });
  }
  function unlinkEvidence(folderId) {
    if (!M.reportCur) return;
    M.loading = true; render();
    api('evidenceUnlink', { folderId: folderId, case_number: M.reportCur.case_number }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.evidence = res.data.evidence || [];
      render();
    });
  }
  function addReportAttachment() {
    var el = $('mdt-r-attachurl'), val = el && el.value.trim();
    if (!val || !M.reportCur || !M.reportCur.case_number) return;
    M.loading = true; render();
    api('reportAttachmentAdd', { case_number: M.reportCur.case_number, url: val }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.attachments = res.data.attachments || [];
      render();
    });
  }
  function deleteReportAttachment(id) {
    if (!M.reportCur || !M.reportCur.case_number) return;
    M.loading = true; render();
    api('reportAttachmentDelete', { id: id, case_number: M.reportCur.case_number }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.attachments = res.data.attachments || [];
      render();
    });
  }
  function togglePhonePicker() {
    if (M.phonePicker) { M.phonePicker = null; return render(); }
    M.phonePicker = []; render();
    api('reportPhoneList').then(function (res) {
      if (!res.ok) { M.error = errText(res); M.phonePicker = null; return render(); }
      M.phonePicker = res.data.photos || [];
      render();
    });
  }
  function importPhonePhoto(id) {
    if (!M.reportCur || !M.reportCur.case_number) return;
    M.loading = true; render();
    api('reportPhoneImport', { case_number: M.reportCur.case_number, ids: [id] }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.attachments = res.data.attachments || [];
      if (M.phonePicker) M.phonePicker = M.phonePicker.filter(function (p) { return p.id !== id; });
      render();
    });
  }
  function jailSuspect() {
    if (!M.reportCur) return;
    var el = $('mdt-r-jailmins'), mins = el && parseInt(el.value, 10);
    if (!mins || mins <= 0) { M.error = errText({ reason: 'invalid_time' }); return render(); }
    M.loading = true; render();
    api('reportJailSuspect', { id: M.reportCur.id, minutes: mins }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.jailed_at = res.data.jailedAt;
      render();
    });
  }
  function sendToCourt() {
    if (!M.reportCur) return;
    M.loading = true; render();
    api('reportSendToCourt', { id: M.reportCur.id }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur.courtCase = res.data.courtCase;
      render();
    });
  }
  function loadVehicles() {
    M.loading = true; render();
    api('vehicleSearch', { query: M.vehQ }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.vehicles = res.data.vehicles || []; M.vehiclesLoaded = true; M.error = '';
      render();
    });
  }
  function openVehicle(plate) {
    M.loading = true; render();
    api('vehicleGet', { plate: plate }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.vehicleCur = res.data.vehicle; M.error = '';
      render();
    });
  }
  function loadReports() {
    M.loading = true; render();
    api('reportsList').then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reports = res.data.reports || []; M.reportsLoaded = true; M.error = '';
      render();
    });
  }
  function openReport(id) {
    M.loading = true; render();
    api('reportGet', { id: id }).then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.reportCur = res.data.report; M.reportEdit = null; M.error = ''; M.confirmDel = false; M.reportCaseErr = ''; M.evidencePicker = null; M.phonePicker = null;
      ensureCharges(render);
      render();
    });
  }
  function loadBolos() {
    M.loading = true; render();
    api('bolosList').then(function (res) {
      M.loading = false;
      if (!res.ok) { M.error = errText(res); return render(); }
      M.bolos = res.data.bolos || []; M.bolosLoaded = true; M.error = '';
      render();
    });
  }

  function go(view) {
    M.view = view; M.error = ''; M.confirmDel = false;
    if (M.boloCtx) { M.boloCtx = null; renderBoloCtxMenu(); }
    if (view === 'dashboard') loadDashboard();
    else if (view === 'people') { M.personCur = null; if (!M.peopleLoaded) loadPeople(); else render(); }
    else if (view === 'vehicles') { M.vehicleCur = null; if (!M.vehiclesLoaded) loadVehicles(); else render(); }
    else if (view === 'reports') { M.reportCur = null; M.reportEdit = null; M.reportCaseErr = ''; if (!M.reportsLoaded) loadReports(); else render(); }
    else if (view === 'bolos') { M.boloNew = null; if (!M.bolosLoaded) loadBolos(); else render(); }
    else render();
  }

  // ------------------------------------------------------------------ markup
  var HTML =
    '<div class="mdt" id="mdt">' +
    '<div class="mdt-cmdbar">' +
    '<div class="mdt-brand">' + BRAND_SVG + '<div><b>MDT</b><span>' + esc(T('md_records', 'Records')) + '</span></div></div>' +
    '<div class="mdt-div"></div>' +
    '<div class="mdt-tabs" id="mdt-navlist"></div>' +
    '<div class="mdt-user" id="mdt-user"></div>' +
    '</div>' +
    '<div class="mdt-main"><div class="mdt-body" id="mdt-body"></div></div></div>';

  function renderUser() {
    var u = $('mdt-user'); if (!u) return;
    var o = M.boot && M.boot.officer;
    u.innerHTML = o
      ? '<div class="mdt-ava">' + esc(initials(o.name)) + '</div><div><b>' + esc(o.name) + '</b><span><span class="mdt-dot"></span>' + esc(o.jobLabel || o.job) + '</span></div>'
      : '<div class="mdt-ava">--</div><div><b>' + esc(T('md_loading_officer', 'Loading…')) + '</b></div>';
  }
  function renderNav() {
    var l = $('mdt-navlist'); if (!l) return;
    l.innerHTML = NAV.map(function (n) {
      return '<button type="button" class="mdt-ni' + (M.view === n.key ? ' on' : '') + '" data-nav="' + n.key + '">' +
        '<svg viewBox="0 0 24 24">' + ICN[n.key] + '</svg>' + esc(T(n.label, n.def)) + '</button>';
    }).join('');
  }
  function pagehead(title, sub, actionHtml) {
    return '<div class="mdt-pagehead"><div><h1>' + esc(title) + '</h1><p>' + esc(sub || '') + '</p></div><div>' + (actionHtml || '') + '</div></div>';
  }
  function errBox() {
    return M.error ? '<div class="mdt-err">' + esc(M.error) + '</div>' : '';
  }

  // ---- dashboard ----
  function renderDashboard() {
    var d = M.dash;
    var html = errBox();
    if (!d) { $('mdt-body').innerHTML = html + (M.loading ? '<div class="mdt-empty">' + esc(T('md_loading', 'Loading…')) + '</div>' : ''); return; }
    html += '<div class="mdt-brief">' +
      '<div class="mdt-brief-main"><div><div class="num">' + d.onDutyCount + '</div><div class="lbl">' + esc(T('md_on_duty', 'On duty')) + '</div></div>' +
      '<div class="mdt-brief-sep"></div><div class="mdt-brief-mini"><b>' + d.reportCount + '</b><span>' + esc(T('md_open_reports', 'Reports')) + '</span></div>' +
      '<div class="mdt-brief-sep"></div><div class="mdt-brief-mini"><b>' + d.boloCount + '</b><span>' + esc(T('md_active_bolos', 'Active BOLOs')) + '</span></div></div>';
    var lead = d.activeBolos && d.activeBolos[0];
    html += lead
      ? '<div class="mdt-brief-side"><div class="tag">' + esc(T('md_active_bolo', 'Active BOLO')) + '</div><b>' + esc(lead.plate) + ' — ' + esc(lead.title) + '</b><span>' + esc(stamp(lead.created_at)) + '</span></div>'
      : '<div class="mdt-brief-side"><div class="tag" style="color:#8b909b">' + esc(T('md_active_bolo', 'Active BOLO')) + '</div><b>' + esc(T('md_none', 'None')) + '</b><span>' + esc(T('md_no_bolos', 'No active BOLOs.')) + '</span></div>';
    html += '</div>';
    html += '<div class="mdt-sec">' + esc(T('md_recent_reports', 'Recent reports')) + '</div>';
    html += d.recentReports.length ? d.recentReports.map(function (r) {
      return '<div class="mdt-row clk" data-goto-report="' + r.id + '"><div class="ic">📄</div><div><div class="tn">' + esc(r.title) + '</div>' +
        '<div class="ts">' + esc(T('md_filed_by', 'Filed by')) + ' ' + esc(r.author_name) + ' · ' + esc(stamp(r.created_at)) + '</div></div></div>';
    }).join('') : '<div class="mdt-empty">' + esc(T('md_no_reports', 'No reports yet.')) + '</div>';
    $('mdt-body').innerHTML = html;
  }

  // ------------------------------------------------------------------ generic split view
  // Renders a master-detail split: a searchable record list on the left, a detail/editor
  // pane on the right. `spec` supplies everything view-specific.
  function renderSplit(spec) {
    var body = $('mdt-body');
    var listHtml = '';
    if (M.loading && !spec.list.length) listHtml = '<div class="mdt-empty">' + esc(T('md_loading', 'Loading…')) + '</div>';
    else if (!spec.list.length) listHtml = '<div class="mdt-empty">' + esc(T('md_no_matches', 'No matches.')) + '</div>';
    else listHtml = spec.list.map(function (item) {
      var id = spec.idOf(item);
      var on = spec.curId != null && String(spec.curId) === String(id);
      return '<div class="mdt-srow' + (on ? ' on' : '') + '" data-split="' + esc(String(id)) + '"><div class="t1"><span>' + esc(spec.titleOf(item)) + '</span>' + (spec.badgeOf ? spec.badgeOf(item) : '') + '</div>' +
        '<div class="t2">' + esc(spec.subOf(item)) + '</div></div>';
    }).join('');

    var searchRow = '<div class="mdt-split-search" style="display:flex;gap:.4rem">' +
      '<input id="' + spec.searchId + '" type="text" autocomplete="off" placeholder="' + esc(spec.searchPh) + '" value="' + esc(spec.searchVal || '') + '" style="flex:1">' +
      (spec.newBtn || '') + '</div>';

    body.innerHTML = pagehead(spec.title, spec.sub) +
      '<div class="mdt-split">' +
      '<div class="mdt-split-list">' + searchRow + '<div class="mdt-split-rows">' + listHtml + '</div></div>' +
      '<div class="mdt-split-detail">' + (spec.detailHtml || '<div class="mdt-empty-detail">' + esc(T('md_select_record', 'Select a record')) + '</div>') + '</div>' +
      '</div>';
    var q = $(spec.searchId); if (q && spec.focusSearch) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  // ---- people ----
  function personBadges(p) {
    return (p.flagged ? chip('active', T('md_flagged', 'Flagged')) : '');
  }
  function renderPeopleView() {
    renderSplit({
      title: T('md_nav_people', 'People'), sub: T('md_people_sub', 'Search citizen records'),
      list: M.people, curId: M.personCur && M.personCur.cid,
      idOf: function (p) { return p.cid; }, titleOf: function (p) { return p.name; },
      subOf: function (p) { return T('md_dob', 'DOB') + ' ' + (p.dob || '—') + ' · ' + p.cid; },
      searchId: 'mdt-pq', searchPh: T('md_search_name', 'Search name or ID…'), searchVal: M.peopleQ, focusSearch: true,
      detailHtml: M.personCur ? renderPersonDetail(M.personCur) : null
    });
  }
  function renderPersonDetail(p) {
    var html = '<div class="mdt-dhead"><div class="mdt-phead-top"><div class="mdt-pavatar">' + esc(initials(p.name || p.cid)) + '</div>' +
      '<div><h2>' + esc(p.name || p.cid) + '</h2><div class="mdt-psub">' + esc(T('md_cid', 'CID')) + ' ' + esc(p.cid) + '</div></div></div>';
    html += '<div class="mdt-dmeta">' +
      '<div>' + esc(T('md_dob', 'DOB')) + '<b>' + esc(p.dob || '—') + '</b></div>' +
      '<div>' + esc(T('md_gender', 'Gender')) + '<b>' + esc(p.gender || '—') + '</b></div>' +
      '<div>' + esc(T('md_phone', 'Phone')) + '<b>' + esc(p.phone || '—') + '</b></div>' +
      '<div>' + esc(T('md_nationality', 'Nationality')) + '<b>' + esc(p.nationality || '—') + '</b></div>' +
      '</div></div>';
    html += '<div class="mdt-dbody">';

    if (p.biometrics || p.firearms) {
      html += '<h4>' + esc(T('md_biometric_data', 'Biometric data')) + '</h4>';
      html += '<div class="mdt-dmeta">' +
        '<div>' + esc(T('md_fingerprint', 'Fingerprint')) + '<b>' + esc((p.biometrics && p.biometrics.fingerprint) || T('md_unknown', 'Unknown')) + '</b></div>' +
        '<div>' + esc(T('md_dna', 'DNA')) + '<b>' + esc((p.biometrics && p.biometrics.dna) || T('md_unknown', 'Unknown')) + '</b></div>' +
        '</div>';

      html += '<div class="mdt-actions" style="margin-top:.5rem">' +
        '<button type="button" class="mdt-btn" data-a="bio-picker" data-type="fingerprint">' + esc((M.bioPicker && M.bioPicker.type === 'fingerprint') ? T('md_hide_bio_picker', 'Close') : T('md_link_fingerprint', '+ Link fingerprint')) + '</button>' +
        '<button type="button" class="mdt-btn" data-a="bio-picker" data-type="dna">' + esc((M.bioPicker && M.bioPicker.type === 'dna') ? T('md_hide_bio_picker', 'Close') : T('md_link_dna', '+ Link DNA')) + '</button></div>';

      if (M.bioPicker) {
        var bioLabel = M.bioPicker.type === 'dna' ? T('md_dna', 'DNA') : T('md_fingerprint', 'Fingerprint');
        html += '<div class="mdt-evidence-picker" style="margin-top:.4rem">';
        if (M.bioPicker.samples === null) {
          html += '<div class="mdt-empty">' + esc(T('md_loading', 'Loading…')) + '</div>';
        } else if (!M.bioPicker.samples.length) {
          html += '<div class="mdt-empty">' + esc(T('md_no_bio_samples', 'No analysed ' + bioLabel + ' samples in your inventory.')) + '</div>';
        } else {
          html += M.bioPicker.samples.map(function (s) {
            return '<div class="mdt-row clk" data-a="pick-bio" data-code="' + esc(s.code) + '"><div class="ic">🧬</div><div><div class="tn">' + esc(s.label) + '</div><div class="ts">' + esc(s.crimeScene || '') + '</div></div></div>';
          }).join('');
        }
        html += '</div>';
      }

      html += '<h4 style="margin-top:1.2rem">' + esc(T('md_registered_firearms', 'Registered firearms')) + '</h4>';
      html += (p.firearms && p.firearms.length) ? p.firearms.map(function (f) {
        return '<div class="mdt-row clk" data-open-firearm="' + esc(f.serial) + '"><div class="ic">🔫</div><div><div class="tn">' + esc(f.label) + '</div><div class="ts">' + esc(f.serial) + (f.status ? ' · ' + esc(f.status) : '') + '</div></div></div>';
      }).join('') : '<div class="mdt-empty">' + esc(T('md_none_on_file', 'None on file.')) + '</div>';
    }

    html += '<h4 style="margin-top:1.2rem">' + esc(T('md_suspect_reports', 'Suspect in reports')) + '</h4>';
    var hist = [];
    (p.reports || []).forEach(function (r) { hist.push({ t: r.title, s: stamp(r.created_at) + ' · ' + r.author_name, id: r.id }); });
    (p.bookings || []).forEach(function (b) {
      var titles = (b.charges || []).map(function (c) { return c.title || c.code; }).join(', ') || T('md_processed', 'Processed');
      hist.push({ t: titles, s: stamp(b.created_at) + ' · ' + b.officer_name });
    });
    html += hist.length ? hist.map(function (h) {
      return '<div class="mdt-row' + (h.id ? ' clk' : '') + '"' + (h.id ? ' data-goto-report="' + h.id + '"' : '') + '><div class="ic">📋</div><div><div class="tn">' + esc(h.t) + '</div><div class="ts">' + esc(h.s) + '</div></div></div>';
    }).join('') : '<div class="mdt-empty">' + esc(T('md_not_a_suspect', 'Not named as a suspect in any reports.')) + '</div>';

    html += '<h4 style="margin-top:1.2rem">' + esc(T('md_photographs', 'Photographs')) + '</h4>';
    html += '<div class="mdt-photos">' + ((p.photos || []).map(function (ph) {
      return '<div class="mdt-photo"><img src="' + esc(ph.url) + '" alt="">' +
        (M.boot && M.boot.isAdmin ? '<button type="button" class="del" data-a="del-pphoto" data-id="' + ph.id + '" title="' + esc(T('md_delete', 'Delete')) + '">×</button>' : '') + '</div>';
    }).join('') || '<div class="mdt-empty" style="padding:0.4rem 0">' + esc(T('md_no_photographs', 'No photographs. Paste an image link below.')) + '</div>') + '</div>';
    html += '<div class="mdt-photoform"><input class="mdt-inp" id="mdt-p-photourl" type="text" placeholder="' + esc(T('md_photo_url_ph2', 'Paste an image link (Discord / imgur / Fivemanage)…')) + '">' +
      '<button type="button" class="mdt-btn pri" data-a="add-pphoto">' + esc(T('md_add_photo', 'Add photo')) + '</button></div>';

    html += '<h4 style="margin-top:1.2rem">' + esc(T('md_vehicles_owned', 'Registered vehicles')) + '</h4>';
    html += (p.vehicles && p.vehicles.length) ? p.vehicles.map(function (v) {
      return '<div class="mdt-pvehrow" data-open-vehicle="' + esc(v.plate) + '"><div class="ic">🚗</div><div><b>' + esc(v.plate) + '</b><span>' + esc(v.vehicle || '') + '</span></div></div>';
    }).join('') : '<div class="mdt-empty">' + esc(T('md_none_on_file', 'None on file.')) + '</div>';

    html += '<h4 style="margin-top:1.2rem">' + esc(T('md_notes_flags', 'Notes & flags')) + '</h4>';
    html += '<div class="mdt-noteform"><textarea class="mdt-ta" id="mdt-p-note" placeholder="' + esc(T('md_person_note_ph', 'Add a note or flag about this person…')) + '"></textarea>' +
      '<button type="button" class="mdt-btn" data-a="add-pnote">' + esc(T('md_add', 'Add')) + '</button></div>';
    html += '<div class="mdt-notes">' + ((p.notes || []).length ? p.notes.map(function (n) {
      return '<div class="mdt-note"><div class="hd"><b>' + esc(n.author_name) + '</b><span>' + esc(stamp(n.created_at)) +
        (M.boot && M.boot.isAdmin ? ' · <button type="button" class="del" data-a="del-pnote" data-id="' + n.id + '">' + esc(T('md_delete', 'Delete')) + '</button>' : '') +
        '</span></div><p>' + esc(n.note) + '</p></div>';
    }).join('') : '<div class="mdt-empty" style="padding:0.4rem 0">' + esc(T('md_no_notes', 'No notes.')) + '</div>') + '</div>';

    html += '</div>';
    return html;
  }

  // ---- vehicles ----
  function statusChip(st) {
    if (!st) return '<span class="mdt-chip">' + esc(T('md_none', 'None')) + '</span>';
    if (st.state === 'valid') return chip('pass', T('md_valid', 'Valid'));
    if (st.state === 'expired') return chip('fail', T('md_expired', 'Expired'));
    return '<span class="mdt-chip">' + esc(T('md_none', 'None')) + '</span>';
  }
  // Small grey detail line under a status chip - the expiry date, and for insurance the
  // provider name too, so the officer doesn't have to open the government site to see either.
  function statusDetail(st) {
    if (!st) return '';
    var parts = [];
    if (st.provider) parts.push(st.provider);
    if (st.date) parts.push(T('md_expires', 'Expires') + ' ' + st.date);
    return parts.length ? '<div class="mdt-status-meta">' + esc(parts.join(' · ')) + '</div>' : '';
  }
  function vehicleBadges(v) {
    return v.bolo ? chip('active', 'BOLO') : (v.impound ? chip('fail', T('md_impound', 'Impound')) : '');
  }
  function renderVehiclesView() {
    renderSplit({
      title: T('md_nav_vehicles', 'Vehicles'), sub: T('md_vehicles_sub', 'Search plates'),
      list: M.vehicles, curId: M.vehicleCur && M.vehicleCur.plate,
      idOf: function (v) { return v.plate; }, titleOf: function (v) { return v.plate; },
      subOf: function (v) { return v.model || ''; }, badgeOf: vehicleBadges,
      searchId: 'mdt-vq', searchPh: T('md_search_plate', 'Search plate…'), searchVal: M.vehQ, focusSearch: true,
      detailHtml: M.vehicleCur ? renderVehicleDetail(M.vehicleCur) : null
    });
  }
  function motChip(v) {
    return v.mot
      ? '<span class="mdt-chip ' + (v.mot.passed && !v.mot.expired ? 'pass' : 'fail') + '">' + esc(v.mot.passed ? (v.mot.expired ? T('md_mot_expired', 'Expired') : T('md_mot_passed', 'Passed')) : T('md_mot_failed', 'Failed')) + '</span>'
      : '<span class="mdt-chip">' + esc(T('md_none', 'None')) + '</span>';
  }
  function motDetail(v) {
    return (v.mot && v.mot.expiresAt) ? '<div class="mdt-status-meta">' + esc(T('md_expires', 'Expires') + ' ' + v.mot.expiresAt) + '</div>' : '';
  }
  function renderVehicleDetail(v) {
    var html = '<div class="mdt-dhead"><div class="badges">' + vehicleBadges(v) + '</div><h2>' + esc(v.plate) + ' — ' + esc(v.model || '') + '</h2>' +
      '<div class="mdt-dmeta"><div>' + esc(T('md_registered_to', 'Registered to')) +
      (v.ownerCid ? '<b class="mdt-link" data-goto-person="' + esc(v.ownerCid) + '">' + esc(v.owner || 'Unknown') + '</b>' : '<b>' + esc(v.owner || 'Unknown') + '</b>') +
      '</div></div></div>';
    html += '<div class="mdt-dbody">';
    html += '<div class="mdt-proplist">' +
      '<div class="mdt-kv"><b>' + esc(T('md_insurance', 'Insurance')) + '</b><div>' + statusChip(v.insurance) + statusDetail(v.insurance) + '</div></div>' +
      '<div class="mdt-kv"><b>' + esc(T('md_tax', 'Tax')) + '</b><div>' + statusChip(v.tax) + statusDetail(v.tax) + '</div></div>' +
      '<div class="mdt-kv"><b>' + esc(T('md_mot', 'MOT')) + '</b><div>' + motChip(v) + motDetail(v) + '</div></div>' +
      '<div class="mdt-kv"><b>' + esc(T('md_impound', 'Impound')) + '</b>' +
      (v.impound && v.impound.impounded
        ? '<div style="display:flex;align-items:center;gap:0.7rem;flex-wrap:wrap"><span class="mdt-chip fail">' + esc(T('md_impounded', 'Impounded')) + (v.impound.reason ? ' — ' + esc(v.impound.reason) : '') + '</span><button type="button" class="mdt-btn" data-a="impound">' + esc(T('md_release', 'Release vehicle')) + '</button></div>'
        : '<button type="button" class="mdt-btn" data-a="impound">' + esc(T('md_flag_impound', 'Flag as impounded')) + '</button>') +
      '</div></div>';

    html += '<h4>' + esc(T('md_photos', 'Photos')) + '</h4>';
    html += '<div class="mdt-photos">' + ((v.photos || []).map(function (p) {
      return '<div class="mdt-photo"><img src="' + esc(p.url) + '" alt="">' +
        (M.boot && M.boot.isAdmin ? '<button type="button" class="del" data-a="del-vphoto" data-id="' + p.id + '" title="' + esc(T('md_delete', 'Delete')) + '">×</button>' : '') + '</div>';
    }).join('') || '<div class="mdt-empty" style="padding:0.8rem 0">' + esc(T('md_no_photos', 'No photos yet.')) + '</div>') + '</div>';
    html += '<div class="mdt-photoform"><input class="mdt-inp" id="mdt-v-photourl" type="text" placeholder="' + esc(T('md_photo_url_ph', 'Paste an image URL…')) + '">' +
      '<button type="button" class="mdt-btn" data-a="add-vphoto">' + esc(T('md_add_photo', 'Add photo')) + '</button></div>';

    html += '<h4>' + esc(T('md_notes', 'Notes')) + '</h4>';
    html += '<div class="mdt-noteform"><textarea class="mdt-ta" id="mdt-v-note" placeholder="' + esc(T('md_note_ph', 'Add a note about this vehicle…')) + '"></textarea>' +
      '<button type="button" class="mdt-btn" data-a="add-vnote">' + esc(T('md_add', 'Add')) + '</button></div>';
    html += '<div class="mdt-notes">' + ((v.notes || []).length ? v.notes.map(function (n) {
      return '<div class="mdt-note"><div class="hd"><b>' + esc(n.author_name) + '</b><span>' + esc(stamp(n.created_at)) +
        (M.boot && M.boot.isAdmin ? ' · <button type="button" class="del" data-a="del-vnote" data-id="' + n.id + '">' + esc(T('md_delete', 'Delete')) + '</button>' : '') +
        '</span></div><p>' + esc(n.note) + '</p></div>';
    }).join('') : '<div class="mdt-empty" style="padding:0.4rem 0 0.8rem">' + esc(T('md_no_notes', 'No notes yet.')) + '</div>') + '</div>';

    html += '<h4>' + esc(T('md_bolos', 'BOLOs on this plate')) + '</h4>';
    html += (v.bolos && v.bolos.length) ? v.bolos.map(function (b) {
      return '<div class="mdt-row"><div class="ic">🚨</div><div><div class="tn">' + esc(b.title) + '</div><div class="ts">' + esc(b.description || '') + '</div></div>' +
        '<span class="mdt-chip ' + (b.active ? 'active' : 'cleared') + '">' + esc(b.active ? T('md_active', 'Active') : T('md_cleared', 'Cleared')) + '</span></div>';
    }).join('') : '<div class="mdt-empty">' + esc(T('md_no_bolos_plate', 'None on this plate.')) + '</div>';
    html += '</div>';
    return html;
  }

  // ---- reports ----
  function reportBadges(r) {
    return (r.case_number ? chip('plain', r.case_number) : '');
  }
  function renderReportsView() {
    renderSplit({
      title: T('md_nav_reports', 'Reports'), sub: T('md_reports_sub', 'Filed incident reports'),
      list: M.reports, curId: M.reportCur ? M.reportCur.id : (M.reportEdit ? 'new' : null),
      idOf: function (r) { return r.id; }, titleOf: function (r) { return r.title; },
      subOf: function (r) { return T('md_filed_by', 'Filed by') + ' ' + r.author_name + ' · ' + stamp(r.created_at); },
      badgeOf: reportBadges,
      searchId: 'mdt-rq-noop', searchPh: T('md_filter_reports', 'Filter reports…'), searchVal: '',
      newBtn: '<button type="button" class="mdt-btn pri" data-a="new-report">+ ' + esc(T('md_new_report', 'New')) + '</button>',
      detailHtml: M.reportEdit ? renderReportEditor(M.reportEdit) : (M.reportCur ? renderReportDetail(M.reportCur) : null)
    });
  }
  // Splits the saved "CODE - Title, CODE - Title" string back into individual charges, and
  // cross-references the penal code cache (when loaded) to pull in type/fine/jail time so the
  // report detail can show more than just what the officer typed.
  function parseChargeString(str) {
    if (!str) return [];
    return str.split(',').map(function (s) { return s.trim(); }).filter(Boolean).map(function (entry) {
      var m = entry.match(/^(\S+)\s*-\s*(.+)$/);
      var code = m ? m[1] : '', title = m ? m[2] : entry;
      var found = chargesCache && chargesCache.filter(function (c) { return c.code === code; })[0];
      return {
        code: code || null, title: found ? found.title : title,
        type: found ? found.type : null, months: found ? found.months : null, fine: found ? found.fine : null
      };
    });
  }
  function chargeTypeBadge(type) {
    if (type === 'F') return chip('active', T('md_felony', 'Felony'));
    if (type === 'M') return chip('amber', T('md_misdemeanor', 'Misdemeanor'));
    if (type === 'I') return chip('plain', T('md_infraction', 'Infraction'));
    return '';
  }
  function renderReportDetail(r) {
    var charges = parseChargeString(r.charges);
    var totalFine = 0, totalMonths = 0, haveTotals = false;
    charges.forEach(function (c) {
      if (typeof c.fine === 'number') { totalFine += c.fine; haveTotals = true; }
      if (typeof c.months === 'number') { totalMonths += c.months; haveTotals = true; }
    });

    var html = '<div class="mdt-dhead"><div class="badges">' + (r.case_number ? chip('plain', r.case_number) : '') + chip('plain', r.type) + '</div><h2>' + esc(r.title) + '</h2>' +
      '<div class="mdt-dmeta"><div>' + esc(T('md_filed_by', 'Filed by')) + '<b>' + esc(r.author_name) + '</b></div><div>' + esc(T('md_filed', 'Filed')) + '<b>' + esc(stamp(r.created_at)) + '</b></div>' +
      (r.suspect_name ? '<div>' + esc(T('md_suspect_name', 'Suspect')) + '<b>' + esc(r.suspect_name) + '</b></div>' : '') + '</div></div>';
    html += '<div class="mdt-dbody">';
    if (r.involved) html += '<div class="mdt-kv"><b>' + esc(T('md_involved', 'Involved')) + '</b><span>' + esc(r.involved) + '</span></div>';

    if (charges.length) {
      html += '<h4 style="margin-top:1rem">' + esc(T('md_charges', 'Charges')) + '</h4>';
      html += '<div class="mdt-charge-list">' + charges.map(function (c) {
        return '<div class="mdt-charge-row">' +
          '<div class="cc">' + (c.code ? '<b>' + esc(c.code) + '</b>' : '') + '<span>' + esc(c.title) + '</span></div>' +
          chargeTypeBadge(c.type) +
          '<div class="cn">' + (typeof c.fine === 'number' ? '<b>$' + c.fine.toLocaleString() + '</b><span>' + esc(T('md_fine', 'fine')) + '</span>' : '') + '</div>' +
          '<div class="cn">' + (typeof c.months === 'number' ? (c.months > 0 ? '<b>' + c.months + ' ' + esc(T('md_months', 'mo')) + '</b><span>' + esc(T('md_jail', 'jail')) + '</span>' : '<b>' + esc(T('md_no_jail', '—')) + '</b>') : '') + '</div>' +
          '</div>';
      }).join('') + '</div>';
      if (haveTotals) {
        html += '<div class="mdt-charge-total"><span>' + esc(T('md_total', 'Total')) + '</span>' +
          '<b>$' + totalFine.toLocaleString() + '</b><b>' + totalMonths + ' ' + esc(T('md_months', 'mo')) + '</b></div>';
      }
    }

    // Sentencing: either Jail Suspect (guilty plea/no contest - immediate, via xt-prison + one DBS
    // record per charge, server/mdt.lua's reportJailSuspect) or Send to Court (not guilty plea -
    // files an mdt_court_cases row for the future Court MDT to assign a judge/solicitors and a
    // court date; reportSendToCourt). Once either has happened, both controls disappear - a case
    // can only go one way, and never twice.
    if (r.suspect_cid) {
      html += '<h4 style="margin-top:1.2rem">' + esc(T('md_sentencing', 'Sentencing')) + '</h4>';
      if (r.courtCase) {
        html += '<div class="mdt-empty" style="padding:0.3rem 0">' + esc(T('md_awaiting_court', '⚖️ Sent to court')) + ' — ' + esc(r.courtCase.submitted_at) + ' — ' + esc(T('md_awaiting_court2', 'awaiting judge & solicitor assignment.')) + '</div>';
      } else if (r.jailed_at) {
        html += '<div class="mdt-empty" style="padding:0.3rem 0">' + esc(T('md_already_jailed', 'These charges are already on this suspect’s DBS record.')) + '</div>';
      } else {
        var suspectOffline = r.suspectOnline === false;
        html += '<div class="mdt-photoform"><input class="mdt-inp" id="mdt-r-jailmins" type="number" min="1" step="1"' +
          (suspectOffline ? ' disabled' : '') + ' value="' + (haveTotals && totalMonths > 0 ? totalMonths : '') + '" placeholder="' + esc(T('md_jail_minutes_ph', 'Minutes (months)')) + '">' +
          '<button type="button" class="mdt-btn pri" data-a="jail-suspect"' + (suspectOffline ? ' disabled' : '') + '>' + esc(T('md_jail_suspect_btn', '🔒 Jail Suspect')) + '</button>' +
          '<button type="button" class="mdt-btn" data-a="send-to-court">' + esc(T('md_send_to_court_btn', '⚖️ Send to Court')) + '</button></div>';
        if (suspectOffline) html += '<div class="mdt-empty" style="padding:0.3rem 0">' + esc(T('md_suspect_offline', 'Suspect must be online to jail them. Sending to court doesn’t need them online.')) + '</div>';
      }
    }

    html += '<h4 style="margin-top:1.2rem">' + esc(T('md_narrative', 'Narrative')) + '</h4>';
    html += '<div class="mdt-narrative">' + (looksHtml(r.narrative) ? (r.narrative || '') : esc(r.narrative || '').replace(/\n/g, '<br>')) + '</div>';

    if (r.case_number) {
      // Evidence Laptop reports (DNA/Fingerprint/Ballistics matches), filed into this case's own
      // folder in File Explorer's Case Files area — see server/evidence_reports.lua.
      html += '<h4 style="margin-top:1.2rem">' + esc(T('md_linked_evidence', 'Linked evidence')) + '</h4>';
      html += (r.evidence && r.evidence.length) ? r.evidence.map(function (f) {
        return '<div class="mdt-row"><div class="ic">🧪</div><div><div class="tn">' + esc(f.name) + '</div><div class="ts">' + esc(stamp(f.created_at)) + '</div></div>' +
          '<button type="button" class="mdt-btn" data-a="unlink-evidence" data-id="' + f.id + '">' + esc(T('md_unlink', 'Unlink')) + '</button></div>';
      }).join('') : '<div class="mdt-empty">' + esc(T('md_no_evidence', 'No evidence linked to this case yet.')) + '</div>';
      html += '<div class="mdt-actions" style="margin-top:.5rem">' +
        '<button type="button" class="mdt-btn" data-a="link-evidence">' + esc(M.evidencePicker ? T('md_hide_evidence_picker', 'Close') : T('md_link_evidence', '+ Link evidence')) + '</button></div>';
      if (M.evidencePicker) {
        html += '<div class="mdt-evidence-picker" style="margin-top:.4rem">' + (M.evidencePicker.length
          ? M.evidencePicker.map(function (f) {
            return '<div class="mdt-row clk" data-a="pick-evidence" data-id="' + f.id + '"><div class="ic">📁</div><div><div class="tn">' + esc(f.name) + '</div><div class="ts">' + esc(stamp(f.created_at)) + '</div></div></div>';
          }).join('')
          : '<div class="mdt-empty">' + esc(T('md_no_unlinked_evidence', 'No unlinked evidence waiting in the Evidence folder.')) + '</div>') + '</div>';
      }

      // Images/videos pasted onto this report - saved into the SAME case's Evidence subfolder in
      // File Explorer as the linked evidence above (server/files.lua's Files.AddLegalCaseAttachment).
      html += '<h4 style="margin-top:1.2rem">' + esc(T('md_attachments', 'Attachments')) + '</h4>';
      var atts = r.attachments || [];
      html += atts.length ? '<div class="mdt-photos">' + atts.map(function (f) {
        var media = f.kind === 'video'
          ? '<video src="' + esc(f.url) + '" controls preload="metadata"></video>'
          : '<img src="' + esc(f.url) + '" alt="">';
        return '<div class="mdt-photo">' + media +
          '<button type="button" class="del" data-a="del-attachment" data-id="' + f.id + '" title="' + esc(T('md_delete', 'Delete')) + '">×</button></div>';
      }).join('') + '</div>' : '<div class="mdt-empty" style="padding:0.4rem 0">' + esc(T('md_no_attachments', 'No images or videos attached yet.')) + '</div>';
      html += '<div class="mdt-photoform"><input class="mdt-inp" id="mdt-r-attachurl" type="text" placeholder="' + esc(T('md_attach_url_ph', 'Paste an image or video link (Discord / imgur / Fivemanage)…')) + '">' +
        '<button type="button" class="mdt-btn pri" data-a="add-attachment">' + esc(T('md_add_attachment', 'Add attachment')) + '</button></div>';
      html += '<div class="mdt-actions" style="margin-top:.5rem">' +
        '<button type="button" class="mdt-btn" data-a="phone-attachment">' + esc(M.phonePicker ? T('md_hide_phone_picker', 'Close') : T('md_import_from_phone', '📱 Import from phone')) + '</button></div>';
      if (M.phonePicker) {
        html += '<div class="mdt-photos" style="margin-top:.4rem">' + (M.phonePicker.length
          ? M.phonePicker.map(function (ph) {
            var media = ph.isVideo ? '<video src="' + esc(ph.url) + '" preload="metadata"></video>' : '<img src="' + esc(ph.url) + '" alt="">';
            return '<div class="mdt-photo clk" data-a="pick-phone" data-id="' + esc(ph.id) + '">' + media + '</div>';
          }).join('')
          : '<div class="mdt-empty">' + esc(T('md_no_phone_photos', 'No photos or videos on this phone.')) + '</div>') + '</div>';
      }
    }

    html += '<div class="mdt-actions">' +
      '<button type="button" class="mdt-btn" data-a="edit-report">' + esc(T('md_edit_report', 'Edit report')) + '</button>' +
      (M.boot && M.boot.isAdmin ? '<button type="button" class="mdt-btn ' + (M.confirmDel ? 'danger' : '') + '" data-a="del-report">' +
        esc(M.confirmDel ? T('md_confirm_delete', 'Click again to delete') : T('md_delete', 'Delete report')) + '</button>' : '') + '</div>';
    html += '</div>';
    return html;
  }
  // Per-type skeletons the "Insert template" button drops into the narrative editor - the officer
  // then just fills the blanks in rather than starting from a blank box every time.
  var NARRATIVE_TEMPLATES = {
    'Incident': '<b>INCIDENT REPORT</b><br><b>Date / Time:</b><br><b>Location:</b><br><b>Persons involved:</b><br><b>Summary of incident:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br><b>Actions taken:</b><br>',
    'Arrest': '<b>ARREST REPORT</b><br><b>Date / Time:</b><br><b>Location:</b><br><b>Suspect(s):</b><br><b>Charges:</b><br><b>Circumstances of arrest:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br><b>Force used:</b><br>',
    'Traffic Stop': '<b>TRAFFIC STOP REPORT</b><br><b>Date / Time:</b><br><b>Location:</b><br><b>Vehicle / Plate:</b><br><b>Driver:</b><br><b>Reason for stop:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br><b>Outcome:</b><br>',
    'Investigation': '<b>INVESTIGATION REPORT</b><br><b>Date / Time:</b><br><b>Case reference:</b><br><b>Persons involved:</b><br><b>Findings:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br><b>Next steps:</b><br>',
    'Use of Force': '<b>USE OF FORCE REPORT</b><br><b>Date / Time:</b><br><b>Location:</b><br><b>Subject:</b><br><b>Type of force used:</b><br><b>Justification:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br><b>Injuries:</b><br>',
    'Field Interview': '<b>FIELD INTERVIEW REPORT</b><br><b>Date / Time:</b><br><b>Location:</b><br><b>Subject:</b><br><b>Reason for interview:</b><br><span class="mdt-rte-ph">Describe what happened here…</span><br>'
  };
  function looksHtml(s) { return /<[a-z][\s\S]*>/i.test(s || ''); }
  function renderReportEditor(r) {
    var types = (M.boot && M.boot.reportTypes) || ['Incident'];
    var html = '<div class="mdt-dhead"><h2>' + esc(r.id ? T('md_edit_report', 'Edit report') : T('md_new_report', 'New report')) + '</h2></div>';
    html += '<div class="mdt-dbody">';
    html += '<label class="mdt-field">' + esc(T('md_title', 'Title')) + '</label><input class="mdt-inp" id="mdt-r-title" type="text" value="' + esc(r.title || '') + '">';
    html += '<label class="mdt-field">' + esc(T('md_case_number', 'Case number')) + '</label><input class="mdt-inp' + (M.reportCaseErr ? ' mdt-inp-err' : '') + '" id="mdt-r-case" type="text" placeholder="' +
      esc(T('md_case_number_ph', 'Leave blank to start a new case')) + '" value="' + esc(r.case_number || '') + '">';
    if (M.reportCaseErr) html += '<div class="mdt-err">' + esc(M.reportCaseErr) + '</div>';
    html += '<label class="mdt-field">' + esc(T('md_type', 'Type')) + '</label><select class="mdt-sel" id="mdt-r-type">' +
      types.map(function (t) { return '<option value="' + esc(t) + '"' + (t === r.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>';
    html += '<label class="mdt-field">' + esc(T('md_suspect_name', 'Suspect name')) + '</label>' +
      '<div class="mdt-ac"><input class="mdt-inp" id="mdt-r-suspect" type="text" autocomplete="off" placeholder="' +
      esc(T('md_suspect_name_ph', 'Used to name the case folder in Case Files')) + '" value="' + esc(r.suspect_name || '') + '">' +
      '<div class="mdt-ac-list" id="mdt-r-suspect-list" hidden></div></div>';
    html += '<label class="mdt-field">' + esc(T('md_involved', 'Involved')) + '</label>' +
      '<div class="mdt-ac"><input class="mdt-inp" id="mdt-r-involved" type="text" autocomplete="off" value="' + esc(r.involved || '') + '">' +
      '<div class="mdt-ac-list" id="mdt-r-involved-list" hidden></div></div>';
    html += '<label class="mdt-field">' + esc(T('md_charges', 'Charges')) + '</label>' +
      '<div class="mdt-ac"><input class="mdt-inp" id="mdt-r-charges" type="text" autocomplete="off" placeholder="' +
      esc(T('md_charges_ph', 'Start typing a code or offence…')) + '" value="' + esc(r.charges || '') + '">' +
      '<div class="mdt-ac-list" id="mdt-r-charges-list" hidden></div></div>';
    html += '<label class="mdt-field">' + esc(T('md_narrative', 'Narrative')) + '</label>';
    html += '<div class="mdt-rte"><div class="mdt-rte-tools">' +
      '<button type="button" data-cmd="bold"><b>B</b></button>' +
      '<button type="button" data-cmd="italic"><i>I</i></button>' +
      '<button type="button" data-cmd="underline"><u>U</u></button>' +
      '<span class="sep"></span>' +
      '<button type="button" data-cmd="insertUnorderedList">' + esc(T('md_bullet_list', '• List')) + '</button>' +
      '<button type="button" data-cmd="insertOrderedList">' + esc(T('md_number_list', '1. List')) + '</button>' +
      '<button type="button" class="tpl" data-a="insert-template">↺ ' + esc(T('md_insert_template', 'Insert template')) + '</button>' +
      '</div><div class="mdt-rte-body" id="mdt-r-narrative" contenteditable="true">' +
      (looksHtml(r.narrative) ? (r.narrative || '') : esc(r.narrative || '').replace(/\n/g, '<br>')) +
      '</div></div>';
    html += '<div class="mdt-actions"><button type="button" class="mdt-btn pri" data-a="save-report">' + esc(T('md_save_report', 'Save report')) + '</button>' +
      '<button type="button" class="mdt-btn" data-a="cancel-report">' + esc(T('md_cancel', 'Cancel')) + '</button></div>';
    html += '</div>';
    return html;
  }
  function editReport(r) {
    M.reportCaseErr = '';
    M.reportEdit = r ? { id: r.id, title: r.title, type: r.type, involved: r.involved, charges: r.charges, narrative: r.narrative, case_number: r.case_number || '', suspect_name: r.suspect_name || '', suspect_cid: r.suspect_cid || null } :
      { id: null, title: '', type: (M.boot && M.boot.reportTypes && M.boot.reportTypes[0]) || 'Incident', involved: '', charges: '', narrative: '', case_number: '', suspect_name: '', suspect_cid: null };
    ensureCharges(function () {});
    render();
  }

  // Penal code list is small and static per server, so it's fetched once and cached rather than
  // re-queried on every keystroke like the citizen name lookups.
  var chargesCache = null, chargesLoading = false;
  function ensureCharges(cb) {
    if (chargesCache) return cb();
    if (chargesLoading) return;
    chargesLoading = true;
    api('chargesList').then(function (res) {
      chargesLoading = false;
      chargesCache = (res.ok && res.data.charges) || [];
      cb();
    });
  }
  function saveReport() {
    var e = M.reportEdit;
    e.title = $('mdt-r-title').value; e.type = $('mdt-r-type').value;
    e.case_number = $('mdt-r-case').value;
    e.suspect_name = $('mdt-r-suspect').value;
    e.involved = $('mdt-r-involved').value;
    // Picking suggestions leaves a trailing ", " ready for the next charge - strip it (and any
    // stray empty entries) before saving so the stored string doesn't end with a dangling comma.
    e.charges = $('mdt-r-charges').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).join(', ');
    var narEl = $('mdt-r-narrative');
    e.narrative = narEl ? narEl.innerHTML : '';
    api('reportSave', e).then(function (res) {
      if (!res.ok) {
        if (res.reason === 'case_not_found') { M.reportCaseErr = errText(res); return render(); }
        M.error = errText(res); return render();
      }
      M.reportCaseErr = ''; M.reportsLoaded = false; M.reportEdit = null;
      loadReports();
    });
  }

  // ---- bolos ----
  function renderBolosView() {
    renderSplit({
      title: T('md_nav_bolos', 'BOLOs'), sub: T('md_bolos_sub', 'Active and cleared lookouts'),
      list: M.bolos, curId: null,
      idOf: function (b) { return b.id; }, titleOf: function (b) { return b.plate + ' — ' + b.title; },
      subOf: function (b) { return b.description || ''; },
      badgeOf: function (b) { return chip(b.active ? 'active' : 'cleared', b.active ? T('md_active', 'Active') : T('md_cleared', 'Cleared')); },
      searchId: 'mdt-bq-noop', searchPh: T('md_filter_bolos', 'Filter BOLOs…'), searchVal: '',
      newBtn: '<button type="button" class="mdt-btn pri" data-a="new-bolo">+ ' + esc(T('md_new_bolo', 'New')) + '</button>',
      detailHtml: M.boloNew ? renderBoloEditor(M.boloNew) : '<div class="mdt-empty-detail">' + esc(T('md_bolo_hint', 'Select a BOLO from the list, or file a new one.')) + '</div>'
    });
    renderBoloCtxMenu();
  }
  function renderBoloCtxMenu() {
    var existing = $('mdt-bolo-ctx'); if (existing) existing.parentNode.removeChild(existing);
    if (!M.boloCtx) return;
    var main = document.querySelector('#mdt .mdt-main'); if (!main) return;
    var el = document.createElement('div');
    el.id = 'mdt-bolo-ctx';
    el.className = 'mdt-ctxmenu';
    el.style.left = M.boloCtx.x + 'px';
    el.style.top = M.boloCtx.y + 'px';
    el.innerHTML = '<button type="button" class="mdt-ctxitem danger" data-a="delete-bolo-ctx">' + esc(T('md_delete_bolo', 'Delete BOLO')) + '</button>';
    main.appendChild(el);
  }
  function renderBoloEditor(b) {
    var html = '<div class="mdt-dhead"><h2>' + esc(T('md_new_bolo', 'New BOLO')) + '</h2></div><div class="mdt-dbody">';
    html += '<label class="mdt-field">' + esc(T('md_plate', 'Plate')) + '</label>' +
      '<div class="mdt-ac"><input class="mdt-inp" id="mdt-b-plate" type="text" autocomplete="off" placeholder="' +
      esc(T('md_plate_ph', 'Search a plate…')) + '" value="' + esc(b.plate) + '">' +
      '<div class="mdt-ac-list" id="mdt-b-plate-list" hidden></div></div>';
    html += '<label class="mdt-field">' + esc(T('md_vehicle_details', 'Vehicle details')) + '</label>' +
      '<div class="mdt-veh-info" id="mdt-b-vehinfo">' + renderVehInfoCard(b.vehInfo || {}) + '</div>';
    html += '<label class="mdt-field">' + esc(T('md_title', 'Title')) + '</label><input class="mdt-inp" id="mdt-b-title" type="text" value="' + esc(b.title) + '">';
    html += '<label class="mdt-field">' + esc(T('md_description', 'Description')) + '</label><textarea class="mdt-ta" id="mdt-b-desc" style="min-height:120px">' + esc(b.description) + '</textarea>';
    html += '<div class="mdt-actions"><button type="button" class="mdt-btn pri" data-a="save-bolo">' + esc(T('md_save_bolo', 'Save BOLO')) + '</button>' +
      '<button type="button" class="mdt-btn" data-a="cancel-bolo">' + esc(T('md_cancel', 'Cancel')) + '</button></div>';
    html += '</div>';
    return html;
  }
  function saveBolo() {
    var data = { plate: $('mdt-b-plate').value, title: $('mdt-b-title').value, description: $('mdt-b-desc').value };
    api('boloSave', data).then(function (res) {
      if (!res.ok) { M.error = errText(res); return render(); }
      M.boloNew = null; M.bolosLoaded = false;
      loadBolos();
    });
  }

  // ------------------------------------------------------------------ master render
  function render() {
    if (!$('mdt')) return;
    renderUser(); renderNav();
    if (M.view === 'dashboard') renderDashboard();
    else if (M.view === 'people') renderPeopleView();
    else if (M.view === 'vehicles') renderVehiclesView();
    else if (M.view === 'reports') renderReportsView();
    else if (M.view === 'bolos') renderBolosView();
  }

  // ------------------------------------------------------------------ events
  var bound = false;
  function bind() {
    if (bound || !$('mdt')) return;
    bound = true;
    var root = $('mdt');
    root.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]'); if (nav) return go(nav.dataset.nav);

      if (M.boloCtx && !e.target.closest('.mdt-ctxmenu')) { M.boloCtx = null; renderBoloCtxMenu(); }

      var sp = e.target.closest('[data-split]');
      if (sp) {
        var id = sp.dataset.split;
        if (M.view === 'people') return openPerson(id);
        if (M.view === 'vehicles') return openVehicle(id);
        if (M.view === 'reports') { M.reportEdit = null; return openReport(+id); }
        return;
      }
      var gv = e.target.closest('[data-open-vehicle]'); if (gv) { M.view = 'vehicles'; return openVehicle(gv.dataset.openVehicle); }
      var grr = e.target.closest('[data-goto-report]'); if (grr) { M.view = 'reports'; return openReport(+grr.dataset.gotoReport); }
      var gp = e.target.closest('[data-goto-person]'); if (gp) { M.view = 'people'; return openPerson(gp.dataset.gotoPerson); }
      var gf = e.target.closest('[data-open-firearm]');
      if (gf) {
        // Firearms Registry stays its own separate app/icon (evidences' own tool) — this just
        // brings it to front and hands it the full firearm record, same as clicking it inside
        // evidences' old Citizens app used to. See ui/evidences.js's exposed hook for the other half.
        var fArr = (M.personCur && M.personCur.firearms) || [];
        var fObj = null;
        for (var fi = 0; fi < fArr.length; fi++) { if (fArr[fi].serial === gf.dataset.openFirearm) { fObj = fArr[fi]; break; } }
        if (fObj && window.__openEvidencesApp) window.__openEvidencesApp('firearms_registry', { firearm: fObj });
        return;
      }

      var a = e.target.closest('[data-a]');
      if (a) {
        var act = a.dataset.a;
        if (act === 'link-evidence') return toggleEvidencePicker();
        if (act === 'pick-evidence') return pickEvidence(+a.dataset.id);
        if (act === 'unlink-evidence') return unlinkEvidence(+a.dataset.id);
        if (act === 'bio-picker') return toggleBioPicker(a.dataset.type);
        if (act === 'pick-bio') return pickBio(a.dataset.code);
        if (act === 'add-attachment') return addReportAttachment();
        if (act === 'del-attachment') return deleteReportAttachment(+a.dataset.id);
        if (act === 'phone-attachment') return togglePhonePicker();
        if (act === 'pick-phone') return importPhonePhoto(a.dataset.id);
        if (act === 'jail-suspect') return jailSuspect();
        if (act === 'send-to-court') return sendToCourt();
        if (act === 'new-report') return editReport(null);
        if (act === 'edit-report') return editReport(M.reportCur);
        if (act === 'cancel-report') { M.reportEdit = null; M.reportCaseErr = ''; return render(); }
        if (act === 'save-report') return saveReport();
        if (act === 'insert-template') {
          var typeSel = $('mdt-r-type');
          var typ = (typeSel && typeSel.value) || (M.reportEdit && M.reportEdit.type) || 'Incident';
          var body = $('mdt-r-narrative');
          if (body) { body.innerHTML = NARRATIVE_TEMPLATES[typ] || NARRATIVE_TEMPLATES.Incident; body.focus(); }
          return;
        }
        if (act === 'del-report') {
          if (!M.confirmDel) { M.confirmDel = true; return render(); }
          M.confirmDel = false;
          return api('reportDelete', { id: M.reportCur.id }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.reportsLoaded = false; M.reportCur = null; loadReports();
          });
        }
        if (act === 'add-pnote') {
          var pnoteEl = $('mdt-p-note'), pnoteVal = pnoteEl && pnoteEl.value.trim();
          if (!pnoteVal || !M.personCur) return;
          return api('personNoteAdd', { cid: M.personCur.cid, note: pnoteVal }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.personCur = res.data.person; render();
          });
        }
        if (act === 'del-pnote') {
          if (!M.personCur) return;
          return api('personNoteDelete', { cid: M.personCur.cid, id: +a.dataset.id }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.personCur = res.data.person; render();
          });
        }
        if (act === 'add-pphoto') {
          var purlEl = $('mdt-p-photourl'), purlVal = purlEl && purlEl.value.trim();
          if (!purlVal || !M.personCur) return;
          return api('personPhotoAdd', { cid: M.personCur.cid, url: purlVal }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.personCur = res.data.person; render();
          });
        }
        if (act === 'del-pphoto') {
          if (!M.personCur) return;
          return api('personPhotoDelete', { cid: M.personCur.cid, id: +a.dataset.id }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.personCur = res.data.person; render();
          });
        }
        if (act === 'new-bolo') { M.boloNew = { plate: '', title: '', description: '' }; return render(); }
        if (act === 'save-bolo') return saveBolo();
        if (act === 'cancel-bolo') { M.boloNew = null; return render(); }
        if (act === 'delete-bolo-ctx') {
          var delId = M.boloCtx && M.boloCtx.id;
          M.boloCtx = null; renderBoloCtxMenu();
          if (!delId) return;
          return api('boloDelete', { id: +delId }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.bolosLoaded = false; loadBolos();
          });
        }
        if (act === 'impound') {
          return api('vehicleToggleImpound', { plate: M.vehicleCur.plate }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.vehicleCur = res.data.vehicle; render();
          });
        }
        if (act === 'add-vnote') {
          var noteEl = $('mdt-v-note'), noteVal = noteEl && noteEl.value.trim();
          if (!noteVal || !M.vehicleCur) return;
          return api('vehicleNoteAdd', { plate: M.vehicleCur.plate, note: noteVal }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.vehicleCur = res.data.vehicle; render();
          });
        }
        if (act === 'del-vnote') {
          if (!M.vehicleCur) return;
          return api('vehicleNoteDelete', { plate: M.vehicleCur.plate, id: +a.dataset.id }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.vehicleCur = res.data.vehicle; render();
          });
        }
        if (act === 'add-vphoto') {
          var urlEl = $('mdt-v-photourl'), urlVal = urlEl && urlEl.value.trim();
          if (!urlVal || !M.vehicleCur) return;
          return api('vehiclePhotoAdd', { plate: M.vehicleCur.plate, url: urlVal }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.vehicleCur = res.data.vehicle; render();
          });
        }
        if (act === 'del-vphoto') {
          if (!M.vehicleCur) return;
          return api('vehiclePhotoDelete', { plate: M.vehicleCur.plate, id: +a.dataset.id }).then(function (res) {
            if (!res.ok) { M.error = errText(res); return render(); }
            M.vehicleCur = res.data.vehicle; render();
          });
        }
        return;
      }
    });
    root.addEventListener('contextmenu', function (e) {
      if (M.view !== 'bolos') return;
      var sp = e.target.closest('[data-split]');
      if (!sp) return;
      e.preventDefault();
      var main = document.querySelector('#mdt .mdt-main');
      var rect = main ? main.getBoundingClientRect() : { left: 0, top: 0 };
      M.boloCtx = { id: sp.dataset.split, x: e.clientX - rect.left, y: e.clientY - rect.top };
      renderBoloCtxMenu();
    });
    root.addEventListener('mousedown', function (e) {
      // preventDefault so clicking a toolbar button never steals focus/selection away from the
      // narrative box - execCommand needs that selection to still be live when it runs.
      var toolBtn = e.target.closest('.mdt-rte-tools button[data-cmd]');
      if (toolBtn) { e.preventDefault(); document.execCommand(toolBtn.dataset.cmd, false, null); }
    });
    root.addEventListener('input', function (e) {
      if (e.target.id === 'mdt-pq') { M.peopleQ = e.target.value; return debounceSearch(loadPeople); }
      if (e.target.id === 'mdt-vq') { M.vehQ = e.target.value; return debounceSearch(loadVehicles); }
      if (e.target.id === 'mdt-r-suspect' || e.target.id === 'mdt-r-involved') {
        // Manual typing invalidates any previously-picked citizen id for the suspect field, so a
        // report never ends up crediting jail/court actions to the wrong person after the officer
        // edits the name post-pick. A fresh pick from the dropdown re-attaches it (see mousedown).
        if (e.target.id === 'mdt-r-suspect' && M.reportEdit) M.reportEdit.suspect_cid = null;
        var q = e.target.value, listId = e.target.id + '-list';
        return debounceSearch(function () { fillNameSuggestions(listId, q); });
      }
      if (e.target.id === 'mdt-r-charges') {
        return fillChargeSuggestions('mdt-r-charges-list', e.target.value);
      }
      if (e.target.id === 'mdt-b-plate') {
        var pq = e.target.value;
        // Look the plate up as soon as typing pauses, not just on pick/blur - blur timing in the
        // NUI browser isn't reliable when clicking straight from this field into the next one.
        return debounceSearch(function () { fillPlateSuggestions('mdt-b-plate-list', pq); autofillBoloFromPlate(pq); });
      }
    });
    root.addEventListener('focusin', function (e) {
      if (e.target.id === 'mdt-r-suspect' || e.target.id === 'mdt-r-involved') {
        fillNameSuggestions(e.target.id + '-list', e.target.value);
      }
      if (e.target.id === 'mdt-r-charges') {
        ensureCharges(function () { fillChargeSuggestions('mdt-r-charges-list', e.target.value); });
      }
      if (e.target.id === 'mdt-b-plate') {
        fillPlateSuggestions('mdt-b-plate-list', e.target.value);
      }
    });
    root.addEventListener('mousedown', function (e) {
      // Selecting a suggestion: mousedown fires before the input's blur, so we can still read it.
      var opt = e.target.closest('[data-name-pick]');
      if (opt) {
        e.preventDefault();
        var list = opt.closest('.mdt-ac-list');
        var input = list && list.previousElementSibling;
        if (input) {
          input.value = opt.dataset.namePick;
          // Only the suspect field's pick maps to a stored citizen id - there's no visible cid
          // input, so stash it straight on the in-memory edit buffer for saveReport() to send.
          // Picking a name re-links suspect_cid; typing over it afterwards clears it again (see
          // the 'input' listener below), so a stale cid can never outlive the name it came from.
          if (input.id === 'mdt-r-suspect' && M.reportEdit) M.reportEdit.suspect_cid = opt.dataset.namePickCid || null;
          input.dispatchEvent(new Event('change'));
        }
        list.hidden = true; list.innerHTML = '';
        return;
      }
      var copt = e.target.closest('[data-charge-pick]');
      if (copt) {
        e.preventDefault();
        var clist = copt.closest('.mdt-ac-list');
        var cinput = clist && clist.previousElementSibling;
        if (cinput) {
          var parts = cinput.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          parts.pop(); // drop the in-progress fragment the officer was typing
          parts.push(copt.dataset.chargePick);
          cinput.value = parts.join(', ') + ', ';
          cinput.focus();
          fillChargeSuggestions('mdt-r-charges-list', '');
        }
        return;
      }
      var popt = e.target.closest('[data-plate-pick]');
      if (popt) {
        e.preventDefault();
        var plist = popt.closest('.mdt-ac-list');
        var pinput = plist && plist.previousElementSibling;
        if (pinput) { pinput.value = popt.dataset.platePick; pinput.focus(); }
        plist.hidden = true; plist.innerHTML = '';
        autofillBoloFromPlate(popt.dataset.platePick);
        return;
      }
      // Clicking anywhere else closes any open suggestion list.
      if (!e.target.closest('.mdt-ac')) {
        root.querySelectorAll('.mdt-ac-list').forEach(function (l) { l.hidden = true; });
      }
    });
    root.addEventListener('focusout', function (e) {
      if (e.target.id === 'mdt-r-suspect' || e.target.id === 'mdt-r-involved' || e.target.id === 'mdt-r-charges' || e.target.id === 'mdt-b-plate') {
        var list = $(e.target.id + '-list');
        if (list) setTimeout(function () { list.hidden = true; }, 150);
      }
      if (e.target.id === 'mdt-b-plate' && e.target.value.trim()) autofillBoloFromPlate(e.target.value.trim());
    });
  }
  var searchTimer = null;
  function debounceSearch(fn) { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(fn, 300); }

  // Autocomplete for the report editor's suspect/involved fields: as the officer types (or
  // focuses the field), look citizens up via the same peopleSearch call the People tab uses,
  // and show their names as a click-to-fill dropdown under the field.
  function fillNameSuggestions(listId, query) {
    var el = $(listId); if (!el) return;
    if (!query || query.length < 2) { el.hidden = true; el.innerHTML = ''; return; }
    api('peopleSearch', { query: query }).then(function (res) {
      var list = $(listId); if (!list || !res.ok) return;
      var people = res.data.people || [];
      if (!people.length) { list.hidden = true; list.innerHTML = ''; return; }
      list.innerHTML = people.map(function (p) {
        return '<div class="mdt-ac-opt" data-name-pick="' + esc(p.name) + '" data-name-pick-cid="' + esc(p.cid || '') + '">' + esc(p.name) +
          '<span>' + esc(T('md_dob', 'DOB')) + ' ' + esc(p.dob || '—') + '</span></div>';
      }).join('');
      list.hidden = false;
    });
  }

  // Autocomplete for the Charges field: it's a comma-separated list built up one charge at a
  // time, so filtering only looks at whatever's typed after the last comma, and picking a
  // suggestion appends "CODE - Title" rather than replacing the whole field.
  function fillChargeSuggestions(listId, fullValue) {
    var list = $(listId); if (!list) return;
    var query = String(fullValue || '').split(',').pop().trim().toLowerCase();
    if (!query || !chargesCache) { list.hidden = true; list.innerHTML = ''; return; }
    var matches = chargesCache.filter(function (c) {
      return (c.code || '').toLowerCase().indexOf(query) !== -1 || (c.title || '').toLowerCase().indexOf(query) !== -1;
    }).slice(0, 8);
    if (!matches.length) { list.hidden = true; list.innerHTML = ''; return; }
    list.innerHTML = matches.map(function (c) {
      var label = c.code + ' - ' + c.title;
      return '<div class="mdt-ac-opt" data-charge-pick="' + esc(label) + '">' + esc(label) +
        '<span>' + esc(c.type === 'F' ? T('md_felony', 'Felony') : c.type === 'M' ? T('md_misdemeanor', 'Misdemeanor') : T('md_infraction', 'Infraction')) + '</span></div>';
    }).join('');
    list.hidden = false;
  }

  // Autocomplete for the New BOLO plate field: search known plates as the officer types, and
  // once a plate is picked, pull its make/model/colour and registered owner so the description
  // writes itself instead of the officer looking the vehicle up separately.
  function fillPlateSuggestions(listId, query) {
    var list = $(listId); if (!list) return;
    if (!query || query.length < 2) { list.hidden = true; list.innerHTML = ''; return; }
    api('vehicleSearch', { query: query }).then(function (res) {
      var el = $(listId); if (!el || !res.ok) return;
      var vehs = res.data.vehicles || [];
      if (!vehs.length) { el.hidden = true; el.innerHTML = ''; return; }
      el.innerHTML = vehs.map(function (v) {
        return '<div class="mdt-ac-opt" data-plate-pick="' + esc(v.plate) + '">' + esc(v.plate) +
          '<span>' + esc(v.model || '') + '</span></div>';
      }).join('');
      el.hidden = false;
    });
  }
  function renderVehInfoCard(v) {
    return '<div class="mdt-kv"><b>' + esc(T('md_owner', 'Owner')) + '</b><span>' + esc(v.owner || '—') + '</span></div>' +
      '<div class="mdt-kv"><b>' + esc(T('md_make', 'Make')) + '</b><span>' + esc(v.make || '—') + '</span></div>' +
      '<div class="mdt-kv"><b>' + esc(T('md_model', 'Model')) + '</b><span>' + esc(v.model || '—') + '</span></div>' +
      '<div class="mdt-kv" style="border-bottom:none"><b>' + esc(T('md_colour', 'Colour')) + '</b><span>' + esc(v.colour || '—') + '</span></div>';
  }
  function autofillBoloFromPlate(plate) {
    var infoEl = $('mdt-b-vehinfo');
    if (!plate || !plate.trim()) {
      if (infoEl) infoEl.innerHTML = renderVehInfoCard({});
      if (M.boloNew) M.boloNew.vehInfo = null;
      return;
    }
    api('boloVehicleLookup', { plate: plate.trim() }).then(function (res) {
      var infoEl = $('mdt-b-vehinfo');
      if (!res.ok) {
        if (infoEl) infoEl.innerHTML = renderVehInfoCard({});
        if (M.boloNew) M.boloNew.vehInfo = null;
        return;
      }
      var v = res.data;
      if (infoEl) infoEl.innerHTML = renderVehInfoCard(v);
      if (M.boloNew) M.boloNew.vehInfo = v;
      // The lookup can resolve a partial plate the officer is still typing to the one real match -
      // reflect that back into the field so the BOLO is filed against the actual plate, not the
      // partial text that happened to trigger the match.
      var plateEl = $('mdt-b-plate');
      if (plateEl && v.plate && plateEl.value.trim().toUpperCase() !== String(v.plate).toUpperCase() && document.activeElement !== plateEl) {
        plateEl.value = v.plate;
      }
    });
  }

  var root = S.registerApp({
    id: 'mdt', icon: ICON_APP, titleKey: 'md_app_name', titleDef: 'MDT', w: 1180, h: 720, html: HTML,
    onOpen: function () {
      bind();
      if (!M.boot) boot(function () { go('dashboard'); });
      else render();
    },
    onClose: function () {},
    onReset: function () { fresh(); if ($('mdt')) render(); },
    onLocale: function () { render(); }
  });
  if (root) bind();
})();
