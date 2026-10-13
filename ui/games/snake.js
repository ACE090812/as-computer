/* Snake (Los Santos OS games). Walls and your own tail end the game. A timed bonus pellet appears every few pellets.
   Controls: arrows or WASD to steer, Space to pause. Uses ui/games.js for the window, saves, sounds and leaderboard. */
(function () {
  'use strict';
  if (!window.LSGames) return;
  var N = 20, CS = 22, W = N * CS;
  var STEP = [0.15, 0.115, 0.082];     // seconds per move: Easy, Normal, Hard
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#2f9e5b"/><path d="M6 15h6a3 3 0 0 0 0-6H9a2 2 0 0 1 0-4h8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="17.5" cy="17.5" r="1.8" fill="#ffd34d"/></svg>';

  window.LSGames.register({
    id: 'snake', name: 'Snake', tint: '#2f9e5b', icon: ICON, w: 760, h: 560,
    boxes: [{ key: 'score', label: 'Score' }, { key: 'best', label: 'Best' }],
    levels: ['Easy', 'Normal', 'Hard'], defaultLevel: 1, pausable: true, canSave: true,
    hint: 'Arrows or WASD to steer',

    create: function (g) {
      var cv = document.createElement('canvas'); cv.width = W; cv.height = W; cv.style.cssText = 'border-radius:10px;border:2px solid #1d3326;background:#0e1a14;max-width:100%';
      g.main.appendChild(cv);
      var ctx = cv.getContext('2d');
      var G = null, raf = 0, best = 0, started = false;

      function fresh() {
        return { body: [[4, 10], [3, 10], [2, 10]], dir: [1, 0], queue: [], food: null, bonus: null, eaten: 0, score: 0, elapsed: 0, acc: 0, over: false, started: false, fx: 0 };
      }
      function free(x, y) { return !G.body.some(function (b) { return b[0] === x && b[1] === y; }) && !(G.food && G.food[0] === x && G.food[1] === y) && !(G.bonus && G.bonus.x === x && G.bonus.y === y); }
      function spot() { var x, y, t = 0; do { x = Math.floor(Math.random() * N); y = Math.floor(Math.random() * N); } while (!free(x, y) && ++t < 500); return [x, y]; }

      function draw() {
        ctx.fillStyle = '#0e1a14'; ctx.fillRect(0, 0, W, W);
        ctx.strokeStyle = '#16271e'; ctx.lineWidth = 1; ctx.beginPath();
        for (var i = 1; i < N; i++) { ctx.moveTo(i * CS + .5, 0); ctx.lineTo(i * CS + .5, W); ctx.moveTo(0, i * CS + .5); ctx.lineTo(W, i * CS + .5); }
        ctx.stroke();
        if (G.food) { ctx.fillStyle = '#ff5d5d'; ctx.shadowColor = '#ff5d5d'; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(G.food[0] * CS + CS / 2, G.food[1] * CS + CS / 2, 8, 0, 7); ctx.fill(); ctx.shadowBlur = 0; }
        if (G.bonus) {
          ctx.fillStyle = '#ffc233'; ctx.shadowColor = '#ffc233'; ctx.shadowBlur = 12; ctx.beginPath(); ctx.arc(G.bonus.x * CS + CS / 2, G.bonus.y * CS + CS / 2, 9.5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
          ctx.fillStyle = '#3a2a00'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('+50', G.bonus.x * CS + CS / 2, G.bonus.y * CS + CS / 2 + 4);
          ctx.fillStyle = '#7fe3a8'; ctx.textAlign = 'left'; ctx.font = '12px sans-serif'; ctx.fillText('BONUS 0:' + String(Math.ceil(G.bonus.t)).padStart(2, '0'), 10, 18);
        }
        G.body.forEach(function (b, i) { ctx.fillStyle = i === 0 ? '#b8ffd2' : (i % 2 ? '#3ddc84' : '#32c874'); ctx.fillRect(b[0] * CS + 1, b[1] * CS + 1, CS - 2, CS - 2); });
        if (!G.started && !G.over) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, W / 2 - 28, W, 56); ctx.fillStyle = '#e8fff1'; ctx.font = '600 17px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Press an arrow key to start', W / 2, W / 2 + 6); }
        if (g.paused && !g.over.classList.contains('open')) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, W, W); ctx.fillStyle = '#fff'; ctx.font = '600 22px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Paused', W / 2, W / 2); }
      }

      function stepOnce() {
        if (G.queue.length) { var nd = G.queue.shift(); if (!(nd[0] === -G.dir[0] && nd[1] === -G.dir[1])) G.dir = nd; }
        var h = [G.body[0][0] + G.dir[0], G.body[0][1] + G.dir[1]];
        if (h[0] < 0 || h[1] < 0 || h[0] >= N || h[1] >= N || G.body.some(function (b, i) { return i < G.body.length - 1 && b[0] === h[0] && b[1] === h[1]; })) return die();
        G.body.unshift(h);
        var grew = false;
        if (G.food && h[0] === G.food[0] && h[1] === G.food[1]) {
          G.eaten++; G.score += 10; grew = true; g.sound('eat'); G.food = spot();
          if (G.eaten % 6 === 0 && !G.bonus) { var s = spot(); G.bonus = { x: s[0], y: s[1], t: 7 }; }
        } else if (G.bonus && h[0] === G.bonus.x && h[1] === G.bonus.y) { G.score += 50; grew = true; G.bonus = null; g.sound('bonus'); }
        if (!grew) G.body.pop();
        g.setBox('score', G.score);
        if (G.score > best) { best = G.score; g.setBox('best', best.toLocaleString('en-GB')); }
      }

      function die() {
        G.over = true; cancelAnimationFrame(raf); draw();
        g.finish({ score: G.score, seconds: Math.max(1, Math.round(G.elapsed)), line: 'Length ' + G.body.length + ' - Time ' + Math.floor(G.elapsed / 60) + ':' + String(Math.floor(G.elapsed % 60)).padStart(2, '0') });
      }

      var last = 0, saveAt = 0;
      function loop(now) {
        raf = requestAnimationFrame(loop);
        var dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (!G || G.over || g.paused || !G.started) return;
        var step = STEP[g.level] * Math.max(0.55, 1 - G.eaten * 0.008);
        G.acc += dt; G.elapsed += dt;
        if (G.bonus) { G.bonus.t -= dt; if (G.bonus.t <= 0) G.bonus = null; }
        while (G.acc >= step && !G.over) { G.acc -= step; stepOnce(); }
        if (!G.over) { draw(); saveAt += dt; if (saveAt > 4) { saveAt = 0; persist(); } }
      }
      function persist() { if (G && G.started && !G.over) g.save({ body: G.body, dir: G.dir, food: G.food, bonus: G.bonus, eaten: G.eaten, score: G.score, elapsed: G.elapsed, level: g.level }); }

      function newGame() {
        G = fresh(); G.food = spot(); g.paused = false; if (g.pauseBtn) g.pauseBtn.textContent = 'Pause';
        g.setBox('score', 0); draw(); cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
      }
      g.def.newGame = function () { g.clearSave(); newGame(); };
      g.def.onLevel = function (gg, i, silent) { if (!silent && G && !G.over && G.started) { /* keep playing; the new speed applies from the next move */ } };
      g.def.pause = function (gg, on) { if (on) persist(); if (G) draw(); };
      g.def.onClose = function () { if (G && G.started && !G.over) { g.setPaused(true); persist(); } };
      g.def.resume = function (gg, s) {
        G = fresh(); G.body = s.body; G.dir = s.dir; G.food = s.food; G.bonus = s.bonus; G.eaten = s.eaten; G.score = s.score; G.elapsed = s.elapsed; G.started = true;
        if (typeof s.level === 'number') { g.level = s.level; g.drawLevels(); }
        g.setBox('score', G.score); g.paused = true; if (g.pauseBtn) g.pauseBtn.textContent = 'Resume'; draw();
        cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(loop);
      };

      g.onKey(function (e) {
        var k = e.key, d = ({ ArrowUp: [0, -1], w: [0, -1], W: [0, -1], ArrowDown: [0, 1], s: [0, 1], S: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0], ArrowRight: [1, 0], d: [1, 0], D: [1, 0] })[k];
        if (k === ' ') { if (G && G.started && !G.over) g.togglePause(); return true; }
        if (!d || !G || G.over || g.paused) return d ? true : false;
        if (!G.started) { if (d[0] === -1) return true; G.started = true; g.startMusic(); }
        var ref = G.queue.length ? G.queue[G.queue.length - 1] : G.dir;
        if (G.queue.length < 2 && !(d[0] === -ref[0] && d[1] === -ref[1]) && !(d[0] === ref[0] && d[1] === ref[1])) G.queue.push(d);
        return true;
      });
      window.LSGames.api('stats').then(function (r) { if (r.ok && r.data.games && r.data.games.snake) { best = r.data.games.snake.best || 0; g.setBox('best', best.toLocaleString('en-GB')); } else g.setBox('best', '0'); });
      newGame();
    }
  });
})();
