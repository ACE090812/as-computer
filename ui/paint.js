/* Paint for Los Santos OS: pencil, brush, eraser, fill, colour picker, text, line, rectangle, ellipse, rectangle select and move,
   layers, undo and redo, zoom, canvases up to 1920x1080. Drawings are saved as PNG in Documents > Pictures (server/files.lua
   'savePicture') and can be opened again, overwriting the original if you want. The Photos app lists the same pictures. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  function $(id) { return document.getElementById(id); }
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#e11d48"/><path d="M6 17.5c1.6 0 2.2-1.2 2.4-2.4l7-7 2.6 2.6-7 7c-1.2.2-2.4.8-2.4 2.4C8 20 6 20 5 19z" fill="#fff"/><path d="M16.4 6.6l1.5-1.5a1.4 1.4 0 0 1 2 0l.6.6a1.4 1.4 0 0 1 0 2L19 9.2z" fill="#fde68a"/></svg>';
  var MAXW = 1920, MAXH = 1080;
  var PAL = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
  var TOOLS = [['select', 'pt_select', 'Select'], ['pencil', 'pt_pencil', 'Pencil'], ['brush', 'pt_brush', 'Brush'], ['eraser', 'pt_eraser', 'Eraser'], ['fill', 'pt_fill', 'Fill'], ['picker', 'pt_picker', 'Colour picker'], ['text', 'pt_text', 'Text'], ['line', 'pt_line', 'Line'], ['rect', 'pt_rect', 'Rectangle'], ['ellipse', 'pt_ellipse', 'Ellipse']];
  var TICON = {
    select: '<path d="M4 4h16v16H4z" stroke-dasharray="3 2"/>', pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>', brush: '<path d="M4 20c3 0 4-1 4-3l-1-1c-2 0-3 2-3 4zM8 16L18 5l2 2-9 11"/>',
    eraser: '<path d="M4 15l8-9 7 7-5 5H8zM10 19h10"/>', fill: '<path d="M5 12l7-7 7 7-7 7zM19 15c1 1.5 1.5 2.5 1.5 3.2a1.5 1.5 0 0 1-3 0c0-.7.5-1.7 1.5-3.2z"/>',
    picker: '<path d="M14 5l5 5-9 9H5v-5zM13 6l5 5"/>', text: '<path d="M6 6h12M12 6v13M9 19h6"/>', line: '<path d="M5 19L19 5"/>', rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>', ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>'
  };
  var AICON = {
    save: '<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>', undo: '<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 8"/>', redo: '<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 8"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-3-6.2M20 4v5h-5"/>', flip: '<path d="M12 3v18M8 7L3 18h5zM16 7l5 11h-5z"/>', resize: '<path d="M4 4h6M4 4v6M20 20h-6M20 20v-6M4 4l16 16"/>', del: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>', layers: '<path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/>'
  };
  function aic(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + AICON[k] + '</svg>'; }
  var P = null;   // the open document, null until the app is opened

  function newDoc(w, h) {
    P = { w: w, h: h, layers: [], li: 0, undo: [], redo: [], zoom: 1, tool: 'pencil', fg: '#000000', bg: '#ffffff', size: 4, fillShape: false, name: '', fileId: 0, dirty: false, sel: null, float: null, menu: null, showLayers: false, slot: 1 };
    addLayer(T('pt_background', 'Background'), '#ffffff');
  }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function addLayer(name, fill) {
    var c = mk(P.w, P.h), x = c.getContext('2d');
    if (fill) { x.fillStyle = fill; x.fillRect(0, 0, P.w, P.h); }
    P.layers.splice(P.li + (P.layers.length ? 1 : 0), 0, { name: name, canvas: c, vis: true });
    P.li = P.layers.indexOf(P.layers.filter(function (l) { return l.canvas === c; })[0]);
  }
  function ctx() { return P.layers[P.li].canvas.getContext('2d'); }

  // ---- view
  function mount() {
    var wrap = $('pt-stack'); if (!wrap) return;
    wrap.innerHTML = '';
    wrap.style.width = P.w * P.zoom + 'px'; wrap.style.height = P.h * P.zoom + 'px';
    P.layers.forEach(function (l) { l.canvas.style.display = l.vis ? '' : 'none'; wrap.appendChild(l.canvas); });
    P.ov = mk(P.w, P.h); P.ov.className = 'pt-ov'; wrap.appendChild(P.ov);
    wrap.querySelectorAll('canvas').forEach(function (c) { c.style.width = P.w * P.zoom + 'px'; c.style.height = P.h * P.zoom + 'px'; });
    status();
  }
  function fitZoom() {
    var sc = $('pt-scroll'); if (!sc || !P) return;
    zoomTo(Math.min(1, (sc.clientWidth - 40) / P.w, (sc.clientHeight - 40) / P.h));
  }
  function zoomTo(z) { P.zoom = Math.max(0.1, Math.min(8, z)); var wrap = $('pt-stack'); if (!wrap) return; wrap.style.width = P.w * P.zoom + 'px'; wrap.style.height = P.h * P.zoom + 'px'; wrap.querySelectorAll('canvas').forEach(function (c) { c.style.width = P.w * P.zoom + 'px'; c.style.height = P.h * P.zoom + 'px'; }); status(); }
  function status(pos) {
    if (!$('pt-s-pos')) return;
    $('pt-s-pos').textContent = pos ? pos.x + ', ' + pos.y + ' px' : '';
    $('pt-s-size').textContent = P.w + ' x ' + P.h + ' px';
    $('pt-s-zoom').textContent = Math.round(P.zoom * 100) + '%';
    var z = $('pt-zoom'); if (z && +z.value !== Math.round(P.zoom * 100)) { z.value = Math.round(P.zoom * 100); paintRange(z); }
    if ($('pt-menu') && !P.menu) { var d = $('pt-menu').querySelector('.pt-doc'); if (d) d.textContent = (P.name || T('pt_untitled', 'Untitled')) + (P.dirty ? ' *' : '') + ' - Paint'; }
  }
  function tb(t, big) { return '<button class="pt-t' + (big ? ' big' : '') + (P.tool === t[0] ? ' on' : '') + '" data-tool="' + t[0] + '" title="' + esc(T(t[1], t[2])) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + TICON[t[0]] + '</svg>' + (big ? '<span>' + esc(T(t[1], t[2])) + '</span>' : '') + '</button>'; }
  function tdef(id) { return TOOLS.filter(function (t) { return t[0] === id; })[0]; }
  function grp(name, body, cls) { return '<div class="pt-grp' + (cls ? ' ' + cls : '') + '"><div class="pt-gb">' + body + '</div><div class="pt-gn">' + esc(T(name[0], name[1])) + '</div></div>'; }
  function menu() {
    var mi = function (a, k, d, key) { return '<button data-a="' + a + '"><span>' + esc(T(k, d)) + '</span><em>' + (key || '') + '</em></button>'; };
    var file = P.menu === 'file' ? '<div class="pt-dd" style="left:6px">' + mi('new', 'pt_new', 'New', 'Ctrl+N') + mi('open', 'pt_open', 'Open', 'Ctrl+O') + mi('save', 'pt_save', 'Save', 'Ctrl+S') + mi('saveas', 'pt_saveas', 'Save as') + '</div>' : '';
    var view = P.menu === 'view' ? '<div class="pt-dd" style="left:56px">' + mi('layers', 'pt_layers', 'Layers', P.showLayers ? '\u2713' : '') + mi('fit', 'pt_fit', 'Fit to window') + mi('zin', 'pt_zin', 'Zoom in') + mi('zout', 'pt_zout', 'Zoom out') + '</div>' : '';
    $('pt-menu').innerHTML = '<button class="pt-m' + (P.menu === 'file' ? ' on' : '') + '" data-a="mfile">' + esc(T('pt_file', 'File')) + '</button><button class="pt-m' + (P.menu === 'view' ? ' on' : '') + '" data-a="mview">' + esc(T('pt_view', 'View')) + '</button><span class="pt-sep"></span>' +
      '<button class="pt-ic" data-a="save" title="' + esc(T('pt_save', 'Save')) + '">' + aic('save') + '</button><button class="pt-ic" data-a="undo" title="' + esc(T('pt_undo', 'Undo')) + '">' + aic('undo') + '</button><button class="pt-ic" data-a="redo" title="' + esc(T('pt_redo', 'Redo')) + '">' + aic('redo') + '</button><span class="pt-gr"></span><span class="pt-doc">' + esc(P.name || T('pt_untitled', 'Untitled')) + (P.dirty ? ' *' : '') + ' - Paint</span>' + file + view;
  }
  function ribbon() {
    var pal = PAL.map(function (c) { return '<button class="pt-c" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('');
    var sel = grp(['pt_g_selection', 'Selection'], tb(tdef('select'), true) + '<button class="pt-t sm" data-a="seldel" title="' + esc(T('pt_delete', 'Delete')) + '">' + aic('del') + '</button>');
    var img = grp(['pt_g_image', 'Image'], '<button class="pt-t big" data-a="resize">' + aic('resize') + '<span>' + esc(T('pt_resize', 'Resize')) + '</span></button><div class="pt-col2"><button class="pt-t sm" data-a="rotate" title="' + esc(T('pt_rotate', 'Rotate right')) + '">' + aic('rotate') + '</button><button class="pt-t sm" data-a="flip" title="' + esc(T('pt_flip', 'Flip horizontal')) + '">' + aic('flip') + '</button></div>');
    var tools = grp(['pt_g_tools', 'Tools'], '<div class="pt-grid3">' + ['pencil', 'fill', 'text', 'eraser', 'picker'].map(function (k) { return tb(tdef(k)); }).join('') + '</div>');
    var brushes = grp(['pt_g_brushes', 'Brushes'], tb(tdef('brush'), true));
    var shapes = grp(['pt_g_shapes', 'Shapes'], '<div class="pt-grid3">' + ['line', 'rect', 'ellipse'].map(function (k) { return tb(tdef(k)); }).join('') + '</div><div class="pt-col2"><label class="chk"><input type="checkbox" id="pt-fillshape"' + (P.fillShape ? ' checked' : '') + '> ' + esc(T('pt_fillshape', 'Fill')) + '</label></div>');
    var size = grp(['pt_g_size', 'Size'], '<div class="pt-sz"><input type="range" id="pt-size" min="1" max="60" value="' + P.size + '"><span id="pt-sz">' + P.size + ' px</span></div>');
    var cols = grp(['pt_g_colors', 'Colors'], '<div class="pt-cur"><button data-a="c1" class="' + (P.slot !== 2 ? 'on' : '') + '" title="' + esc(T('pt_color1', 'Color 1')) + '"><i style="background:' + P.fg + '"></i><span>' + esc(T('pt_color1', 'Color 1')) + '</span></button><button data-a="c2" class="' + (P.slot === 2 ? 'on' : '') + '" title="' + esc(T('pt_color2', 'Color 2')) + '"><i style="background:' + P.bg + '"></i><span>' + esc(T('pt_color2', 'Color 2')) + '</span></button></div><div class="pt-pal">' + pal + '</div><label class="pt-edit" title="' + esc(T('pt_custom', 'Edit colors')) + '"><input type="color" id="pt-custom" value="' + P.fg + '"><span>' + esc(T('pt_custom', 'Edit colors')) + '</span></label>', 'last');
    $('pt-rib').innerHTML = sel + img + tools + brushes + shapes + size + cols;
    var r = $('pt-size'); if (r) paintRange(r);
  }
  function paintRange(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  function layersPanel() {
    var h = '<div class="pt-lh"><b>' + esc(T('pt_layers', 'Layers')) + '</b><span class="grow"></span><button data-l="add" title="' + esc(T('pt_layer_add', 'Add layer')) + '">+</button><button data-l="del" title="' + esc(T('pt_layer_del', 'Delete layer')) + '">&minus;</button><button data-l="up" title="' + esc(T('pt_layer_up', 'Move up')) + '">&uarr;</button><button data-l="down" title="' + esc(T('pt_layer_down', 'Move down')) + '">&darr;</button></div>';
    for (var i = P.layers.length - 1; i >= 0; i--) h += '<div class="pt-l' + (i === P.li ? ' on' : '') + '" data-li="' + i + '"><button class="eye" data-l="vis" data-li="' + i + '">' + (P.layers[i].vis ? '&#9679;' : '&#9675;') + '</button><span>' + esc(P.layers[i].name) + '</span></div>';
    $('pt-layers').innerHTML = h;
  }
  function redraw() { menu(); ribbon(); layersPanel(); $('pt-layers').classList.toggle('hidden', !P.showLayers); status(); }

  // ---- undo
  function snap() { var c = P.layers[P.li].canvas; P.undo.push({ li: P.li, d: c.getContext('2d').getImageData(0, 0, P.w, P.h) }); if (P.undo.length > 25) P.undo.shift(); P.redo = []; P.dirty = true; }
  function undo() { commitFloat(); var u = P.undo.pop(); if (!u || !P.layers[u.li]) return; var x = P.layers[u.li].canvas.getContext('2d'); P.redo.push({ li: u.li, d: x.getImageData(0, 0, P.w, P.h) }); x.putImageData(u.d, 0, 0); status(); }
  function redo() { var u = P.redo.pop(); if (!u || !P.layers[u.li]) return; var x = P.layers[u.li].canvas.getContext('2d'); P.undo.push({ li: u.li, d: x.getImageData(0, 0, P.w, P.h) }); x.putImageData(u.d, 0, 0); status(); }

  // ---- drawing
  // the desktop can be scaled to fit the screen, so work out the real scale from the box on screen
  function pt(e) { var r = $('pt-stack').getBoundingClientRect(), k = (r.width / (P.w * P.zoom)) || 1; return { x: Math.floor((e.clientX - r.left) / (P.zoom * k)), y: Math.floor((e.clientY - r.top) / (P.zoom * k)) }; }
  function stroke(x, a, b, erase) {
    x.save(); x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = P.tool === 'pencil' ? 1 : P.size;
    if (erase) x.globalCompositeOperation = 'destination-out';
    x.strokeStyle = P.fg; x.beginPath(); x.moveTo(a.x + .5, a.y + .5); x.lineTo(b.x + .5, b.y + .5); x.stroke(); x.restore();
  }
  function shape(x, tool, a, b, fillIt) {
    x.save(); x.lineWidth = P.size; x.lineJoin = 'round'; x.lineCap = 'round'; x.strokeStyle = P.fg; x.fillStyle = P.bg; x.beginPath();
    if (tool === 'line') { x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); }
    else if (tool === 'rect') x.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else x.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    if (fillIt && tool !== 'line') x.fill(); x.stroke(); x.restore();
  }
  function hex2rgb(h) { return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)]; }
  function flood(sx, sy) {
    var x = ctx(), im = x.getImageData(0, 0, P.w, P.h), d = im.data, w = P.w, h = P.h;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) return;
    var i0 = (sy * w + sx) * 4, tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3], c = hex2rgb(P.fg);
    if (tr === c[0] && tg === c[1] && tb === c[2] && ta === 255) return;
    function m(i) { return d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta; }
    var st = [[sx, sy]];
    while (st.length) {
      var p = st.pop(), px = p[0], py = p[1];
      while (px >= 0 && m((py * w + px) * 4)) px--;
      px++; var up = false, dn = false;
      while (px < w && m((py * w + px) * 4)) {
        var i = (py * w + px) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
        if (py > 0) { var u = m(((py - 1) * w + px) * 4); if (u && !up) { st.push([px, py - 1]); up = true; } else if (!u) up = false; }
        if (py < h - 1) { var v = m(((py + 1) * w + px) * 4); if (v && !dn) { st.push([px, py + 1]); dn = true; } else if (!v) dn = false; }
        px++;
      }
    }
    x.putImageData(im, 0, 0);
  }
  function commitFloat() {
    if (!P || !P.float) return;
    ctx().drawImage(P.float.c, P.float.x, P.float.y);
    P.ov.getContext('2d').clearRect(0, 0, P.w, P.h); P.float = null; P.sel = null;
  }
  function drawSel() {
    var o = P.ov.getContext('2d'); o.clearRect(0, 0, P.w, P.h);
    if (P.float) o.drawImage(P.float.c, P.float.x, P.float.y);
    if (P.sel) { o.save(); o.setLineDash([5, 4]); o.strokeStyle = '#000'; o.lineWidth = 1; o.strokeRect(P.sel.x + .5, P.sel.y + .5, P.sel.w, P.sel.h); o.strokeStyle = '#fff'; o.lineDashOffset = 4; o.strokeRect(P.sel.x + .5, P.sel.y + .5, P.sel.w, P.sel.h); o.restore(); }
  }
  var drag = null;
  function down(e) {
    if (!P || e.button !== 0) return;
    var a = pt(e), t = P.tool;
    if (t !== 'select') commitFloat();
    if (t === 'picker') { var px = P.layers[P.li].canvas.getContext('2d').getImageData(Math.max(0, a.x), Math.max(0, a.y), 1, 1).data; if (px[3]) { P.fg = '#' + [px[0], px[1], px[2]].map(function (n) { return (n < 16 ? '0' : '') + n.toString(16); }).join(''); ribbon(); } return; }
    if (t === 'fill') { snap(); flood(a.x, a.y); return; }
    if (t === 'text') { textAt(a, e); return; }
    if (t === 'select') {
      if (P.sel && a.x >= P.sel.x && a.y >= P.sel.y && a.x <= P.sel.x + P.sel.w && a.y <= P.sel.y + P.sel.h) {
        if (!P.float) {
          snap();
          var c = mk(P.sel.w, P.sel.h); c.getContext('2d').drawImage(P.layers[P.li].canvas, P.sel.x, P.sel.y, P.sel.w, P.sel.h, 0, 0, P.sel.w, P.sel.h);
          ctx().clearRect(P.sel.x, P.sel.y, P.sel.w, P.sel.h);
          P.float = { c: c, x: P.sel.x, y: P.sel.y };
        }
        drag = { mode: 'move', ox: a.x - P.float.x, oy: a.y - P.float.y };
      } else { commitFloat(); drag = { mode: 'sel', a: a }; P.sel = null; drawSel(); }
      return;
    }
    snap(); drag = { mode: t, a: a, last: a };
    if (t === 'pencil' || t === 'brush' || t === 'eraser') stroke(ctx(), a, a, t === 'eraser');
  }
  function move(e) {
    if (!P) return;
    var a = pt(e); status(a);
    if (!drag) return;
    var m = drag.mode;
    if (m === 'pencil' || m === 'brush' || m === 'eraser') { stroke(ctx(), drag.last, a, m === 'eraser'); drag.last = a; }
    else if (m === 'line' || m === 'rect' || m === 'ellipse') { var o = P.ov.getContext('2d'); o.clearRect(0, 0, P.w, P.h); shape(o, m, drag.a, a, P.fillShape); }
    else if (m === 'sel') { P.sel = { x: Math.max(0, Math.min(drag.a.x, a.x)), y: Math.max(0, Math.min(drag.a.y, a.y)), w: Math.min(P.w, Math.abs(a.x - drag.a.x)), h: Math.min(P.h, Math.abs(a.y - drag.a.y)) }; drawSel(); }
    else if (m === 'move' && P.float) { P.float.x = a.x - drag.ox; P.float.y = a.y - drag.oy; P.sel.x = P.float.x; P.sel.y = P.float.y; drawSel(); }
  }
  function up(e) {
    if (!drag) return;
    var m = drag.mode, a = pt(e);
    if (m === 'line' || m === 'rect' || m === 'ellipse') { shape(ctx(), m, drag.a, a, P.fillShape); P.ov.getContext('2d').clearRect(0, 0, P.w, P.h); }
    if (m === 'sel' && P.sel && (P.sel.w < 2 || P.sel.h < 2)) { P.sel = null; drawSel(); }
    drag = null; status();
  }
  function textAt(a, e) {
    var old = $('pt-txt'); if (old) old.remove();
    var inp = document.createElement('input'); inp.id = 'pt-txt'; inp.className = 'pt-txt'; inp.maxLength = 120;
    var box = $('pt-scroll').getBoundingClientRect(), sz = Math.max(16, P.size * 4 + 12);
    inp.style.left = (e.clientX - box.left + $('pt-scroll').scrollLeft) + 'px'; inp.style.top = (e.clientY - box.top + $('pt-scroll').scrollTop) + 'px';
    inp.style.font = (sz * P.zoom) + 'px sans-serif'; inp.style.color = P.fg;
    $('pt-scroll').appendChild(inp); inp.focus();
    var fin = false;
    var done = function (ok) {
      if (fin) return; fin = true; var v = inp.value; if (inp.parentNode) inp.remove();
      if (ok && v) { snap(); var x = ctx(); x.save(); x.font = sz + 'px sans-serif'; x.fillStyle = P.fg; x.textBaseline = 'top'; x.fillText(v, a.x, a.y); x.restore(); }
    };
    inp.addEventListener('keydown', function (k) { if (k.key === 'Enter') done(true); else if (k.key === 'Escape') done(false); k.stopPropagation(); });
    inp.addEventListener('blur', function () { done(true); });
  }

  // ---- files
  function resizeDlg() {
    S.showDlg({ title: T('pt_resize', 'Resize'), html: '<div class="pt-nw"><label>' + esc(T('pt_width', 'Width')) + '<input id="pt-w" type="number" class="pt-in" min="16" max="' + MAXW + '" value="' + P.w + '"></label><label>' + esc(T('pt_height', 'Height')) + '<input id="pt-h" type="number" class="pt-in" min="16" max="' + MAXH + '" value="' + P.h + '"></label></div><div class="pt-hint">' + esc(T('pt_max', 'Largest size: 1920 x 1080')) + '</div>',
      buttons: [{ label: T('pt_resize', 'Resize'), primary: true, run: function () {
        var w = Math.max(16, Math.min(MAXW, parseInt($('pt-w').value, 10) || P.w)), h = Math.max(16, Math.min(MAXH, parseInt($('pt-h').value, 10) || P.h));
        rebuild(w, h, function (x, c) { x.drawImage(c, 0, 0, w, h); });
      } }, { label: T('pt_cancel', 'Cancel') }] });
  }
  // every layer goes through the same change (resize, rotate, flip); the undo history is cleared
  function rebuild(w, h, draw) {
    commitFloat();
    P.layers.forEach(function (l) { var n = mk(w, h), x = n.getContext('2d'); draw(x, l.canvas, n); l.canvas = n; });
    P.w = w; P.h = h; P.undo = []; P.redo = []; P.sel = null; P.dirty = true; mount(); redraw(); fitZoom();
  }
  function transformDoc(kind) {
    if (kind === 'rotate') { var k = Math.min(1, MAXW / P.h, MAXH / P.w); rebuild(Math.round(P.h * k), Math.round(P.w * k), function (x, c, n) { x.translate(n.width / 2, n.height / 2); x.rotate(Math.PI / 2); x.scale(k, k); x.drawImage(c, -c.width / 2, -c.height / 2); }); }
    else rebuild(P.w, P.h, function (x, c) { x.translate(c.width, 0); x.scale(-1, 1); x.drawImage(c, 0, 0); });
  }
  function flatten() {
    commitFloat();
    var c = mk(P.w, P.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, P.w, P.h);
    P.layers.forEach(function (l) { if (l.vis) x.drawImage(l.canvas, 0, 0); });
    return c.toDataURL('image/png');
  }
  function toast(msg) { S.notify({ app: 'paint', title: msg }); }
  function doSave(name, overwrite) {
    var url = flatten();
    S.api('filesApi', { name: 'savePicture', data: { name: name, dataUrl: url, id: overwrite ? P.fileId : 0 } }).then(function (r) {
      if (r && r.ok) { P.fileId = r.data.id; P.name = r.data.name; P.dirty = false; status(); toast(T('pt_saved', 'Saved to Documents > Pictures')); }
      else toast(r && r.reason === 'too_long' ? T('pt_too_big', 'The picture is too big to save. Use a smaller canvas.') : T('pt_save_fail', 'Could not save the picture.'));
    });
  }
  function askName(cb) {
    S.showDlg({ title: T('pt_saveas', 'Save as'), html: '<input id="pt-name" class="pt-in" maxlength="60" value="' + esc((P.name || '').replace(/\.png$/i, '') || T('pt_untitled', 'Untitled')) + '">',
      buttons: [{ label: T('pt_save', 'Save'), primary: true, run: function () { var v = ($('pt-name') && $('pt-name').value || '').trim(); if (v) cb(v); } }, { label: T('pt_cancel', 'Cancel') }] });
  }
  function save(as) { if (!as && P.fileId) doSave(P.name, true); else askName(function (n) { doSave(n, false); }); }
  function newDlg() {
    S.showDlg({ title: T('pt_new', 'New'), html: '<div class="pt-nw"><label>' + esc(T('pt_width', 'Width')) + '<input id="pt-w" type="number" class="pt-in" min="16" max="' + MAXW + '" value="' + P.w + '"></label><label>' + esc(T('pt_height', 'Height')) + '<input id="pt-h" type="number" class="pt-in" min="16" max="' + MAXH + '" value="' + P.h + '"></label></div><div class="pt-hint">' + esc(T('pt_max', 'Largest size: 1920 x 1080')) + '</div>',
      buttons: [{ label: T('pt_create', 'Create'), primary: true, run: function () {
        var w = Math.max(16, Math.min(MAXW, parseInt($('pt-w').value, 10) || 1280)), h = Math.max(16, Math.min(MAXH, parseInt($('pt-h').value, 10) || 720));
        newDoc(w, h); mount(); redraw(); fitZoom();
      } }, { label: T('pt_cancel', 'Cancel') }] });
  }
  function openDlg() {
    S.api('filesApi', { name: 'picturesId', data: {} }).then(function (r) {
      if (!r || !r.ok) return toast(T('pt_open_fail', 'Could not open Pictures.'));
      S.api('filesApi', { name: 'list', data: { folder: 'docs', parent: r.data.id } }).then(function (l) {
        var files = ((l && l.ok && l.data.files) || []).filter(function (f) { return f.kind === 'image' && f.isLocal; });
        var h = files.length ? '<div class="pt-ol">' + files.map(function (f) { return '<button data-pf="' + f.id + '" data-n="' + esc(f.name) + '">' + esc(f.name) + '</button>'; }).join('') + '</div>' : '<div>' + esc(T('pt_none', 'No drawings saved yet.')) + '</div>';
        S.showDlg({ title: T('pt_open', 'Open'), html: h, buttons: [{ label: T('pt_cancel', 'Cancel') }] });
        document.querySelectorAll('#dlg-body [data-pf]').forEach(function (b) { b.addEventListener('click', function () { S.closeDlg(); loadFile(+b.dataset.pf, b.dataset.n); }); });
      });
    });
  }
  function loadFile(id, name) {
    S.api('filesApi', { name: 'getPicture', data: { id: id } }).then(function (r) {
      if (!r || !r.ok) return toast(T('pt_open_fail', 'Could not open Pictures.'));
      var im = new Image();
      im.onload = function () {
        var w = Math.min(MAXW, im.width), h = Math.min(MAXH, im.height);
        newDoc(w, h); ctx().drawImage(im, 0, 0, w, h); P.fileId = id; P.name = name; P.dirty = false; mount(); redraw(); fitZoom();
      };
      im.src = r.data.dataUrl;
    });
  }

  // ---- app
  S.registerApp({
    id: 'paint', icon: ICON, titleKey: 'app_paint', titleDef: 'Paint', w: 1120, h: 700,
    html: '<div class="pt"><div class="pt-menu" id="pt-menu"></div><div class="pt-rib" id="pt-rib"></div><div class="pt-mid"><div class="pt-scroll" id="pt-scroll"><div class="pt-stack" id="pt-stack"></div></div><div class="pt-layers" id="pt-layers"></div></div>' +
      '<div class="pt-status"><span id="pt-s-pos"></span><span id="pt-s-size"></span><span class="grow"></span><button class="pt-z" data-a="fit" title="Fit">&#9635;</button><button class="pt-z" data-a="zout">&minus;</button><input type="range" id="pt-zoom" min="10" max="400" value="100"><button class="pt-z" data-a="zin">+</button><span id="pt-s-zoom" class="zl"></span></div></div>',
    onOpen: function () { if (!P) newDoc(1280, 720); mount(); redraw(); setTimeout(fitZoom, 60); },
    onClose: function () { if (P) commitFloat(); },
    onReset: function () { P = null; },
    onLocale: function () { if (P) redraw(); }
  });

  document.addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('#pt-stack')) { e.preventDefault(); down(e); } });
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('mousedown', function (e) { if (P && P.menu && !(e.target.closest && (e.target.closest('.pt-dd') || e.target.closest('.pt-m')))) { P.menu = null; if ($('pt-menu')) menu(); } }, true);
  document.addEventListener('wheel', function (e) { if (P && e.ctrlKey && e.target.closest && e.target.closest('#pt-scroll')) { e.preventDefault(); zoomTo(P.zoom * (e.deltaY < 0 ? 1.15 : 0.87)); } }, { passive: false });
  document.addEventListener('keydown', function (e) {
    var w = $('win-paint'); if (!P || !w || !w.classList.contains('open') || /INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); } else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); } else if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(false); } else if (e.ctrlKey && e.key === 'n') { e.preventDefault(); newDlg(); } else if (e.ctrlKey && e.key === 'o') { e.preventDefault(); openDlg(); }
    else if (e.key === 'Delete' && P.sel) { if (!P.float) { snap(); ctx().clearRect(P.sel.x, P.sel.y, P.sel.w, P.sel.h); } P.float = null; P.sel = null; drawSel(); }
    else if (e.key === 'Escape') { commitFloat(); }
  });
  document.addEventListener('click', function (e) {
    var w = $('win-paint'); if (!P || !w || !w.contains(e.target)) return;
    var t = e.target.closest('[data-tool]'); if (t) { commitFloat(); P.tool = t.dataset.tool; ribbon(); return; }
    var c = e.target.closest('[data-col]'); if (c) { if (P.slot === 2) P.bg = c.dataset.col; else P.fg = c.dataset.col; ribbon(); return; }
    var a = e.target.closest('[data-a]');
    if (a) {
      var k = a.dataset.a;
      if (k === 'mfile' || k === 'mview') { P.menu = P.menu === k.slice(1) ? null : k.slice(1); menu(); return; }
      if (P.menu) { P.menu = null; menu(); }
      if (k === 'new') newDlg(); else if (k === 'open') openDlg(); else if (k === 'save') save(false); else if (k === 'saveas') save(true);
      else if (k === 'undo') undo(); else if (k === 'redo') redo();
      else if (k === 'c1' || k === 'c2') { P.slot = k === 'c2' ? 2 : 1; ribbon(); }
      else if (k === 'layers') { P.showLayers = !P.showLayers; $('pt-layers').classList.toggle('hidden', !P.showLayers); setTimeout(fitZoom, 20); }
      else if (k === 'fit') fitZoom(); else if (k === 'zin') zoomTo(P.zoom * 1.25); else if (k === 'zout') zoomTo(P.zoom / 1.25);
      else if (k === 'seldel') { if (P.sel) { if (!P.float) { snap(); ctx().clearRect(P.sel.x, P.sel.y, P.sel.w, P.sel.h); } P.float = null; P.sel = null; drawSel(); } }
      else if (k === 'rotate') transformDoc('rotate'); else if (k === 'flip') transformDoc('flip'); else if (k === 'resize') resizeDlg();
      return;
    }
    var l = e.target.closest('[data-l]');
    if (l) {
      var op = l.dataset.l; commitFloat();
      if (op === 'add' && P.layers.length < 6) { addLayer(T('pt_layer', 'Layer') + ' ' + (P.layers.length + 1)); mount(); }
      else if (op === 'del' && P.layers.length > 1) { P.layers.splice(P.li, 1); P.li = Math.max(0, P.li - 1); mount(); }
      else if (op === 'up' && P.li < P.layers.length - 1) { var i = P.li; P.layers.splice(i + 1, 0, P.layers.splice(i, 1)[0]); P.li = i + 1; mount(); }
      else if (op === 'down' && P.li > 0) { var j = P.li; P.layers.splice(j - 1, 0, P.layers.splice(j, 1)[0]); P.li = j - 1; mount(); }
      else if (op === 'vis') { var n = +l.dataset.li; P.layers[n].vis = !P.layers[n].vis; mount(); }
      if (op !== 'vis') P.undo = []; layersPanel(); return;
    }
    var row = e.target.closest('.pt-l'); if (row) { commitFloat(); P.li = +row.dataset.li; layersPanel(); }
  });
  document.addEventListener('input', function (e) {
    if (!P) return;
    if (e.target.id === 'pt-size') { P.size = +e.target.value; $('pt-sz').textContent = P.size + ' px'; paintRange(e.target); }
    else if (e.target.id === 'pt-custom') { if (P.slot === 2) P.bg = e.target.value; else P.fg = e.target.value; var sw = document.querySelectorAll('.pt-cur i'); if (sw.length) { sw[0].style.background = P.fg; sw[1].style.background = P.bg; } }
    else if (e.target.id === 'pt-zoom') { zoomTo(e.target.value / 100); }
    else if (e.target.id === 'pt-fillshape') P.fillShape = e.target.checked;
  });
})();
