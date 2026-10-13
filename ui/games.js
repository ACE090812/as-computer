/* Games kit for Los Santos OS. Shared by Snake, Blocks, Solitaire, Chess, Connect 4 and Tic-tac-toe (ui/games/*.js).
   LSGames.register(def) builds the window (game area + side panel), loads the character's settings and saved game, plays sounds,
   submits results to the server ('gamesApi', client/games.lua) and shows the leaderboard, stats and settings pages.
     def = { id, name, tint, icon (svg), w, h, boxes: [{ key, label }], levels: ['Easy','Normal','Hard'], defaultLevel,
             pausable, hint, mainWidth, create(g), newGame(g), onLevel(g, i), onClose(g), resume(g, state), canSave }
   The kit object g gives a game: g.main, g.setBox, g.level, g.sound, g.finish, g.save, g.modal, g.clock helpers and keyboard hooks. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function post(path, body) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  function api(name, data) { return post('gamesApi', { name: name, data: data || {} }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'network' }; }); }

  var CONF = null;
  function config() { if (CONF) return Promise.resolve(CONF); return post('gamesConfig').then(function (c) { CONF = c || { music: [], chessClock: [5, 10, 15], pvp: true }; return CONF; }); }

  // ---- sound: effects are generated here, music comes from the files the server lists --------------------------------
  var AC = null;
  function actx() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur, type, vol, at) {
    var c = actx(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (at || 0);
    o.type = type || 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var FX = {
    click: [[620, .03, 'square']], move: [[300, .03, 'square']], place: [[260, .05, 'triangle'], [200, .05, 'triangle', .04]],
    eat: [[660, .05, 'square'], [990, .07, 'square', .05]], bonus: [[880, .05, 'triangle'], [1175, .05, 'triangle', .05], [1568, .1, 'triangle', .1]],
    clear: [[523, .06, 'square'], [659, .06, 'square', .06], [784, .1, 'square', .12]], rotate: [[420, .025, 'square']], drop: [[150, .08, 'sawtooth']],
    lose: [[330, .16, 'sawtooth'], [247, .16, 'sawtooth', .16], [165, .34, 'sawtooth', .32]], win: [[523, .1, 'triangle'], [659, .1, 'triangle', .1], [784, .1, 'triangle', .2], [1047, .25, 'triangle', .3]],
    capture: [[180, .07, 'sawtooth'], [120, .09, 'sawtooth', .05]], check: [[880, .08, 'square'], [880, .08, 'square', .12]], flip: [[500, .02, 'triangle']]
  };

  // ---- window kit ----------------------------------------------------------------------------------------------------
  var DEFAULT_PREFS = { master: 70, music: 40, effects: 85, mute: false, track: 0, difficulty: -1 };
  var KITS = {};

  function Kit(def, root) {
    var g = this;
    g.def = def; g.id = def.id; g.root = root; g.prefs = Object.assign({}, DEFAULT_PREFS); g.level = def.defaultLevel != null ? def.defaultLevel : 1;
    g.music = null; g.keys = []; g.ready = false; g.timers = [];
    root.innerHTML = '<div class="gm-body"><div class="gm-main"></div><div class="gm-side"></div></div><div class="gm-over"></div>';
    g.main = root.querySelector('.gm-main'); g.side = root.querySelector('.gm-side'); g.over = root.querySelector('.gm-over');
    g.over.addEventListener('mousedown', function (e) { if (e.target === g.over && g._dismiss) g.closeModal(); });
    g.buildSide();
    def.create(g);
    api('prefs', { game: def.id }).then(function (r) {
      if (r.ok && r.data && r.data.prefs) {
        g.prefs = Object.assign({}, DEFAULT_PREFS, r.data.prefs);
        if (def.levels && g.prefs.difficulty >= 0 && g.prefs.difficulty < def.levels.length) { g.level = g.prefs.difficulty; g.drawLevels(); if (def.onLevel) def.onLevel(g, g.level, true); }
      }
      g.ready = true; g.checkSave(); g.refreshMini();
    });
    // keys go to the game only while its window is the focused one
    window.addEventListener('keydown', function (e) {
      if (!g.isActive() || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      for (var i = 0; i < g.keys.length; i++) { if (g.keys[i](e) === true) { e.preventDefault(); return; } }
    });
  }
  Kit.prototype.isActive = function () { var w = document.getElementById('win-' + this.id); return !!(w && w.classList.contains('open') && !w.classList.contains('minimised') && w.classList.contains('active')); };
  Kit.prototype.onKey = function (fn) { this.keys.push(fn); };
  Kit.prototype.later = function (ms, fn) { var g = this, t = setTimeout(function () { fn(); }, ms); g.timers.push(t); return t; };
  Kit.prototype.clearTimers = function () { this.timers.forEach(clearTimeout); this.timers = []; };

  Kit.prototype.buildSide = function () {
    var g = this, d = g.def, h = '';
    if (d.boxes && d.boxes.length) {
      h += '<div class="gm-boxes">';
      d.boxes.forEach(function (b) { h += '<div class="gm-box"><small>' + esc(T('gm_' + b.key, b.label)) + '</small><b data-box="' + b.key + '">-</b></div>'; });
      h += '</div>';
    }
    if (d.extraSide) h += '<div class="gm-extra"></div>';
    if (d.levels) h += '<div class="gm-card"><h4>' + esc(d.levelLabel || T('gm_difficulty', 'Difficulty')) + '</h4><div class="gm-seg" data-levels></div></div>';
    h += '<div class="gm-row" data-buttons></div><div data-banner></div>';
    h += '<div class="gm-card gm-mini" data-mini><h4>' + esc(T('gm_leaderboard', 'Leaderboard')) + '</h4><div data-minirows class="gm-empty">...</div></div>';
    h += '<div class="gm-foot"><span>' + esc(d.hint || '') + '</span><span><button data-open="board">' + esc(T('gm_leaderboard', 'Leaderboard')) + '</button> <button data-open="stats">' + esc(T('gm_stats', 'Stats')) + '</button> <button data-open="settings">' + esc(T('gm_settings', 'Settings')) + '</button></span></div>';
    g.side.innerHTML = h;
    g.drawLevels();
    var bt = g.side.querySelector('[data-buttons]');
    if (d.pausable) { var p = el('button', 'gm-btn pri', esc(T('gm_pause', 'Pause'))); p.dataset.act = 'pause'; bt.appendChild(p); g.pauseBtn = p; }
    var n = el('button', 'gm-btn' + (d.pausable ? '' : ' pri'), esc(T('gm_new', 'New game'))); n.dataset.act = 'new'; bt.appendChild(n);
    g.side.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.lv != null) { g.setLevel(Number(b.dataset.lv)); return; }
      if (b.dataset.open) { return g.openPage(b.dataset.open); }
      if (b.dataset.act === 'new') { g.sound('click'); return d.newGame(g); }
      if (b.dataset.act === 'pause') { return g.togglePause(); }
      if (b.dataset.act === 'resume') { return g.doResume(); }
      if (b.dataset.act === 'discard') { api('clearSave', { game: d.id }); g.hasSave = null; g.banner(''); return; }
    });
  };
  Kit.prototype.drawLevels = function () {
    var g = this, box = g.side.querySelector('[data-levels]'); if (!box) return;
    box.innerHTML = '';
    (g.def.levels || []).forEach(function (name, i) { var b = el('button', i === g.level ? 'on' : '', esc(T('gm_lv_' + name.toLowerCase(), name))); b.dataset.lv = i; if (g.levelLocked) b.disabled = true; box.appendChild(b); });
  };
  Kit.prototype.setLevel = function (i) {
    var g = this; if (g.levelLocked) return;
    g.level = i; g.drawLevels(); g.prefs.difficulty = i; g.savePrefs();
    if (g.def.onLevel) g.def.onLevel(g, i, false);
  };
  Kit.prototype.lockLevels = function (on) { this.levelLocked = !!on; this.drawLevels(); };
  Kit.prototype.setBox = function (key, text) { var b = this.side.querySelector('[data-box="' + key + '"]'); if (b) b.textContent = text; };
  Kit.prototype.banner = function (html) { this.side.querySelector('[data-banner]').innerHTML = html ? '<div class="gm-note">' + html + '</div>' : ''; };
  Kit.prototype.sideExtra = function () { return this.side.querySelector('.gm-extra'); };
  Kit.prototype.togglePause = function () {
    var g = this, d = g.def; if (!d.pause) return;
    g.paused = !g.paused; d.pause(g, g.paused);
    if (g.pauseBtn) g.pauseBtn.textContent = g.paused ? T('gm_resume_btn', 'Resume') : T('gm_pause', 'Pause');
  };
  Kit.prototype.setPaused = function (on) { if (!!this.paused !== !!on && this.def.pause) this.togglePause(); };

  // sound ----------------------------------------------------------------------------------------------------------------
  Kit.prototype.vol = function (kind) { var p = this.prefs; if (p.mute) return 0; return (p.master / 100) * ((kind === 'music' ? p.music : p.effects) / 100); };
  Kit.prototype.sound = function (name) {
    var seq = FX[name], v = this.vol('fx'); if (!seq || v <= 0) return;
    seq.forEach(function (n) { tone(n[0], n[1], n[2], 0.2 * v, n[3] || 0); });
  };
  Kit.prototype.startMusic = function () {
    var g = this; if (g.music) { g.music.volume = Math.min(1, g.vol('music')); if (g.vol('music') > 0 && g.music.paused) g.music.play().catch(function () {}); return; }
    config().then(function (c) {
      var files = c.music || []; if (!files.length) return;
      var f = files[Math.min(g.prefs.track, files.length - 1)];
      var a = new Audio('audio/' + f); a.loop = true; a.volume = Math.min(1, g.vol('music')); g.music = a;
      if (a.volume > 0) a.play().catch(function () {});
    });
  };
  Kit.prototype.stopMusic = function () { if (this.music) { this.music.pause(); } };
  Kit.prototype.applyAudio = function () { var g = this; if (g.music) { g.music.volume = Math.min(1, g.vol('music')); if (g.vol('music') <= 0) g.music.pause(); else if (g.music.paused && g.isActive()) g.music.play().catch(function () {}); } };
  Kit.prototype.savePrefs = function () { var g = this; clearTimeout(g._pt); g._pt = setTimeout(function () { api('setPrefs', { game: g.id, prefs: g.prefs }); }, 600); };

  // saved game ----------------------------------------------------------------------------------------------------------
  Kit.prototype.save = function (state) {
    var g = this; if (!g.def.canSave) return;
    var s; try { s = JSON.stringify(state); } catch (e) { return; }
    clearTimeout(g._st); g._st = setTimeout(function () { api('save', { game: g.id, state: s }); }, 800);
  };
  Kit.prototype.clearSave = function () { var g = this; clearTimeout(g._st); g.hasSave = null; if (g.def.canSave) api('clearSave', { game: g.id }); g.banner(''); };
  Kit.prototype.checkSave = function () {
    var g = this; if (!g.def.canSave || !g.def.resume) return;
    api('load', { game: g.id }).then(function (r) {
      if (!r.ok || !r.data || !r.data.state) return;
      try { g.hasSave = JSON.parse(r.data.state); } catch (e) { g.hasSave = null; return; }
      if (g.def.hasUnfinishedSave && !g.def.hasUnfinishedSave(g.hasSave)) { g.hasSave = null; return; }
      g.banner(esc(T('gm_saved_found', 'Saved game found.')) + '<div class="gm-row"><button class="gm-btn pri" data-act="resume">' + esc(T('gm_resume', 'Resume')) + '</button><button class="gm-btn" data-act="discard">' + esc(T('gm_discard', 'Discard')) + '</button></div>');
    });
  };
  Kit.prototype.doResume = function () { var g = this; if (!g.hasSave) return; var s = g.hasSave; g.hasSave = null; g.banner(''); g.def.resume(g, s); };

  // modal ---------------------------------------------------------------------------------------------------------------
  Kit.prototype.modal = function (node, dismissible) {
    var g = this; g.over.innerHTML = ''; g.over.appendChild(node); g.over.classList.add('open'); g._dismiss = dismissible !== false; g.paused0 = g.paused;
    if (g.def.pause && !g.paused) g.setPaused(true);
    return function () { g.closeModal(); };
  };
  Kit.prototype.closeModal = function () { var g = this; g.over.classList.remove('open'); g.over.innerHTML = ''; if (g.def.pause && g.paused && !g.paused0) g.setPaused(false); };
  Kit.prototype.dialog = function (html, buttons, dismissible) {
    var g = this, d = el('div', 'gm-dlg', html), row = el('div', 'gm-row');
    (buttons || []).forEach(function (b) { var x = el('button', 'gm-btn' + (b.pri ? ' pri' : ''), esc(b.label)); x.addEventListener('click', function () { if (b.close !== false) g.closeModal(); if (b.run) b.run(); }); row.appendChild(x); });
    if (buttons && buttons.length) d.appendChild(row);
    g.modal(d, dismissible); return d;
  };

  // end of game ----------------------------------------------------------------------------------------------------------
  /* g.finish({ score, result: 1|0|2, seconds, title, line, again }) saves the result and shows the end page. */
  Kit.prototype.finish = function (o) {
    var g = this, d = g.def; o = o || {};
    g.clearSave();
    var win = o.result === 1;
    g.sound(win ? 'win' : (o.result === 2 ? 'click' : 'lose'));
    var title = o.title || (o.result === 1 ? T('gm_you_won', 'You won!') : o.result === 2 ? T('gm_draw', 'Draw') : o.result === 0 ? T('gm_you_lost', 'You lost') : T('gm_game_over', 'Game over'));
    var big = (o.score != null && o.metric !== 'wins') ? '<div class="big">' + Number(o.score).toLocaleString('en-GB') + '</div>' : '';
    var node = el('div', 'gm-dlg', '<div class="sub" style="letter-spacing:.14em;text-transform:uppercase">' + esc(title) + '</div>' + big + '<div data-tag></div><div class="ranks" data-ranks></div><div class="sub">' + esc(o.line || '') + '</div>');
    var row = el('div', 'gm-row');
    var again = el('button', 'gm-btn pri', esc(T('gm_play_again', 'Play again'))); again.addEventListener('click', function () { g.closeModal(); (o.again || d.newGame)(g); });
    var lb = el('button', 'gm-btn', esc(T('gm_leaderboard', 'Leaderboard'))); lb.addEventListener('click', function () { g.openPage('board'); });
    row.appendChild(again); row.appendChild(lb); node.appendChild(row);
    g.modal(node, false); node.querySelector('[data-ranks]').innerHTML = '<div class="sub" style="flex:1">...</div>';
    api('submit', { game: g.id, score: Math.floor(o.score || 0), result: o.result, seconds: Math.floor(o.seconds || 0), level: g.level + 1, mode: 'solo' }).then(function (r) {
      var rk = node.querySelector('[data-ranks]'); if (!rk) return;
      if (!r.ok || !r.data || !r.data.saved) { rk.innerHTML = ''; if (r.ok && r.data && r.data.saved === false) node.querySelector('[data-tag]').innerHTML = ''; return; }
      var dd = r.data;
      if (o.score != null && o.metric !== 'wins' && dd.best != null && o.score >= dd.best && o.score > 0) node.querySelector('[data-tag]').innerHTML = '<div class="gm-tag" style="text-align:center">' + esc(T('gm_best', 'New personal best')) + '</div>';
      var cell = function (label, v) { return '<div><small>' + esc(label) + '</small><b>' + (v ? '#' + v : '-') + '</b></div>'; };
      rk.innerHTML = cell(T('gm_today', 'Today'), dd.rank && dd.rank.day) + cell(T('gm_week', 'This week'), dd.rank && dd.rank.week) + cell(T('gm_alltime', 'All time'), dd.rank && dd.rank.all);
      g.refreshMini();
    });
  };

  // pages: leaderboard, stats, settings -----------------------------------------------------------------------------------
  Kit.prototype.openPage = function (which) {
    if (which === 'board') return this.pageBoard('week');
    if (which === 'stats') return this.pageStats();
    if (which === 'settings') return this.pageSettings();
  };
  function fmtDate(at) { var d = new Date(at * 1000); return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]; }
  function fmtDur(s) { s = Math.floor(s || 0); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + (m < 10 ? '0' : '') + m + 'm' : m + 'm'; }
  Kit.prototype.pageBoard = function (period) {
    var g = this, d = g.def;
    var node = el('div', 'gm-dlg', '<h3>' + esc(d.name) + ': ' + esc(T('gm_leaderboard', 'Leaderboard')) + '</h3><div class="gm-tabs"></div><div data-rows class="gm-empty">...</div>');
    node.style.width = 'min(520px,94%)';
    var tabs = node.querySelector('.gm-tabs');
    [['day', T('gm_today', 'Today')], ['week', T('gm_week', 'This week')], ['all', T('gm_alltime', 'All time')]].forEach(function (p) {
      var b = el('button', p[0] === period ? 'on' : '', esc(p[1])); b.addEventListener('click', function () { g.pageBoard(p[0]); }); tabs.appendChild(b);
    });
    var close = el('button', 'gm-btn', esc(T('gm_close', 'Close'))); close.addEventListener('click', function () { g.closeModal(); }); node.appendChild(close);
    g.modal(node, true);
    api('board', { game: g.id, period: period }).then(function (r) {
      var box = node.querySelector('[data-rows]'); if (!box) return;
      if (!r.ok) { box.textContent = T('gm_err', 'Could not load.'); return; }
      var wins = r.data.metric === 'wins', rows = r.data.rows || [];
      if (!rows.length) { box.textContent = T('gm_nobody', 'Nobody yet.'); return; }
      var h = '<table class="gm-table"><tr><th style="width:44px">#</th><th>' + esc(T('gm_player', 'Player')) + '</th><th>' + esc(T('gm_date', 'Date')) + '</th><th>' + esc(wins ? T('gm_wins', 'Wins') : T('gm_score', 'Score')) + '</th></tr>';
      rows.forEach(function (x) { h += '<tr' + (x.me ? ' class="me"' : '') + '><td>' + x.rank + '</td><td>' + esc(x.name) + '</td><td>' + esc(fmtDate(x.at)) + '</td><td>' + Number(x.value).toLocaleString('en-GB') + '</td></tr>'; });
      var m = r.data.mine;
      if (m && m.rank > rows.length) h += '<tr class="me"><td>' + m.rank + '</td><td>' + esc(T('gm_you', 'You')) + '</td><td>' + esc(fmtDate(m.at)) + '</td><td>' + Number(m.value).toLocaleString('en-GB') + '</td></tr>';
      box.className = ''; box.innerHTML = h + '</table>';
    });
  };
  Kit.prototype.pageStats = function () {
    var g = this, d = g.def;
    var node = el('div', 'gm-dlg', '<h3>' + esc(d.name) + ': ' + esc(T('gm_stats', 'Stats')) + '</h3><div data-rows class="gm-empty">...</div>');
    var close = el('button', 'gm-btn', esc(T('gm_close', 'Close'))); close.addEventListener('click', function () { g.closeModal(); }); node.appendChild(close);
    g.modal(node, true);
    api('stats').then(function (r) {
      var box = node.querySelector('[data-rows]'); if (!box) return;
      if (!r.ok) { box.textContent = T('gm_err', 'Could not load.'); return; }
      var s = (r.data.games || {})[g.id], wins = r.data.metrics && r.data.metrics[g.id] === 'wins';
      if (!s) { box.textContent = T('gm_nostats', 'Play a game and your stats will show here.'); return; }
      var rows = [[T('gm_played', 'Games played'), s.played], [T('gm_time', 'Time played'), fmtDur(s.seconds)]];
      if (wins) rows.push([T('gm_wins', 'Wins'), s.wins], [T('gm_losses', 'Losses'), s.losses], [T('gm_draws', 'Draws'), s.draws]); else rows.push([T('gm_best_score', 'Best score'), Number(s.best).toLocaleString('en-GB')]);
      rows.push([T('gm_weekrank', 'Weekly rank'), s.week ? '#' + s.week : '-']);
      var h = '<table class="gm-table">'; rows.forEach(function (x) { h += '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; });
      box.className = ''; box.innerHTML = h + '</table><div class="sub" style="margin-top:8px">' + esc(T('gm_stats_note', 'Kept for your character, even if you uninstall the game.')) + '</div>';
    });
  };
  Kit.prototype.pageSettings = function () {
    var g = this, p = g.prefs;
    var node = el('div', 'gm-dlg', '<h3>' + esc(g.def.name) + ': ' + esc(T('gm_settings', 'Settings')) + '</h3><div data-body></div>');
    var body = node.querySelector('[data-body]');
    function slide(key, label) {
      var row = el('label', 'gm-slide', '<span>' + esc(label) + '</span><input type="range" min="0" max="100" value="' + p[key] + '"><output>' + p[key] + '%</output>');
      var inp = row.querySelector('input'), out = row.querySelector('output');
      inp.addEventListener('input', function () { p[key] = Number(inp.value); out.textContent = inp.value + '%'; g.applyAudio(); g.savePrefs(); });
      inp.addEventListener('change', function () { g.sound('click'); });
      body.appendChild(row);
    }
    slide('master', T('gm_master', 'Master volume')); slide('music', T('gm_music', 'Music')); slide('effects', T('gm_effects', 'Effects'));
    var mute = el('label', 'gm-slide', '<span>' + esc(T('gm_mute', 'Mute everything')) + '</span><input type="checkbox"' + (p.mute ? ' checked' : '') + '>');
    mute.querySelector('input').addEventListener('change', function (e) { p.mute = e.target.checked; g.applyAudio(); g.savePrefs(); });
    body.appendChild(mute);
    config().then(function (c) {
      if (!c.music || !c.music.length) { var n = el('div', 'sub', esc(T('gm_nomusic', 'No music tracks are set up on this server.'))); body.appendChild(n); return; }
      var row = el('label', 'gm-slide', '<span>' + esc(T('gm_track', 'Music track')) + '</span><select style="flex:1"></select>'), sel = row.querySelector('select');
      c.music.forEach(function (f, i) { var o = el('option', '', esc(f.replace(/\.[a-z0-9]+$/i, ''))); o.value = i; if (i === p.track) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { p.track = Number(sel.value); g.stopMusic(); g.music = null; g.startMusic(); g.savePrefs(); });
      body.appendChild(row);
    });
    var close = el('button', 'gm-btn pri', esc(T('gm_close', 'Close'))); close.addEventListener('click', function () { g.closeModal(); }); node.appendChild(close);
    g.modal(node, true);
  };
  Kit.prototype.refreshMini = function () {
    var g = this, box = g.side.querySelector('[data-minirows]'); if (!box) return;
    api('board', { game: g.id, period: 'week' }).then(function (r) {
      if (!r.ok) return;
      var rows = (r.data.rows || []).slice(0, 3), wins = r.data.metric === 'wins', h = '';
      if (!rows.length) { box.className = 'gm-empty'; box.textContent = T('gm_nobody', 'Nobody yet.'); return; }
      rows.forEach(function (x) { h += '<div class="r' + (x.me ? ' me' : '') + '"><span>' + x.rank + '. ' + esc(x.name) + '</span><b>' + Number(x.value).toLocaleString('en-GB') + '</b></div>'; });
      var m = r.data.mine; if (m && m.rank > 3) h += '<div class="r me"><span>' + m.rank + '. ' + esc(T('gm_you', 'You')) + '</span><b>' + Number(m.value).toLocaleString('en-GB') + '</b></div>';
      box.className = ''; box.innerHTML = h;
      var head = g.side.querySelector('[data-mini] h4'); if (head) head.textContent = T('gm_this_week', 'This week') + (wins ? ' - ' + T('gm_wins', 'Wins') : '');
    });
  };

  // ---- registration ---------------------------------------------------------------------------------------------------
  function register(def) {
    var root = S.registerApp({
      id: def.id, icon: def.icon, titleKey: 'gm_app_' + def.id, titleDef: def.name, w: def.w || 760, h: def.h || 560,
      html: '<div class="gm" id="gm-' + def.id + '"></div>',
      onOpen: function () {
        var host = document.getElementById('gm-' + def.id); if (!host) return;
        var g = KITS[def.id];
        if (!g) { g = KITS[def.id] = new Kit(def, host); }
        else { g.refreshMini(); if (g.def.onOpen) g.def.onOpen(g); }
      },
      onClose: function () { var g = KITS[def.id]; if (g) { g.stopMusic(); if (def.onClose) def.onClose(g); } },
      onReset: function () { var g = KITS[def.id]; if (g) { g.stopMusic(); if (def.onClose) def.onClose(g); } },
      onLocale: function () {}
    });
    return root;
  }

  window.LSGames = { register: register, api: api, config: config, el: el, tone: tone, kits: KITS, post: post, Kit: Kit };
})();
