/* Event Viewer (Logs app) for Los Santos OS. Registers itself with LSOS.registerApp. Reads this computer's Security, System
   and Boss logs through the 'logsApi' NUI callback (client/logs.lua). The server decides who may read: the machine's owner
   while signed in, and admins - everyone else gets an "access denied" page. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function esc(s) { return S.esc(s); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="3" y="2.5" width="18" height="19" rx="2.6" fill="#7c3aed"/><g stroke="#fff" stroke-width="1.7" stroke-linecap="round"><path d="M7 8h10M7 12h10M7 16h6"/></g><circle cx="17.5" cy="16.5" r="2.6" fill="#f59e0b"/></svg>';

  function api(data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/logsApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: 'list', data: data })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }

  var L = { kind: 'security', level: '', q: '', page: 1, d: null, loading: false, error: null, timer: null };
  var KINDS = [['security', 'lg_security', 'Security'], ['system', 'lg_system', 'System'], ['boss', 'lg_boss', 'Boss']];
  var LEVELS = [['', 'lg_all', 'All levels'], ['info', 'lg_info', 'Information'], ['warning', 'lg_warning', 'Warning'], ['error', 'lg_error', 'Error']];

  var HTML = '<div class="ak" id="lg"><div class="ak-rail" id="lg-rail"></div><div class="ak-main"><div class="ak-top" id="lg-top"></div><div class="ak-body" id="lg-body"></div></div></div>';

  function load(keepScroll) {
    L.loading = true;
    return api({ kind: L.kind, level: L.level, q: L.q, page: L.page }).then(function (r) {
      L.loading = false;
      if (r.ok) { L.d = r.data; L.error = null; if (L.d.page) L.page = L.d.page; }
      else L.error = r.reason === 'not_authorised' ? T('lg_err_auth', 'You are not allowed to open the Event Viewer.') : T('lg_err', 'Could not load the log.');
      draw(keepScroll);
    });
  }

  function fmt(at) {
    var d = new Date(at * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function draw(keepScroll) {
    if (!$('lg')) return;
    var counts = (L.d && L.d.counts) || {};
    var rail = '<div class="ak-brand">' + esc(T('lg_app_name', 'Event Viewer')) + '<small>' + esc(T('lg_sub', 'This computer')) + '</small></div>';
    KINDS.forEach(function (k) {
      rail += '<button class="ak-nav' + (L.kind === k[0] ? ' on' : '') + '" data-kind="' + k[0] + '">' + esc(T(k[1], k[2])) + (counts[k[0]] ? ' <span class="ak-mute">(' + counts[k[0]] + ')</span>' : '') + '</button>';
    });
    $('lg-rail').innerHTML = rail;

    var cur = KINDS.filter(function (k) { return k[0] === L.kind; })[0];
    var top = '<h2>' + esc(T(cur[1], cur[2])) + '</h2><select id="lg-level">';
    LEVELS.forEach(function (v) { top += '<option value="' + v[0] + '"' + (L.level === v[0] ? ' selected' : '') + '>' + esc(T(v[1], v[2])) + '</option>'; });
    top += '</select><input id="lg-q" placeholder="' + esc(T('lg_search', 'Search')) + '" value="' + esc(L.q) + '" style="width:180px"><button class="ak-btn sm" data-act="refresh">' + esc(T('lg_refresh', 'Refresh')) + '</button>';
    var hadFocus = document.activeElement && document.activeElement.id === 'lg-q';
    $('lg-top').innerHTML = top;
    if (hadFocus) { var qi = $('lg-q'); qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }

    var body = $('lg-body'), scroll = body.scrollTop;
    if (L.error) body.innerHTML = '<div class="ak-empty">' + esc(L.error) + '</div>';
    else if (!L.d) body.innerHTML = '<div class="ak-empty">' + esc(T('lg_loading', 'Loading...')) + '</div>';
    else if (L.d.canRead === false) body.innerHTML = '<div class="ak-empty"><b>' + esc(T('lg_denied', 'Access denied')) + '</b><br>' + esc(T('lg_denied_note', 'Only this computer\'s owner can read its logs. Sign in with the owner account.')) + '</div>';
    else {
      var rows = L.d.rows || [];
      if (!rows.length) body.innerHTML = '<div class="ak-empty">' + esc(T('lg_none', 'No events.')) + '</div>';
      else {
        var h = '<table><tr><th style="width:110px">' + esc(T('lg_level', 'Level')) + '</th><th style="width:160px">' + esc(T('lg_time', 'Date and time')) + '</th><th style="width:120px">' + esc(T('lg_event', 'Event')) + '</th><th style="width:150px">' + esc(T('lg_source', 'User')) + '</th><th>' + esc(T('lg_message', 'Message')) + '</th></tr>';
        rows.forEach(function (r) {
          var cls = r.level === 'error' ? 'bad' : r.level === 'warning' ? 'warn' : 'good';
          h += '<tr><td><span class="ak-tag ' + cls + '">' + esc(T('lg_' + r.level, r.level)) + '</span></td><td class="ak-mute">' + esc(fmt(r.at)) + '</td><td>' + esc(r.event) + '</td><td>' + esc(r.actor || '-') + '</td><td>' + esc(r.message) + '</td></tr>';
        });
        h += '</table><div class="ak-bar" style="margin-top:12px;justify-content:space-between"><span class="ak-mute">' + esc(T('lg_total', '%s events').replace('%s', L.d.total)) + '</span><span>' +
          '<button class="ak-btn sm" data-act="prev"' + (L.d.page <= 1 ? ' disabled' : '') + '>' + esc(T('lg_prev', 'Newer')) + '</button> <span class="ak-mute">' + L.d.page + ' / ' + L.d.pages + '</span> ' +
          '<button class="ak-btn sm" data-act="next"' + (L.d.page >= L.d.pages ? ' disabled' : '') + '>' + esc(T('lg_next', 'Older')) + '</button></span></div>';
        body.innerHTML = h;
      }
    }
    if (keepScroll) body.scrollTop = scroll;
  }

  function bind() {
    var el = $('lg'); if (!el || el.__b) return; el.__b = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.kind) { L.kind = b.dataset.kind; L.page = 1; return load(); }
      if (b.dataset.act === 'refresh') return load(true);
      if (b.dataset.act === 'prev' && L.page > 1) { L.page--; return load(); }
      if (b.dataset.act === 'next') { L.page++; return load(); }
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'lg-level') { L.level = e.target.value; L.page = 1; load(); } });
    var t = null;
    el.addEventListener('input', function (e) { if (e.target.id === 'lg-q') { L.q = e.target.value; L.page = 1; clearTimeout(t); t = setTimeout(load, 350); } });
  }

  var root = S.registerApp({
    id: 'logs', icon: ICON_APP, titleKey: 'lg_app_name', titleDef: 'Event Viewer', w: 1040, h: 640, html: HTML,
    onOpen: function () { bind(); L.d = null; L.error = null; load(); clearInterval(L.timer); L.timer = setInterval(function () { if (S.winOpen('logs') && !L.q) load(true); }, 15000); },
    onClose: function () { clearInterval(L.timer); },
    onReset: function () { L.d = null; L.kind = 'security'; L.level = ''; L.q = ''; L.page = 1; },
    onLocale: function () { draw(true); }
  });
  if (root) bind();
})();
