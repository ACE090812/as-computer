/* Notification centre for Los Santos OS: toasts bottom right, a panel from the bell in the tray, Do not disturb, per-app mute and a
   chime. Notifications arrive from the server ({ action: 'pcNotify', n } - server/notify.lua, exports.notifyComputer) and are kept
   until the session ends. Do not disturb and muted apps get no toast and no sound but still land in the panel. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }

  var BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z"/><path d="M10 21h4"/></svg>';
  var list = [], seq = 0, open = false, toastLimit = 4;

  // tray bell + panel + toast stack
  var tray = document.querySelector('.tb-tray');
  var bell = document.createElement('div');
  bell.className = 'tray-ic'; bell.id = 'tb-bell'; bell.title = T('nt_title', 'Notifications');
  bell.innerHTML = '<span class="nt-bell">' + BELL + '</span><i class="nt-dot hidden"></i>';
  tray.insertBefore(bell, tray.firstChild);
  var panel = document.createElement('div'); panel.id = 'nt-panel'; panel.className = 'hidden';
  var toasts = document.createElement('div'); toasts.id = 'nt-toasts';
  document.getElementById('app').appendChild(panel); document.getElementById('app').appendChild(toasts);

  function prefs() { return S.prefs() || {}; }
  function muted(app) { return Array.isArray(prefs().notifMute) && prefs().notifMute.indexOf(app) >= 0; }
  function quiet(n) { return !!prefs().dnd || muted(n.app); }

  // ---- sound (made in the page, no files)
  var ac = null;
  function tone(f, d, type, vol, at) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + (at || 0);
      o.type = type || 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.03);
    } catch (e) { /* no audio */ }
  }
  var SOUNDS = {
    mail: [[880, .12, 'sine', .08, 0], [1175, .18, 'sine', .08, .12]],
    alarm: [[988, .2, 'square', .1, 0], [988, .2, 'square', .1, .3], [988, .2, 'square', .1, .6]],
    security: [[330, .25, 'sawtooth', .08, 0], [247, .35, 'sawtooth', .08, .25]],
    news: [[660, .12, 'triangle', .09, 0], [880, .12, 'triangle', .09, .14], [660, .2, 'triangle', .09, .28]],
    normal: [[740, .12, 'sine', .07, 0], [988, .16, 'sine', .07, .1]]
  };
  function chime(n) {
    if (prefs().notifSound === false) return;
    var kind = /^(clock|calendar)$/.test(n.app) ? 'alarm' : /^(antivirus|security|logs)$/.test(n.app) ? 'security' : SOUNDS[n.app] ? n.app : 'normal';
    (SOUNDS[kind] || SOUNDS.normal).forEach(function (a) { tone(a[0], a[1], a[2], a[3], a[4]); });
  }

  function ago(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    return s < 60 ? T('nt_now', 'now') : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
  }
  function appName(id) {
    var a = S.apps().filter(function (x) { return x.id === id; })[0];
    return a ? a.title : (id ? id.charAt(0).toUpperCase() + id.slice(1) : T('nt_system', 'System'));
  }

  function badge() {
    var d = bell.querySelector('.nt-dot'); d.classList.toggle('hidden', !list.length || !!prefs().dnd);
    bell.classList.toggle('dnd', !!prefs().dnd);
  }

  function draw() {
    badge();
    if (!open) return;
    var dnd = !!prefs().dnd;
    var h = '<div class="nt-head"><b>' + esc(T('nt_title', 'Notifications')) + '</b><span class="grow"></span>' +
      '<button class="nt-btn' + (dnd ? ' on' : '') + '" data-nt="dnd">' + esc(dnd ? T('nt_dnd_on', 'Do not disturb: on') : T('nt_dnd', 'Do not disturb')) + '</button>' +
      (list.length ? '<button class="nt-btn" data-nt="clear">' + esc(T('nt_clear', 'Clear all')) + '</button>' : '') + '</div><div class="nt-list">';
    if (!list.length) h += '<div class="nt-empty">' + esc(T('nt_none', 'No new notifications')) + '</div>';
    list.slice().reverse().forEach(function (n) {
      h += '<div class="nt-item' + (n.priority === 'high' ? ' hi' : '') + '" data-id="' + n.id + '"><div class="nt-app">' + esc(appName(n.app)) + '<span class="nt-time">' + ago(n.at) + '</span>' +
        '<button class="nt-x" data-nt="x" data-id="' + n.id + '" title="' + esc(T('nt_dismiss', 'Dismiss')) + '">×</button></div>' +
        (n.title ? '<div class="nt-t">' + esc(n.title) + '</div>' : '') + (n.text ? '<div class="nt-s">' + esc(n.text) + '</div>' : '') +
        '<div class="nt-acts">' + (n.action ? '<button class="nt-btn" data-nt="go" data-id="' + n.id + '">' + esc(T('nt_open', 'Open')) + '</button>' : '') +
        (n.app ? '<button class="nt-btn" data-nt="mute" data-app="' + esc(n.app) + '">' + esc(muted(n.app) ? T('nt_unmute', 'Unmute this app') : T('nt_mute', 'Mute this app')) + '</button>' : '') + '</div></div>';
    });
    panel.innerHTML = h + '</div>';
  }

  function toast(n) {
    var el = document.createElement('div');
    el.className = 'nt-toast' + (n.priority === 'high' ? ' hi' : '');
    el.innerHTML = '<div class="nt-app">' + esc(appName(n.app)) + '</div>' + (n.title ? '<div class="nt-t">' + esc(n.title) + '</div>' : '') + (n.text ? '<div class="nt-s">' + esc(n.text) + '</div>' : '');
    el.addEventListener('click', function () { if (n.action) S.openApp(n.action.app); el.remove(); });
    toasts.appendChild(el);
    while (toasts.children.length > toastLimit) toasts.removeChild(toasts.firstChild);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, 5000);
  }

  function add(n) {
    n = Object.assign({ app: '', title: '', text: '', priority: 'normal' }, n || {});
    n.id = ++seq; n.at = Date.now();
    list.push(n); if (list.length > 60) list.shift();
    if (!quiet(n)) { toast(n); chime(n); }
    draw();
  }
  S.notify = add;

  function setOpen(v) {
    open = v; panel.classList.toggle('hidden', !v);
    if (v) draw();
  }
  bell.addEventListener('click', function (e) { e.stopPropagation(); setOpen(!open); });
  document.addEventListener('mousedown', function (e) { if (open && !e.target.closest('#nt-panel') && !e.target.closest('#tb-bell')) setOpen(false); });
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-nt]'); if (!b) return;
    var act = b.dataset.nt, id = +b.dataset.id;
    if (act === 'dnd') S.setPrefs({ dnd: !prefs().dnd });
    else if (act === 'clear') list = [];
    else if (act === 'x') list = list.filter(function (n) { return n.id !== id; });
    else if (act === 'go') { var n = list.filter(function (x) { return x.id === id; })[0]; if (n && n.action) S.openApp(n.action.app); list = list.filter(function (x) { return x.id !== id; }); setOpen(false); }
    else if (act === 'mute') {
      var cur = Array.isArray(prefs().notifMute) ? prefs().notifMute.slice() : [], i = cur.indexOf(b.dataset.app);
      if (i >= 0) cur.splice(i, 1); else cur.push(b.dataset.app);
      S.setPrefs({ notifMute: cur });
    }
    draw();
  });
  setInterval(function () { if (open) draw(); }, 30000);

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.action === 'pcNotify' && d.n) add(d.n);
    else if (d.action === 'close' && !d.keep) { list = []; toasts.innerHTML = ''; setOpen(false); badge(); }
  });
  badge();
})();
