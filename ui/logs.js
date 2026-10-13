/* Event Viewer (Logs app) for Los Santos OS. Registers itself with LSOS.registerApp. Reads this computer's logs through the
   'logsApi' NUI callback (client/logs.lua): a log tree (Application, Security, System, Boss), an event grid with filters, a
   details pane for the selected event and an Actions pane. The server decides who may read (the machine's owner while signed
   in, and admins) and who may clear. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function esc(s) { return S.esc(s); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="3" y="2.5" width="18" height="19" rx="2.6" fill="#7c3aed"/><g stroke="#fff" stroke-width="1.7" stroke-linecap="round"><path d="M7 8h10M7 12h10M7 16h6"/></g><circle cx="17.5" cy="16.5" r="2.6" fill="#f59e0b"/></svg>';

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/logsApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: name, data: data })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }

  var V = { kind: 'security', level: '', source: '', q: '', rows: [], more: false, d: null, sel: null, error: null, busy: false, timer: null };
  var KINDS = [['application', 'lg_application', 'Application'], ['security', 'lg_security', 'Security'], ['system', 'lg_system', 'System'], ['boss', 'lg_boss', 'Business Manager']];
  var LEVELS = [['', 'lg_all', 'All levels'], ['information', 'lg_information', 'Information'], ['warning', 'lg_warning', 'Warning'], ['error', 'lg_error', 'Error'], ['success', 'lg_success', 'Audit Success'], ['failure', 'lg_failure', 'Audit Failure']];
  function levelName(l) { var x = LEVELS.filter(function (v) { return v[0] === l; })[0]; return x ? T(x[1], x[2]) : l; }

  var HTML = '<div class="ak" id="lg"><div class="ak-rail" id="lg-rail"></div><div class="lg-center"><div class="ak-top" id="lg-top"></div><div class="lg-grid" id="lg-grid"></div><div class="lg-detail" id="lg-detail" style="display:none"></div><div class="lg-status" id="lg-status"></div></div><div class="lg-actions" id="lg-actions"></div></div>';

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(at) { var d = new Date(at * 1000); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }

  function filters(extra) { return Object.assign({ kind: V.kind, level: V.level, source: V.source, q: V.q }, extra || {}); }

  function load(append) {
    if (V.busy) return Promise.resolve();
    V.busy = true;
    var before = append && V.rows.length ? V.rows[V.rows.length - 1].id : 0;
    return api('list', filters({ beforeId: before })).then(function (r) {
      V.busy = false;
      if (!r.ok) { V.error = r.reason === 'not_authorised' ? T('lg_err_auth', 'You are not allowed to open the Event Viewer.') : T('lg_err', 'Could not load the log.'); return draw(); }
      V.error = null; V.d = r.data;
      if (r.data.canRead !== false) {
        V.rows = append ? V.rows.concat(r.data.rows || []) : (r.data.rows || []);
        V.more = !!r.data.more;
        if (V.sel && !V.rows.some(function (x) { return x.id === V.sel; })) V.sel = null;
      }
      draw();
    });
  }

  function drawRail() {
    var c = (V.d && V.d.counts) || {};
    var h = '<div class="ak-brand">' + esc(T('lg_app_name', 'Event Viewer')) + '<small>' + esc(T('lg_local', 'Event Viewer (Local)')) + '</small></div><h3 style="padding:0 10px">' + esc(T('lg_logs', 'Computer Logs')) + '</h3>';
    KINDS.forEach(function (k) {
      h += '<button class="ak-nav' + (V.kind === k[0] ? ' on' : '') + '" data-kind="' + k[0] + '">' + esc(T(k[1], k[2])) + (c[k[0]] ? ' <span class="ak-mute">(' + c[k[0]] + ')</span>' : '') + '</button>';
    });
    $('lg-rail').innerHTML = h;
  }

  function drawTop() {
    var cur = KINDS.filter(function (k) { return k[0] === V.kind; })[0], lv = (V.d && V.d.levels) || {};
    var h = '<h2>' + esc(T(cur[1], cur[2])) + '</h2><select id="lg-level">';
    LEVELS.forEach(function (x) { h += '<option value="' + x[0] + '"' + (V.level === x[0] ? ' selected' : '') + '>' + esc(T(x[1], x[2])) + (x[0] && lv[x[0]] ? ' (' + lv[x[0]] + ')' : '') + '</option>'; });
    h += '</select><select id="lg-source"><option value="">' + esc(T('lg_all_sources', 'All sources')) + '</option>';
    ((V.d && V.d.sources) || []).forEach(function (s) { h += '<option value="' + esc(s) + '"' + (V.source === s ? ' selected' : '') + '>' + esc(s) + '</option>'; });
    h += '</select><input id="lg-q" placeholder="' + esc(T('lg_find', 'Find...')) + '" value="' + esc(V.q) + '" style="width:150px">';
    var had = document.activeElement && document.activeElement.id === 'lg-q';
    $('lg-top').innerHTML = h;
    if (had) { var qi = $('lg-q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
  }

  function drawGrid() {
    var g = $('lg-grid'), scroll = g.scrollTop;
    if (V.error) { g.innerHTML = '<div class="ak-empty">' + esc(V.error) + '</div>'; return; }
    if (!V.d) { g.innerHTML = '<div class="ak-empty">' + esc(T('lg_loading', 'Loading...')) + '</div>'; return; }
    if (V.d.canRead === false) { g.innerHTML = '<div class="ak-empty"><b>' + esc(T('lg_denied', 'Access is denied')) + '</b><br>' + esc(T('lg_denied_note', 'Only this computer\'s owner can read its logs. Sign in with the owner account.')) + '</div>'; return; }
    if (!V.rows.length) { g.innerHTML = '<div class="ak-empty">' + esc(T('lg_none', 'There are no events to show in this view.')) + '</div>'; return; }
    var h = '<table><thead><tr><th style="width:150px">' + esc(T('lg_level', 'Level')) + '</th><th style="width:165px">' + esc(T('lg_time', 'Date and Time')) + '</th><th style="width:150px">' + esc(T('lg_source', 'Source')) + '</th><th style="width:80px">' + esc(T('lg_eventid', 'Event ID')) + '</th><th>' + esc(T('lg_message', 'Message')) + '</th></tr></thead><tbody>';
    V.rows.forEach(function (r) {
      h += '<tr data-id="' + r.id + '"' + (V.sel === r.id ? ' class="sel"' : '') + '><td><span class="lg-dot ' + esc(r.level) + '"></span>' + esc(levelName(r.level)) + '</td><td class="ak-mute">' + esc(fmt(r.at)) + '</td><td>' + esc(r.source || '') + '</td><td>' + (r.eventId || '') + '</td><td><div class="lg-msg">' + esc(r.message) + '</div></td></tr>';
    });
    h += '</tbody></table>';
    if (V.more) h += '<button class="ak-btn lg-more" data-act="more">' + esc(T('lg_more', 'Load more events...')) + '</button>';
    g.innerHTML = h; g.scrollTop = scroll;
  }

  function drawDetail() {
    var box = $('lg-detail'), r = V.rows.filter(function (x) { return x.id === V.sel; })[0];
    if (!r) { box.style.display = 'none'; return; }
    box.style.display = '';
    var cur = KINDS.filter(function (k) { return k[0] === V.kind; })[0];
    var kv = [[T('lg_logname', 'Log Name'), T(cur[1], cur[2])], [T('lg_source', 'Source'), r.source], [T('lg_eventid', 'Event ID'), r.eventId || '-'], [T('lg_level', 'Level'), levelName(r.level)],
      [T('lg_user', 'User'), r.actor || T('lg_na', 'N/A')], [T('lg_logged', 'Logged'), fmt(r.at)], [T('lg_computer', 'Computer'), (V.d && V.d.computer) || '']];
    if (r.data && typeof r.data === 'object') Object.keys(r.data).slice(0, 12).forEach(function (k) { kv.push([k, typeof r.data[k] === 'object' ? JSON.stringify(r.data[k]) : r.data[k]]); });
    var h = '<div class="lg-dh"><span>' + esc(T('lg_event', 'Event') + ' ' + (r.eventId || '') + ', ' + (r.source || '')) + '</span><button class="ak-btn sm" data-act="closed">' + esc(T('lg_close', 'Close')) + '</button></div><div class="lg-db"><p style="margin:0 0 10px">' + esc(r.message) + '</p><div class="lg-kv">';
    kv.forEach(function (p) { h += '<b>' + esc(p[0]) + '</b><div>' + esc(p[1]) + '</div>'; });
    box.innerHTML = h + '</div></div>';
  }

  function drawActions() {
    var can = V.d && V.d.canRead !== false;
    $('lg-actions').innerHTML = '<h3>' + esc(T('lg_actions', 'Actions')) + '</h3>' +
      '<button data-act="refresh">' + esc(T('lg_refresh', 'Refresh')) + '</button>' +
      '<button data-act="clear"' + (can && V.d.canClear ? '' : ' disabled') + '>' + esc(T('lg_clear', 'Clear Log...')) + '</button>' +
      '<button data-act="nofilter"' + (V.level || V.source || V.q ? '' : ' disabled') + '>' + esc(T('lg_nofilter', 'Clear Filter')) + '</button>';
    var filt = V.level || V.source || V.q;
    $('lg-status').textContent = V.d && V.d.canRead !== false ? (filt ? T('lg_filtered', 'Filtered. Number of events: %s') : T('lg_num', 'Number of events: %s')).replace('%s', V.rows.length + (V.more ? '+' : '')) : '';
  }

  function draw() { if (!$('lg')) return; drawRail(); drawTop(); drawGrid(); drawDetail(); drawActions(); }
  function reload() { V.sel = null; V.rows = []; return load(false); }

  function bind() {
    var el = $('lg'); if (!el || el.__b) return; el.__b = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'), row = e.target.closest('tr[data-id]');
      if (b && b.dataset.kind) { V.kind = b.dataset.kind; V.level = ''; V.source = ''; V.q = ''; return reload(); }
      if (b && b.dataset.act) {
        var a = b.dataset.act;
        if (a === 'refresh') return reload();
        if (a === 'more') return load(true);
        if (a === 'closed') { V.sel = null; return draw(); }
        if (a === 'nofilter') { V.level = ''; V.source = ''; V.q = ''; return reload(); }
        if (a === 'clear') return S.confirmDlg(T('lg_clear', 'Clear Log...'), T('lg_clear_q', 'Clear every event in this log? This is itself recorded.'), function () {
          api('clear', { kind: V.kind }).then(function () { reload(); });
        });
      }
      if (row) { V.sel = Number(row.dataset.id); drawGrid(); drawDetail(); }
    });
    el.addEventListener('change', function (e) {
      if (e.target.id === 'lg-level') { V.level = e.target.value; reload(); }
      if (e.target.id === 'lg-source') { V.source = e.target.value; reload(); }
    });
    var t = null;
    el.addEventListener('input', function (e) { if (e.target.id === 'lg-q') { V.q = e.target.value; clearTimeout(t); t = setTimeout(reload, 350); } });
  }

  var root = S.registerApp({
    id: 'logs', icon: ICON_APP, titleKey: 'lg_app_name', titleDef: 'Event Viewer', w: 1120, h: 660, html: HTML,
    onOpen: function () { bind(); V.d = null; V.error = null; V.rows = []; V.sel = null; draw(); load(false); clearInterval(V.timer); V.timer = setInterval(function () { if (S.winOpen('logs') && !V.q && !V.sel && !V.more) load(false); }, 15000); },
    onClose: function () { clearInterval(V.timer); },
    onReset: function () { V.d = null; V.rows = []; V.kind = 'security'; V.level = ''; V.source = ''; V.q = ''; V.sel = null; },
    onLocale: function () { draw(); }
  });
  if (root) bind();
})();
