/* Task Manager for Los Santos OS: Processes (open apps, End task, Not responding), Performance (CPU, memory, disk, GPU, network from
   the parts fitted in this computer's tower), Startup (apps that open by themselves) and Details (background services).
   The numbers are worked out from what is open and what is installed (server/hardware.lua): every app costs the same CPU and memory,
   so a weak CPU or little RAM shows up as a busy computer, and too many windows for the memory leave the newest ones Not responding.
   Registers with LSOS.registerApp; other files add background processes with LSOS.registerProcess(fn -> { name, cpu, ram, status }). */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }

  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#0f766e"/><path d="M5 15l3.2-4 3 3 3.6-6 3.2 5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><rect x="5" y="17.5" width="14" height="1.6" rx=".8" fill="#99f6e4"/></svg>';

  // ---- model constants (same for every app, by design)
  var BASE_CPU = 3, APP_CPU = 6, MIN_CPU = 1, BASE_RAM = 1100, APP_RAM = 220, MIN_RAM = 90, OS_DISK = 1200;
  var GAMES = { snake: 1, blocks: 1, solitaire: 1, chess: 1, connect4: 1, tictactoe: 1 };
  var HEAVY = { browser: 1, mining: 1, mechanic: 1, snake: 1, blocks: 1, solitaire: 1, chess: 1, connect4: 1, tictactoe: 1 };
  var SERVICES = [
    ['Los Santos OS Shell', 'Desktop, taskbar and Start menu', 0.4, 60], ['Notification Service', 'Toasts and the notification panel', 0.2, 18],
    ['Clock and Time', 'Date, time and alarms', 0.1, 9], ['Network Manager', 'Wi-Fi and Ethernet connection', 0.2, 14], ['Update Service', 'Looks for updates', 0.1, 22],
  ];

  var hw = null, hwAt = 0, mining = null, miningAt = 0;
  var hist = { cpu: [], mem: [], disk: [], gpu: [], net: [] }, HN = 60;
  var tab = 'proc', sel = null, timer = null, extra = [], pids = {}, nextPid = 1100;

  function pidOf(name) { if (!pids[name]) { pids[name] = nextPid; nextPid += 4 + Math.floor(Math.random() * 40); } return pids[name]; }
  S.registerProcess = function (fn) { extra.push(fn); };

  function loadHw() {
    if (Date.now() - hwAt < 5000) return;
    hwAt = Date.now();
    S.api('hardwareApi', {}).then(function (r) { if (r && r.success) hw = r; });
    if (S.apps().some(function (a) { return a.id === 'mining'; }) && Date.now() - miningAt > 9000) {
      miningAt = Date.now();
      S.api('miningApi', { name: 'info', data: {} }).then(function (r) { mining = r && r.success ? r.data : null; });
    }
  }

  // ---- the numbers
  function model() {
    var perf = (hw && hw.perf > 0) ? hw.perf : 1;
    var ramMB = (hw && hw.ramMB > 0) ? hw.ramMB : 4096;
    var wins = S.winList().filter(function (w) { return w.id !== 'taskmgr'; }).sort(function (a, b) { return a.z - b.z; });
    var self = S.winList().filter(function (w) { return w.id === 'taskmgr'; })[0];
    var procs = [], bg = [], usedCpu = BASE_CPU, usedRam = BASE_RAM;
    var capacity = Math.max(1, Math.floor((ramMB - BASE_RAM) / APP_RAM));
    var live = wins.filter(function (w) { return !w.min; });
    wins.forEach(function (w, i) {
      var cpu = (w.min ? MIN_CPU : APP_CPU), ram = w.min ? MIN_RAM : APP_RAM;
      usedCpu += cpu; usedRam += ram;
      procs.push({ id: w.id, name: w.title, icon: w.icon, min: w.min, cpu: cpu, ram: ram, order: i });
    });
    if (self) { usedCpu += APP_CPU; usedRam += APP_RAM; procs.push({ id: 'taskmgr', name: self.title, icon: self.icon, min: self.min, cpu: APP_CPU, ram: APP_RAM, order: 99, self: true }); }
    SERVICES.forEach(function (s) { bg.push({ name: s[0], desc: s[1], cpu: s[2], ram: s[3], status: 'Running' }); usedRam += s[3]; });
    if (mining && mining.running) bg.push({ name: 'Mining service', desc: 'Crypto mining', cpu: 0.6, ram: 140, status: 'Running' });
    extra.forEach(function (fn) { try { (fn() || []).forEach(function (p) { bg.push(p); usedCpu += p.cpu || 0; usedRam += p.ram || 0; }); } catch (e) { /* ignore */ } });
    var cpuPct = Math.min(100, (usedCpu / perf) + (Math.random() * 2 - 1));
    var ramPct = Math.min(100, usedRam / ramMB * 100);
    // not responding: more open apps than the memory fits (the newest ones), or the CPU flat out (the newest one)
    var frozen = {};
    var ordered = procs.filter(function (p) { return !p.self; }).sort(function (a, b) { return a.order - b.order; });
    ordered.forEach(function (p, i) { if (i >= capacity) frozen[p.id] = true; });
    if (cpuPct >= 98 && ordered.length) frozen[ordered[ordered.length - 1].id] = true;
    var gpuApps = live.filter(function (w) { return GAMES[w.id]; }).length;
    var gpuPct = hw && hw.hasGpu ? Math.min(100, 2 + gpuApps * 22 / Math.max(0.5, hw.gpuPerf || 1)) : null;
    var diskUsed = ((hw && hw.diskUsedMB) || 0) + OS_DISK, diskCap = (hw && hw.storageMB) || 0;
    var netPct = hw && hw.network ? Math.max(0, Math.min(100, 1 + Math.random() * 4 + (S.winList().some(function (w) { return w.id === 'browser' && !w.min; }) ? 18 : 0))) : null;
    procs.forEach(function (p) { p.cpuShown = p.cpu / perf; p.frozen = !!frozen[p.id]; });
    return { perf: perf, ramMB: ramMB, procs: procs, bg: bg, cpuPct: cpuPct, ramPct: ramPct, usedRam: usedRam, gpuPct: gpuPct, diskUsed: diskUsed, diskCap: diskCap, netPct: netPct };
  }

  function push(k, v) { var a = hist[k]; a.push(v); if (a.length > HN) a.shift(); }
  function spark(k, color, max) {
    var a = hist[k], w = 300, h = 70, pts = '';
    for (var i = 0; i < a.length; i++) { var x = (HN - a.length + i) / (HN - 1) * w, y = h - (Math.min(max || 100, a[i] || 0) / (max || 100)) * h; pts += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }
    return '<svg class="tm-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.6"/></svg>';
  }
  function mb(n) { return n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : Math.round(n) + ' MB'; }

  // ---- drawing
  function draw() {
    var host = $('tm-body'); if (!host) return;
    var m = model();
    push('cpu', m.cpuPct); push('mem', m.ramPct); push('disk', m.diskCap ? m.diskUsed / m.diskCap * 100 : 0); push('gpu', m.gpuPct || 0); push('net', m.netPct || 0);
    DOMs().forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    var h = '';
    if (tab === 'proc') {
      h += '<div class="tm-sum"><span>CPU <b>' + Math.round(m.cpuPct) + '%</b></span><span>' + esc(T('tm_memory', 'Memory')) + ' <b>' + Math.round(m.ramPct) + '%</b></span><span>' + esc(T('tm_disk', 'Disk')) + ' <b>' + (m.diskCap ? Math.round(m.diskUsed / m.diskCap * 100) + '%' : '-') + '</b></span></div>';
      h += '<table class="tm-tab"><tr><th>' + esc(T('tm_name', 'Name')) + '</th><th>' + esc(T('tm_status', 'Status')) + '</th><th class="r">CPU</th><th class="r">' + esc(T('tm_memory', 'Memory')) + '</th></tr>';
      h += '<tr class="grp"><td colspan="4">' + esc(T('tm_apps', 'Apps')) + ' (' + m.procs.length + ')</td></tr>';
      m.procs.sort(function (a, b) { return a.name < b.name ? -1 : 1; }).forEach(function (p) {
        h += '<tr class="pr' + (sel === p.id ? ' sel' : '') + '" data-id="' + esc(p.id) + '"><td>' + S.icSpan(p.icon) + ' ' + esc(p.name) + '</td><td>' + (p.frozen ? '<span class="nr">' + esc(T('tm_notresp', 'Not responding')) + '</span>' : p.min ? esc(T('tm_min', 'Minimised')) : esc(T('tm_running', 'Running'))) + '</td><td class="r">' + p.cpuShown.toFixed(1) + '%</td><td class="r">' + Math.round(p.ram) + ' MB</td></tr>';
      });
      h += '<tr class="grp"><td colspan="4">' + esc(T('tm_bg', 'Background processes')) + ' (' + m.bg.length + ')</td></tr>';
      m.bg.forEach(function (p) { h += '<tr><td>' + esc(p.name) + '</td><td>' + esc(p.status || 'Running') + '</td><td class="r">' + (p.cpu || 0).toFixed(1) + '%</td><td class="r">' + Math.round(p.ram || 0) + ' MB</td></tr>'; });
      h += '</table>';
      $('tm-foot').innerHTML = '<button class="tm-btn" data-act="end"' + (sel ? '' : ' disabled') + '>' + esc(T('tm_end', 'End task')) + '</button>';
    } else if (tab === 'perf') {
      var cards = [
        ['cpu', 'CPU', Math.round(m.cpuPct) + '%', (hw && hw.slots && hw.slots.cpu ? tierName(hw.slots.cpu.tier) + ' · ' + Math.round(hw.slots.cpu.wear) + '% condition' : T('tm_nocpu', 'No CPU fitted')), '#2563eb', 100],
        ['mem', T('tm_memory', 'Memory'), Math.round(m.ramPct) + '%', mb(m.usedRam) + ' / ' + mb(m.ramMB), '#7c3aed', 100],
        ['disk', T('tm_disk', 'Disk'), m.diskCap ? Math.round(m.diskUsed / m.diskCap * 100) + '%' : '-', m.diskCap ? mb(m.diskUsed) + ' / ' + mb(m.diskCap) : T('tm_nodisk', 'No drive'), '#16a34a', 100],
        ['gpu', 'GPU', m.gpuPct == null ? '-' : Math.round(m.gpuPct) + '%', hw && hw.hasGpu ? tierName(hw.slots.gpu.tier) + ' · ' + Math.round(hw.slots.gpu.wear) + '% condition' : T('tm_nogpu', 'Integrated graphics'), '#ea580c', 100],
        ['net', T('tm_network', 'Network'), m.netPct == null ? T('tm_offline', 'Not connected') : (hw.network === 'eth' ? 'Ethernet' : 'Wi-Fi'), hw && hw.network ? T('tm_speed', 'Speed') + ' ' + (hw.networkSpeed || 1).toFixed(1) + '×' : T('tm_nonic', 'No network card'), '#0891b2', 100],
      ];
      h += '<div class="tm-perf">' + cards.map(function (c) {
        return '<div class="tm-card"><div class="tm-ch"><b>' + esc(c[1]) + '</b><span class="big">' + esc(c[2]) + '</span></div><div class="tm-cs">' + esc(c[3]) + '</div>' + spark(c[0], c[4], c[5]) + '</div>';
      }).join('') + '</div>';
      $('tm-foot').innerHTML = '';
    } else if (tab === 'startup') {
      var on = Array.isArray(S.prefs().startupApps) ? S.prefs().startupApps : [];
      h += '<div class="tm-note">' + esc(T('tm_startup_d', 'Apps that open by themselves when this computer starts. Each one makes starting slower.')) + '</div>';
      h += '<table class="tm-tab"><tr><th>' + esc(T('tm_name', 'Name')) + '</th><th>' + esc(T('tm_status', 'Status')) + '</th><th>' + esc(T('tm_impact', 'Startup impact')) + '</th></tr>';
      S.apps().filter(function (a) { return a.id !== 'taskmgr'; }).forEach(function (a) {
        var enabled = on.indexOf(a.id) >= 0;
        h += '<tr class="pr' + (sel === a.id ? ' sel' : '') + '" data-id="' + esc(a.id) + '"><td>' + S.icSpan(a.id) + ' ' + esc(a.title) + '</td><td>' + esc(enabled ? T('tm_enabled', 'Enabled') : T('tm_disabled', 'Disabled')) + '</td><td>' + esc(HEAVY[a.id] ? T('tm_high', 'High') : T('tm_low', 'Low')) + '</td></tr>';
      });
      h += '</table>';
      var selOn = sel && on.indexOf(sel) >= 0;
      $('tm-foot').innerHTML = '<button class="tm-btn" data-act="startup"' + (sel ? '' : ' disabled') + '>' + esc(selOn ? T('tm_disable', 'Disable') : T('tm_enable', 'Enable')) + '</button>';
    } else {
      h += '<table class="tm-tab"><tr><th>PID</th><th>' + esc(T('tm_name', 'Name')) + '</th><th>' + esc(T('tm_status', 'Status')) + '</th><th>' + esc(T('tm_desc', 'Description')) + '</th></tr>';
      m.bg.forEach(function (p) { h += '<tr><td>' + pidOf(p.name) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.status || 'Running') + '</td><td>' + esc(p.desc || '') + '</td></tr>'; });
      h += '</table>';
      $('tm-foot').innerHTML = '';
    }
    host.innerHTML = h;
  }
  function tierName(t) { return { std: 'Standard', adv: 'Advanced', elite: 'Elite' }[t] || t || ''; }
  function DOMs() { return Array.prototype.slice.call(document.querySelectorAll('#win-taskmgr [data-tab]')); }

  function start() { loadHw(); draw(); clearInterval(timer); timer = setInterval(function () { loadHw(); draw(); }, 1000); }
  function stop() { clearInterval(timer); timer = null; }

  S.registerApp({
    id: 'taskmgr', icon: ICON, titleKey: 'app_taskmgr', titleDef: 'Task Manager', w: 780, h: 520,
    html: '<div class="tm"><div class="tm-tabs">' +
      '<button data-tab="proc">' + esc(T('tm_t_proc', 'Processes')) + '</button><button data-tab="perf">' + esc(T('tm_t_perf', 'Performance')) + '</button>' +
      '<button data-tab="startup">' + esc(T('tm_t_startup', 'Startup apps')) + '</button><button data-tab="det">' + esc(T('tm_t_det', 'Details and services')) + '</button></div>' +
      '<div class="tm-body" id="tm-body"></div><div class="tm-foot" id="tm-foot"></div></div>',
    onOpen: function () { tab = 'proc'; sel = null; hw = null; hwAt = 0; Object.keys(hist).forEach(function (k) { hist[k] = []; }); start(); },
    onClose: stop,
    onReset: stop,
    onLocale: function () { var w = $('win-taskmgr'); if (w && w.classList.contains('open')) draw(); }
  });

  document.addEventListener('click', function (e) {
    var win = e.target.closest('#win-taskmgr'); if (!win) return;
    var tb = e.target.closest('[data-tab]'); if (tb) { tab = tb.dataset.tab; sel = null; draw(); return; }
    var row = e.target.closest('tr[data-id]'); if (row) { sel = row.dataset.id; draw(); return; }
    var b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    if (b.dataset.act === 'end' && sel) {
      var id = sel; sel = null;
      if (id === 'taskmgr') { S.endTask('taskmgr'); return; }
      S.endTask(id); draw();
    } else if (b.dataset.act === 'startup' && sel) {
      var cur = Array.isArray(S.prefs().startupApps) ? S.prefs().startupApps.slice() : [], i = cur.indexOf(sel);
      if (i >= 0) cur.splice(i, 1); else cur.push(sel);
      S.setPrefs({ startupApps: cur }); draw();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'Escape' || e.key === 'Esc')) { e.preventDefault(); S.openApp('taskmgr'); }
  });
  S.openTaskManager = function () { S.openApp('taskmgr'); };
})();
