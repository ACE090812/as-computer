/* Command Prompt (CMD) for Los Santos OS. Registers itself with LSOS.registerApp. Everything runs in the page: nothing is saved
   and nothing is sent to the server.
   Commands: help, cls, echo, whoami, hostname, date, time, ver, history, exit | dir, cd, pwd, type, mkdir, touch, rm |
   ipconfig, ping | hack (practice minigames from ui/hack.js). */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="3.5" width="20" height="17" rx="2.6" fill="#111827"/><path d="M6.2 9l3.6 3-3.6 3" fill="none" stroke="#4ade80" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.8 15.4h5.2" stroke="#e5e7eb" stroke-width="1.9" stroke-linecap="round"/></svg>';

  var FS, cwd, user, hist, histAt, busy;

  // ---- fake file system ------------------------------------------------------------------------------------------
  function dir(children) { return { d: true, c: children || {} }; }
  function file(text) { return { d: false, t: text }; }
  function userName() {
    var n = S.state && S.state.user ? String(S.state.user) : '';
    n = n.replace(/[^\w ]/g, '').trim().split(' ')[0];
    return n || 'User';
  }
  function freshFs() {
    var u = {};
    u[user] = dir({
      Desktop: dir({}),
      Documents: dir({
        'readme.txt': file('Los Santos OS\r\nThis is a test machine. Nothing you do here is saved.\r\n'),
        'todo.txt': file('- change the admin password\r\n- back up the logs\r\n- stop using "password123"\r\n'),
      }),
      Downloads: dir({ 'invoice_0412.txt': file('Invoice 0412\r\nAmount due: nobody knows\r\n') }),
    });
    return dir({
      Users: dir(u),
      Windows: dir({ System32: dir({ hosts: file('127.0.0.1  localhost\r\n10.0.0.1   gateway.local\r\n'), drivers: dir({}) }), 'notepad.exe': file('MZ... (binary)') }),
      'Program Files': dir({ 'Los Santos OS': dir({ 'version.txt': file('Los Santos OS 1.0\r\n') }) }),
    });
  }
  function reset() {
    user = userName(); FS = freshFs(); cwd = ['Users', user]; hist = []; histAt = 0; busy = false;
  }
  function pathOf(arr) { return 'C:\\' + arr.join('\\'); }
  function walk(parts) {
    var node = FS;
    for (var i = 0; i < parts.length; i++) { if (!node.d || !node.c[parts[i]]) return null; node = node.c[parts[i]]; }
    return node;
  }
  /* "..\Documents", "/Users", "C:\Windows" -> array of names (matched case-insensitively), whether or not they exist. */
  function resolve(p) {
    p = String(p || '').replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/');
    var base = p.charAt(0) === '/' ? [] : cwd.slice();
    p.split('/').forEach(function (seg) {
      if (!seg || seg === '.') return;
      if (seg === '..') { base.pop(); return; }
      var node = walk(base), found = null;
      if (node && node.d) Object.keys(node.c).forEach(function (k) { if (k.toLowerCase() === seg.toLowerCase()) found = k; });
      base.push(found || seg);
    });
    return base;
  }
  function badName(n) { return !n || /[<>:"|?*]/.test(n) || n.length > 40; }

  // ---- terminal --------------------------------------------------------------------------------------------------
  function out(text, cls) {
    var o = $('cmd-out'); if (!o) return;
    String(text == null ? '' : text).split('\n').forEach(function (line) {
      var d = document.createElement('div'); d.className = 'cm-line' + (cls ? ' cm-' + cls : ''); d.textContent = line; o.appendChild(d);
    });
    o.scrollTop = o.scrollHeight;
  }
  function setPrompt() { var p = $('cmd-prompt'); if (p) p.textContent = pathOf(cwd) + '> '; }
  function banner() { out('Los Santos OS [Version 1.0]'); out('(c) Los Santos OS. Type "help" for a list of commands.\n'); }
  function noPath() { out(T('cm_nopath', 'The system cannot find the path specified.'), 'err'); }

  var CMDS = {};
  function cmd(names, help, fn) { var list = names.split(' '); list.forEach(function (n) { CMDS[n] = { fn: fn, help: help }; }); }

  cmd('help', 'Lists the commands. help <command> explains one.', function (a) {
    if (a[0]) {
      var c = CMDS[a[0].toLowerCase()];
      return out(c ? a[0].toLowerCase() + ' - ' + c.help : T('cm_nohelp', 'No help for') + ' ' + a[0], c ? '' : 'err');
    }
    [['Basics', 'help cls echo whoami hostname date time ver history exit'], ['Files', 'dir cd pwd type mkdir touch rm'], ['Network', 'ipconfig ping'], ['Games', 'hack']].forEach(function (g) {
      out(g[0] + ':', 'hi'); out('  ' + g[1]);
    });
    out('\nAliases: ls = dir, cat = type, md = mkdir, del = rm, clear = cls.', 'dim');
  });
  cmd('cls clear', 'Clears the screen.', function () { $('cmd-out').innerHTML = ''; });
  cmd('echo', 'Prints text.', function (a, raw) { out(raw); });
  cmd('whoami', 'Shows the current user.', function () { out(user.toLowerCase() + '\\' + user.toLowerCase()); });
  cmd('hostname', 'Shows this computer\'s name.', function () { out('LSOS-' + user.toUpperCase().slice(0, 6)); });
  cmd('date', 'Shows the date.', function () { out(new Date().toDateString()); });
  cmd('time', 'Shows the time.', function () { out(new Date().toLocaleTimeString()); });
  cmd('ver', 'Shows the version.', function () { out('Los Santos OS [Version 1.0]'); });
  cmd('history', 'Shows what you typed.', function () { hist.forEach(function (h, i) { out((i + 1) + '  ' + h); }); });
  cmd('exit', 'Closes this window.', function () { var b = document.querySelector('#win-cmd [data-wb="close"]'); if (b) b.click(); });

  cmd('pwd', 'Shows the current folder.', function () { out(pathOf(cwd)); });
  cmd('cd chdir', 'Changes folder.', function (a, raw) {
    if (!raw) return out(pathOf(cwd));
    var p = resolve(raw), n = walk(p);
    if (!n || !n.d) return noPath();
    cwd = p; setPrompt();
  });
  cmd('dir ls', 'Lists files and folders.', function (a, raw) {
    var p = raw ? resolve(raw) : cwd, n = walk(p);
    if (!n || !n.d) return noPath();
    out(' Directory of ' + pathOf(p) + '\n');
    var names = Object.keys(n.c).sort(function (x, y) { return (n.c[y].d - n.c[x].d) || x.localeCompare(y); });
    if (!names.length) out('  (empty)', 'dim');
    names.forEach(function (k) { var c = n.c[k]; out((c.d ? '<DIR>       ' : (String(c.t ? c.t.length : 0) + ' B').padEnd(12)) + k, c.d ? 'hi' : ''); });
  });
  cmd('type cat', 'Shows a text file.', function (a, raw) {
    if (!raw) return out(T('cm_usage_type', 'Usage: type <file>'), 'warn');
    var n = walk(resolve(raw));
    if (!n) return out(T('cm_nofile', 'The system cannot find the file specified.'), 'err');
    if (n.d) return out(T('cm_isdir', 'That is a folder.'), 'err');
    out(n.t || '');
  });
  cmd('mkdir md', 'Makes a folder.', function (a, raw) {
    if (!raw) return out(T('cm_usage_mkdir', 'Usage: mkdir <name>'), 'warn');
    var p = resolve(raw), name = p.pop(), parent = walk(p);
    if (!parent || !parent.d) return noPath();
    if (badName(name)) return out(T('cm_badname', 'That name is not allowed.'), 'err');
    if (parent.c[name]) return out(T('cm_exists', 'That already exists.'), 'err');
    parent.c[name] = dir({});
  });
  cmd('touch', 'Makes an empty file.', function (a, raw) {
    if (!raw) return out('Usage: touch <name>', 'warn');
    var p = resolve(raw), name = p.pop(), parent = walk(p);
    if (!parent || !parent.d) return noPath();
    if (badName(name)) return out(T('cm_badname', 'That name is not allowed.'), 'err');
    if (!parent.c[name]) parent.c[name] = file('');
  });
  cmd('rm del', 'Deletes a file or an empty folder.', function (a, raw) {
    if (!raw) return out('Usage: rm <name>', 'warn');
    var p = resolve(raw), name = p.pop(), parent = walk(p);
    if (!parent || !parent.c[name]) return out(T('cm_nofile', 'The system cannot find the file specified.'), 'err');
    if (parent.c[name].d && Object.keys(parent.c[name].c).length) return out(T('cm_notempty', 'The folder is not empty.'), 'err');
    delete parent.c[name];
  });

  function hostByte() { var h = 0; for (var i = 0; i < user.length; i++) h = (h * 31 + user.charCodeAt(i)) & 255; return h; }
  cmd('ipconfig', 'Shows the network settings.', function () {
    out('Ethernet adapter Local Area Connection:\n');
    out('   IPv4 Address. . . . . : 10.0.' + (hostByte() % 200 + 20) + '.' + (hostByte() % 90 + 10));
    out('   Subnet Mask . . . . . : 255.255.255.0');
    out('   Default Gateway . . . : 10.0.0.1');
  });
  cmd('ping', 'Sends test packets to a host (pretend: nothing leaves this window).', function (a) {
    var host = a[0];
    if (!host) return out(T('cm_usage_ping', 'Usage: ping <host>'), 'warn');
    if (!/^[\w.\-]{1,50}$/.test(host) || !/^(localhost|127\.0\.0\.1|gateway\.local|10\.0\.0\.1)$|\./i.test(host)) {
      return out('Ping request could not find host ' + host + '. Please check the name and try again.', 'err');
    }
    var ip = /^\d/.test(host) ? host : '10.0.' + (host.length * 7 % 200) + '.' + (host.charCodeAt(0) % 200 + 10);
    out('Pinging ' + host + ' [' + ip + '] with 32 bytes of data:');
    return new Promise(function (res) {
      var i = 0;
      (function step() {
        if (i >= 4) { out('\nPing statistics for ' + ip + ':\n    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)'); return res(); }
        out('Reply from ' + ip + ': bytes=32 time=' + (6 + Math.floor(Math.random() * 20)) + 'ms TTL=' + (56 + Math.floor(Math.random() * 8)));
        i++; setTimeout(step, 380);
      })();
    });
  });

  // ---- practice minigames ----------------------------------------------------------------------------------------
  function games() { return (window.LSOS_HACK && window.LSOS_HACK.games) || []; }
  cmd('hack', 'Practice the hacking programs. hack list | hack play <program> [1-5]', function (a) {
    var sub = (a[0] || '').toLowerCase();
    if (!sub || sub === 'list') {
      out('Programs:', 'hi');
      games().forEach(function (g) { out('  ' + g.id.padEnd(10) + g.name + ' - ' + g.desc); });
      return out('\nhack play <program> [1-5]   (1 = easy, 5 = hard; "random" picks one). Practice only: nothing is changed.', 'dim');
    }
    if (sub !== 'play') return out('Usage: hack list | hack play <program> [1-5]', 'warn');
    var id = (a[1] || 'random').toLowerCase(), level = Math.max(1, Math.min(5, parseInt(a[2], 10) || 2));
    if (id !== 'random' && !games().some(function (g) { return g.id === id; })) return out('Unknown program "' + a[1] + '". Try: hack list', 'err');
    out('Launching ' + id + ' (level ' + level + ')...');
    return window.LSOS_HACK.start(id, level, null).then(function (ok) { out(ok ? 'Program completed.' : 'Program failed.', ok ? 'ok' : 'err'); });
  });

  // ---- input -----------------------------------------------------------------------------------------------------
  function run(line) {
    var raw = line.trim();
    out(pathOf(cwd) + '> ' + line);
    if (!raw) return;
    hist.push(raw); histAt = hist.length;
    var parts = raw.split(/\s+/), name = parts[0].toLowerCase(), args = parts.slice(1), rest = raw.slice(parts[0].length).trim();
    var c = CMDS[name];
    if (!c) return out('\'' + parts[0] + '\' is not recognized as a command. Type "help" for the list.', 'err');
    var r;
    try { r = c.fn(args, rest); } catch (e) { out('The command failed.', 'err'); return; }
    if (r && typeof r.then === 'function') {
      busy = true; $('cmd-in').disabled = true;
      r.then(function () {}, function () { out('The command failed.', 'err'); }).then(function () {
        busy = false; var i = $('cmd-in'); if (i) { i.disabled = false; i.focus(); }
      });
    }
  }

  function complete(v) {
    var m = v.match(/^(\S*)$/);
    if (m) {
      var hits = Object.keys(CMDS).filter(function (k) { return k.indexOf(m[1].toLowerCase()) === 0; }).sort();
      return hits.length === 1 ? hits[0] + ' ' : v;
    }
    var mm = v.match(/^(.*\s)(\S*)$/), word = mm[2].replace(/\\/g, '/'), slash = word.lastIndexOf('/');
    var dirPart = slash >= 0 ? word.slice(0, slash + 1) : '', stem = slash >= 0 ? word.slice(slash + 1) : word;
    var node = walk(resolve(dirPart || '.'));
    if (!node || !node.d) return v;
    var names = Object.keys(node.c).filter(function (k) { return k.toLowerCase().indexOf(stem.toLowerCase()) === 0; });
    return names.length === 1 ? mm[1] + dirPart + names[0] + (node.c[names[0]].d ? '/' : '') : v;
  }

  var HTML = '<div id="cmd"><div class="cm-out" id="cmd-out"></div><div class="cm-in"><span class="cm-prompt" id="cmd-prompt"></span><input id="cmd-in" type="text" autocomplete="off" spellcheck="false"></div></div>';

  function bind() {
    var el = $('cmd'); if (!el || el.__b) return; el.__b = true;
    el.addEventListener('mousedown', function (e) { if (e.target.id !== 'cmd-in' && !window.getSelection().toString()) setTimeout(function () { var i = $('cmd-in'); if (i && !i.disabled) i.focus(); }, 0); });
    $('cmd-in').addEventListener('keydown', function (e) {
      var i = e.target;
      if (e.key === 'Enter') { if (busy) return; var v = i.value; i.value = ''; run(v); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (histAt > 0) { histAt--; i.value = hist[histAt] || ''; } }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (histAt < hist.length) { histAt++; i.value = hist[histAt] || ''; } }
      else if (e.key === 'Tab') { e.preventDefault(); i.value = complete(i.value); }
    });
  }

  function start() { reset(); var o = $('cmd-out'); if (o) o.innerHTML = ''; banner(); setPrompt(); }

  var root = S.registerApp({
    id: 'cmd', icon: ICON_APP, titleKey: 'cmd_app_name', titleDef: 'Command Prompt', w: 820, h: 520, html: HTML,
    onOpen: function () { bind(); if (!FS) start(); var i = $('cmd-in'); if (i) i.focus(); },
    onReset: function () { FS = null; start(); },
    onLocale: function () {}
  });
  if (root) { bind(); start(); }
})();
