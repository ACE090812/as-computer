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
  function titleOf(body) {
    var lines = String(body || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) { var t = lines[i].trim(); if (t) return t.length > 60 ? t.slice(0, 60) : t; }
    return '';
  }
  function words(s) { var m = String(s).trim().match(/\S+/g); return m ? m.length : 0; }

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
  function dirty() { return !!N.cur && N.cur.body !== N.cur.saved && !(N.cur.id === null && N.cur.body.trim() === ''); }

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
  // copy the open note into Documents as a text file (File Explorer > Documents)
  function exportNote() {
    if (!N.cur || !N.cur.body) return;
    var name = (titleOf(N.cur.body) || T('np_untitled', 'Untitled note')) + '.txt';
    fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/filesApi', {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: 'save', data: { folder: 'docs', name: name, body: N.cur.body } })
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
    var draft = N.cur && N.cur.id === null && N.cur.body.trim() === '' ? '<div class="np-item on"><div class="t">' + esc(T('np_untitled', 'Untitled note')) + '</div></div>' : '';
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
      (S.state.printer && N.cur && String(N.cur.body || '').trim() ? '<button type="button" class="np-btn" data-a="print">' + esc(T('pr_print', 'Print')) + '</button>' : '') +
      '<button type="button" class="np-btn" data-a="export" title="' + esc(T('np_export_tip', 'Save a copy to Documents in File Explorer')) + '">' + esc(T('np_export', 'Save to Documents')) + '</button>' +
      '<button type="button" class="np-btn ' + (N.confirmDel ? 'danger' : '') + '" data-a="del">' + esc(N.confirmDel ? T('np_confirm_delete', 'Click again to delete') : T('np_delete', 'Delete note')) + '</button></div>';
    paintStatus();
  }
  function paintStatus() {
    var s = $('np-status'); if (s) s.textContent = N.status || '';
    var f = $('np-foot');
    if (f) f.textContent = N.cur ? F('np_words', '%s words', words(N.cur.body)) + '  ·  ' + F('np_chars', '%s characters', N.cur.body.length) : '';
  }
  function renderBody(focus) {
    var b = $('np-body'); if (!b) return;
    if (!N.cur) {
      b.innerHTML = '<div class="np-empty big">' + esc(N.loading ? T('np_loading', 'Loading your notes…') : T('np_pick', 'Select a note, or start a new one.')) + '</div>';
      return;
    }
    if (!$('np-ed')) b.innerHTML = '<textarea id="np-ed" spellcheck="false"></textarea>';
    var ed = $('np-ed');
    ed.placeholder = T('np_placeholder', 'Start typing…');
    ed.maxLength = N.limits.maxLength;
    ed.style.fontSize = N.font + 'px';
    if (ed.value !== N.cur.body) ed.value = N.cur.body;
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
    root.addEventListener('click', function (e) {
      if (e.target.closest('#np-new')) return newNote();
      var it = e.target.closest('.np-item[data-id]');
      if (it) { if (N.cur && N.cur.id === +it.dataset.id) return; return openNote(+it.dataset.id); }
      var a = e.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'del') return remove();
      if (a.dataset.a === 'print') return S.print({ kind: 'text', title: titleOf(N.cur.body) || T('np_untitled', 'Untitled note'), text: N.cur.body });
      if (a.dataset.a === 'export') return exportNote();
      N.font = Math.max(11, Math.min(28, N.font + (a.dataset.a === 'bigger' ? 1 : -1)));
      renderBody();
    });
    root.addEventListener('input', function (e) {
      if (e.target.id === 'np-q') { N.q = e.target.value; return renderList(); }
      if (e.target.id === 'np-ed' && N.cur) {
        N.cur.body = e.target.value; N.confirmDel = false;
        if (N.cur.id === null && N.cur.body.trim() === '') { N.status = T('np_unsaved', 'Not saved yet'); paintStatus(); return; }
        schedule(); renderList();
        var h = document.querySelector('#np-head [data-a=del]'); if (h) h.textContent = T('np_delete', 'Delete note'), h.classList.remove('danger');
      }
    });
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
