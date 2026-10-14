/* Clock for Los Santos OS: alarms (saved with the character, snooze), timer, stopwatch and world clocks (real time zones).
   Alarms and timers only ring while the computer is on. Registers with LSOS.registerApp; notifies through LSOS.notify. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#7c3aed"/><circle cx="12" cy="12.4" r="6.4" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M12 8.6v4l2.6 1.6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var ZONES = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'America/Sao_Paulo', 'Europe/Paris', 'Europe/Moscow', 'Africa/Johannesburg', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var tab = 'alarm', tick = null;
  var sw = { run: false, base: 0, start: 0, laps: [] };
  var tm = { run: false, end: 0, left: 0, total: 0 };
  var snoozed = [], firedMin = '', ring = null;

  function prefs() { return S.prefs() || {}; }
  function alarms() { return Array.isArray(prefs().alarms) ? prefs().alarms : []; }
  function zones() { return Array.isArray(prefs().worldClocks) ? prefs().worldClocks : ['Europe/London', 'America/New_York']; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function hms(ms, cs) { var t = Math.max(0, ms), h = Math.floor(t / 3600000), m = Math.floor(t / 60000) % 60, s = Math.floor(t / 1000) % 60; return (h ? p2(h) + ':' : '') + p2(m) + ':' + p2(s) + (cs ? '.' + p2(Math.floor(t / 10) % 100) : ''); }

  // ---- sound (three simple tones)
  var actx = null;
  function beep(kind) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var f = [660, 880, 520][(kind || 1) - 1] || 660;
      [0, 0.25, 0.5].forEach(function (d) {
        var o = actx.createOscillator(), g = actx.createGain(); o.type = kind === 3 ? 'square' : 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, actx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d + 0.2);
        o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.22);
      });
    } catch (e) { /* no audio */ }
  }

  // ---- ringing
  function startRing(label, time, snd, onSnooze) {
    stopRing();
    var el = document.createElement('div'); el.id = 'ck-ring';
    el.innerHTML = '<div class="t">' + esc(time) + '</div><div class="l">' + esc(label || T('ck_alarm', 'Alarm')) + '</div><div class="ck-btns">' +
      (onSnooze ? '<button class="ck-b" data-r="snz">' + esc(T('ck_snooze', 'Snooze 5 min')) + '</button>' : '') + '<button class="ck-b pri" data-r="off">' + esc(T('ck_dismiss', 'Dismiss')) + '</button></div>';
    document.body.appendChild(el);
    var iv = setInterval(function () { beep(snd); }, 2000); beep(snd);
    var to = setTimeout(stopRing, 60000);
    ring = { el: el, iv: iv, to: to };
    el.addEventListener('click', function (e) { var b = e.target.closest('[data-r]'); if (!b) return; var snz = b.dataset.r === 'snz'; stopRing(); if (snz && onSnooze) onSnooze(); });
    S.notify({ app: 'clock', title: label || T('ck_alarm', 'Alarm'), text: time, priority: 'high', action: { app: 'clock' } });
  }
  function stopRing() { if (!ring) return; clearInterval(ring.iv); clearTimeout(ring.to); ring.el.remove(); ring = null; }

  // ---- background check (runs from the moment this file loads; the page only exists while the computer is in use)
  function bgTick() {
    var now = new Date(), key = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate() + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes());
    if (key !== firedMin) {
      firedMin = key;
      var hhmm = p2(now.getHours()) + ':' + p2(now.getMinutes()), dow = (now.getDay() + 6) % 7;
      alarms().forEach(function (a) {
        if (!a.on || a.t !== hhmm) return;
        if (a.days && !(a.days & (1 << dow))) return;
        startRing(a.label, a.t, a.snd, function () { snoozed.push({ at: Date.now() + 300000, a: a }); });
        if (!a.days) { var l = alarms().map(function (x) { return x.id === a.id ? Object.assign({}, x, { on: false }) : x; }); S.setPrefs({ alarms: l }); }
      });
    }
    snoozed = snoozed.filter(function (s) { if (Date.now() < s.at) return true; startRing(s.a.label, s.a.t, s.a.snd, function () { snoozed.push({ at: Date.now() + 300000, a: s.a }); }); return false; });
    if (tm.run && Date.now() >= tm.end) { tm.run = false; tm.left = 0; startRing(T('ck_timer_done', 'Timer finished'), hms(tm.total), 2, null); }
  }
  setInterval(bgTick, 1000);
  S.registerProcess(function () {
    var out = [];
    if (alarms().some(function (a) { return a.on; })) out.push({ name: 'Alarm Service', desc: 'Rings alarms', cpu: 0.1, ram: 8, status: 'Running' });
    return out;
  });

  // ---- tabs
  function tzTime(z) { try { return new Date().toLocaleTimeString(T('ui_date_locale', 'en-GB'), { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: prefs().clock24 === false }); } catch (e) { return '--'; } }
  function tzDay(z) { try { return new Date().toLocaleDateString(T('ui_date_locale', 'en-GB'), { timeZone: z, weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) { return ''; } }
  function tzName(z) { return z.split('/').pop().replace(/_/g, ' '); }

  function drawAlarm() {
    var l = alarms();
    var h = '<div class="ck-form"><input type="time" id="ck-t" value="07:00"><input id="ck-l" maxlength="40" placeholder="' + esc(T('ck_label', 'Label')) + '"><select id="ck-s"><option value="1">' + esc(T('ck_snd', 'Sound')) + ' 1</option><option value="2">' + esc(T('ck_snd', 'Sound')) + ' 2</option><option value="3">' + esc(T('ck_snd', 'Sound')) + ' 3</option></select>' +
      '<div class="ck-days" id="ck-d">' + DAYS.map(function (d, i) { return '<button data-b="' + (1 << i) + '">' + esc(T('ck_d_' + d, d)) + '</button>'; }).join('') + '</div><button class="ck-b pri" data-ck="add">' + esc(T('ck_add', 'Add alarm')) + '</button></div>';
    if (!l.length) h += '<div class="ck-empty">' + esc(T('ck_no_alarms', 'No alarms yet')) + '</div>';
    l.forEach(function (a) {
      var days = a.days ? DAYS.map(function (d, i) { return a.days & (1 << i) ? T('ck_d_' + d, d) : ''; }).filter(Boolean).join(' ') : T('ck_once', 'Once');
      h += '<div class="ck-row' + (a.on ? '' : ' off') + '"><span class="tm">' + esc(a.t) + '</span><span class="gr">' + esc(a.label || T('ck_alarm', 'Alarm')) + '<small>' + esc(days) + '</small></span>' +
        '<button class="ck-b" data-ck="tog" data-id="' + esc(a.id) + '">' + esc(a.on ? T('ck_on', 'On') : T('ck_off', 'Off')) + '</button><button class="ck-x" data-ck="del" data-id="' + esc(a.id) + '">×</button></div>';
    });
    return h;
  }
  function drawWorld() {
    var h = '<div class="ck-form"><select id="ck-z">' + ZONES.filter(function (z) { return zones().indexOf(z) < 0; }).map(function (z) { return '<option value="' + z + '">' + esc(tzName(z)) + '</option>'; }).join('') + '</select><button class="ck-b pri" data-ck="addz">' + esc(T('ck_add_clock', 'Add clock')) + '</button></div>';
    h += '<div class="ck-row"><span class="tm" data-z="">' + esc(new Date().toLocaleTimeString(T('ui_date_locale', 'en-GB'), { hour: '2-digit', minute: '2-digit', hour12: prefs().clock24 === false })) + '</span><span class="gr">' + esc(T('ck_local', 'Your local time')) + '</span></div>';
    zones().forEach(function (z) { h += '<div class="ck-row"><span class="tm" data-z="' + esc(z) + '">' + esc(tzTime(z)) + '</span><span class="gr">' + esc(tzName(z)) + '<small>' + esc(tzDay(z)) + '</small></span><button class="ck-x" data-ck="delz" data-z="' + esc(z) + '">×</button></div>'; });
    return h;
  }
  function drawTimer() {
    var left = tm.run ? tm.end - Date.now() : tm.left;
    if (!tm.run && !tm.left) return '<div class="ck-form" style="justify-content:center"><input type="number" id="ck-th" min="0" max="23" value="0" style="width:60px">h <input type="number" id="ck-tm" min="0" max="59" value="5" style="width:60px">m <input type="number" id="ck-ts" min="0" max="59" value="0" style="width:60px">s</div><div class="ck-btns"><button class="ck-b pri" data-ck="tstart">' + esc(T('ck_start', 'Start')) + '</button></div>';
    return '<div class="ck-big" id="ck-tbig">' + hms(left) + '</div><div class="ck-btns"><button class="ck-b pri" data-ck="tpause">' + esc(tm.run ? T('ck_pause', 'Pause') : T('ck_resume', 'Resume')) + '</button><button class="ck-b red" data-ck="treset">' + esc(T('ck_reset', 'Reset')) + '</button></div>';
  }
  function drawSw() {
    var ms = sw.run ? sw.base + Date.now() - sw.start : sw.base;
    return '<div class="ck-big" id="ck-sbig">' + hms(ms, true) + '</div><div class="ck-btns"><button class="ck-b pri" data-ck="sgo">' + esc(sw.run ? T('ck_pause', 'Pause') : T('ck_start', 'Start')) + '</button><button class="ck-b" data-ck="slap"' + (sw.run ? '' : ' disabled') + '>' + esc(T('ck_lap', 'Lap')) + '</button><button class="ck-b red" data-ck="sreset">' + esc(T('ck_reset', 'Reset')) + '</button></div>' +
      '<div class="ck-laps">' + sw.laps.map(function (l, i) { return '<div><span>' + esc(T('ck_lap', 'Lap')) + ' ' + (sw.laps.length - i) + '</span><span>' + hms(l, true) + '</span></div>'; }).join('') + '</div>';
  }
  function draw() {
    var b = $('ck-body'); if (!b) return;
    document.querySelectorAll('.ck-tabs button').forEach(function (x) { x.classList.toggle('on', x.dataset.tab === tab); });
    b.innerHTML = tab === 'alarm' ? drawAlarm() : tab === 'world' ? drawWorld() : tab === 'timer' ? drawTimer() : drawSw();
  }
  function live() {
    if (tab === 'world') document.querySelectorAll('#ck-body [data-z]').forEach(function (e) { e.textContent = e.dataset.z ? tzTime(e.dataset.z) : new Date().toLocaleTimeString(T('ui_date_locale', 'en-GB'), { hour: '2-digit', minute: '2-digit', hour12: prefs().clock24 === false }); });
    else if (tab === 'timer' && $('ck-tbig')) { $('ck-tbig').textContent = hms(tm.run ? tm.end - Date.now() : tm.left); if (!tm.run && !tm.left) draw(); }
    else if (tab === 'timer' && tm.left === 0 && !tm.run && !$('ck-th')) draw();
    else if (tab === 'sw' && $('ck-sbig')) $('ck-sbig').textContent = hms(sw.run ? sw.base + Date.now() - sw.start : sw.base, true);
  }

  S.registerApp({
    id: 'clock', icon: ICON, titleKey: 'app_clock', titleDef: 'Clock', w: 560, h: 480,
    html: '<div class="ck"><div class="ck-tabs"><button data-tab="alarm">' + esc(T('ck_t_alarm', 'Alarms')) + '</button><button data-tab="world">' + esc(T('ck_t_world', 'World clocks')) + '</button><button data-tab="timer">' + esc(T('ck_t_timer', 'Timer')) + '</button><button data-tab="sw">' + esc(T('ck_t_sw', 'Stopwatch')) + '</button></div><div class="ck-body" id="ck-body"></div></div>',
    onOpen: function () { tab = 'alarm'; draw(); clearInterval(tick); tick = setInterval(live, 100); },
    onClose: function () { clearInterval(tick); },
    onReset: function () { clearInterval(tick); stopRing(); snoozed = []; tm = { run: false, end: 0, left: 0, total: 0 }; sw = { run: false, base: 0, start: 0, laps: [] }; },
    onLocale: function () { draw(); }
  });

  var newDays = 0;
  document.addEventListener('click', function (e) {
    var w = $('win-clock'); if (!w || !w.contains(e.target)) return;
    var t = e.target.closest('.ck-tabs [data-tab]'); if (t) { tab = t.dataset.tab; draw(); return; }
    var dayb = e.target.closest('#ck-d button'); if (dayb) { newDays ^= +dayb.dataset.b; dayb.classList.toggle('on'); return; }
    var b = e.target.closest('[data-ck]'); if (!b) return;
    var a = b.dataset.ck, id = b.dataset.id, l = alarms();
    if (a === 'add') {
      var v = $('ck-t').value; if (!/^\d\d:\d\d$/.test(v) || l.length >= 20) return;
      l = l.concat([{ id: 'a' + Date.now().toString(36).slice(-8), label: $('ck-l').value.trim(), t: v, days: newDays, on: true, snd: +$('ck-s').value }]); newDays = 0;
      S.setPrefs({ alarms: l });
    } else if (a === 'tog') S.setPrefs({ alarms: l.map(function (x) { return x.id === id ? Object.assign({}, x, { on: !x.on }) : x; }) });
    else if (a === 'del') S.setPrefs({ alarms: l.filter(function (x) { return x.id !== id; }) });
    else if (a === 'addz') { var z = $('ck-z').value; if (z && zones().length < 8) S.setPrefs({ worldClocks: zones().concat([z]) }); }
    else if (a === 'delz') S.setPrefs({ worldClocks: zones().filter(function (x) { return x !== b.dataset.z; }) });
    else if (a === 'tstart') { var ms = (+$('ck-th').value * 3600 + +$('ck-tm').value * 60 + +$('ck-ts').value) * 1000; if (ms > 0) { tm = { run: true, end: Date.now() + ms, left: ms, total: ms }; } }
    else if (a === 'tpause') { if (tm.run) { tm.left = tm.end - Date.now(); tm.run = false; } else { tm.end = Date.now() + tm.left; tm.run = true; } }
    else if (a === 'treset') tm = { run: false, end: 0, left: 0, total: 0 };
    else if (a === 'sgo') { if (sw.run) { sw.base += Date.now() - sw.start; sw.run = false; } else { sw.start = Date.now(); sw.run = true; } }
    else if (a === 'slap') sw.laps.unshift(sw.base + Date.now() - sw.start);
    else if (a === 'sreset') sw = { run: false, base: 0, start: 0, laps: [] };
    setTimeout(draw, 30);
  });
})();
