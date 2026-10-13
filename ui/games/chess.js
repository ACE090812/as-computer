/* Chess (Los Santos OS games). Standard rules with castling and promotion (no en passant, no repetition draws). Play the computer
   (Easy, Medium, Hard) or another player, with an optional clock in player matches. Click a piece, then a highlighted square. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var CELL = 58;
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#4b5563"/><path d="M8 18h8l-1-3.2c1.6-1 2.2-2.6 1.8-4.6-.4-2-2-3.2-3.8-3.2s-3.4 1.2-3.8 3.2c-.4 2 .2 3.6 1.8 4.6z" fill="#f3f4f6"/><rect x="7" y="18" width="10" height="2.2" rx="1" fill="#f3f4f6"/></svg>';
  var GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  var VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

  function isW(p) { return p && p === p.toUpperCase(); }
  function colorOf(p) { return p ? (isW(p) ? 'w' : 'b') : null; }
  function start() {
    var b = Array(64).fill(''), back = 'RNBQKBNR', i;
    for (i = 0; i < 8; i++) { b[i] = back[i].toLowerCase(); b[8 + i] = 'p'; b[48 + i] = 'P'; b[56 + i] = back[i]; }
    return { b: b, turn: 'w', cr: { K: true, Q: true, k: true, q: true }, half: 0 };
  }
  function clone(s) { return { b: s.b.slice(), turn: s.turn, cr: { K: s.cr.K, Q: s.cr.Q, k: s.cr.k, q: s.cr.q }, half: s.half }; }

  var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  var DG = [[-1, -1], [-1, 1], [1, -1], [1, 1]], OR = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  function attacked(b, sq, by) {   // is `sq` attacked by colour `by`?
    var r = sq >> 3, c = sq & 7, i, k, rr, cc, p;
    var pr = by === 'w' ? r + 1 : r - 1, pawn = by === 'w' ? 'P' : 'p';
    if (pr >= 0 && pr < 8) { if (c > 0 && b[pr * 8 + c - 1] === pawn) return true; if (c < 7 && b[pr * 8 + c + 1] === pawn) return true; }
    var kn = by === 'w' ? 'N' : 'n', kg = by === 'w' ? 'K' : 'k';
    for (i = 0; i < 8; i++) {
      rr = r + KN[i][0]; cc = c + KN[i][1]; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === kn) return true;
      rr = r + KG[i][0]; cc = c + KG[i][1]; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && b[rr * 8 + cc] === kg) return true;
    }
    var q = by === 'w' ? 'Q' : 'q', rk = by === 'w' ? 'R' : 'r', bs = by === 'w' ? 'B' : 'b';
    for (k = 0; k < 4; k++) {
      rr = r + DG[k][0]; cc = c + DG[k][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { p = b[rr * 8 + cc]; if (p) { if (p === q || p === bs) return true; break; } rr += DG[k][0]; cc += DG[k][1]; }
      rr = r + OR[k][0]; cc = c + OR[k][1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { p = b[rr * 8 + cc]; if (p) { if (p === q || p === rk) return true; break; } rr += OR[k][0]; cc += OR[k][1]; }
    }
    return false;
  }
  function kingSq(b, col) { var k = col === 'w' ? 'K' : 'k'; for (var i = 0; i < 64; i++) if (b[i] === k) return i; return -1; }
  function inCheck(s, col) { return attacked(s.b, kingSq(s.b, col), col === 'w' ? 'b' : 'w'); }

  function pseudo(s) {
    var b = s.b, col = s.turn, out = [], f, r, c, p, t, k, rr, cc, up = col === 'w' ? -1 : 1, enemy = col === 'w' ? 'b' : 'w';
    function add(from, to, promo) { out.push({ f: from, t: to, promo: promo || '' }); }
    for (f = 0; f < 64; f++) {
      p = b[f]; if (!p || colorOf(p) !== col) continue; r = f >> 3; c = f & 7; var u = p.toUpperCase();
      if (u === 'P') {
        rr = r + up; var last = rr === 0 || rr === 7;
        if (rr >= 0 && rr < 8 && !b[rr * 8 + c]) {
          if (last) ['Q', 'R', 'B', 'N'].forEach(function (x) { add(f, rr * 8 + c, x); }); else add(f, rr * 8 + c);
          var home = col === 'w' ? 6 : 1; if (r === home && !b[(r + 2 * up) * 8 + c]) add(f, (r + 2 * up) * 8 + c);
        }
        [-1, 1].forEach(function (d) {
          cc = c + d; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return; var tg = b[rr * 8 + cc];
          if (tg && colorOf(tg) === enemy) { if (last) ['Q', 'R', 'B', 'N'].forEach(function (x) { add(f, rr * 8 + cc, x); }); else add(f, rr * 8 + cc); }
        });
      } else if (u === 'N' || u === 'K') {
        var L = u === 'N' ? KN : KG;
        for (k = 0; k < 8; k++) { rr = r + L[k][0]; cc = c + L[k][1]; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; t = b[rr * 8 + cc]; if (!t || colorOf(t) === enemy) add(f, rr * 8 + cc); }
        if (u === 'K') {
          var rank = col === 'w' ? 7 : 0, ks = col === 'w' ? s.cr.K : s.cr.k, qs = col === 'w' ? s.cr.Q : s.cr.q, base = rank * 8;
          if (f === base + 4 && !attacked(b, f, enemy)) {
            if (ks && !b[base + 5] && !b[base + 6] && b[base + 7] === (col === 'w' ? 'R' : 'r') && !attacked(b, base + 5, enemy) && !attacked(b, base + 6, enemy)) out.push({ f: f, t: base + 6, promo: '', castle: 'K' });
            if (qs && !b[base + 3] && !b[base + 2] && !b[base + 1] && b[base] === (col === 'w' ? 'R' : 'r') && !attacked(b, base + 3, enemy) && !attacked(b, base + 2, enemy)) out.push({ f: f, t: base + 2, promo: '', castle: 'Q' });
          }
        }
      } else {
        var dirs = u === 'B' ? DG : u === 'R' ? OR : DG.concat(OR);
        for (k = 0; k < dirs.length; k++) {
          rr = r + dirs[k][0]; cc = c + dirs[k][1];
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) { t = b[rr * 8 + cc]; if (!t) add(f, rr * 8 + cc); else { if (colorOf(t) === enemy) add(f, rr * 8 + cc); break; } rr += dirs[k][0]; cc += dirs[k][1]; }
        }
      }
    }
    return out;
  }
  function apply(s, m) {   // returns a new state
    var n = clone(s), p = n.b[m.f], cap = n.b[m.t];
    n.b[m.t] = m.promo ? (isW(p) ? m.promo : m.promo.toLowerCase()) : p; n.b[m.f] = '';
    if (m.castle) { var base = (m.t >> 3) * 8; if (m.castle === 'K') { n.b[base + 5] = n.b[base + 7]; n.b[base + 7] = ''; } else { n.b[base + 3] = n.b[base]; n.b[base] = ''; } }
    if (p === 'K') { n.cr.K = false; n.cr.Q = false; } if (p === 'k') { n.cr.k = false; n.cr.q = false; }
    [[56, 'Q'], [63, 'K'], [0, 'q'], [7, 'k']].forEach(function (x) { if (m.f === x[0] || m.t === x[0]) n.cr[x[1]] = false; });
    n.half = (p.toUpperCase() === 'P' || cap) ? 0 : s.half + 1; n.turn = s.turn === 'w' ? 'b' : 'w';
    return n;
  }
  function legal(s) { var col = s.turn; return pseudo(s).filter(function (m) { return !inCheck(apply(s, m), col); }); }
  function insufficient(b) {
    var minors = 0, i, u; for (i = 0; i < 64; i++) { if (!b[i]) continue; u = b[i].toUpperCase(); if (u === 'K') continue; if (u === 'N' || u === 'B') { minors++; continue; } return false; }
    return minors <= 1;
  }
  function status(s) {   // 'play' | 'check' | 'mate' | 'stalemate' | 'draw'
    var moves = legal(s), chk = inCheck(s, s.turn);
    if (!moves.length) return chk ? 'mate' : 'stalemate';
    if (insufficient(s.b) || s.half >= 100) return 'draw';
    return chk ? 'check' : 'play';
  }

  // ---- computer ----
  var CENTER = [0, 0, 1, 2, 2, 1, 0, 0];
  function evaluate(s) {   // from white's point of view
    var v = 0, i, p, u, r, c, bonus;
    for (i = 0; i < 64; i++) {
      p = s.b[i]; if (!p) continue; u = p.toUpperCase(); r = i >> 3; c = i & 7;
      bonus = (u === 'K' ? 0 : (CENTER[r] + CENTER[c]) * (u === 'P' ? 4 : 5));
      if (u === 'P') bonus += (isW(p) ? 6 - r : r - 1) * 4;
      v += (isW(p) ? 1 : -1) * (VAL[u] + bonus);
    }
    return v;
  }
  function order(s, ms) {
    return ms.map(function (m) { var cap = s.b[m.t]; return { m: m, k: (cap ? 10 * VAL[cap.toUpperCase()] - VAL[s.b[m.f].toUpperCase()] : 0) + (m.promo ? 800 : 0) }; })
      .sort(function (a, b) { return b.k - a.k; }).map(function (x) { return x.m; });
  }
  function search(s, depth, alpha, beta) {   // negamax, score for side to move
    var ms = legal(s);
    if (!ms.length) return inCheck(s, s.turn) ? -100000 - depth : 0;
    if (depth === 0) return (s.turn === 'w' ? 1 : -1) * evaluate(s);
    ms = order(s, ms); var best = -Infinity;
    for (var i = 0; i < ms.length; i++) {
      var v = -search(apply(s, ms[i]), depth - 1, -beta, -alpha);
      if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
    }
    return best;
  }
  function cpuPick(s, level) {
    var ms = legal(s); if (!ms.length) return null;
    if (level === 0) {
      if (Math.random() < 0.45) return ms[Math.floor(Math.random() * ms.length)];
      var caps = ms.filter(function (m) { return s.b[m.t]; }); return (caps.length ? caps : ms)[Math.floor(Math.random() * (caps.length || ms.length))];
    }
    var depth = level === 1 ? 2 : 3, best = -Infinity, pick = [];
    order(s, ms).forEach(function (m) {
      var v = -search(apply(s, m), depth - 1, -Infinity, Infinity) + Math.random() * 2;
      if (v > best) { best = v; pick = [m]; } else if (v > best - 1) pick.push(m);
    });
    return pick[Math.floor(Math.random() * pick.length)];
  }

  window.LSGames.register({
    id: 'chess', name: 'Chess', tint: '#4b5563', icon: ICON, w: 800, h: 640,
    boxes: [{ key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' }, { key: 'draws', label: 'Draws' }],
    levels: ['Easy', 'Medium', 'Hard'], defaultLevel: 1, levelLabel: 'Computer level', pvp: true, canSave: true,
    hint: 'Click a piece, then a highlighted square',

    create: function (g) {
      var el = window.LSGames.el, N = 8 * CELL;
      g.main.style.width = (N + 16) + 'px';
      g.main.innerHTML = '<div style="display:flex;justify-content:space-between;width:' + N + 'px;margin:2px 0 6px;font-size:14px"><span data-top></span><span data-clk-top style="font-variant-numeric:tabular-nums"></span></div>' +
        '<div data-board style="position:relative;width:' + N + 'px;height:' + N + 'px;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.25)"></div>' +
        '<div style="display:flex;justify-content:space-between;width:' + N + 'px;margin:6px 0 0;font-size:14px"><span data-bot></span><span data-clk-bot style="font-variant-numeric:tabular-nums"></span></div>' +
        '<div class="gm-hint" data-sub style="margin-top:4px;min-height:18px"></div>';
      var boardEl = g.main.querySelector('[data-board]'), topL = g.main.querySelector('[data-top]'), botL = g.main.querySelector('[data-bot]');
      var clkTop = g.main.querySelector('[data-clk-top]'), clkBot = g.main.querySelector('[data-clk-bot]'), sub = g.main.querySelector('[data-sub]');
      var sqs = [], i;
      for (i = 0; i < 64; i++) (function (i) {
        var d = el('div', ''); d.style.cssText = 'position:absolute;width:' + CELL + 'px;height:' + CELL + 'px;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(CELL * 0.74) + 'px;line-height:1;cursor:pointer;user-select:none';
        d.addEventListener('click', function () { clickSq(i); }); boardEl.appendChild(d); sqs.push(d);
      })(i);
      var promoEl = el('div', ''); promoEl.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;z-index:5';
      boardEl.appendChild(promoEl);

      var S, hist, mine = 'w', first = true, sel = -1, targets = [], lastMove = null, over, startedAt = 0, net = null, busy = false;
      var rec = { wins: 0, losses: 0, draws: 0 }, clock = { w: 0, b: 0 }, tick = null, tickAt = 0;
      var ub = el('button', 'gm-btn', 'Undo'); g.side.querySelector('[data-buttons]').appendChild(ub);

      function view(sq) { return mine === 'w' ? sq : 63 - sq; }   // board square index -> display slot
      function fmt(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
      function paint() {
        var ksq = (S.turn === mine || true) && inCheck(S, S.turn) ? kingSq(S.b, S.turn) : -1;
        for (var sq = 0; sq < 64; sq++) {
          var slot = view(sq), d = sqs[sq], r = slot >> 3, c = slot & 7, light = (r + c) % 2 === 0, p = S.b[sq];
          d.style.left = (c * CELL) + 'px'; d.style.top = (r * CELL) + 'px';
          var bg = light ? '#e7d9b8' : '#a9835c';
          if (lastMove && (lastMove.f === sq || lastMove.t === sq)) bg = light ? '#f0e58a' : '#cdb94d';
          if (sq === ksq) bg = '#e57373'; if (sq === sel) bg = '#8fc78a';
          d.style.background = bg;
          d.innerHTML = p ? '<span style="color:' + (isW(p) ? '#fff' : '#17171a') + ';text-shadow:' + (isW(p) ? '0 0 2px #000,0 0 2px #000,0 1px 1px #000' : '0 0 1px rgba(255,255,255,.5)') + '">' + GLYPH[p.toUpperCase()] + '</span>' : '';
          var tg = targets.filter(function (m) { return m.t === sq; })[0];
          if (tg) d.innerHTML += '<span style="position:absolute;' + (p ? 'inset:3px;border:3px solid rgba(40,120,60,.8);border-radius:50%' : 'left:' + (CELL / 2 - 7) + 'px;top:' + (CELL / 2 - 7) + 'px;width:14px;height:14px;border-radius:50%;background:rgba(40,120,60,.7)') + '"></span>';
        }
        g.setBox('wins', rec.wins); g.setBox('losses', rec.losses); g.setBox('draws', rec.draws);
        ub.disabled = !!net || !hist.length;
      }
      function labels() {
        var opp = net ? net.opp : 'Computer', me = 'You (' + (mine === 'w' ? 'white' : 'black') + ')';
        topL.innerHTML = '<b>' + opp + '</b>'; botL.innerHTML = '<b>' + me + '</b>';
      }
      function setStatus(st) {
        if (over) return;
        var t = S.turn === mine ? 'Your move' : (net ? net.opp + ' to move' : 'Computer is thinking');
        sub.textContent = (st === 'check' ? 'Check. ' : '') + t;
      }
      function showClocks() {
        if (!net || !net.clock) { clkTop.textContent = ''; clkBot.textContent = ''; return; }
        var o = mine === 'w' ? 'b' : 'w'; clkTop.textContent = fmt(clock[o]); clkBot.textContent = fmt(clock[mine]);
      }
      function stopClock() { if (tick) { clearInterval(tick); tick = null; } }
      function runClock() {
        stopClock(); if (!net || !net.clock || over) return; tickAt = Date.now();
        tick = setInterval(function () {
          var now = Date.now(); clock[S.turn] -= now - tickAt; tickAt = now; showClocks();
          if (clock[S.turn] <= 0) {
            clock[S.turn] = 0; showClocks(); stopClock();
            if (S.turn === mine) { net.send({ flag: 1 }); finishGame('loss', 'Out of time'); }
          }
        }, 250);
      }

      function persist() {
        if (net || over) return;
        g.save({ s: S, hist: hist.slice(-8), mine: mine, first: first, lv: g.level, last: lastMove, elapsed: Math.round((Date.now() - startedAt) / 1000) });
      }
      function newGame(restore) {
        net = g.pvp && g.pvp.active ? g.pvp : null; stopClock();
        sel = -1; targets = []; over = false; busy = false; promoEl.style.display = 'none';
        if (restore) { S = restore.s; hist = restore.hist || []; mine = restore.mine; first = restore.first; lastMove = restore.last || null; startedAt = Date.now() - (restore.elapsed || 0) * 1000; }
        else {
          S = start(); hist = []; lastMove = null; startedAt = Date.now();
          if (net) { mine = net.first ? 'w' : 'b'; var ms = (net.clock || 0) * 60000; clock = { w: ms, b: ms }; } else mine = first ? 'w' : 'b';
        }
        labels(); paint(); setStatus('play'); showClocks();
        if (net) { sub.textContent = 'Playing ' + net.opp; runClock(); }
        else if (S.turn !== mine) cpuTurn();
      }
      function finishGame(kind, why) {   // kind: 'win' | 'loss' | 'draw'
        over = true; stopClock(); paint();
        var res = kind === 'win' ? 1 : kind === 'loss' ? 0 : 2;
        if (res === 1) rec.wins++; else if (res === 0) rec.losses++; else rec.draws++; paint();
        sub.textContent = (kind === 'win' ? 'You win' : kind === 'loss' ? 'You lose' : 'Draw') + (why ? ': ' + why : '');
        if (net) { net.finish(res); g.later(900, function () { g.pvpEnded(res); }); return; }
        first = !first; g.clearSave();
        g.later(900, function () { g.finish({ result: res, metric: 'wins', seconds: Math.round((Date.now() - startedAt) / 1000), line: 'Computer: ' + ['Easy', 'Medium', 'Hard'][g.level] }); });
      }
      function afterMove() {
        var st = status(S); paint();
        if (st === 'mate') { var iWon = S.turn !== mine; return finishGame(iWon ? 'win' : 'loss', 'checkmate'); }
        if (st === 'stalemate') return finishGame('draw', 'stalemate');
        if (st === 'draw') return finishGame('draw', S.half >= 100 ? '50-move rule' : 'not enough pieces');
        setStatus(st);
        if (net) { if (net.clock) tickAt = Date.now(); } else { persist(); if (S.turn !== mine) cpuTurn(); }
      }
      function play(m, byNet) {
        var cap = S.b[m.t]; hist.push(S); S = apply(S, m); lastMove = { f: m.f, t: m.t }; sel = -1; targets = [];
        g.sound(cap ? 'capture' : 'move');
        if (inCheck(S, S.turn)) g.sound('check');
        afterMove();
      }
      function cpuTurn() {
        busy = true;
        g.later(400, function () {
          if (over) return; var m = cpuPick(S, g.level); busy = false; if (m) play(m, false);
        });
      }
      function askPromo(cands, done) {
        promoEl.innerHTML = ''; promoEl.style.display = 'flex';
        var box = el('div', ''); box.style.cssText = 'background:#fff;border-radius:10px;padding:12px 16px;text-align:center;color:#17171a';
        box.innerHTML = '<div style="font-size:13px;margin-bottom:8px">Pawn reaches the last rank: choose a piece</div>';
        var row = el('div', ''); row.style.cssText = 'display:flex;gap:8px;justify-content:center';
        ['Q', 'R', 'B', 'N'].forEach(function (x) {
          var b = el('button', 'gm-btn', ''); b.style.cssText = 'font-size:34px;line-height:1;padding:4px 10px';
          b.innerHTML = '<span style="color:' + (mine === 'w' ? '#fff' : '#17171a') + ';text-shadow:' + (mine === 'w' ? '0 0 2px #000,0 0 2px #000' : 'none') + '">' + GLYPH[x] + '</span>';
          b.addEventListener('click', function () { promoEl.style.display = 'none'; done(x); }); row.appendChild(b);
        });
        box.appendChild(row); promoEl.appendChild(box);
      }
      function clickSq(sq) {
        if (over || busy || S.turn !== mine || promoEl.style.display === 'flex') return;
        var p = S.b[sq], tg = targets.filter(function (m) { return m.t === sq; });
        if (sel >= 0 && tg.length) {
          var go = function (m) { if (net) net.send({ f: m.f, t: m.t, p: m.promo, c: m.castle || '' }); play(m, false); };
          if (tg.length > 1) { askPromo(tg, function (x) { go(tg.filter(function (m) { return m.promo === x; })[0]); }); } else go(tg[0]);
          return;
        }
        if (p && colorOf(p) === mine) { sel = sq; targets = legal(S).filter(function (m) { return m.f === sq; }); g.sound('click'); }
        else { sel = -1; targets = []; }
        paint();
      }
      ub.addEventListener('click', function () {
        if (net || over || busy || !hist.length) return;
        do { S = hist.pop(); } while (hist.length && S.turn !== mine);
        sel = -1; targets = []; lastMove = null; g.sound('click'); paint(); setStatus('play'); persist();
        if (S.turn !== mine) cpuTurn();
      });

      g.def.newGame = function () { if (g.mode === 'player') return; newGame(); };
      g.def.onLevel = function () { if (!(g.pvp && g.pvp.active)) { first = true; rec = { wins: 0, losses: 0, draws: 0 }; newGame(); } };
      g.def.resume = function (gg, s) { if (s && s.s && s.s.b && s.s.b.length === 64) { g.level = s.lv || 0; g.drawLevels(); newGame(s); } };
      g.def.hasUnfinishedSave = function (s) { return !!(s && s.s && s.s.b); };
      g.def.onNetStart = function () { first = true; newGame(); };
      g.def.onNetMove = function (gg, m) {
        if (over || !net || S.turn === mine) return;
        if (m && m.flag) { stopClock(); finishGame('win', 'opponent out of time'); return; }
        if (!m || typeof m.f !== 'number' || typeof m.t !== 'number') return;
        var mv = legal(S).filter(function (x) { return x.f === m.f && x.t === m.t && (x.promo || '') === (m.p || ''); })[0];
        if (mv) play(mv, true);
      };
      g.def.onNetEnd = function () { if (!over) { over = true; stopClock(); sub.textContent = (net ? net.opp : 'Opponent') + ' left. You win'; } };
      g.def.onClose = function () { stopClock(); };
      newGame();
    }
  });
})();
