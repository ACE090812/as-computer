/* Connect 4 (Los Santos OS games). You are red against the computer (Easy, Medium, Hard) or another player. Click a column to drop a disc,
   or use the arrow keys and Enter. Who goes first alternates each game. Results count on the wins leaderboard. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var R = 6, C = 7, CELL = 62;
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#1d4ed8"/><circle cx="8" cy="9" r="2.4" fill="#e53935"/><circle cx="15.5" cy="9" r="2.4" fill="#0f2a7a"/><circle cx="8" cy="16" r="2.4" fill="#fdd835"/><circle cx="15.5" cy="16" r="2.4" fill="#e53935"/></svg>';

  function newBoard() { var b = []; for (var r = 0; r < R; r++) b.push(Array(C).fill(0)); return b; }
  function dropRow(b, c) { for (var r = R - 1; r >= 0; r--) if (!b[r][c]) return r; return -1; }
  function checkWin(b, p) {
    var D = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
      if (b[r][c] !== p) continue;
      for (var k = 0; k < 4; k++) {
        var cells = [[r, c]];
        for (var s = 1; s < 4; s++) { var rr = r + D[k][0] * s, cc = c + D[k][1] * s; if (rr < 0 || rr >= R || cc < 0 || cc >= C || b[rr][cc] !== p) break; cells.push([rr, cc]); }
        if (cells.length === 4) return cells;
      }
    }
    return null;
  }
  function full(b) { return b[0].every(Boolean); }
  function windowScore(w, me) {
    var m = 0, o = 0, e = 0; w.forEach(function (v) { if (v === me) m++; else if (v === 0) e++; else o++; });
    if (m === 4) return 1000; if (m === 3 && e === 1) return 6; if (m === 2 && e === 2) return 2;
    if (o === 3 && e === 1) return -8; return 0;
  }
  function evaluate(b, me) {
    var s = 0, r, c, k;
    for (r = 0; r < R; r++) s += (b[r][3] === me ? 3 : b[r][3] ? -3 : 0);
    for (r = 0; r < R; r++) for (c = 0; c < C - 3; c++) s += windowScore([b[r][c], b[r][c + 1], b[r][c + 2], b[r][c + 3]], me);
    for (c = 0; c < C; c++) for (r = 0; r < R - 3; r++) s += windowScore([b[r][c], b[r + 1][c], b[r + 2][c], b[r + 3][c]], me);
    for (r = 0; r < R - 3; r++) for (c = 0; c < C - 3; c++) { s += windowScore([b[r][c], b[r + 1][c + 1], b[r + 2][c + 2], b[r + 3][c + 3]], me); s += windowScore([b[r + 3][c], b[r + 2][c + 1], b[r + 1][c + 2], b[r][c + 3]], me); }
    return s;
  }
  var ORDER = [3, 2, 4, 1, 5, 0, 6];
  /* Score of the position for the side TO MOVE (`turn`): the previous mover having won is the worst case. */
  function negamax(b, depth, alpha, beta, turn) {
    var opp = turn === 1 ? 2 : 1;
    if (checkWin(b, opp)) return -100000 - depth;
    if (full(b)) return 0;
    if (depth === 0) return evaluate(b, turn);
    var best = -Infinity;
    for (var i = 0; i < ORDER.length; i++) {
      var c = ORDER[i], r = dropRow(b, c); if (r < 0) continue;
      b[r][c] = turn; var v = -negamax(b, depth - 1, -beta, -alpha, opp); b[r][c] = 0;
      if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
    }
    return best;
  }
  function cpuMove(b, me, level) {
    var opp = me === 1 ? 2 : 1, cols = [], c, r;
    for (c = 0; c < C; c++) if (dropRow(b, c) >= 0) cols.push(c);
    // always take an immediate win; harder levels also block
    for (var i = 0; i < cols.length; i++) { c = cols[i]; r = dropRow(b, c); b[r][c] = me; var w = checkWin(b, me); b[r][c] = 0; if (w) return c; }
    if (level >= 1 || Math.random() < 0.6) for (var j = 0; j < cols.length; j++) { c = cols[j]; r = dropRow(b, c); b[r][c] = opp; var w2 = checkWin(b, opp); b[r][c] = 0; if (w2) return c; }
    if (level === 0) return cols[Math.floor(Math.random() * cols.length)];
    var depth = level === 1 ? 3 : 6, best = -Infinity, pick = [];
    ORDER.forEach(function (cc) {
      var rr = dropRow(b, cc); if (rr < 0) return;
      b[rr][cc] = me; var v = -negamax(b, depth - 1, -Infinity, Infinity, opp); b[rr][cc] = 0;
      if (v > best) { best = v; pick = [cc]; } else if (v === best) pick.push(cc);
    });
    return pick[Math.floor(Math.random() * pick.length)];
  }

  window.LSGames.register({
    id: 'connect4', name: 'Connect 4', tint: '#c2410c', icon: ICON, w: 760, h: 560,
    boxes: [{ key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' }, { key: 'draws', label: 'Draws' }],
    levels: ['Easy', 'Medium', 'Hard'], defaultLevel: 1, levelLabel: 'Computer level', pvp: true,
    hint: 'Click a column, or use the arrows',

    create: function (g) {
      var el = window.LSGames.el;
      var W = C * CELL + 20, H = R * CELL + 20;
      g.main.style.width = W + 'px';
      g.main.innerHTML = '<div style="display:flex;justify-content:space-between;width:100%;margin:2px 0 8px;font-size:14px"><span data-me></span><span data-turn style="color:var(--g-sub)"></span><span data-opp></span></div>' +
        '<div style="position:relative;width:' + W + 'px;height:' + (H + 22) + 'px"><div data-hover style="position:absolute;top:0;width:' + CELL + 'px;height:20px;display:flex;justify-content:center;transition:left .08s"></div>' +
        '<div data-board style="position:absolute;top:22px;left:0;width:' + W + 'px;height:' + H + 'px;border-radius:14px;background:#1d4ed8;box-shadow:inset 0 -6px 0 #1a3fae;overflow:hidden"></div></div><div class="gm-hint" data-sub></div>';
      var board = g.main.querySelector('[data-board]'), hover = g.main.querySelector('[data-hover]');
      var meL = g.main.querySelector('[data-me]'), oppL = g.main.querySelector('[data-opp]'), turnL = g.main.querySelector('[data-turn]'), sub = g.main.querySelector('[data-sub]');
      hover.innerHTML = '<div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:12px solid #e53935"></div>';
      var discs = [];
      for (var r = 0; r < R; r++) { discs.push([]); for (var c = 0; c < C; c++) { var d = el('div', ''); d.style.cssText = 'position:absolute;left:' + (10 + c * CELL + 5) + 'px;top:' + (10 + r * CELL + 5) + 'px;width:' + (CELL - 10) + 'px;height:' + (CELL - 10) + 'px;border-radius:50%;background:#0f2a7a;box-shadow:inset 0 4px 6px rgba(0,0,0,.45)'; board.appendChild(d); discs[r].push(d); } }
      var colHit = [];
      for (var cc = 0; cc < C; cc++) (function (cc) {
        var z = el('div', ''); z.style.cssText = 'position:absolute;top:0;bottom:0;left:' + (10 + cc * CELL) + 'px;width:' + CELL + 'px;cursor:pointer;z-index:2';
        z.addEventListener('click', function () { clickCol(cc); }); z.addEventListener('mouseenter', function () { setHover(cc); }); board.appendChild(z); colHit.push(z);
      })(cc);

      var B, over, turn, mine = 1, first = true, startedAt = 0, rec = { wins: 0, losses: 0, draws: 0 }, net = null, hov = 3, busy = false;
      function setHover(c) { hov = Math.max(0, Math.min(C - 1, c)); hover.style.left = (10 + hov * CELL) + 'px'; }
      function paint(line) {
        for (var r = 0; r < R; r++) for (var c = 0; c < C; c++) {
          var v = B[r][c], d = discs[r][c]; d.style.background = v === 1 ? '#e53935' : v === 2 ? '#fdd835' : '#0f2a7a';
          d.style.boxShadow = v ? 'inset 0 -4px 6px rgba(0,0,0,.25)' : 'inset 0 4px 6px rgba(0,0,0,.45)';
          var hot = line && line.some(function (x) { return x[0] === r && x[1] === c; }); d.style.outline = hot ? '3px solid #fff' : 'none';
        }
        g.setBox('wins', rec.wins); g.setBox('losses', rec.losses); g.setBox('draws', rec.draws);
      }
      function labels() {
        meL.innerHTML = '<b>You</b> <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + (mine === 1 ? '#e53935' : '#fdd835') + ';vertical-align:-1px"></span>';
        oppL.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:' + (mine === 1 ? '#fdd835' : '#e53935') + ';vertical-align:-1px"></span> <b>' + (net ? net.opp : 'Computer') + '</b>';
      }
      function setTurn() { turnL.textContent = over ? '' : (turn === mine ? 'Your turn' : (net ? net.opp + ' is thinking' : 'Computer is thinking')); }

      function newGame() {
        net = g.pvp && g.pvp.active ? g.pvp : null;
        B = newBoard(); over = false; busy = false; startedAt = Date.now();
        if (net) { mine = net.first ? 1 : 2; turn = 1; sub.textContent = 'Playing ' + net.opp; }
        else { mine = 1; turn = first ? 1 : 2; sub.textContent = ''; }
        labels(); paint(); setTurn();
        if (!net && turn !== mine) cpuTurn();
      }
      function end(line, res) {
        over = true; setTurn(); paint(line);
        if (res === 1) rec.wins++; else if (res === 0) rec.losses++; else rec.draws++;
        paint(line); turnL.textContent = res === 1 ? 'You win!' : res === 0 ? (net ? net.opp + ' wins' : 'Computer wins') : 'Draw';
        if (net) { net.finish(res); g.later(900, function () { g.pvpEnded(res); }); return; }
        first = !first;
        g.later(900, function () { g.finish({ result: res, metric: 'wins', seconds: Math.round((Date.now() - startedAt) / 1000), line: 'Computer: ' + ['Easy', 'Medium', 'Hard'][g.level] }); });
      }
      function dropAnim(c, who, done) {
        var r = dropRow(B, c); if (r < 0) return false;
        B[r][c] = who; busy = true; g.sound('place');
        paint(); var d = discs[r][c]; d.style.transition = 'none'; d.style.transform = 'translateY(' + (-(r + 1) * CELL - 20) + 'px)'; void d.offsetHeight;
        d.style.transition = 'transform .28s cubic-bezier(.4,.1,.7,1)'; d.style.transform = 'none';
        g.later(300, function () { d.style.transition = 'none'; busy = false; done(r); });
        return true;
      }
      function afterMove(who, byNet) {
        var w = checkWin(B, who);
        if (w) return end(w, who === mine ? 1 : 0);
        if (full(B)) return end(null, 2);
        turn = who === 1 ? 2 : 1; setTurn();
        if (!net && turn !== mine) cpuTurn();
      }
      function cpuTurn() {
        g.later(450, function () {
          if (over) return; var c = cpuMove(B, turn, g.level);
          dropAnim(c, turn, function () { afterMove(turn === 1 ? 1 : 2); });
        });
      }
      function clickCol(c) {
        if (over || busy || turn !== mine || dropRow(B, c) < 0) return;
        if (net) net.send({ c: c });
        dropAnim(c, mine, function () { afterMove(mine); });
      }
      g.onKey(function (e) {
        if (e.key === 'ArrowLeft') { setHover(hov - 1); return true; } if (e.key === 'ArrowRight') { setHover(hov + 1); return true; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { clickCol(hov); return true; } return false;
      });
      g.def.newGame = function () { if (g.mode === 'player') return; newGame(); };
      g.def.onLevel = function () { if (!(g.pvp && g.pvp.active)) { first = true; rec = { wins: 0, losses: 0, draws: 0 }; newGame(); } };
      g.def.onNetStart = function () { first = true; newGame(); };
      g.def.onNetMove = function (gg, m) {
        if (over || !net || turn === mine || typeof m.c !== 'number' || dropRow(B, m.c) < 0) return;
        var who = mine === 1 ? 2 : 1; dropAnim(m.c, who, function () { afterMove(who, true); });
      };
      g.def.onNetEnd = function () { if (!over) { over = true; turnL.textContent = (net ? net.opp : 'Opponent') + ' left. You win'; } };
      setHover(3); newGame();
    }
  });
})();
