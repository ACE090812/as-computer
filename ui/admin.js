/* Admin panel (/pcadmin). Opened by client/admin.lua ({ action: 'adminOpen' }). The page only asks the server
   (the 'adminApi' NUI callback -> MotCallback); the server checks Bridge.IsAdmin on every call. Standalone:
   it builds its own overlay and does not touch the desktop. */
(function () {
  'use strict';
  if (/[?&]dui=1/.test(location.search)) return;

  var strings = {};
  var gdata = null, cdata = null, cq = '', bets = null, root = null, panel = null, tab = 'overview', data = null, timer = null, refreshMs = 5000, search = '', open = false;

  function T(key, def) { return strings[key] || def; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function res() { return 'https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/'; }
  function post(path, body) {
    return fetch(res() + path, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  function api(name, d) { return post('adminApi', { name: name, data: d }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false }; }); }

  var TABS = [['overview', 'adm_tab_overview', 'Overview'], ['computers', 'adm_tab_computers', 'Computers'], ['place', 'adm_tab_place', 'Place'],
    ['props', 'adm_tab_props', 'Props'], ['games', 'adm_tab_games', 'Games'], ['casino', 'adm_tab_casino', 'Casino'], ['log', 'adm_tab_log', 'Log']];
  var KIND = { computer: ['adm_kind_computer', 'Computer'], tv: ['adm_kind_tv', 'TV'], printer: ['adm_kind_printer', 'Printer'], prop: ['adm_kind_prop', 'Prop'] };

  function build() {
    root = document.createElement('div');
    root.id = 'adm';
    root.innerHTML = '<div class="panel"><div class="side"></div><div class="main"><div class="head"></div><div class="body"></div></div></div>';
    document.body.appendChild(root);
    panel = root.querySelector('.panel');
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });
    document.addEventListener('keydown', function (e) { if (open && e.key === 'Escape') { if (root.querySelector('.dlg')) dlgClose(); else close(); } });
  }

  function toast(msg) {
    var old = root.querySelector('.toast'); if (old) old.remove();
    var el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; panel.appendChild(el);
    setTimeout(function () { el.remove(); }, 2400);
  }
  function fail(r) { toast((r && r.reason === 'not_authorised') ? T('adm_err_auth', 'Not authorised.') : T('adm_err', 'That did not work.')); }

  // ---- dialogs ------------------------------------------------------------------------------------------------
  function dlgClose() { var d = root.querySelector('.dlg'); if (d) d.remove(); }
  function dialog(title, fields, okLabel, onOk, danger) {
    dlgClose();
    var d = document.createElement('div'); d.className = 'dlg';
    var html = '<div><b>' + esc(title) + '</b>';
    fields.forEach(function (f, i) {
      if (f.text) html += '<div class="mute">' + esc(f.text) + '</div>';
      else html += '<label>' + esc(f.label) + '<input data-i="' + i + '" value="' + esc(f.value || '') + '" placeholder="' + esc(f.hint || '') + '" maxlength="' + (f.max || 80) + '"></label>';
    });
    html += '<div class="row"><button class="btn" data-x="no">' + esc(T('adm_cancel', 'Cancel')) + '</button><button class="btn ' + (danger ? 'bad' : 'pri') + '" data-x="ok">' + esc(okLabel) + '</button></div></div>';
    d.innerHTML = html;
    panel.appendChild(d);
    var first = d.querySelector('input'); if (first) { first.focus(); first.select(); }
    d.addEventListener('click', function (e) {
      var x = e.target.getAttribute && e.target.getAttribute('data-x');
      if (e.target === d || x === 'no') return dlgClose();
      if (x === 'ok') {
        var vals = []; d.querySelectorAll('input').forEach(function (inp) { vals.push(inp.value); });
        dlgClose(); onOk(vals);
      }
    });
    d.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var ok = d.querySelector('[data-x="ok"]'); if (ok) ok.click(); } });
  }

  // ---- data ---------------------------------------------------------------------------------------------------
  function refresh() {
    return api('snapshot').then(function (r) {
      if (!open) return;
      if (!r.ok) return fail(r);
      data = r.data;
      draw(true);
      loadExtra();
    });
  }
  function money(n) { n = Math.round(Number(n) || 0); return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-GB'); }
  function loadExtra() {
    if (tab === 'games') api('games').then(function (r) { if (open && r.ok) { gdata = r.games; if (tab === 'games') draw(true); } });
    if (tab === 'casino') {
      api('casino', { action: 'overview' }).then(function (r) { if (!open) return; cdata = r.ok ? r : { off: true }; if (tab === 'casino') draw(true); });
      api('casino', { action: 'accounts', data: { query: cq } }).then(function (r) { if (open && r.ok) { cdata = cdata || {}; cdata.rows = r.rows; if (tab === 'casino') draw(true); } });
    }
  }
  function viewGames() {
    if (!gdata) return '<div class="empty">' + esc(T('adm_loading', 'Loading...')) + '</div>';
    var h = '<table><tr><th>' + esc(T('adm_game', 'Game')) + '</th><th>' + esc(T('adm_installs', 'Installed')) + '</th><th>' + esc(T('adm_players', 'Players')) + '</th><th>' + esc(T('adm_plays', 'Plays')) + '</th><th>' + esc(T('adm_plays24', 'Last 24h')) + '</th><th>' + esc(T('adm_status', 'Status')) + '</th><th></th></tr>';
    gdata.forEach(function (g, i) {
      h += '<tr><td>' + esc(g.name) + '</td><td>' + g.installs + '</td><td>' + g.players + '</td><td>' + g.plays + '</td><td>' + g.recent + '</td><td><span class="tag ' + (g.enabled ? 'good' : 'warn') + '">' + esc(g.enabled ? T('adm_on', 'On') : T('adm_off', 'Off')) + '</span></td>' +
        '<td><button class="btn sm" data-a="gtoggle" data-i="' + i + '">' + esc(g.enabled ? T('adm_turn_off', 'Turn off') : T('adm_turn_on', 'Turn on')) + '</button><button class="btn sm bad" data-a="greset" data-i="' + i + '">' + esc(T('adm_reset_board', 'Reset leaderboard')) + '</button></td></tr>';
    });
    return h + '</table><div class="mute" style="margin-top:10px">' + esc(T('adm_games_note', 'Turning a game off stops it opening and hides it from players. Resetting clears its leaderboard and stats; saved games stay.')) + '</div>';
  }
  function viewCasino() {
    if (!cdata) return '<div class="empty">' + esc(T('adm_loading', 'Loading...')) + '</div>';
    if (cdata.off) return '<div class="empty">' + esc(T('adm_no_casino', 'The Diamond Online casino (as-browser) is not running.')) + '</div>';
    var h = '<div class="bar"><b style="flex:1">' + esc(T('adm_casino_betting', 'Betting')) + ': <span class="tag ' + (cdata.open ? 'good' : 'warn') + '">' + esc(cdata.open ? T('adm_on', 'On') : T('adm_off', 'Off')) + '</span></b>' +
      '<button class="btn sm" data-a="cswitch">' + esc(cdata.open ? T('adm_casino_stop', 'Emergency stop') : T('adm_casino_start', 'Open betting')) + '</button></div>';
    h += '<div class="cards"><div class="card"><b>' + (cdata.accounts || 0) + '</b><span>' + esc(T('adm_c_accounts', 'Accounts')) + '</span></div><div class="card"><b>' + money(cdata.held) + '</b><span>' + esc(T('adm_c_held', 'Held in site balances')) + '</span></div>' +
      '<div class="card"><b>' + money(cdata.houseToday) + '</b><span>' + esc(T('adm_c_house', 'House result today')) + '</span></div><div class="card"><b>' + money(cdata.jackpot) + '</b><span>' + esc(T('adm_c_jackpot', 'Slots jackpot pool')) + '</span></div></div>';
    h += '<h3>' + esc(T('adm_c_bygame', 'Today by game')) + '</h3><table><tr><th>' + esc(T('adm_game', 'Game')) + '</th><th>' + esc(T('adm_c_bets', 'Bets')) + '</th><th>' + esc(T('adm_c_wagered', 'Wagered')) + '</th><th>' + esc(T('adm_c_paid', 'Paid out')) + '</th><th>' + esc(T('adm_c_hr', 'House')) + '</th></tr>';
    (cdata.games || []).forEach(function (g) { var hr = (g.wagered || 0) - (g.paid || 0); h += '<tr><td>' + esc(g.game) + '</td><td>' + g.bets + '</td><td>' + money(g.wagered) + '</td><td>' + money(g.paid) + '</td><td style="color:' + (hr < 0 ? 'var(--bad,#c42b1c)' : 'inherit') + '">' + money(hr) + '</td></tr>'; });
    if (!(cdata.games || []).length) h += '<tr><td colspan="5" class="mute">' + esc(T('adm_nolog', 'Nothing logged yet.')) + '</td></tr>';
    h += '</table><h3 style="margin-top:16px">' + esc(T('adm_c_accts', 'Accounts')) + '</h3><div class="bar"><input id="adm-cq" placeholder="' + esc(T('adm_search', 'Search')) + '" value="' + esc(cq) + '" style="flex:1"></div><table><tr><th>' + esc(T('adm_c_user', 'Username')) + '</th><th>' + esc(T('adm_c_char', 'Character')) + '</th><th>' + esc(T('adm_c_bal', 'Balance')) + '</th><th>' + esc(T('adm_status', 'Status')) + '</th><th></th></tr>';
    (cdata.rows || []).forEach(function (a, i) {
      h += '<tr><td>' + esc(a.username) + '</td><td>' + esc(a.name) + '</td><td>' + money(a.balance) + '</td><td><span class="tag ' + (a.status === 'active' ? 'good' : 'warn') + '">' + esc(a.status) + '</span></td><td>' +
        (a.status === 'closed' ? '' : '<button class="btn sm ' + (a.status === 'frozen' ? '' : 'bad') + '" data-a="cfreeze" data-i="' + i + '">' + esc(a.status === 'frozen' ? T('adm_c_unfreeze', 'Unfreeze') : T('adm_c_freeze', 'Freeze')) + '</button>') + '</td></tr>';
    });
    return h + '</table><div class="mute" style="margin-top:10px">' + esc(T('adm_c_note', 'A frozen account cannot bet or deposit but can still withdraw. Every bet and payout is stored in the casino_bets table.')) + '</div>';
  }
  function act(name, d, okMsg) {
    return api(name, d).then(function (r) { if (r.ok) { toast(okMsg || T('adm_done', 'Done.')); refresh(); } else fail(r); return r; });
  }

  // ---- drawing ------------------------------------------------------------------------------------------------
  function drawChrome() {
    var side = root.querySelector('.side');
    var h = '<div class="brand">' + esc(T('adm_title', 'Computer admin')) + '<small>' + esc(T('adm_sub', 'Los Santos OS')) + '</small></div>';
    TABS.forEach(function (t) { h += '<button class="tab' + (tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + esc(T(t[1], t[2])) + '</button>'; });
    h += '<div class="grow"></div><button class="btn" data-close="1">' + esc(T('adm_close', 'Close')) + '</button>';
    side.innerHTML = h;
    var cur = TABS.filter(function (t) { return t[0] === tab; })[0];
    root.querySelector('.head').innerHTML = '<h2>' + esc(T(cur[1], cur[2])) + '</h2><button class="btn sm" data-refresh="1">' + esc(T('adm_refresh', 'Refresh')) + '</button>';
  }

  function sessionTag(s) {
    if (!s) return '<span class="mute">-</span>';
    var label = s.state === 'active' ? T('adm_active', 'In use') : T('adm_locked', 'Locked');
    return '<span class="tag ' + (s.state === 'active' ? 'good' : 'warn') + '">' + esc(label) + '</span> ' + esc(s.name || '');
  }

  function viewOverview() {
    var s = data.stats;
    var cards = [['computers', 'adm_s_computers', 'Computers'], ['tvs', 'adm_s_tvs', 'TVs'], ['printers', 'adm_s_printers', 'Printers'], ['props', 'adm_s_props', 'Props'],
      ['active', 'adm_s_active', 'In use now'], ['locked', 'adm_s_locked', 'Locked'], ['setup', 'adm_s_setup', 'Not set up']];
    var h = '<div class="cards">';
    cards.forEach(function (c) { h += '<div class="card"><b>' + (s[c[0]] || 0) + '</b><span>' + esc(T(c[1], c[2])) + '</span></div>'; });
    h += '</div><h3>' + esc(T('adm_recent', 'Recent admin actions')) + '</h3>' + logTable(data.log.slice(0, 8));
    return h;
  }

  function logTable(rows) {
    if (!rows.length) return '<div class="empty">' + esc(T('adm_nolog', 'Nothing logged yet.')) + '</div>';
    var h = '<table><tr><th>' + esc(T('adm_when', 'When')) + '</th><th>' + esc(T('adm_who', 'Admin')) + '</th><th>' + esc(T('adm_action', 'Action')) + '</th><th>' + esc(T('adm_detail', 'Detail')) + '</th></tr>';
    rows.forEach(function (r) {
      var ago = Math.max(0, (data.now || 0) - r.at), txt = ago < 90 ? ago + 's' : ago < 5400 ? Math.round(ago / 60) + 'm' : ago < 129600 ? Math.round(ago / 3600) + 'h' : Math.round(ago / 86400) + 'd';
      h += '<tr><td class="mute">' + txt + ' ' + esc(T('adm_ago', 'ago')) + '</td><td>' + esc(r.admin) + '</td><td><span class="tag">' + esc(r.action) + '</span></td><td>' + esc(r.detail) + '</td></tr>';
    });
    return h + '</table>';
  }

  function viewComputers() {
    var q = search.toLowerCase();
    var rows = data.entries.filter(function (e) { return !q || (e.label + ' ' + (e.variantLabel || '') + ' ' + e.kind + ' ' + (e.owner || '') + ' ' + ((e.session && e.session.name) || '') + ' ' + (e.key || '')).toLowerCase().indexOf(q) >= 0; });
    var h = '<div class="bar"><input id="adm-q" placeholder="' + esc(T('adm_search', 'Search')) + '" value="' + esc(search) + '" style="flex:1;min-width:200px"></div>';
    if (!rows.length) return h + '<div class="empty">' + esc(T('adm_none', 'Nothing here yet.')) + '</div>';
    h += '<table><tr><th>' + esc(T('adm_name', 'Name')) + '</th><th>' + esc(T('adm_type', 'Type')) + '</th><th>' + esc(T('adm_lock', 'Locked to')) + '</th><th>' + esc(T('adm_owner', 'Owner')) + '</th><th>' + esc(T('adm_user', 'User')) + '</th><th></th></tr>';
    rows.forEach(function (e, i) {
      var idx = data.entries.indexOf(e);
      var k = KIND[e.kind] || ['', e.kind];
      var lock = e.job || (e.jobs && e.jobs.join(', ')) || '';
      var a = '<button class="btn sm" data-a="tp" data-i="' + idx + '">' + esc(T('adm_tp', 'Teleport')) + '</button>';
      if (!e.builtin) {
        a += '<button class="btn sm" data-a="move" data-i="' + idx + '">' + esc(T('adm_move', 'Move')) + '</button>';
        a += '<button class="btn sm" data-a="edit" data-i="' + idx + '">' + esc(T('adm_edit', 'Edit')) + '</button>';
      }
      if (e.session) {
        if (e.session.state === 'active') a += '<button class="btn sm" data-a="lock" data-i="' + idx + '">' + esc(T('adm_dolock', 'Lock')) + '</button>';
        a += '<button class="btn sm" data-a="kick" data-i="' + idx + '">' + esc(T('adm_kick', 'Kick')) + '</button>';
      }
      if (e.key && (e.accounts || 0) > 0) a += '<button class="btn sm bad" data-a="reset" data-i="' + idx + '">' + esc(T('adm_reset', 'Reset accounts')) + '</button>';
      if (!e.builtin) a += '<button class="btn sm bad" data-a="del" data-i="' + idx + '">' + esc(T('adm_delete', 'Delete')) + '</button>';
      h += '<tr><td><b>' + esc(e.label) + '</b><div class="mute">' + (e.builtin ? esc(T('adm_builtin', 'Built in')) : '#' + e.id) + (e.variantLabel ? ' · ' + esc(e.variantLabel) : '') + '</div></td>' +
        '<td>' + esc(T(k[0], k[1])) + '</td><td>' + (lock ? esc(lock) : '<span class="mute">-</span>') + '</td>' +
        '<td>' + (e.key ? (e.owner ? esc(e.owner) : '<span class="tag warn">' + esc(T('adm_unset', 'Not set up')) + '</span>') : '<span class="mute">-</span>') + '</td>' +
        '<td>' + sessionTag(e.session) + '</td><td><div class="acts">' + a + '</div></td></tr>';
    });
    return h + '</table>';
  }

  function viewPlace() {
    var h = '';
    [['computer', 'adm_pl_computer', 'Computers'], ['tv', 'adm_pl_tv', 'TVs'], ['printer', 'adm_pl_printer', 'Printers']].forEach(function (g) {
      var list = data.variants[g[0]] || [];
      h += '<h3>' + esc(T(g[1], g[2])) + '</h3>';
      if (!list.length) { h += '<div class="mute">' + esc(T('adm_nomodels', 'No models in the config.')) + '</div>'; return; }
      h += '<div class="grid">';
      list.forEach(function (label, i) { h += '<button class="opt" data-place="' + g[0] + '" data-v="' + (i + 1) + '"><b>' + esc(label) + '</b><small>' + esc(T('adm_place_hint', 'Click to place')) + '</small></button>'; });
      h += '</div>';
    });
    h += '<h3>' + esc(T('adm_pl_prop', 'Custom props')) + '</h3>';
    if (!data.props.length) h += '<div class="mute">' + esc(T('adm_noprops', 'Add props in the Props tab.')) + '</div>';
    else {
      h += '<div class="grid">';
      data.props.forEach(function (p) { h += '<button class="opt" data-place="prop" data-v="' + p.id + '" data-model="' + esc(p.model) + '" data-label="' + esc(p.label) + '"><b>' + esc(p.label) + '</b><small>' + esc(p.model) + '</small></button>'; });
      h += '</div>';
    }
    return h;
  }

  function viewProps() {
    var h = '<div class="bar"><button class="btn pri" data-a="propadd">' + esc(T('adm_addprop', 'Add prop')) + '</button></div>';
    if (!data.props.length) return h + '<div class="empty">' + esc(T('adm_noprops', 'No custom props yet.')) + '</div>';
    h += '<table><tr><th>' + esc(T('adm_name', 'Name')) + '</th><th>' + esc(T('adm_model', 'Model')) + '</th><th></th></tr>';
    data.props.forEach(function (p, i) {
      h += '<tr><td><b>' + esc(p.label) + '</b></td><td class="mute">' + esc(p.model) + '</td><td><div class="acts"><button class="btn sm bad" data-a="propdel" data-i="' + i + '">' + esc(T('adm_delete', 'Delete')) + '</button></div></td></tr>';
    });
    return h + '</table><p class="mute">' + esc(T('adm_prop_note', 'Props are decorative: removing one also removes every copy placed in the world.')) + '</p>';
  }

  function draw(keepFocus) {
    if (!root) return;
    var body = root.querySelector('.body'), scroll = body.scrollTop;
    var q = keepFocus && document.activeElement && document.activeElement.id === 'adm-q';
    drawChrome();
    if (!data) { body.innerHTML = '<div class="empty">' + esc(T('adm_loading', 'Loading...')) + '</div>'; return; }
    body.innerHTML = tab === 'overview' ? viewOverview() : tab === 'computers' ? viewComputers() : tab === 'place' ? viewPlace() : tab === 'props' ? viewProps() : tab === 'games' ? viewGames() : tab === 'casino' ? viewCasino() : logTable(data.log);
    body.scrollTop = scroll;
    if (q) { var inp = $q(); if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
  }
  function $q() { return root.querySelector('#adm-q'); }

  // ---- events -------------------------------------------------------------------------------------------------
  function onClick(e) {
    var el = e.target.closest ? e.target.closest('button') : null;
    if (!el || !root.contains(el)) return;
    if (el.dataset.tab) { tab = el.dataset.tab; draw(); return loadExtra(); }
    if (el.dataset.close) return close();
    if (el.dataset.refresh) return refresh();
    if (el.dataset.place) {
      var kind = el.dataset.place;
      post('adminPlace', { kind: kind, variant: Number(el.dataset.v), model: el.dataset.model || '', label: el.dataset.label || '' });
      return;
    }
    var a = el.dataset.a; if (!a) return;
    if (a === 'gtoggle' || a === 'greset') {
      var g = gdata[Number(el.dataset.i)];
      if (a === 'gtoggle') return act('gamesToggle', { game: g.id, enabled: !g.enabled }, T('adm_done', 'Done.')).then(loadExtra);
      return dialog(T('adm_reset_board', 'Reset leaderboard'), [{ text: T('adm_reset_board_q', 'Clear every score and stat for this game?') + ' ' + g.name }], T('adm_reset_board', 'Reset leaderboard'), function () { act('gamesReset', { game: g.id }, T('adm_done', 'Done.')).then(loadExtra); }, true);
    }
    if (a === 'cswitch') {
      var want = !cdata.open;
      return dialog(want ? T('adm_casino_start', 'Open betting') : T('adm_casino_stop', 'Emergency stop'), [{ text: want ? T('adm_casino_start_q', 'Let players bet again?') : T('adm_casino_stop_q', 'Stop all betting now? Players can still withdraw and finish a game in progress.') }], want ? T('adm_casino_start', 'Open betting') : T('adm_casino_stop', 'Emergency stop'), function () { api('casino', { action: 'setOpen', data: { open: want } }).then(function (r) { if (r.ok) { toast(T('adm_done', 'Done.')); loadExtra(); } else fail(r); }); }, !want);
    }
    if (a === 'cfreeze') {
      var acc = cdata.rows[Number(el.dataset.i)];
      return api('casino', { action: 'freeze', data: { cid: acc.cid, frozen: acc.status !== 'frozen' } }).then(function (r) { if (r.ok) { toast(T('adm_done', 'Done.')); loadExtra(); } else fail(r); });
    }
    var ent = el.dataset.i != null ? (a === 'propdel' ? data.props[Number(el.dataset.i)] : data.entries[Number(el.dataset.i)]) : null;
    if (a === 'tp') return post('adminTeleport', { x: ent.x, y: ent.y, z: ent.z });
    if (a === 'move') return post('adminMove', { id: ent.id });
    if (a === 'edit') {
      var f = [{ label: T('adm_name', 'Name'), value: ent.label, max: 60 }];
      if (ent.kind === 'computer') f.push({ label: T('adm_lock_job', 'Lock to job (blank = none)'), value: ent.job || '', max: 40 });
      else if (ent.kind === 'tv') f.push({ label: T('adm_lock_jobs', 'Jobs that may cast (comma separated)'), value: (ent.jobs || []).join(', '), max: 200 });
      return dialog(T('adm_edit', 'Edit'), f, T('adm_save', 'Save'), function (v) {
        var d = { id: ent.id, label: v[0] };
        if (ent.kind === 'computer') d.job = (v[1] || '').trim().toLowerCase() || null;
        else if (ent.kind === 'tv') d.jobs = (v[1] || '').split(/[,\s]+/).filter(Boolean).map(function (j) { return j.toLowerCase(); });
        act('edit', d, T('adm_saved', 'Saved.'));
      });
    }
    if (a === 'lock') return act('lock', ent.key, T('adm_locked_ok', 'Locked.'));
    if (a === 'kick') return dialog(T('adm_kick', 'Kick'), [{ text: T('adm_kick_q', 'Shut the computer down for whoever is using it?') }], T('adm_kick', 'Kick'), function () { act('kick', ent.key, T('adm_kicked', 'Kicked.')); }, true);
    if (a === 'reset') return dialog(T('adm_reset', 'Reset accounts'), [{ text: T('adm_reset_q', 'Remove every account from this machine? It will ask to be set up again. Files and other data are kept.') }], T('adm_reset', 'Reset accounts'), function () { act('reset', ent.key, T('adm_reset_ok', 'Accounts reset.')); }, true);
    if (a === 'del') return dialog(T('adm_delete', 'Delete'), [{ text: T('adm_delete_q', 'Delete this for everyone?') + ' ' + ent.label }], T('adm_delete', 'Delete'), function () { act('delete', ent.id, T('adm_deleted', 'Deleted.')); }, true);
    if (a === 'propadd') return dialog(T('adm_addprop', 'Add prop'), [{ label: T('adm_name', 'Name'), max: 48 }, { label: T('adm_model', 'Model name'), hint: 'prop_laptop_01a', max: 80 }], T('adm_add', 'Add'), function (v) {
      api('propAdd', { label: v[0], model: v[1] }).then(function (r) {
        if (r.ok) { toast(T('adm_added', 'Added.')); refresh(); }
        else toast(r.reason === 'exists' ? T('adm_err_exists', 'That model is already added.') : r.reason === 'too_many' ? T('adm_err_many', 'Too many props.') : r.reason === 'invalid' ? T('adm_err_invalid', 'Enter a name and a model name.') : T('adm_err', 'That did not work.'));
      });
    });
    if (a === 'propdel') return dialog(T('adm_delete', 'Delete'), [{ text: T('adm_prop_del_q', 'Remove this prop and every copy placed in the world?') + ' ' + ent.label }], T('adm_delete', 'Delete'), function () { act('propRemove', ent.id, T('adm_deleted', 'Deleted.')); }, true);
  }

  function openPanel(msg) {
    if (!root) build();
    strings = msg.strings || {};
    refreshMs = Math.max(2000, Number(msg.refreshMs) || 5000);
    open = true; data = null; gdata = null; cdata = null; tab = 'overview'; search = '';
    root.classList.add('open');
    root.onclick = onClick;
    root.oninput = function (e) { if (e.target.id === 'adm-q') { search = e.target.value; draw(true); } else if (e.target.id === 'adm-cq') { cq = e.target.value; clearTimeout(window.__cqt); window.__cqt = setTimeout(loadExtra, 350); } };
    draw();
    refresh();
    clearInterval(timer);
    timer = setInterval(function () { if (open && !root.querySelector('.dlg')) refresh(); }, refreshMs);
  }
  function closePanel() { open = false; clearInterval(timer); if (root) { root.classList.remove('open'); dlgClose(); } }
  function close() { post('adminClose', {}); closePanel(); }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.action === 'adminOpen') openPanel(d);
    else if (d.action === 'adminClose') closePanel();
  });
})();
