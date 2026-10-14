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
  var P = null;   // the open document, null until the app is opened

  function newDoc(w, h) {
    P = { w: w, h: h, layers: [], li: 0, undo: [], redo: [], zoom: 1, tool: 'pencil', fg: '#000000', bg: '#ffffff', size: 4, fillShape: false, name: '', fileId: 0, dirty: false, sel: null, float: null };
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
  function zoomTo(z) { P.zoom = Math.max(0.1, Math.min(8, z)); var wrap = $('pt-stack'); wrap.style.width = P.w * P.zoom + 'px'; wrap.style.height = P.h * P.zoom + 'px'; wrap.querySelectorAll('canvas').forEach(function (c) { c.style.width = P.w * P.zoom + 'px'; c.style.height = P.h * P.zoom + 'px'; }); status(); }
  function status(pos) {
    var s = $('pt-status'); if (!s) return;
    s.innerHTML = '<span>' + (pos ? pos.x + ', ' + pos.y + ' px' : '') + '</span><span>' + P.w + ' x ' + P.h + ' px</span><span>' + (P.name ? esc(P.name) : esc(T('pt_untitled', 'Untitled'))) + (P.dirty ? ' *' : '') + '</span><span class="grow"></span><span>' + Math.round(P.zoom * 100) + '%</span>';
  }
  function ribbon() {
    var tools = TOOLS.map(function (t) { return '<button class="pt-t' + (P.tool === t[0] ? ' on' : '') + '" data-tool="' + t[0] + '" title="' + esc(T(t[1], t[2])) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + TICON[t[0]] + '</svg></button>'; }).join('');
    var pal = PAL.map(function (c) { return '<button class="pt-c" data-col="' + c + '" style="background:' + c + '"></button>'; }).join('');
    $('pt-rib').innerHTML =
      '<div class="pt-g"><button class="pt-b" data-a="new">' + esc(T('pt_new', 'New')) + '</button><button class="pt-b" data-a="open">' + esc(T('pt_open', 'Open')) + '</button><button class="pt-b pri" data-a="save">' + esc(T('pt_save', 'Save')) + '</button><button class="pt-b" data-a="saveas">' + esc(T('pt_saveas', 'Save as')) + '</button></div>' +
      '<div class="pt-g"><button class="pt-b" data-a="undo">' + esc(T('pt_undo', 'Undo')) + '</button><button class="pt-b" data-a="redo">' + esc(T('pt_redo', 'Redo')) + '</button></div>' +
      '<div class="pt-g tools">' + tools + '</div>' +
      '<div class="pt-g sz"><label>' + esc(T('pt_size', 'Size')) + ' <span id="pt-sz">' + P.size + '</span></label><input type="range" id="pt-size" min="1" max="60" value="' + P.size + '"><label class="chk"><input type="checkbox" id="pt-fillshape"' + (P.fillShape ? ' checked' : '') + '> ' + esc(T('pt_fillshape', 'Fill shapes')) + '</label></div>' +
      '<div class="pt-g col"><button class="pt-cur" data-a="swap" title="' + esc(T('pt_swap', 'Swap colours')) + '"><i class="bgc" style="background:' + P.bg + '"></i><i class="fgc" style="background:' + P.fg + '"></i></button><div class="pt-pal">' + pal + '</div><input type="color" id="pt-custom" value="' + P.fg + '" title="' + esc(T('pt_custom', 'Custom colour')) + '"></div>';
    var r = $('pt-size'); if (r) paintRange(r);
  }
  function paintRange(r) { r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  function layersPanel() {
    var h = '<div class="pt-lh"><b>' + esc(T('pt_layers', 'Layers')) + '</b><span class="grow"></span><button data-l="add" title="' + esc(T('pt_layer_add', 'Add layer')) + '">+</button><button data-l="del" title="' + esc(T('pt_layer_del', 'Delete layer')) + '">&minus;</button><button data-l="up" title="' + esc(T('pt_layer_up', 'Move up')) + '">&uarr;</button><button data-l="down" title="' + esc(T('pt_layer_down', 'Move down')) + '">&darr;</button></div>';
    for (var i = P.layers.length - 1; i >= 0; i--) h += '<div class="pt-l' + (i === P.li ? ' on' : '') + '" data-li="' + i + '"><button class="eye" data-l="vis" data-li="' + i + '">' + (P.layers[i].vis ? '&#9679;' : '&#9675;') + '</button><span>' + esc(P.layers[i].name) + '</span></div>';
    $('pt-layers').innerHTML = h;
  }
  function redraw() { ribbon(); layersPanel(); status(); }

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
    html: '<div class="pt"><div class="pt-rib" id="pt-rib"></div><div class="pt-mid"><div class="pt-scroll" id="pt-scroll"><div class="pt-stack" id="pt-stack"></div></div><div class="pt-layers" id="pt-layers"></div></div><div class="pt-status" id="pt-status"></div></div>',
    onOpen: function () { if (!P) newDoc(1280, 720); mount(); redraw(); setTimeout(fitZoom, 60); },
    onClose: function () { if (P) commitFloat(); },
    onReset: function () { P = null; },
    onLocale: function () { if (P) redraw(); }
  });

  document.addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('#pt-stack')) { e.preventDefault(); down(e); } });
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
  document.addEventListener('wheel', function (e) { if (P && e.ctrlKey && e.target.closest && e.target.closest('#pt-scroll')) { e.preventDefault(); zoomTo(P.zoom * (e.deltaY < 0 ? 1.15 : 0.87)); } }, { passive: false });
  document.addEventListener('keydown', function (e) {
    var w = $('win-paint'); if (!P || !w || !w.classList.contains('open') || /INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) return;
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); } else if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); } else if (e.ctrlKey && e.key === 's') { e.preventDefault(); save(false); }
    else if (e.key === 'Delete' && P.sel) { if (!P.float) { snap(); ctx().clearRect(P.sel.x, P.sel.y, P.sel.w, P.sel.h); } P.float = null; P.sel = null; drawSel(); }
    else if (e.key === 'Escape') { commitFloat(); }
  });
  document.addEventListener('click', function (e) {
    var w = $('win-paint'); if (!P || !w || !w.contains(e.target)) return;
    var t = e.target.closest('[data-tool]'); if (t) { commitFloat(); P.tool = t.dataset.tool; ribbon(); return; }
    var c = e.target.closest('[data-col]'); if (c) { P.fg = c.dataset.col; ribbon(); return; }
    var a = e.target.closest('[data-a]');
    if (a) {
      var k = a.dataset.a;
      if (k === 'new') newDlg(); else if (k === 'open') openDlg(); else if (k === 'save') save(false); else if (k === 'saveas') save(true);
      else if (k === 'undo') undo(); else if (k === 'redo') redo(); else if (k === 'swap') { var x = P.fg; P.fg = P.bg; P.bg = x; ribbon(); }
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
    if (e.target.id === 'pt-size') { P.size = +e.target.value; $('pt-sz').textContent = P.size; paintRange(e.target); }
    else if (e.target.id === 'pt-custom') { P.fg = e.target.value; var cur = document.querySelector('.pt-cur .fgc'); if (cur) cur.style.background = P.fg; }
    else if (e.target.id === 'pt-fillshape') P.fillShape = e.target.checked;
  });
})();
