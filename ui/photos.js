/* Photo viewer for Los Santos OS. Browses the pictures in Documents, Downloads, Public and the phone's Photos; zoom, drag, rotate,
   flip, slideshow, non-destructive adjustments (brightness, contrast, saturation, filters) with undo, set as wallpaper, print and
   send to phone. Pictures are links kept by server/files.lua, so adjustments are for viewing, the wallpaper and nothing else:
   the original file is never changed. Explorer opens images here through LSOS.photoOpen. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#0ea5e9"/><circle cx="8.6" cy="9" r="1.8" fill="#fff"/><path d="M4.5 17.5l4.2-4.4 3.2 2.8 3.2-3.4 4.4 5z" fill="#fff"/></svg>';
  var SRC = [['docs', 'ph_docs', 'Documents'], ['dl', 'ph_dl', 'Downloads'], ['pcf', 'ph_pub', 'Public'], ['phone', 'ph_phone', 'Phone photos']];
  var PLACE = { docs: 'docs', dl: 'dl', pcf: 'shared' };
  var st = { src: 'docs', lists: {}, idx: 0, zoom: 1, rot: 0, flip: 1, x: 0, y: 0, edit: false, fx: null, undo: [], show: null, opened: null };

  function blank() { return { b: 100, c: 100, s: 100, gray: 0, sepia: 0, blur: 0, invert: 0 }; }
  st.fx = blank();
  function list() { var l = st.lists[st.src] || []; return (st.opened && st.src === 'opened') ? [st.opened] : l; }
  function cur() { return list()[st.idx]; }
  function filter() { var f = st.fx; return 'brightness(' + f.b + '%) contrast(' + f.c + '%) saturate(' + f.s + '%) grayscale(' + f.gray + '%) sepia(' + f.sepia + '%) blur(' + f.blur + 'px) invert(' + f.invert + '%)'; }
  function safe(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }

  function load(src) {
    if (st.lists[src] && src !== 'phone') return Promise.resolve();
    if (src === 'phone') return S.api('filesApi', { name: 'phoneList', data: {} }).then(function (r) {
      st.lists.phone = r && r.ok ? ((r.data && r.data.photos) || []).filter(function (p) { return !p.isVideo && safe(p.url); }).map(function (p) { return { id: 'ph' + p.id, name: T('ph_photo', 'Photo') + ' ' + new Date((p.timestamp || 0) * 1000).toLocaleDateString(), url: p.url, phone: true }; }) : [];
    });
    return S.api('filesApi', { name: 'list', data: { folder: PLACE[src], parent: 0 } }).then(function (r) {
      st.lists[src] = r && r.ok ? ((r.data && r.data.files) || []).filter(function (f) { return f.kind === 'image' && safe(f.url); }) : [];
    });
  }
  function resetView() { st.zoom = 1; st.rot = 0; st.flip = 1; st.x = 0; st.y = 0; st.fx = blank(); st.undo = []; }
  function go(i) { var l = list(); if (!l.length) return; st.idx = (i + l.length) % l.length; resetView(); draw(); }
  function select(src) { st.src = src; st.idx = 0; resetView(); stopShow(); draw(); load(src).then(draw); }

  function stopShow() { if (st.show) { clearInterval(st.show); st.show = null; } }
  function toggleShow() { if (st.show) { stopShow(); } else if (list().length > 1) { st.show = setInterval(function () { go(st.idx + 1); }, 4000); } draw(); }

  function transform() { return 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + (st.zoom * st.flip) + ',' + st.zoom + ') rotate(' + st.rot + 'deg)'; }
  function applyView() { var im = $('ph-img'); if (im) { im.style.transform = transform(); im.style.filter = filter(); } }

  function draw() {
    var root = $('ph-root'); if (!root) return;
    var l = list(), f = cur();
    var side = SRC.map(function (s) { var n = (st.lists[s[0]] || []).length; return '<button data-src="' + s[0] + '" class="' + (st.src === s[0] ? 'on' : '') + '">' + esc(T(s[1], s[2])) + '<span class="n">' + (st.lists[s[0]] ? n : '') + '</span></button>'; }).join('');
    if (st.opened) side = '<button data-src="opened" class="' + (st.src === 'opened' ? 'on' : '') + '">' + esc(T('ph_opened', 'Opened')) + '</button>' + side;
    var bar = '<button data-a="zi">+</button><button data-a="zo">−</button><button data-a="fit">' + esc(T('ph_fit', 'Fit')) + '</button><button data-a="rl">⟲</button><button data-a="rr">⟳</button><button data-a="flip">⇋</button>' +
      '<button data-a="show" class="' + (st.show ? 'on' : '') + '">' + esc(st.show ? T('ph_stop', 'Stop slideshow') : T('ph_slide', 'Slideshow')) + '</button><button data-a="edit" class="' + (st.edit ? 'on' : '') + '">' + esc(T('ph_adjust', 'Adjust')) + '</button><span class="grow"></span>' +
      (f ? '<span class="nm">' + esc(f.name) + '</span><button data-a="wall">' + esc(T('ph_wall', 'Set as wallpaper')) + '</button>' + (S.state && S.state.printer ? '<button data-a="print">' + esc(T('pr_print', 'Print')) + '</button>' : '') + (!f.phone ? '<button data-a="tophone">' + esc(T('fl_send_phone', 'Send to phone Photos')) + '</button>' : '') : '');
    var stage = f ? '<img id="ph-img" alt="" referrerpolicy="no-referrer" draggable="false" src="' + esc(safe(f.url)) + '">' + (l.length > 1 ? '<button class="ph-nav l" data-a="prev">‹</button><button class="ph-nav r" data-a="next">›</button>' : '') :
      '<div class="ph-msg">' + esc(st.lists[st.src] ? T('ph_none', 'No pictures here yet.') : T('ph_loading', 'Loading...')) + '</div>';
    var fx = st.fx;
    function sl(k, lab, min, max) { return '<label>' + esc(T('ph_' + k, lab)) + '</label><input type="range" data-fx="' + k + '" min="' + min + '" max="' + max + '" value="' + fx[k] + '">'; }
    var edit = st.edit ? '<div class="ph-edit">' + sl('b', 'Brightness', 40, 180) + sl('c', 'Contrast', 40, 180) + sl('s', 'Saturation', 0, 200) + sl('blur', 'Blur', 0, 8) +
      '<div class="ph-fx"><button data-pre="gray" class="' + (fx.gray ? 'on' : '') + '">' + esc(T('ph_gray', 'Black and white')) + '</button><button data-pre="sepia" class="' + (fx.sepia ? 'on' : '') + '">' + esc(T('ph_sepia', 'Sepia')) + '</button><button data-pre="invert" class="' + (fx.invert ? 'on' : '') + '">' + esc(T('ph_invert', 'Invert')) + '</button></div>' +
      '<div class="ph-fx"><button data-a="undo">' + esc(T('ph_undo', 'Undo')) + '</button><button data-a="reset">' + esc(T('ph_reset', 'Reset')) + '</button></div><div class="ph-note">' + esc(T('ph_note', 'Adjustments change how it looks here and the wallpaper. The original file is not changed.')) + '</div></div>' : '';
    var strip = l.map(function (p, i) { return '<img data-i="' + i + '" class="' + (i === st.idx ? 'on' : '') + '" loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(safe(p.url)) + '">'; }).join('');
    root.innerHTML = '<div class="ph-side">' + side + '</div><div class="ph-main"><div class="ph-bar">' + bar + '</div><div class="ph-mid"><div class="ph-stage" id="ph-stage">' + stage + '</div>' + edit + '</div><div class="ph-strip">' + strip + '</div></div>';
    applyView();
  }

  function snap() { st.undo.push(JSON.stringify([st.fx, st.rot, st.flip])); if (st.undo.length > 30) st.undo.shift(); }
  function act(a, f) {
    if (a === 'zi') st.zoom = Math.min(8, st.zoom * 1.25);
    else if (a === 'zo') st.zoom = Math.max(0.2, st.zoom / 1.25);
    else if (a === 'fit') { st.zoom = 1; st.x = 0; st.y = 0; }
    else if (a === 'rl') { snap(); st.rot -= 90; } else if (a === 'rr') { snap(); st.rot += 90; } else if (a === 'flip') { snap(); st.flip *= -1; }
    else if (a === 'prev') return go(st.idx - 1); else if (a === 'next') return go(st.idx + 1);
    else if (a === 'show') return toggleShow();
    else if (a === 'edit') { st.edit = !st.edit; return draw(); }
    else if (a === 'undo') { var u = st.undo.pop(); if (u) { var v = JSON.parse(u); st.fx = v[0]; st.rot = v[1]; st.flip = v[2]; } return draw(); }
    else if (a === 'reset') { snap(); st.fx = blank(); st.rot = 0; st.flip = 1; return draw(); }
    else if (a === 'wall' && f) {
      S.setPrefs({ wallpaper: 'custom', wallpaperUrl: f.url });
      S.notify({ app: 'photos', title: T('ph_wall_set', 'Wallpaper changed'), text: f.name });
      return;
    } else if (a === 'print' && f) return S.print({ kind: 'image', title: f.name, url: f.url });
    else if (a === 'tophone' && f) { S.api('filesApi', { name: 'toPhone', data: { id: f.id } }).then(function (r) { S.notify({ app: 'photos', title: r && r.ok ? T('fl_sent_phone', 'Saved to your phone') : T('ph_fail', 'That could not be done.') }); }); return; }
    applyView();
  }

  S.registerApp({
    id: 'photos', icon: ICON, titleKey: 'app_photos', titleDef: 'Photos', w: 920, h: 600,
    html: '<div class="ph" id="ph-root"></div>',
    onOpen: function () { if (!st.opened) st.src = 'docs'; st.idx = 0; resetView(); draw(); load(st.src).then(draw); },
    onClose: function () { stopShow(); },
    onReset: function () { stopShow(); st.lists = {}; st.opened = null; st.edit = false; },
    onLocale: function () { draw(); }
  });
  // Explorer hands images over here
  S.photoOpen = function (f) {
    st.opened = { id: f.id, name: f.name, url: f.url }; st.src = 'opened'; st.idx = 0; resetView();
    S.openApp('photos'); draw();
  };

  document.addEventListener('click', function (e) {
    var w = $('win-photos'); if (!w || !w.contains(e.target)) return;
    var s = e.target.closest('[data-src]'); if (s) { select(s.dataset.src); return; }
    var th = e.target.closest('.ph-strip [data-i]'); if (th) { go(+th.dataset.i); return; }
    var p = e.target.closest('[data-pre]'); if (p) { snap(); st.fx[p.dataset.pre] = st.fx[p.dataset.pre] ? 0 : 100; draw(); return; }
    var b = e.target.closest('[data-a]'); if (b) act(b.dataset.a, cur());
  });
  document.addEventListener('input', function (e) {
    var r = e.target.closest && e.target.closest('[data-fx]'); if (!r || !$('win-photos').contains(r)) return;
    st.fx[r.dataset.fx] = +r.value; applyView();
  });
  document.addEventListener('change', function (e) { var r = e.target.closest && e.target.closest('[data-fx]'); if (r) snap(); });
  document.addEventListener('wheel', function (e) {
    var sg = e.target.closest && e.target.closest('#ph-stage'); if (!sg) return;
    e.preventDefault(); st.zoom = Math.max(0.2, Math.min(8, st.zoom * (e.deltaY < 0 ? 1.12 : 0.89))); applyView();
  }, { passive: false });
  var drag = null;
  document.addEventListener('mousedown', function (e) { var sg = e.target.closest && e.target.closest('#ph-stage'); if (!sg || e.target.closest('.ph-nav')) return; drag = { x: e.clientX - st.x, y: e.clientY - st.y }; sg.classList.add('drag'); });
  document.addEventListener('mousemove', function (e) { if (!drag) return; st.x = e.clientX - drag.x; st.y = e.clientY - drag.y; applyView(); });
  document.addEventListener('mouseup', function () { if (!drag) return; drag = null; var sg = $('ph-stage'); if (sg) sg.classList.remove('drag'); });
  document.addEventListener('keydown', function (e) {
    var w = $('win-photos'); if (!w || !w.classList.contains('open') || (e.target && /INPUT|TEXTAREA/.test(e.target.tagName) && e.target.type !== 'range')) return;
    if (e.key === 'ArrowLeft') go(st.idx - 1); else if (e.key === 'ArrowRight') go(st.idx + 1);
  });
})();
