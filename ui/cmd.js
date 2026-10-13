/* Command Prompt (CMD) for Los Santos OS. Registers itself with LSOS.registerApp.
   The drive C:\ shows the player's REAL File Explorer folders (Documents, Downloads, the job's shared folder, and the legal / court
   folders when they have them) through the same 'filesApi' NUI callback File Explorer uses, so the server applies the same rules
   (who may see or change what, name and size limits, the Recycle Bin) and logs the same Event Viewer lines. Windows and
   Program Files are read-only decoration.
   Commands: help, cls, echo (also  echo text > file  and  >> file), whoami, hostname, date, time, ver, history, exit |
   dir, cd, pwd, type, mkdir, touch, ren, rm | ipconfig, ping | hack (practice minigames from ui/hack.js). */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="3.5" width="20" height="17" rx="2.6" fill="#111827"/><path d="M6.2 9l3.6 3-3.6 3" fill="none" stroke="#4ade80" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.8 15.4h5.2" stroke="#e5e7eb" stroke-width="1.9" stroke-linecap="round"/></svg>';

  var user, hist, histAt, busy, cwd, places;

  // ---- file system: real folders through filesApi, plus read-only decoration ------------------------------------------
  function files(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/filesApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* Changes are rate limited server side (one per ~150 ms): retry politely when it says "busy". */
  async function change(name, data) {
    var r;
    for (var i = 0; i < 4; i++) { r = await files(name, data); if (!(r && r.reason === 'busy')) return r; await sleep(220); }
    return r;
  }
  var FERR = {
    forbidden: 'Access is denied.', too_many: 'There are too many files here.', too_deep: 'Folders cannot be nested that deep.', too_long: 'That file is too long.',
    busy: 'The file system is busy. Try again.', network: 'Could not reach the server.', not_authorised: 'Access is denied.', invalid: 'The system cannot find the file specified.', error: 'The file system reported an error.'
  };
  function ferr(r) { out(T('cm_f_' + (r && r.reason), FERR[r && r.reason] || FERR.error), 'err'); }

  function userName() {
    var n = S.state && S.state.user ? String(S.state.user) : '';
    n = n.replace(/[^\w ]/g, '').trim().split(' ')[0];
    return n || 'User';
  }

  // decoration: read-only
  function dir(children) { return { d: true, c: children || {} }; }
  function file(text) { return { d: false, t: text }; }
  var SYS = dir({
    Windows: dir({ System32: dir({ hosts: file('127.0.0.1  localhost\r\n10.0.0.1   gateway.local\r\n'), drivers: dir({}) }), 'notepad.exe': file('MZ... (binary)') }),
    'Program Files': dir({ 'Los Santos OS': dir({ 'version.txt': file('Los Santos OS 1.0\r\n') }) })
  });
  function sysNode(names) {
    var n = SYS;
    for (var i = 0; i < names.length; i++) { if (!n.d || !n.c[names[i]]) return null; n = n.c[names[i]]; }
    return n;
  }

  /* A location is { place: null (the drive's root) | 'docs' | 'dl' | 'job' | 'legal' | 'court' | 'sys', ids: [folder ids], names: [folder names] }. */
  function rootLoc() { return { place: null, ids: [], names: [] }; }
  function pathOf(loc) { return 'C:\\' + loc.names.join('\\'); }
  function clone(loc) { return { place: loc.place, ids: loc.ids.slice(), names: loc.names.slice() }; }
  function parentId(loc) { return loc.ids.length ? loc.ids[loc.ids.length - 1] : 0; }

  async function loadPlaces() {
    var r = await files('folders');
    places = [{ key: 'docs', name: 'Documents' }, { key: 'dl', name: 'Downloads' }];
    if (r.ok && r.data) {
      var d = r.data;
      var safe = function (s) { return String(s).replace(/[\\/:*?"<>|]/g, '').trim(); };
      if (d.job) places.push({ key: 'job', name: safe(d.job) || 'Work' });
      if (d.legal) places.push({ key: 'legal', name: safe(d.legal) || 'Legal' });
      if (d.court) places.push({ key: 'court', name: safe(d.court) || 'Court' });
    }
    places.push({ key: 'sys', name: 'Windows', sys: true }, { key: 'sys', name: 'Program Files', sys: true });
  }

  /* The entries inside a location: [{ name, folder: bool, id, size, updated, kind, manage, place }] */
  async function listDir(loc) {
    if (loc.place === null) {
      if (!places) await loadPlaces();
      return places.map(function (p) { return { name: p.name, folder: true, place: p.key, root: true }; });
    }
    if (loc.place === 'sys') {
      var n = sysNode(loc.names);
      if (!n || !n.d) return [];
      return Object.keys(n.c).map(function (k) { var c = n.c[k]; return { name: k, folder: c.d, size: c.d ? 0 : (c.t || '').length, sys: true, text: c.t }; });
    }
    var r = await files('list', { folder: loc.place, parent: parentId(loc) });
    if (!r.ok) { ferr(r); return null; }
    return (r.data.files || []).map(function (f) { return { name: f.name, folder: f.kind === 'folder', id: f.id, size: f.size, updated: f.updated, kind: f.kind, manage: f.manage }; });
  }
  function find(entries, name) {
    var low = name.toLowerCase();
    for (var i = 0; i < entries.length; i++) if (entries[i].name.toLowerCase() === low) return entries[i];
    return null;
  }

  function up(loc) {
    if (!loc.names.length) return;
    if (loc.place !== 'sys' && loc.ids.length) loc.ids.pop();
    loc.names.pop();
    if (!loc.names.length) { loc.place = null; loc.ids = []; }
  }
  function down(loc, e) {
    if (loc.place === null) { loc.place = e.place; loc.names = [e.name]; loc.ids = []; }
    else { if (loc.place !== 'sys') loc.ids.push(e.id); loc.names.push(e.name); }
  }

  /* Walks a path from the current folder (or the root when it starts with \ or /). Results:
       { error: true }                          the server refused (already printed)
       { missing: true }                        a folder on the way does not exist
       { loc, entry, name }                     loc = the folder that holds the last item, entry = that item (or null when it is missing
                                                and opts.allowMissingLast), name = its name
       { loc, folder: true }                    the path ended at a folder (or the root): loc is that folder itself, entry its listing row */
  async function resolve(text, opts) {
    opts = opts || {};
    var p = String(text || '').trim().replace(/^"(.*)"$/, '$1').replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/');
    var loc = p.charAt(0) === '/' ? rootLoc() : clone(cwd);
    var parts = p.split('/').filter(function (x) { return x && x !== '.'; });
    var entry = null;
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i], isLast = i === parts.length - 1;
      if (seg === '..') { up(loc); entry = null; continue; }
      var entries = await listDir(loc);
      if (entries === null) return { error: true };
      var e = find(entries, seg);
      if (!e) { if (isLast && opts.allowMissingLast) return { loc: loc, entry: null, name: seg }; return { missing: true }; }
      if (!e.folder) {
        if (!isLast) return { missing: true };
        return { loc: loc, entry: e, name: e.name };
      }
      if (isLast && opts.keepParent) return { loc: loc, entry: e, name: e.name };
      down(loc, e); entry = e;
    }
    return { loc: loc, folder: true, entry: entry };
  }
  function noPath() { out(T('cm_nopath', 'The system cannot find the path specified.'), 'err'); }
  function noFile() { out(T('cm_nofile', 'The system cannot find the file specified.'), 'err'); }
  function denied() { out('Access is denied.', 'err'); }

  // text <-> what File Explorer stores (a small sanitised HTML fragment)
  var ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
  function fromStored(body) {
    var s = String(body || '').replace(/\r/g, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<\/(p|div|li|h[1-3])>/gi, '\n').replace(/<[^>]*>/g, '');
    s = s.replace(/&(lt|gt|amp|quot|#39|apos);/g, function (m) { return ENT[m]; });
    return s.replace(/\n+$/, '');
  }
  function toStored(text) { return String(text).replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>'); }
  function badName(n) { return !n || /[<>:"|?*\\/]/.test(n) || n.length > 80; }

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

  var CMDS = {};
  function cmd(names, help, fn) { var list = names.split(' '); list.forEach(function (n) { CMDS[n] = { fn: fn, help: help }; }); }

  cmd('help', 'Lists the commands. help <command> explains one.', function (a) {
    if (a[0]) {
      var c = CMDS[a[0].toLowerCase()];
      return out(c ? a[0].toLowerCase() + ' - ' + c.help : T('cm_nohelp', 'No help for') + ' ' + a[0], c ? '' : 'err');
    }
    [['Basics', 'help cls echo whoami hostname date time ver history exit'], ['Files', 'dir cd pwd type mkdir touch ren rm echo>'], ['Network', 'ipconfig ping'], ['Games', 'hack']].forEach(function (g) {
      out(g[0] + ':', 'hi'); out('  ' + g[1]);
    });
    out('\nAliases: ls = dir, cat = type, md = mkdir, del = rm, clear = cls.', 'dim');
  });
  cmd('cls clear', 'Clears the screen.', function () { $('cmd-out').innerHTML = ''; });
  cmd('echo', 'Prints text.  echo text > file  writes it to a file, >> adds to one.', async function (a, raw) {
    var m = raw.match(/^(.*?)\s*(>>|>)\s*(.+)$/);
    if (!m) return out(raw);
    var r = await target(m[3]); if (!r) return;
    await writeText(r, m[1].replace(/^"(.*)"$/, '$1'), m[2] === '>>');
  });
  cmd('whoami', 'Shows the current user.', function () { out(user.toLowerCase() + '\\' + user.toLowerCase()); });
  cmd('hostname', 'Shows this computer\'s name.', function () { out('LSOS-' + user.toUpperCase().slice(0, 6)); });
  cmd('date', 'Shows the date.', function () { out(new Date().toDateString()); });
  cmd('time', 'Shows the time.', function () { out(new Date().toLocaleTimeString()); });
  cmd('ver', 'Shows the version.', function () { out('Los Santos OS [Version 1.0]'); });
  cmd('history', 'Shows what you typed.', function () { hist.forEach(function (h, i) { out((i + 1) + '  ' + h); }); });
  cmd('exit', 'Closes this window.', function () { var b = document.querySelector('#win-cmd [data-wb="close"]'); if (b) b.click(); });

  cmd('pwd', 'Shows the current folder.', function () { out(pathOf(cwd)); });
  cmd('cd chdir', 'Changes folder.', async function (a, raw) {
    if (!raw) return out(pathOf(cwd));
    var r = await resolve(raw);
    if (r.error) return;
    if (r.missing || !r.folder) return noPath();
    cwd = r.loc; setPrompt();
  });
  function when(at) {
    if (!at) return '                ';
    var d = new Date(at * 1000), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  cmd('dir ls', 'Lists files and folders.', async function (a, raw) {
    var loc = cwd;
    if (raw) { var r = await resolve(raw); if (r.error) return; if (r.missing || !r.folder) return noPath(); loc = r.loc; }
    var list = await listDir(loc); if (list === null) return;
    out(' Directory of ' + pathOf(loc) + '\n');
    if (!list.length) return out('  (empty)', 'dim');
    list.sort(function (x, y) { return ((y.folder ? 1 : 0) - (x.folder ? 1 : 0)) || x.name.localeCompare(y.name); });
    list.forEach(function (e) {
      var mark = e.folder ? '<DIR>'.padEnd(12) : (e.kind && e.kind !== 'text' ? '<' + e.kind.toUpperCase() + '>' : String(e.size || 0) + ' ch').padEnd(12);
      out(when(e.updated) + '  ' + mark + e.name, e.folder ? 'hi' : '');
    });
  });
  cmd('type cat', 'Shows a text file.', async function (a, raw) {
    if (!raw) return out(T('cm_usage_type', 'Usage: type <file>'), 'warn');
    var r = await resolve(raw);
    if (r.error) return;
    if (r.missing || !r.entry || r.folder) return noFile();
    var e = r.entry;
    if (e.sys) return out(String(e.text || '').replace(/\r/g, ''));
    var g = await files('get', { id: e.id });
    if (!g.ok) return ferr(g);
    var f = g.data.file;
    if (f.kind === 'text') return out(fromStored(f.body));
    out((f.url ? f.url : '(' + f.kind + ')'), 'dim');
  });

  /* Splits "folder\name" into the folder that must exist and the new name. Refuses the drive root and read-only places. */
  async function target(raw) {
    var r = await resolve(raw, { allowMissingLast: true, keepParent: true });
    if (r.error) return null;
    if (r.missing) { noPath(); return null; }
    if (r.folder) { out(T('cm_exists', 'That already exists.'), 'err'); return null; }
    if (r.loc.place === null || r.loc.place === 'sys') { denied(); return null; }
    return r;
  }
  cmd('mkdir md', 'Makes a folder.', async function (a, raw) {
    if (!raw) return out(T('cm_usage_mkdir', 'Usage: mkdir <name>'), 'warn');
    var r = await target(raw); if (!r) return;
    if (r.entry) return out(T('cm_exists', 'That already exists.'), 'err');
    if (badName(r.name)) return out(T('cm_badname', 'That name is not allowed.'), 'err');
    var res = await change('folder', { folder: r.loc.place, parent: parentId(r.loc), name: r.name });
    if (!res.ok) return ferr(res);
  });
  async function writeText(r, text, append) {
    if (r.entry && r.entry.folder) return out(T('cm_isdir', 'That is a folder.'), 'err');
    if (!r.entry && badName(r.name)) return out(T('cm_badname', 'That name is not allowed.'), 'err');
    var body = text;
    if (r.entry && append) {
      var g = await files('get', { id: r.entry.id });
      if (!g.ok) return ferr(g);
      if (g.data.file.kind !== 'text') return out('That is not a text file.', 'err');
      body = fromStored(g.data.file.body) + '\n' + text;
    }
    var data = r.entry ? { id: r.entry.id, body: toStored(body) } : { folder: r.loc.place, parent: parentId(r.loc), name: r.name, body: toStored(body) };
    var res = await change('save', data);
    if (!res.ok) ferr(res);
  }
  cmd('touch', 'Makes an empty text file.', async function (a, raw) {
    if (!raw) return out('Usage: touch <name>', 'warn');
    var r = await target(raw); if (!r || r.entry) return;
    await writeText(r, '', false);
  });
  cmd('ren rename', 'Renames a file or folder.  ren <old> <new name>', async function (a, raw) {
    var m = raw.match(/^("[^"]+"|\S+)\s+(.+)$/);
    if (!m) return out('Usage: ren <old> <new name>', 'warn');
    var r = await resolve(m[1], { keepParent: true });
    if (r.error) return;
    if (r.missing || !r.entry) return noFile();
    if (r.entry.root || r.entry.sys) return denied();
    var nm = m[2].trim().replace(/^"(.*)"$/, '$1');
    if (badName(nm)) return out(T('cm_badname', 'That name is not allowed.'), 'err');
    var res = await change('rename', { id: r.entry.id, name: nm });
    if (!res.ok) ferr(res);
  });
  cmd('rm del', 'Deletes a file or folder (it goes to the Recycle Bin).', async function (a, raw) {
    if (!raw) return out('Usage: rm <name>', 'warn');
    var r = await resolve(raw, { keepParent: true });
    if (r.error) return;
    if (r.missing || !r.entry) return noFile();
    if (r.entry.root || r.entry.sys) return denied();
    var res = await change('delete', { id: r.entry.id });
    if (!res.ok) return ferr(res);
    out(res.data && res.data.binned ? 'Moved to the Recycle Bin.' : 'Deleted.', 'dim');
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

  async function complete(v) {
    var m = v.match(/^(\S*)$/);
    if (m) {
      var hits = Object.keys(CMDS).filter(function (k) { return k.indexOf(m[1].toLowerCase()) === 0; }).sort();
      return hits.length === 1 ? hits[0] + ' ' : v;
    }
    var mm = v.match(/^(.*\s)(\S*)$/), word = mm[2].replace(/\\/g, '/'), slash = word.lastIndexOf('/');
    var dirPart = slash >= 0 ? word.slice(0, slash + 1) : '', stem = slash >= 0 ? word.slice(slash + 1) : word;
    var r = await resolve(dirPart || '.');
    if (r.error || r.missing || !r.folder) return v;
    var list = await listDir(r.loc);
    if (!list) return v;
    var names = list.filter(function (e) { return e.name.toLowerCase().indexOf(stem.toLowerCase()) === 0; });
    if (names.length !== 1) return v;
    var n = names[0].name;
    return mm[1] + dirPart + (/\s/.test(n) ? '"' + n + '"' : n) + (names[0].folder ? '/' : '');
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
      else if (e.key === 'Tab') { e.preventDefault(); var cur = i.value; complete(cur).then(function (nv) { if (i.value === cur) i.value = nv; }); }
    });
  }

  async function start() {
    user = userName(); hist = []; histAt = 0; busy = false; cwd = rootLoc(); places = null;
    var o = $('cmd-out'); if (o) o.innerHTML = '';
    banner(); setPrompt();
    await loadPlaces(); started = true;
  }
  var started = false;

  var root = S.registerApp({
    id: 'cmd', icon: ICON_APP, titleKey: 'cmd_app_name', titleDef: 'Command Prompt', w: 820, h: 520, html: HTML,
    onOpen: function () { bind(); if (!started) start(); var i = $('cmd-in'); if (i) i.focus(); },
    onReset: function () { started = false; if ($('cmd')) start(); },
    onLocale: function () {}
  });
  if (root) { bind(); start(); }
})();
