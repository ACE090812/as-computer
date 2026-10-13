/* Tic-tac-toe (Los Santos OS games). You are X against the computer (Easy, Medium or Unbeatable) or another player.
   Who goes first alternates each game. Results count on the wins leaderboard. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#7c3aed"/><path d="M7 7l4 4M11 7l-4 4" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="16.5" cy="16.5" r="2.6" fill="none" stroke="#ffd34d" stroke-width="2"/><path d="M12 12h0" stroke="#fff"/></svg>';
  var LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

  function winner(b) {
    for (var i = 0; i < LINES.length; i++) { var l = LINES[i]; if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) return { w: b[l[0]], line: l }; }
    return b.every(Boolean) ? { w: 'draw' } : null;
  }
  function free(b) { var f = []; for (var i = 0; i < 9; i++) if (!b[i]) f.push(i); return f; }
  function minimax(b, turn, me) {
    var r = winner(b); if (r) return r.w === me ? 10 : r.w === 'draw' ? 0 : -10;
    var best = turn === me ? -99 : 99;
    free(b).forEach(function (i) { b[i] = turn; var v = minimax(b, turn === 'X' ? 'O' : 'X', me); b[i] = ''; if (turn === me) best = Math.max(best, v - 0); else best = Math.min(best, v); });
    return best;
  }
  function cpuMove(b, me, level) {
    var f = free(b), opp = me === 'X' ? 'O' : 'X', i, t;
    if (level === 0 && Math.random() < 0.65) return f[Math.floor(Math.random() * f.length)];
    if (level <= 1) {
      for (i = 0; i < f.length; i++) { t = b.slice(); t[f[i]] = me; if (winner(t) && winner(t).w === me) return f[i]; }
      if (level === 1) for (i = 0; i < f.length; i++) { t = b.slice(); t[f[i]] = opp; if (winner(t) && winner(t).w === opp) return f[i]; }
      return f[Math.floor(Math.random() * f.length)];
    }
    var best = -99, pick = [];
    f.forEach(function (c) { var t2 = b.slice(); t2[c] = me; var v = minimax(t2, opp, me); if (v > best) { best = v; pick = [c]; } else if (v === best) pick.push(c); });
    return pick[Math.floor(Math.random() * pick.length)];
  }

  window.LSGames.register({
    id: 'tictactoe', name: 'Tic-tac-toe', tint: '#7c3aed', icon: ICON, w: 760, h: 560,
    boxes: [{ key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' }, { key: 'draws', label: 'Draws' }],
    levels: ['Easy', 'Medium', 'Unbeatable'], defaultLevel: 1, levelLabel: 'Computer level', pvp: true,
    hint: 'You are X',

    create: function (g) {
      var el = window.LSGames.el;
      g.main.style.width = '372px';
      g.main.innerHTML = '<div style="font-size:18px;font-weight:600;height:30px;margin:6px 0 10px" data-status></div><div data-grid style="display:grid;grid-template-columns:repeat(3,112px);gap:8px;padding:8px;background:var(--g-line);border-radius:14px"></div><div class="gm-hint" data-sub></div>';
      var status = g.main.querySelector('[data-status]'), grid = g.main.querySelector('[data-grid]'), sub = g.main.querySelector('[data-sub]');
      var cells = [];
      for (var i = 0; i < 9; i++) (function (i) {
        var b = el('button', ''); b.style.cssText = 'width:112px;height:112px;border:0;border-radius:9px;background:var(--g-card);font-size:64px;font-weight:700;line-height:1;cursor:pointer;transition:background .1s';
        b.addEventListener('click', function () { clickCell(i); }); grid.appendChild(b); cells.push(b);
      })(i);

      var B, over, turn, mine, first = true, startedAt = 0, rec = { wins: 0, losses: 0, draws: 0 }, net = null;
      function paint(line) {
        cells.forEach(function (c, i) {
          c.textContent = B[i]; c.style.color = B[i] === 'X' ? '#7c3aed' : '#e11d48';
          c.style.background = line && line.indexOf(i) >= 0 ? 'rgba(15,108,189,.2)' : 'var(--g-card)';
        });
        g.setBox('wins', rec.wins); g.setBox('losses', rec.losses); g.setBox('draws', rec.draws);
      }
      function setStatus(t) { status.textContent = t; }

      function newGame() {
        net = g.pvp && g.pvp.active ? g.pvp : null;
        B = Array(9).fill(''); over = false; startedAt = Date.now();
        if (net) { turn = 'X'; mine = net.side; sub.textContent = 'Playing ' + net.opp; }
        else { mine = 'X'; turn = 'X'; sub.textContent = ''; if (!first) { mine = 'X'; /* human is always X; computer opens on alternate games */ } }
        if (!net && !first) { turn = 'O'; B[cpuMove(B, 'O', g.level)] = 'O'; turn = 'X'; }
        paint(); setStatus(net ? (turn === mine ? 'Your move' : net.opp + ' is thinking') : 'Your move');
      }
      function end(r, byNet) {
        over = true; var res = r.w === 'draw' ? 2 : (r.w === mine ? 1 : 0);
        if (res === 1) rec.wins++; else if (res === 0) rec.losses++; else rec.draws++;
        paint(r.line); setStatus(res === 1 ? 'You win!' : res === 0 ? (net ? net.opp + ' wins' : 'Computer wins') : 'Draw');
        if (net) { net.finish(res); g.later(500, function () { g.pvpEnded(res); }); return; }
        first = !first;
        g.later(650, function () { g.finish({ result: res, metric: 'wins', seconds: Math.round((Date.now() - startedAt) / 1000), line: 'Computer: ' + ['Easy', 'Medium', 'Unbeatable'][g.level] }); });
      }
      function clickCell(i) {
        if (over || B[i]) return;
        if (net) { if (turn !== mine) return; }
        else if (turn !== 'X') return;
        place(i, net ? mine : 'X'); g.sound('place');
        var r = winner(B);
        if (net) { net.send({ c: i }); }
        if (r) return end(r);
        turn = turn === 'X' ? 'O' : 'X';
        if (net) { setStatus(net.opp + ' is thinking'); return; }
        setStatus('Computer is thinking...');
        g.later(380, function () {
          if (over) return;
          var c = cpuMove(B, 'O', g.level); place(c, 'O'); g.sound('place');
          var r2 = winner(B); if (r2) return end(r2);
          turn = 'X'; setStatus('Your move');
        });
      }
      function place(i, who) { B[i] = who; paint(); }

      g.def.newGame = function () { if (g.mode === 'player') { return; } newGame(); };
      g.def.onLevel = function () { if (!(g.pvp && g.pvp.active)) { first = true; rec = { wins: 0, losses: 0, draws: 0 }; newGame(); } };
      // player matches (ui/games/pvp.js)
      g.def.onNetStart = function (gg, info) { first = true; newGame(); };
      g.def.onNetMove = function (gg, m) { if (over || !net || B[m.c] || turn === mine) return; place(m.c, net.side === 'X' ? 'O' : 'X'); g.sound('place'); var r = winner(B); if (r) return end(r, true); turn = mine; setStatus('Your move'); };
      g.def.onNetEnd = function (gg, reason) { if (over) return; over = true; setStatus(reason === 'left' ? net.opp + ' left. You win' : 'Match ended'); };
      newGame();
    }
  });
})();
