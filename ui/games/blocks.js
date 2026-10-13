/* Blocks (Los Santos OS games): a falling-block puzzle. Hold (C), next-piece preview, ghost piece, line-clear scoring and levels.
   Controls: arrows or A/D move, Down/S soft drop, Space hard drop, Up/X rotate right, Z rotate left, C hold, P pause. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var COLS = 10, ROWS = 20, S = 22, BX = 100, BW = COLS * S + 4, BH = ROWS * S + 4, CW = 100 + BW + 106, CH = BH;
  var BASE = [800, 550, 340];     // ms per row at level 0: Easy, Normal, Hard
  var COLORS = { I: '#06b6d4', O: '#f59e0b', T: '#a855f7', S: '#22c55e', Z: '#ef4444', J: '#3b82f6', L: '#f97316' };
  var SHAPES = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]]
  };
  var NAMES = Object.keys(SHAPES);
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#3b6fd6"/><rect x="6" y="6" width="5" height="5" rx="1" fill="#fff"/><rect x="11" y="6" width="5" height="5" rx="1" fill="#ffd34d"/><rect x="11" y="11" width="5" height="5" rx="1" fill="#fff"/><rect x="6" y="11" width="5" height="5" rx="1" fill="#7be0a0"/></svg>';

  function rotate(cells, size, dir) {   // rotate in an n x n box
    return cells.map(function (c) { return dir > 0 ? [size - 1 - c[1], c[0]] : [c[1], size - 1 - c[0]]; });
  }
  function boxOf(t) { return t === 'I' ? 4 : t === 'O' ? 4 : 3; }

  window.LSGames.register({
    id: 'blocks', name: 'Blocks', tint: '#3b6fd6', icon: ICON, w: 760, h: 560,
    boxes: [{ key: 'score', label: 'Score' }, { key: 'lines', label: 'Lines' }, { key: 'level', label: 'Level' }],
    levels: ['Easy', 'Normal', 'Hard'], defaultLevel: 1, levelLabel: 'Difficulty (start speed)', pausable: true, canSave: true,
    hint: 'C hold, Space drop',

    create: function (g) {
      var cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; cv.style.cssText = 'max-width:100%'; g.main.appendChild(cv);
      var ctx = cv.getContext('2d'), G = null, raf = 0, best = 0, last = 0;

      function bag() { var a = NAMES.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
      function fresh() {
        var G0 = { grid: [], queue: bag().concat(bag()), hold: null, canHold: true, cur: null, score: 0, lines: 0, level: 0, elapsed: 0, acc: 0, lock: 0, over: false, started: false, flash: [] };
        for (var r = 0; r < ROWS; r++) G0.grid.push(Array(COLS).fill(''));
        return G0;
      }
      function nextType() { if (G.queue.length < 8) G.queue = G.queue.concat(bag()); return G.queue.shift(); }
      function spawn(t) {
        t = t || nextType();
        var box = boxOf(t); var cells = SHAPES[t].map(function (c) { return c.slice(); });
        G.cur = { t: t, cells: cells, size: box, x: Math.floor((COLS - 4) / 2), y: t === 'I' ? -1 : 0 };
        G.canHold = true; G.lock = 0;
        if (collide(G.cur.cells, G.cur.x, G.cur.y)) { gameOver(); }
      }
      function collide(cells, x, y) {
        for (var i = 0; i < cells.length; i++) {
          var cx = cells[i][0] + x, cy = cells[i][1] + y;
          if (cx < 0 || cx >= COLS || cy >= ROWS) return true;
          if (cy >= 0 && G.grid[cy][cx]) return true;
        }
        return false;
      }
      function tryMove(dx, dy) { if (!collide(G.cur.cells, G.cur.x + dx, G.cur.y + dy)) { G.cur.x += dx; G.cur.y += dy; G.lock = 0; return true; } return false; }
      function tryRotate(dir) {
        var t = G.cur.t; if (t === 'O') return;
        var size = G.cur.size === 4 && t === 'I' ? 4 : 3;
        var rc = rotate(G.cur.cells, size, dir);
        var kicks = [0, -1, 1, -2, 2];
        for (var i = 0; i < kicks.length; i++) { if (!collide(rc, G.cur.x + kicks[i], G.cur.y)) { G.cur.cells = rc; G.cur.x += kicks[i]; G.lock = 0; g.sound('rotate'); return; } }
      }
      function ghostY() { var y = G.cur.y; while (!collide(G.cur.cells, G.cur.x, y + 1)) y++; return y; }
      function lockPiece() {
        var cells = G.cur.cells, lost = true;
        cells.forEach(function (c) { var cy = c[1] + G.cur.y, cx = c[0] + G.cur.x; if (cy >= 0) { G.grid[cy][cx] = G.cur.t; lost = false; } });
        var full = [];
        for (var r = 0; r < ROWS; r++) if (G.grid[r].every(Boolean)) full.push(r);
        if (full.length) {
          full.forEach(function (r) { G.grid.splice(r, 1); G.grid.unshift(Array(COLS).fill('')); });
          var pts = [0, 100, 300, 500, 800][full.length]; G.score += pts * (G.level + 1); G.lines += full.length;
          var nl = Math.floor(G.lines / 10); if (nl > G.level) { G.level = nl; g.sound('bonus'); }
          g.sound('clear'); G.flash = full; setTimeout(function () { if (G) G.flash = []; }, 120);
        } else g.sound('drop');
        updateBoxes();
        if (lost) return gameOver();
        spawn();
      }
      function updateBoxes() {
        g.setBox('score', G.score.toLocaleString('en-GB')); g.setBox('lines', G.lines); g.setBox('level', G.level + 1);
        if (G.score > best) best = G.score;
      }
      function hold() {
        if (!G.canHold) return; g.sound('click');
        var t = G.cur.t; var swap = G.hold; G.hold = t;
        if (swap) spawn(swap); else spawn();
        G.canHold = false;
      }
      function gameOver() {
        if (G.over) return; G.over = true; cancelAnimationFrame(raf); draw();
        g.finish({ score: G.score, seconds: Math.max(1, Math.round(G.elapsed)), line: 'Lines ' + G.lines + ' - Level ' + (G.level + 1) });
      }
      function interval() { return Math.max(60, BASE[g.level] * Math.pow(0.86, G.level)); }

      // ---- drawing ----
      function cell(x, y, color, a, size) {
        size = size || S; ctx.globalAlpha = a == null ? 1 : a; ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(x + 1, y + 1, size - 2, 3); ctx.globalAlpha = 1;
      }
      function mini(x0, y0, t, size) {
        var cells = SHAPES[t], minX = 9, maxX = 0; cells.forEach(function (c) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); });
        var w = (maxX - minX + 1) * size; cells.forEach(function (c) { cell(x0 + (c[0] - minX) * size + (80 - w) / 2, y0 + c[1] * size, COLORS[t], 1, size); });
      }
      function panel(x, y, w, h, label) { ctx.fillStyle = 'rgba(128,128,128,.12)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(128,128,128,.35)'; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); ctx.fillStyle = '#888'; ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(label, x + 8, y + 16); }
      function draw() {
        ctx.clearRect(0, 0, CW, CH);
        panel(0, 0, 90, 84, 'Hold'); if (G.hold) mini(5, 30, G.hold, 14);
        panel(BX + BW + 12, 0, 94, 190, 'Next'); for (var n = 0; n < 3; n++) mini(BX + BW + 17, 28 + n * 52, G.queue[n], 14);
        ctx.fillStyle = '#0d1424'; ctx.fillRect(BX, 0, BW, BH); ctx.strokeStyle = '#25324f'; ctx.lineWidth = 2; ctx.strokeRect(BX + 1, 1, BW - 2, BH - 2);
        ctx.strokeStyle = '#18223a'; ctx.lineWidth = 1; ctx.beginPath();
        for (var i = 1; i < COLS; i++) { ctx.moveTo(BX + 2 + i * S + .5, 2); ctx.lineTo(BX + 2 + i * S + .5, BH - 2); }
        for (var j = 1; j < ROWS; j++) { ctx.moveTo(BX + 2, 2 + j * S + .5); ctx.lineTo(BX + BW - 2, 2 + j * S + .5); }
        ctx.stroke();
        for (var r = 0; r < ROWS; r++) for (var c = 0; c < COLS; c++) if (G.grid[r][c]) cell(BX + 2 + c * S, 2 + r * S, COLORS[G.grid[r][c]]);
        if (G.cur && !G.over) {
          var gy = ghostY();
          G.cur.cells.forEach(function (p) { var cy = p[1] + gy; if (cy >= 0) { ctx.strokeStyle = COLORS[G.cur.t]; ctx.globalAlpha = .55; ctx.setLineDash([4, 3]); ctx.strokeRect(BX + 2 + (p[0] + G.cur.x) * S + 2, 2 + cy * S + 2, S - 4, S - 4); ctx.setLineDash([]); ctx.globalAlpha = 1; } });
          G.cur.cells.forEach(function (p) { var cy = p[1] + G.cur.y; if (cy >= 0) cell(BX + 2 + (p[0] + G.cur.x) * S, 2 + cy * S, COLORS[G.cur.t]); });
        }
        if (!G.started && !G.over) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(BX, BH / 2 - 30, BW, 60); ctx.fillStyle = '#e8eefc'; ctx.font = '600 15px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Press any arrow to start', BX + BW / 2, BH / 2 + 5); }
        if (g.paused && G.started && !G.over && !g.over.classList.contains('open')) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(BX, 0, BW, BH); ctx.fillStyle = '#fff'; ctx.font = '600 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Paused', BX + BW / 2, BH / 2); }
      }

      // ---- loop ----
      var saveAt = 0;
      function loop(now) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min(100, now - last); last = now;
        if (!G || G.over) return;
        if (G.started && !g.paused) {
          G.elapsed += dt / 1000; G.acc += dt;
          var iv = interval();
          while (G.acc >= iv && !G.over) {
            G.acc -= iv;
            if (!tryMove(0, 1)) { G.lock += iv; if (G.lock >= 450) { lockPiece(); } } else G.lock = 0;
          }
          if (!tryMove(0, 0) && false) { /* no-op */ }
          if (G.cur && !G.over && collide(G.cur.cells, G.cur.x, G.cur.y + 1) && G.lock === 0) G.lock = 1;
          saveAt += dt; if (saveAt > 5000) { saveAt = 0; persist(); }
        }
        draw();
      }
      function persist() { if (G && G.started && !G.over && G.cur) g.save({ grid: G.grid, queue: G.queue.slice(0, 14), hold: G.hold, canHold: G.canHold, cur: { t: G.cur.t }, score: G.score, lines: G.lines, level: G.level, elapsed: G.elapsed, lv: g.level }); }
      function newGame() {
        G = fresh(); g.paused = false; if (g.pauseBtn) g.pauseBtn.textContent = 'Pause'; spawn(); updateBoxes();
        cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
      }
      g.def.newGame = function () { g.clearSave(); newGame(); };
      g.def.pause = function (gg, on) { if (on) persist(); };
      g.def.onClose = function () { if (G && G.started && !G.over) { g.setPaused(true); persist(); } };
      g.def.onLevel = function (gg, i, silent) { if (!silent && G && !G.started) draw(); };
      g.def.resume = function (gg, s) {
        G = fresh(); G.grid = s.grid; G.queue = s.queue; G.hold = s.hold; G.canHold = s.canHold; G.score = s.score; G.lines = s.lines; G.level = s.level; G.elapsed = s.elapsed;
        if (typeof s.lv === 'number') { g.level = s.lv; g.drawLevels(); }
        spawn(s.cur.t); G.started = true; updateBoxes(); g.paused = true; if (g.pauseBtn) g.pauseBtn.textContent = 'Resume'; draw();
        cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
      };
      var KEYS = { ArrowLeft: 'l', a: 'l', A: 'l', ArrowRight: 'r', d: 'r', D: 'r', ArrowDown: 'd', s: 'd', S: 'd', ArrowUp: 'cw', x: 'cw', X: 'cw', z: 'ccw', Z: 'ccw', ' ': 'drop', c: 'hold', C: 'hold', p: 'pause', P: 'pause' };
      g.onKey(function (e) {
        var k = KEYS[e.key]; if (!k) return false;
        if (!G || G.over) return true;
        if (k === 'pause') { if (G.started) g.togglePause(); return true; }
        if (g.paused) return true;
        if (!G.started) { G.started = true; g.startMusic(); if (k === 'l' || k === 'r' || k === 'd' || k === 'cw') { /* the first key also acts */ } else return true; }
        if (k === 'l') { if (tryMove(-1, 0)) g.sound('move'); }
        else if (k === 'r') { if (tryMove(1, 0)) g.sound('move'); }
        else if (k === 'd') { if (tryMove(0, 1)) { G.score += 1; updateBoxes(); } }
        else if (k === 'cw') tryRotate(1); else if (k === 'ccw') tryRotate(-1);
        else if (k === 'hold') hold();
        else if (k === 'drop') { var n = 0; while (tryMove(0, 1)) n++; G.score += n * 2; lockPiece(); }
        draw(); return true;
      });
      window.LSGames.api('stats').then(function (r) { if (r.ok && r.data.games && r.data.games.blocks) best = r.data.games.blocks.best || 0; });
      newGame();
    }
  });
})();
