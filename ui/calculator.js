/* Calculator app for Los Santos OS: standard calculator, memory and a history tape. Runs entirely in the page.
   Registers itself with LSOS.registerApp (see the end of app.js). Operators run as they are typed (2 + 3 × 4 = 20),
   like the standard Windows calculator. Numbers are rounded to 12 significant digits so 0.1 + 0.2 shows 0.3. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  function T(key, def) { return S.t(key, def); }
  function esc(s) { return S.esc(s); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#4b5563"/><rect x="6" y="5" width="12" height="4.4" rx="1" fill="#e5e7eb"/><g fill="#fff"><rect x="6" y="11" width="3" height="2.6" rx=".6"/><rect x="10.5" y="11" width="3" height="2.6" rx=".6"/><rect x="15" y="11" width="3" height="2.6" rx=".6"/><rect x="6" y="15" width="3" height="2.6" rx=".6"/><rect x="10.5" y="15" width="3" height="2.6" rx=".6"/></g><rect x="15" y="15" width="3" height="2.6" rx=".6" fill="#f59e0b"/></svg>';

  var SYM = { add: '+', sub: '−', mul: '×', div: '÷' };
  var MAXDIGITS = 16;

  var C;
  function fresh() {
    C = { cur: '0', acc: null, op: null, expr: '', fresh: true, err: null, rep: null, mem: 0, hasMem: false, hist: [], showHist: false };
  }
  fresh();

  function round(n) { return parseFloat(Number(n).toPrecision(12)); }
  function num(s) { return parseFloat(s); }
  function str(n) {
    var r = round(n);
    if (!isFinite(r)) return null;
    var s = String(r);
    if (Math.abs(r) >= 1e16 || (Math.abs(r) < 1e-9 && r !== 0)) s = r.toExponential().replace('e+', 'e');
    return s;
  }
  function group(s) {
    if (/e/.test(s)) return s;
    var neg = s.charAt(0) === '-', body = neg ? s.slice(1) : s;
    var p = body.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + p.join('.');
  }

  function calc(a, b, op) {
    if (op === 'add') return a + b;
    if (op === 'sub') return a - b;
    if (op === 'mul') return a * b;
    if (op === 'div') return b === 0 ? null : a / b;
    return b;
  }
  function setErr(key, def) { C.err = T(key, def); C.acc = null; C.op = null; C.expr = ''; C.fresh = true; C.rep = null; }
  function setResult(n) {
    var s = str(n);
    if (s === null) { setErr('cl_err_overflow', 'Overflow'); return false; }
    C.cur = s; return true;
  }

  // ------------------------------------------------------------------ actions
  function digit(d) {
    if (C.err) clearAll();
    if (C.fresh) { C.cur = d; C.fresh = false; if (C.rep && !C.op) { C.rep = null; C.expr = ''; } }
    else if (C.cur === '0') C.cur = d;
    else if (C.cur === '-0') C.cur = '-' + d;
    else if (C.cur.replace(/[-.]/g, '').length < MAXDIGITS) C.cur += d;
  }
  function dot() {
    if (C.err) clearAll();
    if (C.fresh) { C.cur = '0.'; C.fresh = false; return; }
    if (C.cur.indexOf('.') < 0) C.cur += '.';
  }
  function op(o) {
    if (C.err) return;
    if (C.op && !C.fresh) {
      var r = calc(C.acc, num(C.cur), C.op);
      if (r === null) return setErr('cl_err_div0', 'Cannot divide by zero');
      if (!setResult(r)) return;
      C.acc = num(C.cur);
    } else if (C.acc === null || !C.op) {
      C.acc = num(C.cur);
    }
    C.op = o; C.rep = null;
    C.expr = group(str(C.acc)) + ' ' + SYM[o];
    C.fresh = true;
  }
  function equals() {
    if (C.err) return;
    var a, b, o;
    if (C.op) { a = C.acc; b = num(C.cur); o = C.op; }
    else if (C.rep) { a = num(C.cur); b = C.rep.b; o = C.rep.op; }
    else return;
    var r = calc(a, b, o);
    if (r === null) return setErr('cl_err_div0', 'Cannot divide by zero');
    var line = group(str(a)) + ' ' + SYM[o] + ' ' + group(str(b)) + ' =';
    if (!setResult(r)) return;
    C.hist.unshift({ expr: line, result: C.cur });
    if (C.hist.length > 30) C.hist.pop();
    C.expr = line; C.rep = { op: o, b: b }; C.acc = null; C.op = null; C.fresh = true;
  }
  function percent() {
    if (C.err) return;
    if (C.op && C.acc !== null) { setResult(C.acc * num(C.cur) / 100); }
    else { C.cur = '0'; }
    C.fresh = false;
  }
  function unary(k) {
    if (C.err) return;
    var x = num(C.cur), r, label;
    if (k === 'neg') {
      if (C.cur === '0') return;
      C.cur = C.cur.charAt(0) === '-' ? C.cur.slice(1) : '-' + C.cur;
      return;
    }
    if (k === 'sqrt') { if (x < 0) return setErr('cl_err_invalid', 'Invalid input'); r = Math.sqrt(x); label = '√(' + group(str(x)) + ')'; }
    if (k === 'sqr') { r = x * x; label = 'sqr(' + group(str(x)) + ')'; }
    if (k === 'inv') { if (x === 0) return setErr('cl_err_div0', 'Cannot divide by zero'); r = 1 / x; label = '1/(' + group(str(x)) + ')'; }
    if (!setResult(r)) return;
    C.hist.unshift({ expr: label + ' =', result: C.cur });
    if (C.hist.length > 30) C.hist.pop();
    if (C.op) C.expr = group(str(C.acc)) + ' ' + SYM[C.op] + ' ' + label; else C.expr = label + ' =';
    C.fresh = true;
  }
  function backspace() {
    if (C.err) return clearAll();
    if (C.fresh) return;
    var s = C.cur.slice(0, -1);
    C.cur = (s === '' || s === '-') ? '0' : s;
  }
  function clearEntry() { if (C.err) return clearAll(); C.cur = '0'; C.fresh = false; }
  function clearAll() { var m = C.mem, hm = C.hasMem, h = C.hist, sh = C.showHist; fresh(); C.mem = m; C.hasMem = hm; C.hist = h; C.showHist = sh; }
  function memory(k) {
    if (C.err) return;
    if (k === 'mc') { C.mem = 0; C.hasMem = false; return; }
    if (k === 'mr') { if (C.hasMem) { setResult(C.mem); C.fresh = true; } return; }
    var x = num(C.cur);
    if (k === 'mplus') C.mem = round(C.mem + x);
    if (k === 'mminus') C.mem = round(C.mem - x);
    C.hasMem = true; C.fresh = true;
  }

  function press(k) {
    if (/^[0-9]$/.test(k)) digit(k);
    else if (k === 'dot') dot();
    else if (SYM[k]) op(k);
    else if (k === 'eq') equals();
    else if (k === 'pct') percent();
    else if (k === 'sqrt' || k === 'sqr' || k === 'inv' || k === 'neg') unary(k);
    else if (k === 'back') backspace();
    else if (k === 'ce') clearEntry();
    else if (k === 'c') clearAll();
    else if (k === 'mc' || k === 'mr' || k === 'mplus' || k === 'mminus') memory(k);
    render();
  }

  // ------------------------------------------------------------------ drawing
  var KEYS = [
    ['mc', 'MC', 'mem'], ['mr', 'MR', 'mem'], ['mplus', 'M+', 'mem'], ['mminus', 'M−', 'mem'],
    ['pct', '%', 'fn'], ['ce', 'CE', 'fn'], ['c', 'C', 'fn'], ['back', '⌫', 'fn'],
    ['inv', '¹⁄x', 'fn'], ['sqr', 'x²', 'fn'], ['sqrt', '√x', 'fn'], ['div', '÷', 'op'],
    ['7', '7', 'num'], ['8', '8', 'num'], ['9', '9', 'num'], ['mul', '×', 'op'],
    ['4', '4', 'num'], ['5', '5', 'num'], ['6', '6', 'num'], ['sub', '−', 'op'],
    ['1', '1', 'num'], ['2', '2', 'num'], ['3', '3', 'num'], ['add', '+', 'op'],
    ['neg', '±', 'num'], ['0', '0', 'num'], ['dot', '.', 'num'], ['eq', '=', 'eq']
  ];

  var HTML =
    '<div class="cl" id="cl" tabindex="0">' +
    '<div class="cl-main">' +
    '<div class="cl-top"><span class="cl-title" id="cl-title"></span><button class="cl-hbtn" id="cl-hbtn" type="button" title="History">⧖</button></div>' +
    '<div class="cl-disp"><div class="cl-mem" id="cl-mem"></div><div class="cl-expr" id="cl-expr"></div><div class="cl-cur" id="cl-cur">0</div></div>' +
    '<div class="cl-keys" id="cl-keys">' +
    KEYS.map(function (k) { return '<button type="button" class="cl-k ' + k[2] + '" data-k="' + k[0] + '">' + k[1] + '</button>'; }).join('') +
    '</div></div>' +
    '<div class="cl-side hidden" id="cl-side"><div class="cl-side-h"><b id="cl-hist-t"></b><button type="button" class="cl-link" id="cl-hclear"></button></div><div class="cl-hist" id="cl-hist"></div></div>' +
    '</div>';

  var bound = false;
  function render() {
    if (!$('cl')) return;
    var cur = C.err || group(C.cur);
    var el = $('cl-cur');
    el.textContent = cur;
    el.className = 'cl-cur' + (C.err ? ' err' : '') + (cur.length > 14 ? ' sm' : '') + (cur.length > 20 ? ' xs' : '');
    $('cl-expr').textContent = C.expr;
    $('cl-mem').textContent = C.hasMem ? 'M' : '';
    $('cl-title').textContent = T('cl_app_name', 'Calculator');
    $('cl-hist-t').textContent = T('cl_history', 'History');
    $('cl-hclear').textContent = T('cl_history_clear', 'Clear history');
    $('cl-hbtn').title = T('cl_history', 'History');
    $('cl-side').classList.toggle('hidden', !C.showHist);
    var h = $('cl-hist');
    h.innerHTML = C.hist.length ? C.hist.map(function (x, i) {
      return '<button type="button" class="cl-h" data-h="' + i + '"><span class="e">' + esc(x.expr) + '</span><span class="r">' + esc(group(x.result)) + '</span></button>';
    }).join('') : '<div class="cl-empty">' + esc(T('cl_history_empty', 'There is no history yet.')) + '</div>';
    var mr = document.querySelector('#cl [data-k=mr]'), mc = document.querySelector('#cl [data-k=mc]');
    if (mr) mr.disabled = !C.hasMem;
    if (mc) mc.disabled = !C.hasMem;
  }

  var KEYMAP = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', 'Enter': 'eq', '=': 'eq', '%': 'pct', '.': 'dot', ',': 'dot', 'Backspace': 'back', 'Delete': 'ce', 'Escape': 'c' };
  function bind() {
    if (bound || !$('cl')) return;
    bound = true;
    var root = $('cl');
    root.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]');
      if (b && !b.disabled) { press(b.dataset.k); return; }
      var h = e.target.closest('[data-h]');
      if (h) { var x = C.hist[+h.dataset.h]; if (x) { C.err = null; C.cur = x.result; C.fresh = false; C.expr = ''; render(); } return; }
      if (e.target.closest('#cl-hbtn')) { C.showHist = !C.showHist; render(); return; }
      if (e.target.closest('#cl-hclear')) { C.hist = []; render(); }
    });
    root.addEventListener('mousedown', function () { setTimeout(function () { root.focus(); }, 0); });
    root.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var k = e.key;
      var m = /^[0-9]$/.test(k) ? k : KEYMAP[k];
      if (!m) return;
      e.preventDefault();
      press(m);
    });
  }

  var root = S.registerApp({
    id: 'calculator', icon: ICON_APP, titleKey: 'cl_app_name', titleDef: 'Calculator', w: 380, h: 640, html: HTML,
    onOpen: function () { bind(); render(); var r = $('cl'); if (r) r.focus(); },
    onReset: function () { fresh(); render(); },
    onLocale: function () { render(); }
  });
  if (root) bind();
})();
