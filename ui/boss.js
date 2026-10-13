/* Business Manager (Boss app) for Los Santos OS. Registers itself with LSOS.registerApp. Every call goes through the
   'bossApi' NUI callback (client/boss.lua) and the server re-checks the job and boss grade each time.
   Tabs: Overview, Employees, Hiring, Finances (view only). */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function esc(s) { return S.esc(s); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2.6" fill="#0f6cbd"/><path d="M8.5 7V5.6A1.6 1.6 0 0 1 10.1 4h3.8a1.6 1.6 0 0 1 1.6 1.6V7" fill="none" stroke="#0f6cbd" stroke-width="1.8"/><rect x="2" y="12" width="20" height="2" fill="#7db7ee"/><rect x="10.4" y="11" width="3.2" height="4" rx=".8" fill="#fff"/></svg>';

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/bossApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }

  var B = { tab: 'overview', loading: false, d: {}, hire: { mode: 'nearby', grade: 0, id: '' }, timer: null };
  var TABS = [['overview', 'bs_tab_overview', 'Overview'], ['employees', 'bs_tab_employees', 'Employees'], ['hiring', 'bs_tab_hiring', 'Hiring'], ['finances', 'bs_tab_finances', 'Finances']];

  var ERR = { not_boss: ['bs_err_boss', 'Only the boss can use the Business Manager.'], not_authorised: ['bs_err_auth', 'You are not allowed to do that.'], busy: ['bs_err_busy', 'Slow down, try again in a moment.'],
    invalid: ['bs_err_invalid', 'That change is not allowed.'], far: ['bs_err_far', 'That person is too far away.'], not_found: ['bs_err_notfound', 'Nobody found with that ID.'],
    already: ['bs_err_already', 'They already work here.'], error: ['bs_err_error', 'Something went wrong.'], network: ['bs_err_network', 'Could not reach the server.'] };
  function errText(r) { var e = ERR[r && r.reason] || ERR.error; return T(e[0], e[1]); }

  function money(n) {
    if (n == null) return '-';
    var cur = (B.d.overview && B.d.overview.currency) || (B.d.finances && B.d.finances.currency) || '$';
    return cur + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function toast(msg) {
    var main = $('bs'); if (!main) return;
    var old = main.querySelector('.ak-toast'); if (old) old.remove();
    var el = document.createElement('div'); el.className = 'ak-toast'; el.textContent = msg; main.appendChild(el);
    setTimeout(function () { el.remove(); }, 2400);
  }

  var HTML = '<div class="ak" id="bs"><div class="ak-rail" id="bs-rail"></div><div class="ak-main"><div class="ak-top" id="bs-top"></div><div class="ak-body" id="bs-body"></div></div></div>';

  function load(which) {
    B.loading = true; draw();
    return api(which).then(function (r) {
      B.loading = false;
      if (r.ok) B.d[which] = r.data; else B.error = errText(r);
      if (r.ok) B.error = null;
      draw();
    });
  }

  function tabLoad() {
    if (B.tab === 'overview') return load('overview');
    if (B.tab === 'employees') return load('employees');
    if (B.tab === 'finances') return load('finances');
    if (B.tab === 'hiring') return Promise.all([load('employees'), loadNearby()]);
  }
  function loadNearby() { return api('nearby').then(function (r) { B.d.nearby = r.ok ? r.data.rows : []; draw(); }); }

  function drawRail() {
    var job = B.d.overview && B.d.overview.job ? B.d.overview.job.label : '';
    var h = '<div class="ak-brand">' + esc(T('bs_app_name', 'Business Manager')) + '<small>' + esc(job) + '</small></div>';
    TABS.forEach(function (t) { h += '<button class="ak-nav' + (B.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + esc(T(t[1], t[2])) + '</button>'; });
    $('bs-rail').innerHTML = h;
    var cur = TABS.filter(function (t) { return t[0] === B.tab; })[0];
    $('bs-top').innerHTML = '<h2>' + esc(T(cur[1], cur[2])) + '</h2><button class="ak-btn sm" data-act="refresh">' + esc(T('bs_refresh', 'Refresh')) + '</button>';
  }

  function viewOverview() {
    var o = B.d.overview; if (!o) return '';
    var cards = [[o.staff, T('bs_staff', 'Staff')], [o.online, T('bs_online', 'Online now')], [money(o.payroll), T('bs_payroll', 'Payroll per cycle')], [o.balance == null ? T('bs_no_bank', 'No bank') : money(o.balance), T('bs_balance', 'Society balance')]];
    var h = '<div class="ak-cards">';
    cards.forEach(function (c) { h += '<div class="ak-card"><b>' + esc(c[0]) + '</b><span>' + esc(c[1]) + '</span></div>'; });
    return h + '</div><p class="ak-mute">' + esc(T('bs_overview_note', 'Manage your staff in Employees and Hiring. Money moves in your banking app; the Finances tab shows how the balance changes.')) + '</p>';
  }

  function gradeSelect(grades, cur, max, attrs) {
    var h = '<select ' + attrs + '>';
    grades.forEach(function (g) { if (g.grade <= max) h += '<option value="' + g.grade + '"' + (g.grade === cur ? ' selected' : '') + '>' + esc(g.label) + ' (' + g.grade + ')</option>'; });
    return h + '</select>';
  }

  function viewEmployees() {
    var e = B.d.employees; if (!e) return '';
    if (!e.rows.length) return '<div class="ak-empty">' + esc(T('bs_none', 'Nobody works here yet.')) + '</div>';
    var h = '<table><tr><th>' + esc(T('bs_name', 'Name')) + '</th><th>' + esc(T('bs_grade', 'Grade')) + '</th><th>' + esc(T('bs_status', 'Status')) + '</th><th></th></tr>';
    e.rows.forEach(function (r, i) {
      var acts = '';
      if (r.canManage) {
        acts = gradeSelect(e.grades, r.grade, e.maxGrade, 'data-grade="' + i + '"') + ' <button class="ak-btn sm" data-act="setgrade" data-i="' + i + '">' + esc(T('bs_apply', 'Apply')) + '</button> <button class="ak-btn sm bad" data-act="fire" data-i="' + i + '">' + esc(T('bs_fire', 'Fire')) + '</button>';
      }
      h += '<tr><td><b>' + esc(r.name || r.id) + '</b>' + (r.self ? ' <span class="ak-tag">' + esc(T('bs_you', 'You')) + '</span>' : '') + '</td><td>' + esc(r.gradeLabel) + '</td>' +
        '<td>' + (r.online ? '<span class="ak-tag good">' + esc(T('bs_online_tag', 'Online')) + '</span>' : '<span class="ak-mute">' + esc(T('bs_offline', 'Offline')) + '</span>') + '</td><td><div class="ak-acts">' + acts + '</div></td></tr>';
    });
    return h + '</table>';
  }

  function viewHiring() {
    var e = B.d.employees || { grades: [], maxGrade: 0 };
    var hire = B.hire, start = Math.min(hire.grade, e.maxGrade);
    var h = '<div class="ak-bar"><button class="ak-btn' + (hire.mode === 'nearby' ? ' pri' : '') + '" data-act="mode" data-m="nearby">' + esc(T('bs_nearby', 'Nearby')) + '</button>' +
      '<button class="ak-btn' + (hire.mode === 'id' ? ' pri' : '') + '" data-act="mode" data-m="id">' + esc(T('bs_by_id', 'By ID')) + '</button>' +
      '<span class="ak-mute">' + esc(T('bs_start_grade', 'Start as')) + '</span>' + gradeSelect(e.grades, start, e.maxGrade, 'id="bs-hgrade"') + '</div>';
    if (hire.mode === 'nearby') {
      var rows = B.d.nearby || [];
      if (!rows.length) return h + '<div class="ak-empty">' + esc(T('bs_nobody_near', 'Nobody is standing close enough.')) + '</div>';
      h += '<table><tr><th>' + esc(T('bs_name', 'Name')) + '</th><th>' + esc(T('bs_job', 'Current job')) + '</th><th></th></tr>';
      rows.forEach(function (r, i) { h += '<tr><td><b>' + esc(r.name) + '</b></td><td class="ak-mute">' + esc(r.job) + '</td><td><button class="ak-btn sm pri" data-act="hire" data-i="' + i + '">' + esc(T('bs_hire', 'Hire')) + '</button></td></tr>'; });
      return h + '</table>';
    }
    return h + '<div class="ak-bar"><input id="bs-id" placeholder="' + esc(T('bs_id_hint', 'Server ID or character ID')) + '" value="' + esc(hire.id) + '" style="flex:1;min-width:200px"><button class="ak-btn pri" data-act="hireid">' + esc(T('bs_hire', 'Hire')) + '</button></div>' +
      '<p class="ak-mute">' + esc(T('bs_id_note', 'A server ID must be a player standing nearby. A character ID can be someone offline.')) + '</p>';
  }

  function chart(hist) {
    if (!hist || hist.length < 2) return '<div class="ak-empty">' + esc(T('bs_chart_wait', 'The chart fills in as the balance is sampled over time.')) + '</div>';
    var W = 760, H = 220, P = 36, minV = Infinity, maxV = -Infinity, t0 = hist[0].at, t1 = hist[hist.length - 1].at;
    hist.forEach(function (p) { minV = Math.min(minV, p.balance); maxV = Math.max(maxV, p.balance); });
    if (maxV === minV) { maxV += 1; minV -= 1; }
    var span = Math.max(1, t1 - t0), pts = hist.map(function (p) {
      return (P + (p.at - t0) / span * (W - P * 1.4)).toFixed(1) + ',' + (H - P - (p.balance - minV) / (maxV - minV) * (H - P * 1.6)).toFixed(1);
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-height:260px;background:var(--k-card);border:1px solid var(--k-line);border-radius:8px">' +
      '<polyline fill="none" stroke="var(--k-acc)" stroke-width="2.4" stroke-linejoin="round" points="' + pts.join(' ') + '"/>' +
      '<text x="' + P + '" y="18" font-size="12" fill="var(--k-sub)">' + esc(money(maxV)) + '</text><text x="' + P + '" y="' + (H - 10) + '" font-size="12" fill="var(--k-sub)">' + esc(money(minV)) + '</text></svg>';
  }

  function viewFinances() {
    var f = B.d.finances; if (!f) return '';
    B.d.overview = B.d.overview || { currency: f.currency };
    var h = '<div class="ak-cards"><div class="ak-card"><b>' + esc(f.balance == null ? T('bs_no_bank', 'No bank') : money(f.balance)) + '</b><span>' + esc(T('bs_balance', 'Society balance')) + '</span></div>' +
      '<div class="ak-card"><b>' + esc(money(f.payroll)) + '</b><span>' + esc(T('bs_payroll', 'Payroll per cycle')) + '</span></div></div>';
    h += '<h3>' + esc(T('bs_last14', 'Balance, last 14 days')) + '</h3>' + chart(f.history);
    return h + '<p class="ak-mute">' + esc(T('bs_fin_note', 'View only. Deposits and withdrawals are made in your banking app.')) + '</p>';
  }

  function draw() {
    if (!$('bs')) return;
    drawRail();
    var body = $('bs-body'), scroll = body.scrollTop;
    if (B.error) { body.innerHTML = '<div class="ak-empty">' + esc(B.error) + '</div>'; return; }
    if (B.loading && !B.d[B.tab === 'hiring' ? 'employees' : B.tab]) { body.innerHTML = '<div class="ak-empty">' + esc(T('bs_loading', 'Loading...')) + '</div>'; return; }
    body.innerHTML = B.tab === 'overview' ? viewOverview() : B.tab === 'employees' ? viewEmployees() : B.tab === 'hiring' ? viewHiring() : viewFinances();
    body.scrollTop = scroll;
  }

  function act(call, data, ok) {
    return api(call, data).then(function (r) {
      if (r.ok) { toast(ok); return tabLoad(); }
      toast(errText(r));
    });
  }

  function bind() {
    var el = $('bs'); if (!el || el.__b) return; el.__b = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tab) { B.tab = b.dataset.tab; B.error = null; return tabLoad(); }
      var a = b.dataset.act, i = Number(b.dataset.i);
      var emp = B.d.employees && B.d.employees.rows;
      if (a === 'refresh') return tabLoad();
      if (a === 'mode') { B.hire.mode = b.dataset.m; return draw(); }
      if (a === 'setgrade') {
        var sel = el.querySelector('select[data-grade="' + i + '"]');
        return act('setGrade', { id: emp[i].id, grade: Number(sel.value) }, T('bs_saved', 'Saved.'));
      }
      if (a === 'fire') {
        var r = emp[i];
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = T('bs_fire_sure', 'Click again to fire'); return; }
        return act('fire', { id: r.id }, T('bs_fired', 'Fired.'));
      }
      var g = Number(($('bs-hgrade') || {}).value || 0); B.hire.grade = g;
      if (a === 'hire') return act('hire', { src: B.d.nearby[i].src, grade: g }, T('bs_hired', 'Hired.'));
      if (a === 'hireid') {
        var v = ($('bs-id').value || '').trim(); B.hire.id = v;
        if (!v) return;
        return act('hire', /^\d{1,5}$/.test(v) ? { serverId: Number(v), grade: g } : { cid: v, grade: g }, T('bs_hired', 'Hired.'));
      }
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'bs-hgrade') B.hire.grade = Number(e.target.value); });
  }

  var root = S.registerApp({
    id: 'boss', icon: ICON_APP, titleKey: 'bs_app_name', titleDef: 'Business Manager', w: 980, h: 640, html: HTML,
    onOpen: function () { bind(); B.error = null; tabLoad(); clearInterval(B.timer); B.timer = setInterval(function () { if (S.winOpen('boss') && B.tab !== 'hiring') tabLoad(); }, 30000); },
    onClose: function () { clearInterval(B.timer); },
    onReset: function () { B.d = {}; B.tab = 'overview'; B.error = null; },
    onLocale: function () { draw(); }
  });
  if (root) bind();
})();
