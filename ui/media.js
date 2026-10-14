/* Media Player for Los Santos OS, laid out like the Windows 11 Media Player: navigation on the left (Now playing and your
   playlists), the track list or the video in the middle, and a transport bar along the bottom (seek, previous, play, next,
   shuffle, repeat, volume, equaliser). Plays any direct https audio or video link, or the audio and video files in File
   Explorer. Up to 10 playlists of 100 tracks, saved with the character (Settings: playlists, mpVol, mpEq). It keeps playing
   when the window is minimised. The equaliser needs the media host to allow it (CORS); if it does not, the equaliser says so. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#7c3aed"/><path d="M10 8v8l6.5-4z" fill="#fff"/></svg>';
  var IC = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
    prev: '<path d="M6 5v14M19 5l-9 7 9 7z"/>', next: '<path d="M18 5v14M5 5l9 7-9 7z"/>', shuf: '<path d="M3 7h4l10 10h4M3 17h4l3-3M14 10l3-3h4M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    rep: '<path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/>', vol: '<path d="M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>', mute: '<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>',
    eq: '<path d="M5 20V10M12 20V4M19 20v-7"/>', plus: '<path d="M12 5v14M5 12h14"/>', note: '<path d="M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3M19 16a3 3 0 1 1-3-3"/>', list: '<path d="M4 6h12M4 12h12M4 18h8M19 15v6M16 18h6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  function ic(k, cls) { return '<svg class="mp-i ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + IC[k] + '</svg>'; }
  var EQF = [60, 230, 910, 3600, 14000], EQN = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];
  var PRESETS = { flat: [0, 0, 0, 0, 0], bass: [8, 5, 0, 0, 0], treble: [0, 0, 0, 5, 8], vocal: [-3, 0, 5, 3, -2], rock: [5, 3, -2, 3, 5] };
  var st = { view: 'now', queue: [], qi: -1, shuffle: false, rep: 0, vol: 80, mute: false, eqOn: false, eq: [0, 0, 0, 0, 0], eqOpen: false, order: [], playing: false, err: '', q: '' };
  var media = null, actx = null, filters = null, srcNode = null, eqTried = false;

  function prefs() { return S.prefs() || {}; }
  function lists() { return Array.isArray(prefs().playlists) ? prefs().playlists : []; }
  function saveLists(l) { S.setPrefs({ playlists: l }); }
  function cur() { return st.queue[st.qi]; }
  function fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2); }
  function safe(u) { return /^https:\/\/[A-Za-z0-9\-.]+(?:[\/?#][^\s<>"']*)?$/.test(String(u || '')); }
  function guessKind(u) { return /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u) ? 'v' : 'a'; }
  function titleOf(u) { var m = (u.split('?')[0].split('#')[0].match(/([^\/]+)$/) || [])[1] || u; try { m = decodeURIComponent(m); } catch (e) { /* keep */ } return m.replace(/\.[A-Za-z0-9]{2,4}$/, '').slice(0, 80); }

  // ---- the media element (one, reused: audio or video)
  function el() {
    if (media) return media;
    media = document.createElement('video'); media.preload = 'metadata'; media.playsInline = true;
    media.addEventListener('ended', function () { next(true); });
    media.addEventListener('timeupdate', tick);
    media.addEventListener('loadedmetadata', tick);
    media.addEventListener('play', function () { st.playing = true; drawBar(); });
    media.addEventListener('pause', function () { st.playing = false; drawBar(); });
    media.addEventListener('error', function () {
      st.err = T('mp_err', 'This file could not be played. The link may be wrong or the host may block it.'); st.playing = false; draw();
    });
    applyVol();
    return media;
  }
  function applyVol() { if (media) { media.volume = st.vol / 100 * S.sysVol(); media.muted = st.mute || S.sysVol() === 0; } }
  function ensureEq() {
    if (filters || !media) return !!filters;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      srcNode = actx.createMediaElementSource(media);
      filters = EQF.map(function (f, i) { var b = actx.createBiquadFilter(); b.type = i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1; b.gain.value = st.eq[i]; return b; });
      var n = srcNode; filters.forEach(function (b) { n.connect(b); n = b; }); n.connect(actx.destination);
      return true;
    } catch (e) { filters = null; return false; }
  }
  function applyEq() { if (filters) filters.forEach(function (b, i) { b.gain.value = st.eqOn ? st.eq[i] : 0; }); }

  // ---- queue and playback
  function load(i, auto) {
    if (i < 0 || i >= st.queue.length) return;
    st.qi = i; st.err = '';
    var t = st.queue[i], m = el();
    m.crossOrigin = st.eqOn ? 'anonymous' : null;
    m.src = t.u; m.load();
    var p = m.play(); if (p && p.catch) p.catch(function () { /* the error handler reports it */ });
    if (st.eqOn && !filters) { if (!ensureEq()) { st.eqOn = false; st.err = T('mp_eq_fail', 'The equaliser cannot be used with this file.'); } }
    if (actx && actx.state === 'suspended') actx.resume();
    draw();
  }
  function pickNext(dir) {
    var n = st.queue.length; if (!n) return -1;
    if (st.shuffle && n > 1) { var r; do { r = Math.floor(Math.random() * n); } while (r === st.qi); return r; }
    var i = st.qi + dir;
    if (i >= n) return st.rep === 1 ? 0 : -1;
    if (i < 0) return st.rep === 1 ? n - 1 : 0;
    return i;
  }
  function next(ended) {
    if (ended && st.rep === 2) { var m = el(); m.currentTime = 0; m.play(); return; }
    var i = pickNext(1);
    if (i < 0) { st.playing = false; drawBar(); return; }
    load(i, true);
  }
  function prev() { var m = el(); if (m.currentTime > 3) { m.currentTime = 0; return; } var i = pickNext(-1); if (i >= 0) load(i); }
  function toggle() {
    var m = el();
    if (st.qi < 0) { if (st.queue.length) load(0); return; }
    if (m.paused) m.play(); else m.pause();
  }
  function playList(tracks, from) { st.queue = tracks.map(function (t) { return { t: t.t, u: t.u, k: t.k }; }); load(from || 0); }
  function addToQueue(t) { st.queue.push(t); if (st.qi < 0) load(0); else draw(); }

  // ---- drawing
  function nav() {
    var h = '<div class="mp-search"><input id="mp-q" placeholder="' + esc(T('mp_search', 'Search')) + '" value="' + esc(st.q) + '" maxlength="40"></div>' +
      '<button class="mp-n' + (st.view === 'now' ? ' on' : '') + '" data-v="now">' + ic('note') + '<span>' + esc(T('mp_now', 'Now playing')) + '</span></button><div class="mp-nh"><span>' + esc(T('mp_playlists', 'Playlists')) + '</span><button data-a="newpl" title="' + esc(T('mp_newpl', 'New playlist')) + '">' + ic('plus') + '</button></div>';
    lists().forEach(function (p) { h += '<button class="mp-n' + (st.view === p.id ? ' on' : '') + '" data-v="' + esc(p.id) + '">' + ic('list') + '<span>' + esc(p.n) + '</span><em>' + p.t.length + '</em></button>'; });
    return h;
  }
  function trackRows(tracks, isQueue) {
    if (!tracks.length) return '<div class="mp-empty">' + ic('note') + '<div>' + esc(T('mp_empty', 'Nothing here yet. Add a link or a file from Explorer.')) + '</div></div>';
    var q = st.q.toLowerCase(), rows = '';
    tracks.forEach(function (t, i) {
      var name = t.t || titleOf(t.u);
      if (q && name.toLowerCase().indexOf(q) < 0) return;
      var on = isQueue && i === st.qi;
      rows += '<div class="mp-r' + (on ? ' on' : '') + '" data-i="' + i + '"><span class="n">' + (on && st.playing ? '<i class="eqi"><b></b><b></b><b></b></i>' : i + 1) + '</span><span class="t">' + esc(name) + '</span><span class="k">' + esc(t.k === 'v' ? T('mp_video', 'Video') : T('mp_audio', 'Audio')) + '</span>' +
        '<button class="x" data-a="rm" data-i="' + i + '" title="' + esc(T('mp_remove', 'Remove')) + '">' + ic('x') + '</button></div>';
    });
    return '<div class="mp-th"><span class="n">#</span><span class="t">' + esc(T('mp_title', 'Title')) + '</span><span class="k">' + esc(T('mp_type', 'Type')) + '</span><span class="x"></span></div><div class="mp-rows">' + (rows || '<div class="mp-empty">' + esc(T('mp_no_match', 'No matches')) + '</div>') + '</div>';
  }
  function main() {
    var add = '<button class="mp-b" data-a="addurl">' + ic('plus') + esc(T('mp_add_url', 'Add link')) + '</button><button class="mp-b" data-a="addfile">' + ic('plus') + esc(T('mp_add_file', 'Add from files')) + '</button>';
    if (st.view === 'now') {
      var t = cur(), video = t && t.k === 'v', nm = t ? (t.t || titleOf(t.u)) : T('mp_nothing', 'Nothing is playing');
      return '<div class="mp-now2"><div class="mp-left"><div class="mp-stage" id="mp-stage">' + (video ? '' : '<div class="mp-art' + (st.playing ? ' go' : '') + '">' + ic('note') + '</div>') + '</div><div class="mp-np">' + esc(nm) + '</div><div class="mp-sub">' + esc(t ? (t.k === 'v' ? T('mp_video', 'Video') : T('mp_audio', 'Audio')) : '') + '</div></div>' +
        '<div class="mp-right2"><div class="mp-hd"><h2>' + esc(T('mp_up_next', 'Up next')) + '</h2><span class="grow"></span>' + add + (st.queue.length ? '<button class="mp-b" data-a="savepl">' + esc(T('mp_save_pl', 'Save as playlist')) + '</button><button class="mp-b" data-a="clear">' + esc(T('mp_clear', 'Clear')) + '</button>' : '') + '</div>' +
        (st.err ? '<div class="mp-err">' + esc(st.err) + '</div>' : '') + trackRows(st.queue, true) + '</div></div>';
    }
    var pl = lists().filter(function (p) { return p.id === st.view; })[0];
    if (!pl) { st.view = 'now'; return main(); }
    return '<div class="mp-hero"><div class="mp-art sm">' + ic('list') + '</div><div><div class="mp-sub">' + esc(T('mp_playlist', 'Playlist')) + '</div><h2>' + esc(pl.n) + '</h2><div class="mp-sub">' + pl.t.length + ' ' + esc(T('mp_tracks', 'tracks')) + '</div></div></div>' +
      '<div class="mp-hd"><button class="mp-b pri" data-a="playpl">' + ic('play') + esc(T('mp_play_all', 'Play all')) + '</button>' + add + '<span class="grow"></span><button class="mp-b" data-a="renpl">' + esc(T('mp_rename', 'Rename')) + '</button><button class="mp-b" data-a="delpl">' + esc(T('mp_delete', 'Delete')) + '</button></div>' +
      (st.err ? '<div class="mp-err">' + esc(st.err) + '</div>' : '') + trackRows(pl.t, false);
  }
  function drawBar() {
    var b = $('mp-bar'); if (!b) return;
    var t = cur(), nm = t ? (t.t || titleOf(t.u)) : '';
    b.innerHTML = '<div class="mp-bl"><div class="mp-th2">' + ic('note') + '</div><div class="mp-bt"><div class="a">' + esc(nm) + '</div><div class="b">' + esc(t ? (t.k === 'v' ? T('mp_video', 'Video') : T('mp_audio', 'Audio')) : '') + '</div></div></div>' +
      '<div class="mp-bc"><div class="mp-mid">' +
      '<button class="mp-c' + (st.shuffle ? ' on' : '') + '" data-a="shuf" title="' + esc(T('mp_shuffle', 'Shuffle')) + '">' + ic('shuf') + '</button><button class="mp-c" data-a="prev" title="' + esc(T('mp_prev', 'Previous')) + '">' + ic('prev') + '</button>' +
      '<button class="mp-c play" data-a="toggle" title="' + esc(st.playing ? T('mp_pause', 'Pause') : T('mp_play', 'Play')) + '">' + ic(st.playing ? 'pause' : 'play') + '</button><button class="mp-c" data-a="next" title="' + esc(T('mp_next', 'Next')) + '">' + ic('next') + '</button>' +
      '<button class="mp-c' + (st.rep ? ' on' : '') + '" data-a="rep" title="' + esc(T('mp_repeat', 'Repeat')) + '">' + ic('rep') + (st.rep === 2 ? '<b>1</b>' : '') + '</button></div>' +
      '<div class="mp-seek"><span id="mp-cur">0:00</span><input type="range" id="mp-seekr" min="0" max="1000" value="0"><span id="mp-dur">0:00</span></div></div>' +
      '<div class="mp-br"><button class="mp-c' + (st.eqOpen ? ' on' : '') + '" data-a="eq" title="' + esc(T('mp_eq', 'Equaliser')) + '">' + ic('eq') + '</button><button class="mp-c" data-a="mute" title="' + esc(T('mp_mute', 'Mute')) + '">' + ic(st.mute || !st.vol ? 'mute' : 'vol') + '</button><input type="range" id="mp-vol" min="0" max="100" value="' + st.vol + '"></div>';
    b.querySelectorAll('input[type=range]').forEach(paintRange);
    tick();
  }
  function eqPanel() {
    if (!st.eqOpen) return '';
    return '<div class="mp-eq"><div class="mp-eh"><b>' + esc(T('mp_eq', 'Equaliser')) + '</b><label><input type="checkbox" id="mp-eqon"' + (st.eqOn ? ' checked' : '') + '> ' + esc(T('mp_eq_on', 'On')) + '</label></div><div class="mp-presets">' +
      Object.keys(PRESETS).map(function (k) { return '<button data-pre="' + k + '">' + esc(T('mp_pre_' + k, k)) + '</button>'; }).join('') + '</div><div class="mp-bands">' +
      EQF.map(function (f, i) { return '<div class="band"><div class="bw"><input type="range" data-band="' + i + '" min="-12" max="12" value="' + st.eq[i] + '"></div><span>' + EQN[i] + '</span></div>'; }).join('') + '</div><div class="mp-note">' + esc(T('mp_eq_note', 'The equaliser only works with hosts that allow it.')) + '</div></div>';
  }
  function draw() {
    var r = $('mp-root'); if (!r) return;
    r.innerHTML = '<div class="mp-side">' + nav() + '</div><div class="mp-main">' + main() + '</div>' + eqPanel() + '<div class="mp-bar" id="mp-bar"></div>';
    var stg = $('mp-stage'), t = cur();
    if (stg && t && t.k === 'v' && media) { stg.appendChild(media); media.className = 'mp-video'; }
    r.querySelectorAll('[data-band]').forEach(paintRange);
    drawBar();
  }
  function paintRange(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  function tick() {
    var m = media, s = $('mp-seekr'); if (!m || !s) return;
    if (!s.dataset.drag) { s.value = m.duration ? Math.round(m.currentTime / m.duration * 1000) : 0; paintRange(s); }
    if ($('mp-cur')) { $('mp-cur').textContent = fmt(m.currentTime); $('mp-dur').textContent = isFinite(m.duration) ? fmt(m.duration) : '0:00'; }
  }

  // ---- dialogs
  function addUrl() {
    S.showDlg({ title: T('mp_add_url', 'Add link'), html: '<input id="mp-u" class="mp-in" placeholder="https://" maxlength="500"><input id="mp-ut" class="mp-in" placeholder="' + esc(T('mp_title_ph', 'Title (optional)')) + '" maxlength="80"><div class="mp-hint">' + esc(T('mp_url_hint', 'A direct link to an audio or video file.')) + '</div>',
      buttons: [{ label: T('mp_add', 'Add'), primary: true, run: function () {
        var u = ($('mp-u').value || '').trim(), t = ($('mp-ut').value || '').trim();
        if (!safe(u)) return S.notify({ app: 'media', title: T('mp_bad_url', 'That is not a valid https link.') });
        addTrack({ t: t || titleOf(u), u: u, k: guessKind(u) });
      } }, { label: T('pt_cancel', 'Cancel') }] });
  }
  function addTrack(tr) {
    if (st.view === 'now') return addToQueue(tr);
    var l = lists().map(function (p) { return p.id === st.view && p.t.length < 100 ? Object.assign({}, p, { t: p.t.concat([tr]) }) : p; });
    saveLists(l); setTimeout(draw, 40);
  }
  function addFiles() {
    var places = ['docs', 'dl', 'shared'], out = [];
    Promise.all(places.map(function (pl) { return S.api('filesApi', { name: 'list', data: { folder: pl, parent: 0 } }).then(function (r) { if (r && r.ok) ((r.data && r.data.files) || []).forEach(function (f) { if ((f.kind === 'audio' || f.kind === 'video') && safe(f.url)) out.push(f); }); }); })).then(function () {
      var h = out.length ? '<div class="mp-fl">' + out.map(function (f, i) { return '<label><input type="checkbox" data-f="' + i + '"> ' + esc(f.name) + '</label>'; }).join('') + '</div>' : '<div>' + esc(T('mp_no_files', 'No audio or video files in Documents, Downloads or Public.')) + '</div>';
      S.showDlg({ title: T('mp_add_file', 'Add from files'), html: h, buttons: (out.length ? [{ label: T('mp_add', 'Add'), primary: true, run: function () {
        [].slice.call(document.querySelectorAll('#dlg-body [data-f]:checked')).forEach(function (c) { var f = out[+c.dataset.f]; addTrack({ t: f.name.replace(/\.[A-Za-z0-9]{2,4}$/, ''), u: f.url, k: f.kind === 'video' ? 'v' : 'a' }); });
      } }] : []).concat([{ label: T('pt_cancel', 'Cancel') }]) });
    });
  }
  function nameDlg(title, val, cb) {
    S.showDlg({ title: title, html: '<input id="mp-nm" class="mp-in" maxlength="30" value="' + esc(val || '') + '">', buttons: [{ label: T('pt_save', 'Save'), primary: true, run: function () { var v = ($('mp-nm').value || '').trim(); if (v) cb(v); } }, { label: T('pt_cancel', 'Cancel') }] });
  }
  function newPl(tracks) {
    if (lists().length >= 10) return S.notify({ app: 'media', title: T('mp_max_pl', 'You can have up to 10 playlists.') });
    nameDlg(T('mp_newpl', 'New playlist'), '', function (n) { var id = 'p' + Date.now().toString(36).slice(-8); saveLists(lists().concat([{ id: id, n: n, t: tracks || [] }])); st.view = id; setTimeout(draw, 40); });
  }

  S.registerApp({
    id: 'media', icon: ICON, titleKey: 'app_media', titleDef: 'Media Player', w: 940, h: 600,
    html: '<div class="mp" id="mp-root"></div>',
    onOpen: function () {
      var p = prefs(); applyVol(); if (typeof p.mpVol === 'number') st.vol = p.mpVol; if (Array.isArray(p.mpEq)) st.eq = p.mpEq.slice();
      draw();
    },
    onClose: function () { /* keeps playing in the background */ },
    onReset: function () { if (media) { media.pause(); media.removeAttribute('src'); media.load(); } st.queue = []; st.qi = -1; st.playing = false; st.err = ''; st.view = 'now'; },
    onLocale: function () { draw(); }
  });
  S.registerProcess(function () { return st.playing ? [{ name: 'Media Player (playing)', desc: 'Plays audio and video', cpu: 1.2, ram: 60, status: 'Running' }] : []; });

  document.addEventListener('click', function (e) {
    var w = $('win-media'); if (!w || !w.contains(e.target)) return;
    var v = e.target.closest('[data-v]'); if (v) { st.view = v.dataset.v; st.err = ''; draw(); return; }
    var pre = e.target.closest('[data-pre]'); if (pre) { st.eq = PRESETS[pre.dataset.pre].slice(); S.setPrefs({ mpEq: st.eq }); applyEq(); draw(); return; }
    var a = e.target.closest('[data-a]');
    if (a) {
      var k = a.dataset.a, i = +a.dataset.i;
      if (k === 'rm') { e.stopPropagation(); if (st.view === 'now') { st.queue.splice(i, 1); if (i < st.qi) st.qi--; else if (i === st.qi) { st.qi = -1; if (media) media.pause(); } draw(); } else { saveLists(lists().map(function (p) { return p.id === st.view ? Object.assign({}, p, { t: p.t.filter(function (_, j) { return j !== i; }) }) : p; })); setTimeout(draw, 40); } return; }
      if (k === 'toggle') toggle(); else if (k === 'next') next(false); else if (k === 'prev') prev();
      else if (k === 'shuf') { st.shuffle = !st.shuffle; drawBar(); } else if (k === 'rep') { st.rep = (st.rep + 1) % 3; drawBar(); }
      else if (k === 'mute') { st.mute = !st.mute; applyVol(); drawBar(); }
      else if (k === 'eq') { st.eqOpen = !st.eqOpen; draw(); }
      else if (k === 'addurl') addUrl(); else if (k === 'addfile') addFiles();
      else if (k === 'newpl') newPl(); else if (k === 'savepl') newPl(st.queue.slice(0, 100));
      else if (k === 'clear') { if (media) media.pause(); st.queue = []; st.qi = -1; st.playing = false; draw(); }
      else if (k === 'playpl') { var pl = lists().filter(function (p) { return p.id === st.view; })[0]; if (pl && pl.t.length) { playList(pl.t, 0); st.view = 'now'; draw(); } }
      else if (k === 'renpl') { var cp = lists().filter(function (p) { return p.id === st.view; })[0]; if (cp) nameDlg(T('mp_rename', 'Rename'), cp.n, function (n) { saveLists(lists().map(function (p) { return p.id === cp.id ? Object.assign({}, p, { n: n }) : p; })); setTimeout(draw, 40); }); }
      else if (k === 'delpl') { var id = st.view; S.showDlg({ title: T('mp_delete', 'Delete'), html: '<div>' + esc(T('mp_delete_q', 'Delete this playlist?')) + '</div>', buttons: [{ label: T('ui_dlg_yes', 'Yes'), primary: true, run: function () { saveLists(lists().filter(function (p) { return p.id !== id; })); st.view = 'now'; setTimeout(draw, 40); } }, { label: T('ui_dlg_no', 'No') }] }); }
      return;
    }
    var row = e.target.closest('.mp-r');
    if (row) {
      var n = +row.dataset.i;
      if (st.view === 'now') load(n); else { var pl2 = lists().filter(function (p) { return p.id === st.view; })[0]; if (pl2) { playList(pl2.t, n); st.view = 'now'; draw(); } }
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t || !$('win-media') || !$('win-media').contains(t)) return;
    if (t.id === 'mp-q') { st.q = t.value; var m = document.querySelector('.mp-main'); if (m) { m.innerHTML = main(); var cv = cur(); var sg = $('mp-stage'); if (sg && cv && cv.k === 'v' && media) { sg.appendChild(media); media.className = 'mp-video'; } } return; }
    if (t.id === 'mp-vol') { st.vol = +t.value; st.mute = false; applyVol(); paintRange(t); }
    else if (t.id === 'mp-seekr') { t.dataset.drag = '1'; paintRange(t); if (media && media.duration) $('mp-cur').textContent = fmt(t.value / 1000 * media.duration); }
    else if (t.dataset && t.dataset.band !== undefined) { st.eq[+t.dataset.band] = +t.value; paintRange(t); applyEq(); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t || !$('win-media') || !$('win-media').contains(t)) return;
    if (t.id === 'mp-vol') S.setPrefs({ mpVol: st.vol });
    else if (t.id === 'mp-seekr') { delete t.dataset.drag; if (media && media.duration) media.currentTime = t.value / 1000 * media.duration; }
    else if (t.dataset && t.dataset.band !== undefined) S.setPrefs({ mpEq: st.eq });
    else if (t.id === 'mp-eqon') {
      st.eqOn = t.checked;
      if (st.eqOn && cur()) { filters = filters; load(st.qi); }   // reload so the file is fetched in the mode the equaliser needs
      else applyEq();
    }
  });
})();
