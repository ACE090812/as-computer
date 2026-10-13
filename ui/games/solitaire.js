/* Solitaire (Los Santos OS games): Klondike with Windows-style scoring. Drag cards, double-click to send one to a foundation, click the
   stock to deal. "Difficulty" is how many cards the stock deals (1 or 3). Undo costs 2 points. A win adds a time bonus. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var CW = 76, CH = 104, GX = 86, TOP = 12, TY = 138, DOWN = 14, UP = 26;
  var SU = ['♠', '♥', '♦', '♣'];
  var RK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#1f6f4a"/><rect x="6" y="5" width="9" height="13" rx="1.6" fill="#fff"/><path d="M10.5 8.4l2 2.2-2 2.2-2-2.2z" fill="#c62828"/><rect x="10" y="7" width="9" height="13" rx="1.6" fill="#f4f4f4" opacity=".9"/><path d="M14.5 10.6l1.5 1.6-1.5 1.6-1.5-1.6z" fill="#1b1b1f"/></svg>';
  function red(c) { return c.s === 1 || c.s === 2; }

  window.LSGames.register({
    id: 'solitaire', name: 'Solitaire', tint: '#1f6f4a', icon: ICON, w: 940, h: 660,
    boxes: [{ key: 'score', label: 'Score' }, { key: 'time', label: 'Time' }, { key: 'moves', label: 'Moves' }],
    levels: ['Draw 1', 'Draw 3'], defaultLevel: 0, levelLabel: 'Cards dealt from the stock', pausable: true, canSave: true,
    hint: 'Drag cards. Double-click sends a card home.',

    create: function (g) {
      var el = window.LSGames.el;
      g.main.style.width = (7 * GX + 20) + 'px'; g.main.style.height = '100%';
      var felt = el('div', ''); felt.style.cssText = 'position:relative;width:100%;flex:1;min-height:560px;border-radius:12px;background:radial-gradient(ellipse at 50% 30%,#2a8458,#1a5f3e);overflow:hidden;user-select:none';
      g.main.appendChild(felt);
      var cvs = el('canvas', ''); cvs.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:50'; felt.appendChild(cvs);

      var G = null, nodes = {}, undoStack = [], t0 = 0, tick = 0, best = 0, won = false, anim = 0;
      var pos = {};   // pile slot positions
      function slotX(i) { return 12 + i * GX; }
      var slots = [];
      function slot(kind, i, x, y) { var d = el('div', ''); d.style.cssText = 'position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + CW + 'px;height:' + CH + 'px;border-radius:8px;border:2px solid rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.35);font-size:30px'; felt.insertBefore(d, cvs); slots.push({ kind: kind, i: i, x: x, y: y, el: d }); return d; }
      var stockEl = slot('stock', 0, slotX(0), TOP); stockEl.style.cursor = 'pointer'; stockEl.textContent = '↺';
      slot('waste', 0, slotX(1), TOP);
      for (var f = 0; f < 4; f++) slot('found', f, slotX(3 + f), TOP).textContent = '';
      for (var t = 0; t < 7; t++) { var tp = slot('tab', t, slotX(t), TY); tp.style.border = '2px solid rgba(255,255,255,.12)'; }

      function deck() { var d = [], id = 0; for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) d.push({ id: id++, s: s, r: r, up: false }); for (var i = d.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), x = d[i]; d[i] = d[j]; d[j] = x; } return d; }
      function fresh() {
        var d = deck(), tab = [[], [], [], [], [], [], []];
        for (var i = 0; i < 7; i++) for (var j = 0; j <= i; j++) { var c = d.pop(); c.up = j === i; tab[i].push(c); }
        return { stock: d, waste: [], found: [[], [], [], []], tab: tab, score: 0, moves: 0, passes: 0 };
      }
      function snap() { return JSON.stringify({ stock: G.stock, waste: G.waste, found: G.found, tab: G.tab, score: G.score, moves: G.moves, passes: G.passes }); }
      function push() { undoStack.push(snap()); if (undoStack.length > 150) undoStack.shift(); }
      function allCards() { var a = G.stock.concat(G.waste); G.found.forEach(function (p) { a = a.concat(p); }); G.tab.forEach(function (p) { a = a.concat(p); }); return a; }

      // ---- cards as DOM nodes ----
      function node(c) {
        var n = nodes[c.id]; if (n) return n;
        n = el('div', ''); n.dataset.id = c.id;
        n.style.cssText = 'position:absolute;width:' + CW + 'px;height:' + CH + 'px;box-sizing:border-box;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:left .12s,top .12s;cursor:grab';
        felt.insertBefore(n, cvs); nodes[c.id] = n; return n;
      }
      function paintCard(c, x, y, z) {
        var n = node(c); n.style.left = x + 'px'; n.style.top = y + 'px'; n.style.zIndex = z;
        if (c.up) { n.style.background = '#fff'; n.style.border = '1px solid #cfd3da'; n.style.color = red(c) ? '#c62828' : '#1b1b1f';
          n.innerHTML = '<div style="position:absolute;left:6px;top:4px;font-weight:700;font-size:15px;line-height:1.05">' + RK[c.r] + '<br><span style="font-size:14px">' + SU[c.s] + '</span></div><div style="position:absolute;right:7px;bottom:5px;font-size:30px;line-height:1">' + SU[c.s] + '</div>'; }
        else { n.style.background = 'repeating-linear-gradient(45deg,#2b4f9c,#2b4f9c 6px,#335fb8 6px,#335fb8 12px)'; n.style.border = '3px solid #fff'; n.innerHTML = ''; n.style.color = '#fff'; }
      }
      function layout() {
        var z = 1;
        G.stock.forEach(function (c) { c.up = false; paintCard(c, slotX(0), TOP, z++); });
        var wn = G.waste.length, show = g.level === 1 ? Math.min(3, wn) : Math.min(1, wn);
        G.waste.forEach(function (c, i) { c.up = true; var k = i - (wn - show); paintCard(c, slotX(1) + (k > 0 ? k * 18 : 0), TOP, z++); if (k < 0) nodes[c.id].style.left = slotX(1) + 'px'; });
        G.found.forEach(function (p, k) { p.forEach(function (c) { c.up = true; paintCard(c, slotX(3 + k), TOP, z++); }); });
        G.tab.forEach(function (p, i) { var y = TY; p.forEach(function (c) { paintCard(c, slotX(i), y, z++); y += c.up ? UP : DOWN; }); });
        g.setBox('score', Math.max(0, G.score)); g.setBox('moves', G.moves);
        slots[0].el.style.opacity = G.stock.length ? 0 : 1;
      }
      function timeText(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
      function elapsed() { return G.elapsed + (t0 && !g.paused ? (Date.now() - t0) / 1000 : 0); }

      // ---- rules ----
      function canTab(c, pile) { var top = pile[pile.length - 1]; if (!top) return c.r === 13; return top.up && top.r === c.r + 1 && red(top) !== red(c); }
      function canFound(c, pile) { var top = pile[pile.length - 1]; if (!top) return c.r === 1; return top.s === c.s && c.r === top.r + 1; }
      function findCard(id) {
        var i, k;
        for (k = 0; k < G.stock.length; k++) if (G.stock[k].id === id) return { where: 'stock', idx: k };
        for (k = 0; k < G.waste.length; k++) if (G.waste[k].id === id) return { where: 'waste', idx: k };
        for (i = 0; i < 4; i++) for (k = 0; k < G.found[i].length; k++) if (G.found[i][k].id === id) return { where: 'found', pile: i, idx: k };
        for (i = 0; i < 7; i++) for (k = 0; k < G.tab[i].length; k++) if (G.tab[i][k].id === id) return { where: 'tab', pile: i, idx: k };
        return null;
      }
      function flipTop(i) { var p = G.tab[i], top = p[p.length - 1]; if (top && !top.up) { top.up = true; G.score += 5; } }
      function take(loc) {
        if (loc.where === 'waste') return [G.waste.pop()];
        if (loc.where === 'found') return [G.found[loc.pile].pop()];
        return G.tab[loc.pile].splice(loc.idx);
      }
      function moveTo(loc, target) {   // target: { kind: 'tab'|'found', i }
        var cards = loc.where === 'tab' ? G.tab[loc.pile].slice(loc.idx) : [loc.where === 'waste' ? G.waste[G.waste.length - 1] : G.found[loc.pile][G.found[loc.pile].length - 1]];
        if (!cards.length || !cards[0].up) return false;
        if (loc.where !== 'tab' && cards.length !== 1) return false;
        if (target.kind === 'found') { if (cards.length !== 1 || !canFound(cards[0], G.found[target.i])) return false; }
        else if (!canTab(cards[0], G.tab[target.i])) return false;
        if (loc.where === 'tab' && target.kind === 'tab' && loc.pile === target.i) return false;
        push(); var moved = take(loc);
        if (target.kind === 'found') { G.found[target.i].push(moved[0]); G.score += loc.where === 'found' ? 0 : 10; }
        else { moved.forEach(function (c) { G.tab[target.i].push(c); }); if (loc.where === 'waste') G.score += 5; if (loc.where === 'found') G.score -= 15; }
        if (loc.where === 'tab') flipTop(loc.pile);
        G.moves++; g.sound('place'); afterMove(); return true;
      }
      function drawStock() {
        push();
        if (!G.stock.length) {
          if (!G.waste.length) { undoStack.pop(); return; }
          G.stock = G.waste.reverse(); G.waste = []; G.passes++; if (g.level === 0) G.score -= 100; else if (G.passes > 3) G.score -= 20;
        } else { var n = g.level === 1 ? 3 : 1; for (var i = 0; i < n && G.stock.length; i++) G.waste.push(G.stock.pop()); }
        G.moves++; g.sound('flip'); afterMove();
      }
      function autoHome(c) {   // double-click: send to a foundation if it fits
        var loc = findCard(c.id); if (!loc || !c.up) return false;
        if (loc.where === 'tab' && loc.idx !== G.tab[loc.pile].length - 1) return false;
        if (loc.where === 'waste' && loc.idx !== G.waste.length - 1) return false;
        if (loc.where === 'found') return false;
        for (var i = 0; i < 4; i++) if (moveTo(loc, { kind: 'found', i: i })) return true;
        return false;
      }
      function afterMove() { layout(); persist(); if (G.found.every(function (p) { return p.length === 13; })) win(); else checkAuto(); }
      function checkAuto() {
        var ok = !G.stock.length && !G.waste.length && G.tab.every(function (p) { return p.every(function (c) { return c.up; }); });
        g.banner(ok ? 'All cards are face up.<div class="gm-row"><button class="gm-btn pri" data-act="auto">Finish for me</button></div>' : '');
        var b = g.side.querySelector('[data-act="auto"]'); if (b) b.addEventListener('click', autoFinish);
      }
      function autoFinish() {
        g.banner('');
        (function step() {
          if (won || !G) return; var moved = false;
          for (var i = 0; i < 7 && !moved; i++) { var p = G.tab[i], c = p[p.length - 1]; if (c) moved = autoHome(c); }
          if (moved) setTimeout(step, 90);
        })();
      }

      // ---- win ----
      function win() {
        if (won) return; won = true; var secs = Math.max(1, Math.round(elapsed())); t0 = 0; clearInterval(tick);
        var bonus = secs > 30 ? Math.floor(700000 / secs) : 0; var total = Math.max(0, G.score) + Math.min(bonus, 19000 - Math.max(0, G.score));
        cascade(function () { g.finish({ score: total, result: 1, seconds: secs, title: 'You won!', line: 'Time bonus +' + Math.min(bonus, 19000) + ' - ' + G.moves + ' moves - ' + timeText(secs) }); });
      }
      function cascade(done) {
        cvs.width = felt.clientWidth; cvs.height = felt.clientHeight; var c2 = cvs.getContext('2d'), parts = [], ps = [];
        G.found.forEach(function (p, k) { for (var i = p.length - 1; i >= 0; i--) ps.push({ c: p[i], x: slotX(3 + k), y: TOP, d: (13 - i) * 140 + k * 60 }); });
        var start = performance.now(); g.sound('win');
        (function frame(now) {
          var t = now - start; anim = requestAnimationFrame(frame);
          ps.forEach(function (q) { if (!q.on && t > q.d) { q.on = true; q.vx = -(2 + Math.random() * 4) * (Math.random() < .3 ? -1 : 1); q.vy = -2 - Math.random() * 3; parts.push(q); } });
          parts.forEach(function (q) {
            q.vy += 0.35; q.x += q.vx; q.y += q.vy; if (q.y > cvs.height - CH) { q.y = cvs.height - CH; q.vy *= -0.82; }
            c2.fillStyle = '#fff'; c2.strokeStyle = '#cfd3da'; c2.fillRect(q.x, q.y, CW, CH); c2.strokeRect(q.x + .5, q.y + .5, CW - 1, CH - 1);
            c2.fillStyle = red(q.c) ? '#c62828' : '#1b1b1f'; c2.font = 'bold 18px sans-serif'; c2.fillText(RK[q.c.r] + SU[q.c.s], q.x + 6, q.y + 20);
          });
          if (t > 3800) { cancelAnimationFrame(anim); c2.clearRect(0, 0, cvs.width, cvs.height); done(); }
        })(start);
      }

      // ---- score over time, saves ----
      function persist() { if (G && !won) g.save({ stock: G.stock, waste: G.waste, found: G.found, tab: G.tab, score: G.score, moves: G.moves, passes: G.passes, elapsed: elapsed(), lv: g.level }); }
      function startClock() {
        clearInterval(tick); if (!t0) t0 = Date.now();
        tick = setInterval(function () {
          if (!G || won) return; if (g.paused) return;
          var e = Math.floor(elapsed()); g.setBox('time', timeText(e));
          var pen = Math.floor(e / 10) * 2; if (pen > (G.penalised || 0)) { G.score -= pen - (G.penalised || 0); G.penalised = pen; g.setBox('score', Math.max(0, G.score)); }
        }, 500);
      }
      function newGame() {
        won = false; cancelAnimationFrame(anim); var c2 = cvs.getContext('2d'); c2.clearRect(0, 0, cvs.width, cvs.height);
        Object.keys(nodes).forEach(function (k) { nodes[k].remove(); }); nodes = {};
        G = fresh(); G.elapsed = 0; G.penalised = 0; undoStack = []; g.paused = false; if (g.pauseBtn) g.pauseBtn.textContent = 'Pause'; t0 = 0;
        layout(); g.setBox('time', '0:00'); g.banner(''); startClock(); g.pauseGate = false;
      }
      function applyState(s) {
        won = false; Object.keys(nodes).forEach(function (k) { nodes[k].remove(); }); nodes = {};
        G = { stock: s.stock, waste: s.waste, found: s.found, tab: s.tab, score: s.score, moves: s.moves, passes: s.passes, elapsed: s.elapsed, penalised: Math.floor(s.elapsed / 10) * 2 };
        undoStack = []; t0 = 0; layout(); g.setBox('time', timeText(s.elapsed));
      }
      g.def.newGame = function () { g.clearSave(); newGame(); };
      g.def.onLevel = function (gg, i, silent) { if (!silent) { g.clearSave(); newGame(); } else if (G) layout(); };
      g.def.pause = function (gg, on) {
        if (on) { if (t0) { G.elapsed += (Date.now() - t0) / 1000; t0 = 0; } persist(); felt.style.visibility = 'hidden'; }
        else { t0 = Date.now(); felt.style.visibility = 'visible'; }
      };
      g.def.onClose = function () { if (G && !won) { g.setPaused(true); persist(); } };
      g.def.resume = function (gg, s) { if (typeof s.lv === 'number') { g.level = s.lv; g.drawLevels(); } applyState(s); t0 = 0; G.elapsed = s.elapsed; g.paused = true; if (g.pauseBtn) g.pauseBtn.textContent = 'Resume'; felt.style.visibility = 'hidden'; startClock(); };
      var ub = el('button', 'gm-btn', 'Undo (-2)'); ub.dataset.act = 'undo-x';
      ub.addEventListener('click', function () { if (!undoStack.length || won || g.paused) return; var s = JSON.parse(undoStack.pop()); var e = G.elapsed, pn = G.penalised; G.stock = s.stock; G.waste = s.waste; G.found = s.found; G.tab = s.tab; G.score = s.score - 2; G.moves = s.moves; G.passes = s.passes; G.elapsed = e; G.penalised = pn; Object.keys(nodes).forEach(function (k) { nodes[k].remove(); }); nodes = {}; g.sound('click'); layout(); persist(); });
      g.side.querySelector('[data-buttons]').appendChild(ub);

      // ---- dragging ----
      var drag = null;
      felt.addEventListener('mousedown', function (e) {
        if (won || g.paused || e.button !== 0) return;
        if (e.target === stockEl || (e.target.closest && e.target.closest('div') === stockEl)) { drawStock(); return; }
        var cn = e.target.closest ? e.target.closest('[data-id]') : null; if (!cn) return;
        var id = Number(cn.dataset.id), loc = findCard(id); if (!loc) return;
        var c = allCards().filter(function (x) { return x.id === id; })[0];
        if (!c.up) { if (loc.where === 'stock') drawStock(); return; }
        if (loc.where === 'waste' && loc.idx !== G.waste.length - 1) return;
        if (loc.where === 'found' && loc.idx !== G.found[loc.pile].length - 1) return;
        var group = loc.where === 'tab' ? G.tab[loc.pile].slice(loc.idx) : [c];
        var rect = felt.getBoundingClientRect();
        drag = { loc: loc, group: group, ox: e.clientX - rect.left - parseFloat(cn.style.left), oy: e.clientY - rect.top - parseFloat(cn.style.top), moved: false, sx: e.clientX, sy: e.clientY };
        group.forEach(function (x) { var n = nodes[x.id]; n.style.transition = 'none'; n.style.zIndex = 900 + group.indexOf(x); });
        e.preventDefault();
      });
      window.addEventListener('mousemove', function (e) {
        if (!drag) return; var rect = felt.getBoundingClientRect();
        if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
        if (!drag.moved) return;
        drag.group.forEach(function (x, i) { var n = nodes[x.id]; n.style.left = (e.clientX - rect.left - drag.ox) + 'px'; n.style.top = (e.clientY - rect.top - drag.oy + i * UP) + 'px'; });
      });
      window.addEventListener('mouseup', function (e) {
        if (!drag) return; var d = drag; drag = null;
        d.group.forEach(function (x) { nodes[x.id].style.transition = 'left .12s,top .12s'; });
        if (!d.moved) { layout(); return; }
        var rect = felt.getBoundingClientRect(), px = e.clientX - rect.left - d.ox + CW / 2, py = e.clientY - rect.top - d.oy + CH / 2, best = null, bd = 1e9;
        slots.forEach(function (s) { if (s.kind === 'stock' || s.kind === 'waste') return; var cx = s.x + CW / 2, cy = s.kind === 'tab' ? Math.max(s.y + CH / 2, s.y + (G.tab[s.i].length ? (G.tab[s.i].length - 1) * UP : 0) + CH / 2) : s.y + CH / 2; var dist = Math.hypot(px - cx, py - cy); if (dist < bd && dist < 90) { bd = dist; best = s; } });
        if (!(best && moveTo(d.loc, { kind: best.kind, i: best.i }))) layout();
      });
      felt.addEventListener('dblclick', function (e) {
        if (won || g.paused) return; var cn = e.target.closest ? e.target.closest('[data-id]') : null; if (!cn) return;
        var id = Number(cn.dataset.id), c = allCards().filter(function (x) { return x.id === id; })[0]; if (c && autoHome(c)) { /* moved */ }
      });
      window.LSGames.api('stats').then(function (r) { if (r.ok && r.data.games && r.data.games.solitaire) best = r.data.games.solitaire.best || 0; });
      newGame();
    }
  });
})();
