/* Notepad app for Los Santos OS: the character's own notes, saved on the server (so they follow the player to any
   computer). A note's title is its first line. Changes save by themselves a moment after typing stops.
   Registers itself with LSOS.registerApp. Every call goes through the 'notesApi' NUI callback (client/notepad.lua). */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function F(key, def, a) { return T(key, def).replace(/%s/g, function () { return a; }); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#f5c542"/><rect x="6" y="5" width="12" height="14" rx="1.6" fill="#fff"/><path d="M8.6 9h6.8M8.6 12h6.8M8.6 15h4" stroke="#b7791f" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/notesApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
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

  var N;
  function fresh() {
    if (N && N.timer) clearTimeout(N.timer);
    N = { notes: [], limits: { maxNotes: 50, maxLength: 20000 }, cur: null, q: '', loading: true, error: '', status: '',
          timer: null, saving: false, again: false, font: 15, confirmDel: false, seq: 0, loaded: false };
  }
  fresh();

  function stamp(ts) {
    var d = new Date(ts * 1000), now = new Date();
    var time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return time;
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + (d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : '');
  }
  // body is now a small rich-text HTML fragment (bold/italic/underline/strikethrough, bulleted/numbered
  // lists) coming out of the contenteditable editor below. Title, word count and the "is this note empty"
  // checks all need the PLAIN TEXT reading of it, never the markup itself.
  var plainDiv = document.createElement('div');
  function plainText(html) {
    plainDiv.innerHTML = String(html || '');
    return plainDiv.textContent || plainDiv.innerText || '';
  }
  function titleOf(body) {
    var lines = plainText(body).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (t) return t.length > 60 ? t.slice(0, 60) : t; }
    return '';
  }
  function words(s) { var m = plainText(s).trim().match(/\S+/g); return m ? m.length : 0; }
  function chars(s) { return plainText(s).length; }
  function isBlank(s) { return plainText(s).trim() === ''; }

  // ------------------------------------------------------------------ data
  function load() {
    var seq = ++N.seq;
    N.loading = true; N.error = ''; render();
    api('list').then(function (res) {
      if (seq !== N.seq) return;
      N.loading = false;
      if (!res.ok) { N.error = errText(res); return render(); }
      N.notes = res.data.notes || [];
      N.limits = res.data.limits || N.limits;
      N.loaded = true;
      if (!N.cur && N.notes.length) return openNote(N.notes[0].id);
      render();
    });
  }
  function openNote(id) {
    flush();
    api('get', { id: id }).then(function (res) {
      if (!res.ok) { N.error = errText(res); return render(); }
      var n = res.data.note;
      N.cur = { id: n.id, body: n.body, saved: n.body, updated: n.updated };
      N.status = ''; N.confirmDel = false; N.error = '';
      render(true);
    });
  }
  function newNote() {
    flush();
    N.cur = { id: null, body: '', saved: '', updated: 0 };
    N.status = T('np_unsaved', 'Not saved yet'); N.confirmDel = false; N.error = '';
    render(true);
  }
  function schedule() {
    if (N.timer) clearTimeout(N.timer);
    N.timer = setTimeout(save, 700);
    N.status = T('np_saving', 'Saving…');
    paintStatus();
  }
  function flush() { if (N.timer) { clearTimeout(N.timer); N.timer = null; if (dirty()) save(); } }
  function dirty() { return !!N.cur && N.cur.body !== N.cur.saved && !(N.cur.id === null && isBlank(N.cur.body)); }

  function save() {
    N.timer = null;
    if (!N.cur || !dirty()) { N.status = ''; paintStatus(); return; }
    if (N.saving) { N.again = true; return; }
    var note = N.cur, body = note.body;
    N.saving = true;
    api('save', { id: note.id, body: body }).then(function (res) {
      N.saving = false;
      if (!res.ok) {
        N.error = errText(res);
        if (res.reason === 'busy' || res.reason === 'network' || res.reason === 'error') { N.timer = setTimeout(save, 1500); }
        N.status = ''; return render();
      }
      N.error = '';
      var s = res.data.note;
      note.id = s.id; note.saved = body; note.updated = s.updated;
      var i = N.notes.findIndex(function (x) { return x.id === s.id; });
      if (i >= 0) N.notes.splice(i, 1);
      N.notes.unshift(s);
      N.status = F('np_last_saved', 'Saved %s', stamp(s.updated));
      if (N.again || note.body !== body) { N.again = false; schedule(); }
      renderList(); paintStatus();
    });
  }
  // copy the open note into Documents as a PLAIN TEXT file (File Explorer > Documents doesn't render the
  // note's formatting, so bold/italic/lists are flattened to plain lines here rather than exporting raw HTML)
  function exportNote() {
    if (!N.cur || isBlank(N.cur.body)) return;
    var name = (titleOf(N.cur.body) || T('np_untitled', 'Untitled note')) + '.txt';
    fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/filesApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: 'save', data: { folder: 'docs', name: name, body: plainText(N.cur.body) } })
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; }).then(function (res) {
      N.status = res && res.ok ? T('np_exported', 'Saved a copy to Documents') : T('np_export_failed', 'Could not save a copy to Documents');
      paintStatus();
    });
  }
  function remove() {
    if (!N.cur) return;
    if (!N.confirmDel) { N.confirmDel = true; renderHead(); return; }
    var id = N.cur.id;
    N.confirmDel = false;
    if (id === null) { N.cur = null; return render(true); }
    api('delete', { id: id }).then(function (res) {
      if (!res.ok) { N.error = errText(res); return render(); }
      N.notes = N.notes.filter(function (x) { return x.id !== id; });
      N.cur = null;
      if (N.notes.length) return openNote(N.notes[0].id);
      render(true);
    });
  }

  // Toolbar buttons: [data-cmd, label, execCommand name]. Bold/italic/underline/strikethrough plus bulleted
  // and numbered lists - the same set the rich-text mockup showed, kept deliberately small so the sanitizer
  // on the server (ALLOWED_TAGS in server/notepad.lua) only ever has to recognise a handful of plain tags.
  var TOOLS = [
    { cmd: 'bold', key: 'np_bold', def: 'Bold', label: 'B', style: 'font-weight:700' },
    { cmd: 'italic', key: 'np_italic', def: 'Italic', label: 'I', style: 'font-style:italic' },
    { cmd: 'underline', key: 'np_underline', def: 'Underline', label: 'U', style: 'text-decoration:underline' },
    { cmd: 'strikeThrough', key: 'np_strike', def: 'Strikethrough', label: 'S', style: 'text-decoration:line-through' },
    { cmd: 'insertUnorderedList', key: 'np_bullet_list', def: 'Bulleted list', label: '•≡', sep: true },
    { cmd: 'insertOrderedList', key: 'np_numbered_list', def: 'Numbered list', label: '1.2.' },
  ];
  // Fixed font list, kept in lockstep with FONTS in server/notepad.lua and server/files.lua - a face outside
  // this list is silently dropped server-side, so the picker never offers one that wouldn't survive a save.
  var FONT_LIST = ['Arial', 'Consolas', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana', 'Comic Sans MS'];
  // formatBlock values, kept in lockstep with the h1/h2/h3 tags the server allows through.
  var HEADINGS = [
    { v: 'P', key: 'np_heading_body', def: 'Body text' },
    { v: 'H1', key: 'np_heading_1', def: 'Heading 1' },
    { v: 'H2', key: 'np_heading_2', def: 'Heading 2' },
    { v: 'H3', key: 'np_heading_3', def: 'Heading 3' },
  ];
  function toolbarHtml() {
    return '<div class="np-toolbar" id="np-toolbar">' +
      '<select class="np-tsel" id="np-heading" title="' + esc(T('np_heading', 'Heading style')) + '">' +
      HEADINGS.map(function (h) { return '<option value="' + h.v + '">' + esc(T(h.key, h.def)) + '</option>'; }).join('') + '</select>' +
      '<select class="np-tsel np-tfont" id="np-fontname" title="' + esc(T('np_font', 'Font')) + '">' +
      FONT_LIST.map(function (f) { return '<option value="' + f + '" style="font-family:\'' + f + '\'">' + f + '</option>'; }).join('') + '</select>' +
      '<input type="color" class="np-tcolor" id="np-color" value="#000000" title="' + esc(T('np_color', 'Text colour')) + '">' +
      '<span class="np-tsep"></span>' +
      TOOLS.map(function (b) {
        return (b.sep ? '<span class="np-tsep"></span>' : '') +
          '<button type="button" class="np-tbtn" data-cmd="' + b.cmd + '" title="' + esc(T(b.key, b.def)) + '" style="' + (b.style || '') + '">' + b.label + '</button>';
      }).join('') + '</div>';
  }

  // ------------------------------------------------------------------ drawing
  var HTML =
    '<div class="np" id="np">' +
    '<div class="np-rail"><div class="np-rail-h"><button type="button" class="np-btn pri" id="np-new"></button></div>' +
    '<div class="np-search"><input id="np-q" type="search" autocomplete="off"></div><div class="np-list" id="np-list"></div></div>' +
    '<div class="np-main"><div class="np-head" id="np-head"></div><div class="np-err hidden" id="np-err"></div>' +
    '<div class="np-body" id="np-body"></div><div class="np-foot" id="np-foot"></div></div></div>';

  function renderList() {
    var l = $('np-list'); if (!l) return;
    var q = N.q.trim().toLowerCase();
    var rows = N.notes.filter(function (n) { return !q || (n.title + ' ' + n.snippet).toLowerCase().indexOf(q) >= 0; });
    var draft = N.cur && N.cur.id === null && isBlank(N.cur.body) ? '<div class="np-item on"><div class="t">' + esc(T('np_untitled', 'Untitled note')) + '</div></div>' : '';
    l.innerHTML = draft + (rows.length ? rows.map(function (n) {
      var on = N.cur && N.cur.id === n.id;
      var t = on && N.cur.body !== N.cur.saved ? titleOf(N.cur.body) : n.title;
      return '<button type="button" class="np-item' + (on ? ' on' : '') + '" data-id="' + n.id + '"><div class="t">' + esc(t || T('np_untitled', 'Untitled note')) + '</div>' +
        '<div class="s"><span class="d">' + esc(stamp(n.updated)) + '</span> ' + esc(n.snippet) + '</div></button>';
    }).join('') : (draft ? '' : '<div class="np-empty">' + esc(q ? T('np_no_match', 'No notes match your search.') : T('np_empty_list', 'No notes yet. Press New note to start one.')) + '</div>'));
  }
  function renderHead() {
    var h = $('np-head'); if (!h) return;
    if (!N.cur) { h.innerHTML = ''; return; }
    h.innerHTML = '<div class="np-status" id="np-status"></div><div class="np-tools">' +
      '<button type="button" class="np-btn" data-a="smaller" title="' + esc(T('np_font_smaller', 'Smaller text')) + '">A−</button>' +
      '<button type="button" class="np-btn" data-a="bigger" title="' + esc(T('np_font_bigger', 'Larger text')) + '">A+</button>' +
      (S.state.printer && N.cur && !isBlank(N.cur.body) ? '<button type="button" class="np-btn" data-a="print">' + esc(T('pr_print', 'Print')) + '</button>' : '') +
      '<button type="button" class="np-btn" data-a="export" title="' + esc(T('np_export_tip', 'Save a copy to Documents in File Explorer')) + '">' + esc(T('np_export', 'Save to Documents')) + '</button>' +
      '<button type="button" class="np-btn ' + (N.confirmDel ? 'danger' : '') + '" data-a="del">' + esc(N.confirmDel ? T('np_confirm_delete', 'Click again to delete') : T('np_delete', 'Delete note')) + '</button></div>';
    paintStatus();
  }
  function paintStatus() {
    var s = $('np-status'); if (s) s.textContent = N.status || '';
    var f = $('np-foot');
    if (f) f.textContent = N.cur ? F('np_words', '%s words', words(N.cur.body)) + '  ·  ' + F('np_chars', '%s characters', chars(N.cur.body)) : '';
  }
  function renderBody(focus) {
    var b = $('np-body'); if (!b) return;
    if (!N.cur) {
      b.innerHTML = '<div class="np-empty big">' + esc(N.loading ? T('np_loading', 'Loading your notes…') : T('np_pick', 'Select a note, or start a new one.')) + '</div>';
      return;
    }
    if (!$('np-ed')) b.innerHTML = toolbarHtml() + '<div id="np-ed" class="np-ed" contenteditable="true" spellcheck="false"></div>';
    var ed = $('np-ed');
    ed.setAttribute('data-placeholder', T('np_placeholder', 'Start typing…'));
    ed.style.fontSize = N.font + 'px';
    if (ed.innerHTML !== N.cur.body) ed.innerHTML = N.cur.body;
    if (focus) ed.focus();
  }
  function render(focus) {
    if (!$('np')) return;
    $('np-new').textContent = '+ ' + T('np_new', 'New note');
    $('np-q').placeholder = T('np_search', 'Search notes');
    var e = $('np-err');
    e.textContent = N.error; e.classList.toggle('hidden', !N.error);
    if (N.cur && N.cur.id !== null && !$('np-ed')) { /* editor is created in renderBody */ }
    renderList(); renderHead(); renderBody(focus); paintStatus();
  }

  var bound = false;
  function bind() {
    if (bound || !$('np')) return;
    bound = true;
    var root = $('np');
    // mousedown (not click) on a toolbar button, and preventDefault, so the editor's text selection is
    // never lost before execCommand runs on it - a plain click steals focus/selection from the editor first.
    root.addEventListener('mousedown', function (e) {
      var tb = e.target.closest('.np-tbtn');
      if (!tb) return;
      e.preventDefault();
      var ed = $('np-ed'); if (!ed || !N.cur) return;
      ed.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
      document.execCommand(tb.dataset.cmd, false, null);
      afterEdit();
      paintToolbar();
    });
    // font/heading/colour pickers use a real change so the picked value is committed once, rather than a
    // mousedown that would fire before the option is actually selected.
    root.addEventListener('change', function (e) {
      var ed = $('np-ed'); if (!ed || !N.cur) return;
      if (e.target.id === 'np-fontname') {
        restoreSelection(ed);
        try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
        document.execCommand('fontName', false, e.target.value);
        afterEdit();
      } else if (e.target.id === 'np-heading') {
        restoreSelection(ed);
        document.execCommand('formatBlock', false, e.target.value);
        afterEdit();
      } else if (e.target.id === 'np-color') {
        restoreSelection(ed);
        try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
        document.execCommand('foreColor', false, e.target.value);
        afterEdit();
      }
    });
    root.addEventListener('click', function (e) {
      if (e.target.closest('#np-new')) return newNote();
      var it = e.target.closest('.np-item[data-id]');
      if (it) { if (N.cur && N.cur.id === +it.dataset.id) return; return openNote(+it.dataset.id); }
      var a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'del') return remove();
      if (a.dataset.a === 'print') return S.print({ kind: 'text', title: titleOf(N.cur.body) || T('np_untitled', 'Untitled note'), text: plainText(N.cur.body) });
      if (a.dataset.a === 'export') return exportNote();
      N.font = Math.max(11, Math.min(28, N.font + (a.dataset.a === 'bigger' ? 1 : -1)));
      renderBody();
    });
    // one typed character over the limit is trimmed back rather than silently accepted and refused only on
    // save - simplest thing that keeps the length honest without a full undo/redo stack of our own.
    function afterEdit() {
      var ed = $('np-ed'); if (!ed || !N.cur) return;
      if (chars(ed.innerHTML) > (N.limits.maxLength || 30000)) { ed.innerHTML = N.cur.body; return; }
      N.cur.body = ed.innerHTML; N.confirmDel = false;
      if (N.cur.id === null && isBlank(N.cur.body)) { N.status = T('np_unsaved', 'Not saved yet'); paintStatus(); return; }
      schedule(); renderList();
      var h = document.querySelector('#np-head [data-a=del]'); if (h) h.textContent = T('np_delete', 'Delete note'), h.classList.remove('danger');
    }
    function paintToolbar() {
      var tb = $('np-toolbar'); if (!tb) return;
      TOOLS.forEach(function (b) {
        var el = tb.querySelector('[data-cmd="' + b.cmd + '"]');
        if (!el) return;
        var on = false;
        try { on = document.queryCommandState(b.cmd); } catch (e) { /* not supported here, leave off */ }
        el.classList.toggle('on', on);
      });
    }
    root.addEventListener('input', function (e) {
      if (e.target.id === 'np-q') { N.q = e.target.value; return renderList(); }
      if (e.target.id === 'np-ed' && N.cur) afterEdit();
    });
    // the font/heading/colour pickers steal focus (and so the browser's selection) from the editor the
    // moment they're clicked, so the last real selection inside np-ed is remembered here and restored
    // just before running a command from one of them - otherwise the command would land nowhere.
    document.addEventListener('selectionchange', function () {
      var ed = $('np-ed');
      if (ed && document.activeElement === ed) {
        paintToolbar();
        var sel = window.getSelection();
        if (sel && sel.rangeCount) N.lastRange = sel.getRangeAt(0).cloneRange();
      }
    });
    function restoreSelection(ed) {
      ed.focus();
      if (!N.lastRange || !ed.contains(N.lastRange.commonAncestorContainer)) return;
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(N.lastRange);
    }
    root.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); if (N.timer) clearTimeout(N.timer); save(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); newNote(); }
    });
  }

  var root = S.registerApp({
    id: 'notepad', icon: ICON_APP, titleKey: 'np_app_name', titleDef: 'Notepad', w: 1000, h: 680, html: HTML,
    onOpen: function () { bind(); if (!N.loaded || !N.notes.length) load(); else render(); },
    onClose: function () { flush(); },
    onReset: function () { fresh(); if ($('np')) render(); },
    onLocale: function () { render(); }
  });
  if (root) bind();
})();
