/* Mining Rig app for Los Santos OS (Crypto Mining Rig feature, Phase 3, restyled Phase 8). Laid out
   like a real Windows desktop utility - command bar with a Start/Stop button, a nav rail, grouped
   panels with label/value rows, a column-headed table for part health, and a status bar - rather than
   a generic rounded-card dashboard. Registers itself with LSOS.registerApp. Every call goes through
   the 'miningApi' NUI callback (client/dui.lua), which injects the current computer's key
   server-side - this file never has to know or send it itself.
   Nav rail items other than Dashboard are decorative (no second screen exists yet) - a real gap, not
   an oversight: Rigs/Wallet/Settings would each need their own view built out. Documented gap vs. the
   original mockup: a sidebar to switch between EVERY computer you own without walking to each, coin
   tabs that mine several coins in parallel, and a live 24h price chart are also not built (real
   architecture changes - remote computer switching needs a new server-side "list my computers"
   endpoint and each miningApi call taking an explicit computerKey instead of always using the one
   you're sitting at; a price chart needs sd-phone to expose price history, which hasn't been checked
   yet) - flagging so it isn't mistaken for done. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.6" fill="#3b8dea"/><rect x="4.5" y="5.5" width="15" height="9" rx=".8" fill="#9fd0ff"/><path d="M8 20h8M12 16v4" stroke="#556" stroke-width="1.6" stroke-linecap="round"/></svg>';

  // sd-phone's own configured crypto symbols (configs/stocks.lua) - not fetched live, so a coin added
  // there later needs adding here too. Kept short and hardcoded rather than adding yet another
  // cross-resource call just to list options in a dropdown.
  var COINS = ['SDC', 'BTL', 'ETD', 'SPC', 'MZC', 'FLC', 'WZC', 'POG', 'VWC', 'KIF'];
  var PART_LABELS = { cpu: 'CPU', gpu: 'GPU', ram: 'RAM', psu: 'PSU', hdd: 'HDD/SSD' };
  var SLOT_ORDER = ['cpu', 'gpu', 'ram', 'psu', 'hdd'];

  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/miningApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { success: false }; })
      .catch(function () { return { success: false }; });
  }

  var M = { loading: true, error: false, data: null, busy: false, timer: null, addOpen: false, available: [], prevBalance: null, prevPrice: null };

  // Phase 6: a short synthesized "ping" on payout - no audio asset to ship, just WebAudio. Silently
  // does nothing if the browser blocks autoplay-without-interaction; missing a ping once in a while
  // is a non-issue, the balance number itself is still the source of truth.
  function ping() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
      osc.onended = function () { ctx.close && ctx.close(); };
    } catch (e) { /* best-effort only */ }
  }

  function fmtRate(r) { return (r || 0).toFixed(4); }
  function fmtCoin(n) { return (n || 0).toLocaleString(undefined, { maximumFractionDigits: 6 }); }
  function fmtUptime(s) {
    s = s || 0;
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
  }

  // Component table row: name / tier / wear bar+pct / status badge. Wear thresholds match the old
  // wear-bar colors (>60 fine, >25 worn, else failing) so the badge and bar always agree.
  function partRow(slot, part) {
    var label = PART_LABELS[slot];
    if (!part) {
      return '<div class="mn-crow"><span class="mn-crow-name">' + esc(label) + '</span>' +
        '<span class="mn-crow-tier">—</span>' +
        '<span class="mn-crow-wear"><span class="mn-empty-dash">—</span></span>' +
        '<span class="mn-crow-badge"><span class="mn-badge mn-badge-empty">' + esc(T('mn_slot_empty', 'Empty')) + '</span></span></div>';
    }
    var wear = Math.round(part.wear);
    var badgeCls = wear > 60 ? 'mn-badge-ok' : wear > 25 ? 'mn-badge-warn' : 'mn-badge-bad';
    var barCls = wear > 60 ? 'mn-wear-ok' : wear > 25 ? 'mn-wear-warn' : 'mn-wear-bad';
    var status = wear > 60 ? T('mn_wear_good', 'Good') : wear > 25 ? T('mn_wear_worn', 'Worn') : T('mn_wear_failing', 'Fail soon');
    return '<div class="mn-crow">' +
      '<span class="mn-crow-name">' + esc(label) + '</span>' +
      '<span class="mn-crow-tier">' + esc(part.tier) + '</span>' +
      '<span class="mn-crow-wear"><span class="mn-wearbar"><span class="mn-wearfill ' + barCls + '" style="width:' + wear + '%"></span></span><span class="mn-wearpct">' + wear + '%</span></span>' +
      '<span class="mn-crow-badge"><span class="mn-badge ' + badgeCls + '">' + esc(status) + '</span></span></div>';
  }

  // Health badge, computed purely from data the app already has (no naming/location system yet - the
  // mockup's "Large Rig - Garage" style names are a documented gap, see this file's header comment).
  //   GPU failing - some installed GPU's wear has dropped below FAIL_WEAR (still mining, just badly worn)
  //   N slot open - not every GPU slot is filled
  //   Healthy      - every slot filled, nothing critically worn
  var FAIL_WEAR = 25;
  function rigHealth(rig) {
    var slots = rig.gpuSlots || 0, filled = 0, anyLow = false;
    for (var i = 1; i <= slots; i++) {
      var g = rig.gpus && rig.gpus[String(i)];
      if (g) { filled++; if (typeof g.wear === 'number' && g.wear < FAIL_WEAR) anyLow = true; }
    }
    if (anyLow) return { cls: 'mn-badge-bad', dot: '#ff99a4', label: T('mn_rig_failing', 'GPU failing') };
    if (filled < slots) return { cls: 'mn-badge-warn', dot: '#ffcc66', label: (slots - filled) + ' ' + T('mn_rig_slot_open', 'slot open') };
    return { cls: 'mn-badge-ok', dot: '#8fd6a6', label: T('mn_rig_healthy', 'Healthy') };
  }

  function rigRow(rig) {
    var filled = 0;
    for (var k in rig.gpus) if (rig.gpus.hasOwnProperty(k) && rig.gpus[k]) filled++;
    var health = rigHealth(rig);
    return '<div class="mn-rigrow">' +
      '<span class="mn-rig-dot" style="background:' + health.dot + '"></span>' +
      '<div class="mn-rig-info"><span class="mn-rig-name">' + esc(rig.key) + ' (' + esc(rig.size) + ')</span>' +
      '<span class="mn-rig-slots">' + filled + '/' + rig.gpuSlots + ' GPUs</span></div>' +
      '<span class="mn-badge ' + health.cls + '">' + esc(health.label) + '</span>' +
      '<span class="mn-rig-unlink" data-unlink="' + esc(rig.key) + '">' + esc(T('mn_unlink', 'Unlink')) + '</span></div>';
  }

  function availableRow(rig) {
    return '<div class="mn-rigrow">' +
      '<span class="mn-rig-dot" style="background:#3a3a3a"></span>' +
      '<div class="mn-rig-info"><span class="mn-rig-name">' + esc(rig.key) + ' (' + esc(rig.size) + ')</span></div>' +
      '<span class="mn-rig-link" data-link="' + esc(rig.key) + '">' + esc(T('mn_link', 'Link')) + '</span></div>';
  }

  // Single Start/Stop button in the command bar - same priority order the old bottom CTA used
  // (not ready > busy > cooling > running > stopped), just rendered as one button whose label,
  // icon and disabled state change instead of four different divs.
  function ctaButton(d, locked) {
    var iconStop = '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>';
    var iconStart = '<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M7 5l12 7-12 7V5z"/></svg>';
    if (!d.ready) {
      return '<button class="mn-cta-btn mn-cta-neutral" disabled title="' + esc(T('mn_not_ready', 'Install all 5 parts to start mining.')) + '">' + esc(T('mn_not_ready_short', 'Not ready')) + '</button>';
    }
    if (M.busy) {
      return '<button class="mn-cta-btn mn-cta-neutral" disabled>' + esc(d.running ? T('mn_stopping', 'Stopping…') : T('mn_starting', 'Starting…')) + '</button>';
    }
    if (locked) {
      return '<button class="mn-cta-btn mn-cta-neutral" disabled>' + esc(T('mn_wait', 'Please wait…')) + '</button>';
    }
    if (d.running) {
      return '<button class="mn-cta-btn mn-cta-stop" id="mn-stop">' + iconStop + esc(T('mn_stop', 'Stop')) + '</button>';
    }
    return '<button class="mn-cta-btn mn-cta-start" id="mn-start">' + iconStart + esc(T('mn_start', 'Start')) + '</button>';
  }

  function render() {
    var root = $('mn');
    if (!root) return;
    if (M.loading) { root.innerHTML = '<div class="mn-empty">' + esc(T('mn_loading', 'Loading…')) + '</div>'; return; }
    if (M.error || !M.data) { root.innerHTML = '<div class="mn-empty">' + esc(T('mn_error', 'Could not reach the mining server.')) + '</div>'; return; }

    var d = M.data;
    var locked = cooling();

    // Price delta since the last poll (~8s) - not a real 24h chart (documented gap, header comment),
    // but gives the same at-a-glance "is it moving" signal. Only shown once there's a real prior value
    // to compare against, so it never appears on first load.
    var deltaHtml = '';
    if (M.prevPrice != null && M.prevPrice > 0 && typeof d.price === 'number') {
      var pct = ((d.price - M.prevPrice) / M.prevPrice) * 100;
      if (Math.abs(pct) >= 0.01) {
        deltaHtml = '&nbsp;&nbsp;<span class="mn-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%</span>';
      }
    }

    // Command bar
    var html = '<div class="mn-cmdbar">' +
      '<div class="mn-cmdbar-title"><svg viewBox="0 0 24 24" fill="none" stroke="var(--mn-accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h3v3H8z"/><path d="M13 9h3v3h-3z"/><path d="M8 14h3v3H8z"/><path d="M13 14h3v3h-3z"/></svg>' +
      '<span>' + esc(T('mn_app_name', 'Mining Rig Manager')) + '</span></div>' +
      ctaButton(d, locked) +
      '</div>';

    // Nav rail (Dashboard is the only real screen; the rest are a documented gap - see header comment)
    html += '<div class="mn-body"><div class="mn-nav">' +
      '<div class="mn-navitem active"><span class="mn-navtick"></span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="3" width="8" height="8" rx="1.2"/><rect x="13" y="3" width="8" height="5" rx="1.2"/><rect x="13" y="11" width="8" height="10" rx="1.2"/><rect x="3" y="14" width="8" height="7" rx="1.2"/></svg>' +
      '<span>' + esc(T('mn_nav_dashboard', 'Dashboard')) + '</span></div>' +
      '<div class="mn-navitem mn-navitem-static"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="3" y="4" width="18" height="16" rx="1.6"/><path d="M7 9h2M7 12h2M7 15h2M12 9h5M12 12h5M12 15h3"/></svg>' +
      '<span>' + esc(T('mn_nav_rigs', 'Rigs')) + '</span></div>' +
      '<div class="mn-navitem mn-navitem-static"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M16 12h3M2.5 10h19"/></svg>' +
      '<span>' + esc(T('mn_nav_wallet', 'Wallet')) + '</span></div>' +
      '</div>';

    // Content
    html += '<div class="mn-content">';

    html += '<div class="mn-head"><div><div class="mn-head-title">' + esc(T('mn_app_name', 'Mining Rig Manager')) + '</div>' +
      '<div class="mn-head-sub">' + (d.hasOwner
        ? esc(T('mn_wallet_detected', 'sd-phone wallet detected'))
        : esc(T('mn_wallet_missing', 'No sd-phone wallet linked'))) + '</div></div>' +
      '<div class="mn-status-chip"><span class="mn-dot ' + (d.running ? 'on' : 'off') + '"></span><span>' + esc(d.running ? T('mn_running', 'Mining active') : T('mn_stopped', 'Stopped')) + '</span></div>' +
      '</div>';

    if (!d.hasOwner) {
      html += '<div class="mn-warn">' + esc(T('mn_no_owner', "This computer has no recorded owner yet - payouts can't be delivered until it does.")) + '</div>';
    }

    // Coin segmented control
    html += '<div class="mn-segmented' + (locked ? ' mn-locked' : '') + '" id="mn-coins">' + COINS.map(function (c) {
      return '<button class="mn-segbtn' + (c === d.coin ? ' active' : '') + '" data-coin="' + c + '">' + esc(c) + '</button>';
    }).join('') + '</div>';

    // Overview group
    html += '<div class="mn-group"><div class="mn-group-head">' + esc(T('mn_overview', 'Overview')) + '</div>' +
      '<div class="mn-row"><span class="mn-row-label">' + esc(T('mn_balance', 'Wallet balance')) + '</span><span class="mn-row-val" id="mn-balance-val">' + fmtCoin(d.balance) + ' ' + esc(d.coin) + '</span></div>' +
      '<div class="mn-row"><span class="mn-row-label">' + esc(T('mn_price', 'Spot price')) + '</span><span class="mn-row-val muted">$' + fmtCoin(d.price) + deltaHtml + '</span></div>' +
      '<div class="mn-row"><span class="mn-row-label">' + esc(T('mn_hashrate', 'Hash rate')) + '</span><span class="mn-row-val muted">' + fmtRate(d.hashRate) + ' MH/s</span></div>' +
      '<div class="mn-row mn-row-last"><span class="mn-row-label">' + esc(T('mn_uptime', 'Session uptime')) + '</span><span class="mn-row-val muted">' + (d.running ? fmtUptime(d.uptime) : '—') + '</span></div>' +
      '</div>';

    // Tower components table
    html += '<div class="mn-group"><div class="mn-group-head">' + esc(T('mn_tower_health', 'Tower components')) + '</div>' +
      '<div class="mn-table-head"><span class="mn-th-name">' + esc(T('mn_th_component', 'Component')) + '</span><span class="mn-th-tier">' + esc(T('mn_th_tier', 'Tier')) + '</span><span class="mn-th-wear">' + esc(T('mn_th_wear', 'Wear')) + '</span><span class="mn-th-status">' + esc(T('mn_th_status', 'Status')) + '</span></div>' +
      SLOT_ORDER.map(function (s) { return partRow(s, d.parts[s]); }).join('') +
      '</div>';

    // Linked rigs group
    html += '<div class="mn-group mn-group-last">' +
      '<div class="mn-group-head mn-group-head-row"><span>' + esc(T('mn_rigs', 'Linked rigs')) + ' (' + d.rigs.length + ')</span>' +
      '<button class="mn-addbtn" id="mn-addtoggle">' + esc(M.addOpen ? T('mn_close', 'Close') : T('mn_add_rig', '+ Link rig')) + '</button></div>';
    html += d.rigs.length ? d.rigs.map(rigRow).join('') : '<div class="mn-empty-small">' + esc(T('mn_no_rigs', 'No mining rigs linked yet.')) + '</div>';
    if (M.addOpen) {
      html += '<div class="mn-available">' + (M.available.length
        ? M.available.map(availableRow).join('')
        : '<div class="mn-empty-small">' + esc(T('mn_no_available', 'No unlinked mining rigs found.')) + '</div>') + '</div>';
    }
    html += '</div>';

    html += '</div></div>'; // .mn-content, .mn-body

    // Status bar
    html += '<div class="mn-statusbar"><span>' + esc(d.running ? T('mn_running', 'Mining active') : T('mn_stopped', 'Stopped')) + '</span>' +
      '<span class="mn-statusbar-sep"></span><span>' + esc(T('mn_uptime', 'Uptime')) + ' ' + (d.running ? fmtUptime(d.uptime) : '—') + '</span>' +
      '<span class="mn-statusbar-sep"></span><span>' + d.rigs.length + ' ' + esc(T('mn_rigs_linked', 'rigs linked')) + '</span>' +
      '<span class="mn-statusbar-fill"></span>' +
      '<span>' + (d.hasOwner ? esc(T('mn_wallet_ok', 'Wallet linked')) : esc(T('mn_wallet_missing_short', 'No wallet'))) + '</span></div>';

    root.innerHTML = html;

    root.querySelectorAll('[data-coin]').forEach(function (el) { el.addEventListener('click', function () { setCoin(el.dataset.coin); }); });
    var startBtn = $('mn-start'); if (startBtn) startBtn.addEventListener('click', start);
    var stopBtn = $('mn-stop'); if (stopBtn) stopBtn.addEventListener('click', stop);
    var addToggle = $('mn-addtoggle'); if (addToggle) addToggle.addEventListener('click', toggleAdd);
    root.querySelectorAll('[data-link]').forEach(function (el) { el.addEventListener('click', function () { linkRig(el.dataset.link); }); });
    root.querySelectorAll('[data-unlink]').forEach(function (el) { el.addEventListener('click', function () { unlinkRig(el.dataset.unlink); }); });
  }

  // Two 'info' fetches can be in flight at once (the 8s setInterval timer overlapping with the extra
  // poll every mutating action triggers right after it resolves) - responses don't always arrive in
  // the order they were sent, so a stale one arriving LAST could silently overwrite a fresher
  // "running: true" with an older "running: false" (this is exactly why Start looked like it reverted
  // itself). reqSeq makes every load() ignore any response that isn't from the most recent call.
  var reqSeq = 0;
  function load() {
    var seq = ++reqSeq;
    api('info', {}).then(function (r) {
      if (seq !== reqSeq) return; // superseded by a newer request - discard
      M.loading = false;
      if (r && r.success) {
        M.error = false;
        // Phase 6: a payout landed since the last poll (8s) - ping + briefly flash the number. Only
        // once M.prevBalance has a real prior value, so opening the app never pings on its first load.
        M.balanceFlash = M.prevBalance != null && typeof r.data.balance === 'number' && r.data.balance > M.prevBalance;
        M.prevBalance = r.data.balance;
        M.data = r.data;
        render();
        if (M.balanceFlash) {
          ping();
          var el = $('mn-balance-val');
          if (el) { el.classList.add('mn-flash'); setTimeout(function () { el.classList.remove('mn-flash'); }, 900); }
        }
        // Updated AFTER render so render()'s delta calc compares the just-displayed price against the
        // PREVIOUS poll's price, not against itself.
        M.prevPrice = r.data.price;
        return;
      } else { M.error = true; }
      render();
    });
  }

  // A failed action used to just silently do nothing from the player's point of view (start/setCoin/
  // link/unlink never looked at r.success at all) - a throttled click (Mining.Throttled,
  // server/mining.lua, 0.75s between mutating actions) or a real rejection like 'not_ready' looked
  // identical to the button being broken. This surfaces the actual reason, same toast pattern
  // ui/mechanic.js already uses (mx-toast/toast()/fail()).
  var ERROR_TEXT = {
    throttled:  ['mn_err_throttled', 'Slow down a moment and try again.'],
    not_ready:  ['mn_err_not_ready', 'Install all 5 parts before starting.'],
    not_owner:  ['mn_err_not_owner', "That's not yours to change."],
    not_your_rig: ['mn_err_not_your_rig', "That rig isn't yours to link."],
  };
  function errText(r) {
    var e = r && r.error;
    var t = e && ERROR_TEXT[e];
    return t ? T(t[0], t[1]) : T('mn_err_generic', 'Could not do that.');
  }
  function toast(msg, bad) {
    var el = $('mn-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'mn-toast on' + (bad ? ' bad' : '');
    clearTimeout(M.toastT);
    M.toastT = setTimeout(function () { el.className = 'mn-toast'; }, 3200);
  }
  function fail(r) { toast(errText(r), true); }

  // Every mutating mining action shares ONE 0.75s per-player cooldown server-side (Mining.Throttled,
  // server/mining.lua) - switching coins right before clicking Start used to just silently eat the
  // click (throttled, no feedback). Two fixes: markBusy() disables the CTA/coin-tabs the INSTANT you
  // click (optimistic - before the round trip even starts) so double-clicks and clicks-during-cooldown
  // can't reach the server at all, and a timer forces a re-render the moment the cooldown ends so the
  // button re-enables itself without waiting for the next 8s poll.
  var COOLDOWN_MS = 900; // server's 0.75s + a small margin for round-trip time
  function cooling() { return Date.now() < (M.cooldownUntil || 0); }
  function markBusy() {
    M.cooldownUntil = Date.now() + COOLDOWN_MS;
    clearTimeout(M.cooldownTimer);
    M.cooldownTimer = setTimeout(render, COOLDOWN_MS + 50);
  }

  function start() {
    if (M.busy || cooling()) return;
    M.busy = true;
    markBusy();
    render();
    api('start', {}).then(function (r) { M.busy = false; if (!(r && r.success)) fail(r); load(); });
  }
  function stop() {
    if (M.busy || cooling()) return;
    M.busy = true;
    markBusy();
    render();
    api('stop', {}).then(function (r) { M.busy = false; if (!(r && r.success)) fail(r); load(); });
  }
  function setCoin(coin) {
    if (cooling()) return;
    markBusy();
    render();
    api('setCoin', { coin: coin }).then(function (r) { if (!(r && r.success)) fail(r); load(); });
  }
  function toggleAdd() {
    M.addOpen = !M.addOpen;
    if (M.addOpen) {
      api('listAvailableRigs', {}).then(function (r) {
        M.available = (r && r.success && r.data) || [];
        render();
      });
    } else {
      render();
    }
  }
  function linkRig(rigKey) {
    if (cooling()) return;
    markBusy();
    api('linkRig', { rigKey: rigKey }).then(function (r) { if (!(r && r.success)) fail(r); toggleAdd(); toggleAdd(); load(); });
  }
  function unlinkRig(rigKey) {
    if (cooling()) return;
    markBusy();
    api('unlinkRig', { rigKey: rigKey }).then(function (r) { if (!(r && r.success)) fail(r); load(); });
  }

  var HTML = '<div class="mn" id="mn"></div><div class="mn-toast" id="mn-toast"></div>';

  var root = S.registerApp({
    id: 'mining', icon: ICON_APP, titleKey: 'mn_app_name', titleDef: 'Mining Rig', w: 660, h: 760, html: HTML,
    onOpen: function () {
      M.loading = true; M.addOpen = false; render();
      load();
      if (M.timer) clearInterval(M.timer);
      M.timer = setInterval(load, 8000);
    },
    onClose: function () { if (M.timer) clearInterval(M.timer); M.timer = null; },
    onLocale: function () { render(); }
  });
  if (!root) { /* app not available on this computer/job */ }
})();
