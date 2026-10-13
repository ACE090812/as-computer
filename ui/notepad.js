/* Notepad app for Los Santos OS: the character's own plain-text notes, saved on the server (so they follow the player to any
   computer). Several notes can be open at once in tabs; each saves by itself a moment after typing stops. A note's title is its
   first line. Menu bar (File / Edit / View), Find and Replace, an Open dialog and a status bar.
   Registers itself with LSOS.registerApp. Every call goes through the 'notesApi' NUI callback (client/notepad.lua).
   Older notes were saved as small HTML fragments (rich text); they are turned into plain text when opened. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#f5c542"/><rect x="6" y="5" width="12" height="14" rx="1.6" fill="#fff"/><path d="M8.6 9h6.8M8.6 12h6.8M8.6 15h4" stroke="#b7791f" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/notesApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  var ERR = {
    not_authorised: ['np_err_not_authorised', 'You cannot use Notepad from this computer.'],
    invalid: ['np_err_invalid', 'That note could not be saved.'],
    too_long: ['np_err_too_long', 'This note is at its length limit.'],
    too_many: ['np_err_too_many', 'You have reached the note limit. Delete one first.'],
    busy: ['np_err_busy', 'Slow down, saving again in a moment.'],
    network: ['np_err_network', 'Could not reach the server. Your changes are still here.'],
    error: ['np_err_error', 'Something went wrong. Your changes are still here and will be saved again.']
  };
  function errText(res) { var e = ERR[res && res.reason] || ERR.error; return T(e[0], e[1]); }

  // ---- text <-> what the server stores ---------------------------------------------------------------------------
  // The server keeps a note as a small sanitised fragment: it turns & < > into entities and leaves line breaks alone. We escape
  // them ourselves before sending so typing "&lt;" survives a round trip, and undo the escaping when a note is opened.
  var ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
  function fromStored(body) {
    var s = String(body || '').replace(/\r/g, '');
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<\/(p|div|li|h[1-3])>/gi, '\n').replace(/<[^>]*>/g, '');
    s = s.replace(/&(lt|gt|amp|quot|#39|apos);/g, function (m) { return ENT[m]; });
    return s.replace(/\n+$/, '');
  }
  function toStored(text) { return String(text).replace(/\r/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function titleOf(text) {
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (t) return t.length > 60 ? t.slice(0, 60) : t; }
    return '';
  }

  // ---- state -----------------------------------------------------------------------------------------------------
  var PREF = 'as-computer:notepad';
  function loadPrefs() { try { return JSON.parse(window.localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } }
  function savePrefs() { try { window.localStorage.setItem(PREF, JSON.stringify({ wrap: N.wrap, zoom: N.zoom, bar: N.bar })); } catch (e) { /* storage blocked */ } }

  var N, seq = 0;
  function fresh() {
    if (N) N.tabs.forEach(function (t) { clearTimeout(t.timer); });
    var p = loadPrefs();
    N = { tabs: [], cur: -1, notes: [], limits: { maxNotes: 50, maxLength: 30000 }, loaded: false, loading: false, error: '', menu: null,
          find: null, findText: '', replText: '', matchCase: false, dlg: null, dlgQ: '', wrap: p.wrap !== false, zoom: p.zoom || 15, bar: p.bar !== false,
          queue: [], pumping: false, confirmDel: false, toast: '' };
  }
  fresh();

  function cur() { return N.tabs[N.cur] || null; }
  function dirty(t) { return t.text !== t.saved && !(t.id === null && t.text.trim() === ''); }
  function stamp(ts) {
    var d = new Date(ts * 1000), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  }

  // ---- saving (one request at a time: the server throttles saves per player) ---------------------------------------
  function schedule(t) {
    clearTimeout(t.timer);
    t.timer = setTimeout(function () { enqueue(t); }, 700);
    paintStatus();
  }
  function enqueue(t) {
    clearTimeout(t.timer); t.timer = null;
    if (!dirty(t) || N.queue.indexOf(t) >= 0) return;
    N.queue.push(t); pump();
  }
  function pump() {
    if (N.pumping || !N.queue.length) return;
    var t = N.queue[0], text = t.text;
    N.pumping = true; t.saving = true; paintStatus();
    api('save', { id: t.id, body: toStored(text) }).then(function (res) {
      N.pumping = false; t.saving = false; N.queue.shift();
      if (!res.ok) {
        N.error = errText(res); paintStatus();
        if (res.reason === 'busy' || res.reason === 'network' || res.reason === 'error') { t.timer = setTimeout(function () { enqueue(t); }, 1500); }
        return pump();
      }
      N.error = '';
      var s = res.data.note;
      t.id = s.id; t.saved = text; t.updated = s.updated;
      var row = N.notes.filter(function (x) { return x.id === s.id; })[0];
      if (row) { row.title = s.title; row.snippet = s.snippet; row.updated = s.updated; } else N.notes.unshift(s);
      if (t.text !== t.saved) enqueue(t);
      render(); pump();
    });
  }
  function flushAll() { N.tabs.forEach(function (t) { if (t.timer) enqueue(t); }); }

  // ---- tabs ------------------------------------------------------------------------------------------------------
  function addTab(note) {
    var t = { key: ++seq, id: note ? note.id : null, text: note ? note.text : '', saved: note ? note.text : '', updated: note ? note.updated : 0, timer: null, saving: false };
    N.tabs.push(t); N.cur = N.tabs.length - 1; N.confirmDel = false; N.error = '';
    render(true);
  }
  function newTab() { addTab(null); }
  function openNote(id) {
    var at = -1; N.tabs.forEach(function (t, i) { if (t.id === id) at = i; });
    if (at >= 0) { N.cur = at; N.dlg = null; return render(true); }
    api('get', { id: id }).then(function (res) {
      if (!res.ok) { N.error = errText(res); return render(); }
      var n = res.data.note; N.dlg = null;
      addTab({ id: n.id, text: fromStored(n.body), updated: n.updated });
    });
  }
  function closeTab(i) {
    var t = N.tabs[i]; if (!t) return;
    if (t.timer || dirty(t)) enqueue(t);
    N.tabs.splice(i, 1);
    if (N.cur >= N.tabs.length) N.cur = N.tabs.length - 1;
    if (!N.tabs.length) return newTab();
    N.confirmDel = false; render(true);
  }
  function deleteNote() {
    var t = cur(); if (!t) return;
    if (t.id === null) { t.text = t.saved = ''; return render(true); }
    if (!N.confirmDel) { N.confirmDel = true; N.toast = T('np_confirm_delete', 'Click Delete note again to confirm'); return render(); }
    api('delete', { id: t.id }).then(function (res) {
      if (!res.ok) { N.error = errText(res); return render(); }
      N.notes = N.notes.filter(function (x) { return x.id !== t.id; });
      t.saved = t.text; t.id = null; clearTimeout(t.timer); N.queue = N.queue.filter(function (x) { return x !== t; });
      N.confirmDel = false; N.toast = T('np_deleted', 'Note deleted');
      closeTab(N.tabs.indexOf(t));
    });
  }

  function load() {
    N.loading = true; render();
    api('list').then(function (res) {
      N.loading = false;
      if (!res.ok) { N.error = errText(res); return render(); }
      N.notes = res.data.notes || []; N.limits = res.data.limits || N.limits; N.loaded = true; N.error = '';
      if (!N.tabs.length) { if (N.notes.length) return openNote(N.notes[0].id); return newTab(); }
      render();
    });
  }

  // ---- find & replace --------------------------------------------------------------------------------------------
  function ta() { return $('npd-ta'); }
  function hay(s) { return N.matchCase ? s : s.toLowerCase(); }
  function countMatches() {
    var t = cur(); if (!t || !N.findText) return 0;
    var h = hay(t.text), n = hay(N.findText), c = 0, i = 0;
    while ((i = h.indexOf(n, i)) >= 0) { c++; i += n.length; }
    return c;
  }
  function findNext(back) {
    var t = cur(), el = ta(); if (!t || !el || !N.findText) return false;
    var h = hay(el.value), n = hay(N.findText), from = back ? el.selectionStart - 1 : el.selectionEnd, i;
    if (back) { i = from >= 0 ? h.lastIndexOf(n, from) : -1; if (i < 0) i = h.lastIndexOf(n); }
    else { i = h.indexOf(n, from); if (i < 0) i = h.indexOf(n); }
    if (i < 0) { N.toast = T('np_not_found', 'Cannot find') + ' "' + N.findText + '"'; paintStatus(); return false; }
    el.focus(); el.setSelectionRange(i, i + N.findText.length); N.toast = '';
    var line = el.value.slice(0, i).split('\n').length, lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (line - 4) * lh);
    paintStatus(); return true;
  }
  function replaceOne() {
    var el = ta(); if (!el || !N.findText) return;
    var sel = el.value.slice(el.selectionStart, el.selectionEnd);
    if (sel && hay(sel) === hay(N.findText)) { el.focus(); document.execCommand('insertText', false, N.replText); onInput(); }
    findNext(false);
  }
  function replaceAll() {
    var t = cur(), el = ta(); if (!t || !el || !N.findText) return;
    var h = hay(t.text), n = hay(N.findText), out = '', last = 0, i, c = 0;
    while ((i = h.indexOf(n, last)) >= 0) { out += t.text.slice(last, i) + N.replText; last = i + n.length; c++; }
    if (!c) { N.toast = T('np_not_found', 'Cannot find') + ' "' + N.findText + '"'; return paintStatus(); }
    t.text = (out + t.text.slice(last)).slice(0, N.limits.maxLength); el.value = t.text; schedule(t);
    N.toast = c + ' ' + T('np_replaced', 'replaced'); paintStatus(); drawTabs();
  }
  function openFind(replace) {
    N.find = replace ? 'replace' : 'find'; N.menu = null;
    var el = ta(), sel = el && el.selectionStart !== el.selectionEnd ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
    if (sel && sel.indexOf('\n') < 0) N.findText = sel;
    render(); var f = $('npd-find'); if (f) { f.focus(); f.select(); }
  }

  // ---- drawing ---------------------------------------------------------------------------------------------------
  var HTML = '<div class="npd" id="np"><div class="npd-menubar" id="npd-menubar"></div><div class="npd-tabs" id="npd-tabs"></div><div class="npd-findbar" id="npd-findbar" style="display:none"></div>' +
    '<div class="npd-edit"><textarea id="npd-ta" spellcheck="false"></textarea></div><div class="npd-status" id="npd-status"></div><div class="npd-over" id="npd-over"></div></div>';

  var MENUS = [
    ['file', 'np_m_file', 'File', [['new', 'np_new', 'New tab', 'Ctrl+N'], ['open', 'np_open', 'Open...', 'Ctrl+O'], ['save', 'np_save', 'Save', 'Ctrl+S'], ['-'], ['delete', 'np_delete', 'Delete note'], ['close', 'np_close_tab', 'Close tab', 'Ctrl+W']]],
    ['edit', 'np_m_edit', 'Edit', [['undo', 'np_undo', 'Undo', 'Ctrl+Z'], ['-'], ['cut', 'np_cut', 'Cut', 'Ctrl+X'], ['copy', 'np_copy', 'Copy', 'Ctrl+C'], ['paste', 'np_paste', 'Paste', 'Ctrl+V'], ['-'], ['find', 'np_find', 'Find...', 'Ctrl+F'], ['replace', 'np_replace', 'Replace...', 'Ctrl+H'], ['-'], ['all', 'np_select_all', 'Select all', 'Ctrl+A'], ['time', 'np_time', 'Time / date', '']]],
    ['view', 'np_m_view', 'View', [['wrap', 'np_wrap', 'Word wrap'], ['bar', 'np_statusbar', 'Status bar'], ['-'], ['zin', 'np_zoom_in', 'Zoom in', 'Ctrl+='], ['zout', 'np_zoom_out', 'Zoom out', 'Ctrl+-'], ['zreset', 'np_zoom_reset', 'Restore default zoom']]]
  ];

  function drawMenubar() {
    var h = '';
    MENUS.forEach(function (m) {
      h += '<div class="npd-menu"><button class="npd-mb' + (N.menu === m[0] ? ' on' : '') + '" data-menu="' + m[0] + '">' + esc(T(m[1], m[2])) + '</button>';
      if (N.menu === m[0]) {
        h += '<div class="npd-drop">';
        m[3].forEach(function (it) {
          if (it[0] === '-') return (h += '<div class="npd-sep"></div>');
          var on = (it[0] === 'wrap' && N.wrap) || (it[0] === 'bar' && N.bar);
          h += '<button class="npd-it" data-cmd="' + it[0] + '"><span class="ck">' + (on ? '✓' : '') + '</span><span class="lb">' + esc(T(it[1], it[2])) + '</span><span class="sc">' + esc(it[3] || '') + '</span></button>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    $('npd-menubar').innerHTML = h;
  }
  function drawTabs() {
    var h = '';
    N.tabs.forEach(function (t, i) {
      var title = titleOf(t.text) || T('np_untitled', 'Untitled');
      h += '<div class="npd-tab' + (i === N.cur ? ' on' : '') + '" data-tab="' + i + '"><span class="tt">' + esc(title.length > 22 ? title.slice(0, 22) + '…' : title) + '</span>' + (dirty(t) ? '<span class="dot">●</span>' : '') + '<button class="x" data-close="' + i + '" title="' + esc(T('np_close_tab', 'Close tab')) + '">×</button></div>';
    });
    h += '<button class="npd-plus" data-cmd="new" title="' + esc(T('np_new', 'New tab')) + '">+</button>';
    $('npd-tabs').innerHTML = h;
  }
  function drawFind() {
    var b = $('npd-findbar');
    if (!N.find) { b.style.display = 'none'; return; }
    b.style.display = '';
    var rep = N.find === 'replace';
    b.innerHTML = '<input id="npd-find" placeholder="' + esc(T('np_find_what', 'Find')) + '" value="' + esc(N.findText) + '">' +
      (rep ? '<input id="npd-repl" placeholder="' + esc(T('np_replace_with', 'Replace with')) + '" value="' + esc(N.replText) + '">' : '') +
      '<button class="npd-btn" data-cmd="fprev">' + esc(T('np_prev', 'Previous')) + '</button><button class="npd-btn" data-cmd="fnext">' + esc(T('np_next', 'Next')) + '</button>' +
      (rep ? '<button class="npd-btn" data-cmd="rone">' + esc(T('np_replace_one', 'Replace')) + '</button><button class="npd-btn" data-cmd="rall">' + esc(T('np_replace_all', 'Replace all')) + '</button>' : '') +
      '<span class="npd-count" id="npd-findcount"></span><label class="npd-chk"><input type="checkbox" id="npd-case"' + (N.matchCase ? ' checked' : '') + '> ' + esc(T('np_match_case', 'Match case')) + '</label><button class="npd-btn" data-cmd="fclose">×</button>';
  }
  function drawDialog() {
    var o = $('npd-over');
    if (!N.dlg) { o.innerHTML = ''; o.style.display = 'none'; return; }
    o.style.display = 'flex';
    var q = N.dlgQ.toLowerCase(), rows = N.notes.filter(function (n) { return !q || (n.title + ' ' + n.snippet).toLowerCase().indexOf(q) >= 0; });
    var h = '<div class="npd-dlg"><div class="npd-dh"><b>' + esc(T('np_open', 'Open...')) + '</b><button class="npd-btn" data-cmd="dclose">×</button></div><input id="npd-dq" placeholder="' + esc(T('np_search', 'Search notes')) + '" value="' + esc(N.dlgQ) + '"><div class="npd-dl">';
    if (!rows.length) h += '<div class="npd-empty">' + esc(N.notes.length ? T('np_no_match', 'No notes match.') : T('np_empty_list', 'No notes yet.')) + '</div>';
    rows.forEach(function (n) {
      h += '<button class="npd-row" data-open="' + n.id + '"><span class="t">' + esc(n.title || T('np_untitled', 'Untitled')) + '</span><span class="s">' + esc(stamp(n.updated)) + ' · ' + esc(n.snippet || '') + '</span></button>';
    });
    o.innerHTML = h + '</div></div>';
  }
  function paintStatus() {
    var s = $('npd-status'); if (!s) return;
    s.style.display = N.bar ? '' : 'none';
    var t = cur(), el = ta(), ln = 1, col = 1;
    if (el) { var before = el.value.slice(0, el.selectionStart).split('\n'); ln = before.length; col = before[before.length - 1].length + 1; }
    var state = N.error || N.toast || (t && t.saving ? T('np_saving', 'Saving…') : t && dirty(t) ? T('np_unsaved', 'Not saved yet') : t && t.id ? T('np_saved', 'Saved') : '');
    s.innerHTML = '<span class="' + (N.error ? 'bad' : '') + '">' + esc(state) + '</span><span class="gr"></span><span>' + esc(T('np_ln', 'Ln')) + ' ' + ln + ', ' + esc(T('np_col', 'Col')) + ' ' + col + '</span><span>' + (t ? t.text.length : 0) + ' / ' + N.limits.maxLength + '</span><span>' + Math.round(N.zoom / 15 * 100) + '%</span>';
    if (N.find === 'find' || N.find === 'replace') { var m = $('npd-findcount'); if (m) m.textContent = countMatches(); }
  }
  function render(focus) {
    if (!$('np')) return;
    var t = cur(), el = ta();
    drawMenubar(); drawTabs(); drawFind(); drawDialog();
    if (el && t) {
      if (el.__key !== t.key) { el.value = t.text; el.__key = t.key; if (focus) { el.setSelectionRange(0, 0); el.scrollTop = 0; } }
      el.style.fontSize = N.zoom + 'px'; el.style.whiteSpace = N.wrap ? 'pre-wrap' : 'pre'; el.style.overflowX = N.wrap ? 'hidden' : 'auto';
      el.maxLength = N.limits.maxLength; el.disabled = !!N.loading && !t;
      if (focus && !N.find && !N.dlg) el.focus();
    }
    paintStatus();
  }
  function onInput() {
    var t = cur(), el = ta(); if (!t || !el) return;
    t.text = el.value; N.confirmDel = false; N.toast = ''; schedule(t); drawTabs();
  }

  // ---- commands --------------------------------------------------------------------------------------------------
  function cmd(c) {
    var el = ta(), t = cur(); N.menu = null;
    switch (c) {
      case 'new': return newTab();
      case 'open': N.dlg = true; N.dlgQ = ''; render(); var q = $('npd-dq'); if (q) q.focus(); return;
      case 'save': if (t) { enqueue(t); N.toast = ''; } return render();
      case 'delete': return deleteNote();
      case 'close': return closeTab(N.cur);
      case 'undo': el.focus(); return document.execCommand('undo');
      case 'cut': el.focus(); return document.execCommand('cut');
      case 'copy': el.focus(); return document.execCommand('copy');
      case 'paste': el.focus(); N.toast = T('np_paste_hint', 'Use Ctrl+V to paste'); return render();
      case 'find': return openFind(false);
      case 'replace': return openFind(true);
      case 'all': el.focus(); return el.select();
      case 'time': el.focus(); document.execCommand('insertText', false, new Date().toLocaleString()); return onInput();
      case 'wrap': N.wrap = !N.wrap; savePrefs(); return render();
      case 'bar': N.bar = !N.bar; savePrefs(); return render();
      case 'zin': N.zoom = Math.min(36, N.zoom + 2); savePrefs(); return render();
      case 'zout': N.zoom = Math.max(9, N.zoom - 2); savePrefs(); return render();
      case 'zreset': N.zoom = 15; savePrefs(); return render();
      case 'fnext': return findNext(false);
      case 'fprev': return findNext(true);
      case 'rone': return replaceOne();
      case 'rall': return replaceAll();
      case 'fclose': N.find = null; render(); return ta() && ta().focus();
      case 'dclose': N.dlg = null; render(); return ta() && ta().focus();
    }
  }

  function bind() {
    var el = $('np'); if (!el || el.__b) return; el.__b = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'), tab = e.target.closest('[data-tab]');
      if (b && b.dataset.menu) { N.menu = N.menu === b.dataset.menu ? null : b.dataset.menu; return drawMenubar(); }
      if (b && b.dataset.cmd) return cmd(b.dataset.cmd);
      if (b && b.dataset.close != null) return closeTab(Number(b.dataset.close));
      if (b && b.dataset.open) return openNote(Number(b.dataset.open));
      if (tab) { N.cur = Number(tab.dataset.tab); N.confirmDel = false; return render(true); }
      if (N.menu) { N.menu = null; drawMenubar(); }
    });
    el.addEventListener('input', function (e) {
      if (e.target.id === 'npd-ta') return onInput();
      if (e.target.id === 'npd-find') { N.findText = e.target.value; return paintStatus(); }
      if (e.target.id === 'npd-repl') { N.replText = e.target.value; return; }
      if (e.target.id === 'npd-dq') { N.dlgQ = e.target.value; var pos = e.target.selectionStart; drawDialog(); var q = $('npd-dq'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } }
    });
    el.addEventListener('change', function (e) { if (e.target.id === 'npd-case') { N.matchCase = e.target.checked; paintStatus(); } });
    el.addEventListener('keyup', function (e) { if (e.target.id === 'npd-ta') paintStatus(); });
    el.addEventListener('mouseup', function (e) { if (e.target.id === 'npd-ta') paintStatus(); });
    el.addEventListener('keydown', function (e) {
      var ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (e.target.id === 'npd-find' && e.key === 'Enter') { e.preventDefault(); return findNext(e.shiftKey); }
      if (e.target.id === 'npd-repl' && e.key === 'Enter') { e.preventDefault(); return replaceOne(); }
      if (e.key === 'Escape') { if (N.dlg) { e.stopPropagation(); return cmd('dclose'); } if (N.find) { e.stopPropagation(); return cmd('fclose'); } if (N.menu) { N.menu = null; return drawMenubar(); } }
      if (e.key === 'F3') { e.preventDefault(); return findNext(e.shiftKey); }
      if (!ctrl) return;
      var map = { s: 'save', n: 'new', o: 'open', f: 'find', h: 'replace', w: 'close', '=': 'zin', '+': 'zin', '-': 'zout', '0': 'zreset' };
      if (map[k]) { e.preventDefault(); cmd(map[k]); }
    });
    ta().addEventListener('select', paintStatus);
  }

  var root = S.registerApp({
    id: 'notepad', icon: ICON_APP, titleKey: 'np_app_name', titleDef: 'Notepad', w: 980, h: 660, html: HTML,
    onOpen: function () { bind(); if (!N.loaded) load(); else render(true); },
    onClose: function () { flushAll(); },
    onReset: function () { flushAll(); fresh(); if ($('np')) { var el = ta(); if (el) { el.value = ''; el.__key = null; } render(); } },
    onLocale: function () { render(); }
  });
  if (root) bind();
})();
