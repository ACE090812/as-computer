/* Mining Rig app for Los Santos OS (Crypto Mining Rig feature, Phase 3, restyled Phase 7). Dashboard
   for the computer you're physically sitting at: hash rate, coin, balance, price (+ delta since the
   last poll), part health, uptime, start/stop, linked rigs with a health badge - no sell/collect
   button, cash-out happens entirely on the phone's own crypto app. Registers itself with
   LSOS.registerApp. Every call goes through the 'miningApi' NUI callback (client/dui.lua), which
   injects the current computer's key server-side - this file never has to know or send it itself.
   Documented gap vs. the original mockup: the mockup also had a sidebar to switch between EVERY
   computer you own without walking to each one, coin tabs that mine several coins in parallel, and a
   live 24h price chart. None of those are built (they're a real architecture change - remote computer
   switching needs a new server-side "list my computers" endpoint and each miningApi call taking an
   explicit computerKey instead of always using the one you're sitting at; a price chart needs sd-phone
   to expose price history, which hasn't been checked yet) - flagging so it isn't mistaken for done. */
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

  function partRow(slot, part) {
    var label = PART_LABELS[slot];
    if (!part) {
      return '<div class="mn-part mn-part-empty"><span class="mn-part-name">' + esc(label) + '</span><span class="mn-part-missing">' + esc(T('mn_slot_empty', 'Empty')) + '</span></div>';
    }
    var wear = Math.round(part.wear);
    var cls = wear > 60 ? 'mn-wear-ok' : wear > 25 ? 'mn-wear-warn' : 'mn-wear-bad';
    return '<div class="mn-part">' +
      '<span class="mn-part-name">' + esc(label) + '</span>' +
      '<span class="mn-part-tier">' + esc(part.tier) + '</span>' +
      '<div class="mn-wearbar"><div class="mn-wearfill ' + cls + '" style="width:' + wear + '%"></div></div>' +
      '<span class="mn-wearpct">' + wear + '%</span></div>';
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
    if (anyLow) return { cls: 'mn-badge-bad', label: T('mn_rig_failing', 'GPU failing') };
    if (filled < slots) return { cls: 'mn-badge-warn', label: (slots - filled) + ' ' + T('mn_rig_slot_open', 'slot open') };
    return { cls: 'mn-badge-ok', label: T('mn_rig_healthy', 'Healthy') };
  }

  function rigRow(rig) {
    var filled = 0;
    for (var k in rig.gpus) if (rig.gpus.hasOwnProperty(k) && rig.gpus[k]) filled++;
    var health = rigHealth(rig);
    return '<div class="mn-rig">' +
      '<div class="mn-rig-info"><span class="mn-rig-name">' + esc(rig.key) + ' (' + esc(rig.size) + ')</span>' +
      '<span class="mn-rig-slots">' + filled + '/' + rig.gpuSlots + ' GPUs</span></div>' +
      '<span class="mn-badge ' + health.cls + '">' + esc(health.label) + '</span>' +
      '<span class="mn-rig-unlink" data-unlink="' + esc(rig.key) + '">' + esc(T('mn_unlink', 'Unlink')) + '</span></div>';
  }

  function availableRow(rig) {
    return '<div class="mn-rig">' +
      '<div class="mn-rig-info"><span class="mn-rig-name">' + esc(rig.key) + ' (' + esc(rig.size) + ')</span></div>' +
      '<span class="mn-rig-link" data-link="' + esc(rig.key) + '">' + esc(T('mn_link', 'Link')) + '</span></div>';
  }

  function render() {
    var root = $('mn');
    if (!root) return;
    if (M.loading) { root.innerHTML = '<div class="mn-empty">' + esc(T('mn_loading', 'Loading…')) + '</div>'; return; }
    if (M.error || !M.data) { root.innerHTML = '<div class="mn-empty">' + esc(T('mn_error', 'Could not reach the mining server.')) + '</div>'; return; }

    var d = M.data;

    // Price delta since the last poll (~8s) - not a real 24h chart (documented gap, header comment),
    // but gives the same at-a-glance "is it moving" signal the mockup's arrow conveys. Only shown once
    // there's a real prior value to compare against, so it never appears on first load.
    var deltaHtml = '';
    if (M.prevPrice != null && M.prevPrice > 0 && typeof d.price === 'number') {
      var pct = ((d.price - M.prevPrice) / M.prevPrice) * 100;
      if (Math.abs(pct) >= 0.01) {
        deltaHtml = '<span class="mn-stat-delta ' + (pct >= 0 ? 'up' : 'down') + '">' + (pct >= 0 ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%</span>';
      }
    }

    var html = '<div class="mn-top">' +
      '<div class="mn-coins" id="mn-coins">' + COINS.map(function (c) {
        return '<span class="mn-coin-tab' + (c === d.coin ? ' active' : '') + '" data-coin="' + c + '">' + esc(c) + '</span>';
      }).join('') + '</div>' +
      '<div class="mn-wallet">' + (d.hasOwner
        ? esc(T('mn_wallet_detected', 'sd-phone wallet')) + ' · <b>' + esc(d.coin) + '</b> ' + esc(T('mn_wallet_ok', 'detected'))
        : esc(T('mn_wallet_missing', 'No sd-phone wallet linked'))) + '</div>' +
      '<span class="mn-state ' + (d.running ? 'mn-state-on' : 'mn-state-off') + '">' + esc(d.running ? T('mn_running', 'Mining') : T('mn_stopped', 'Stopped')) + '</span>' +
      '</div>';

    html += '<div class="mn-stats">' +
      '<div class="mn-stat"><div class="mn-stat-label">' + esc(T('mn_hashrate', 'Hash rate')) + '</div><div class="mn-stat-val">' + fmtRate(d.hashRate) + '</div></div>' +
      '<div class="mn-stat"><div class="mn-stat-label">' + esc(T('mn_balance', 'Balance')) + '</div><div class="mn-stat-val' + (M.balanceFlash ? ' mn-flash' : '') + '" id="mn-balance-val">' + fmtCoin(d.balance) + ' ' + esc(d.coin) + '</div></div>' +
      '<div class="mn-stat"><div class="mn-stat-label">' + esc(T('mn_price', 'Price')) + '</div><div class="mn-stat-val">$' + fmtCoin(d.price) + deltaHtml + '</div></div>' +
      '<div class="mn-stat"><div class="mn-stat-label">' + esc(T('mn_uptime', 'Uptime')) + '</div><div class="mn-stat-val">' + (d.running ? fmtUptime(d.uptime) : '—') + '</div></div>' +
      '</div>';

    if (!d.hasOwner) {
      html += '<div class="mn-warn">' + esc(T('mn_no_owner', "This computer has no recorded owner yet - payouts can't be delivered until it does.")) + '</div>';
    }

    html += '<div class="mn-grid">';

    html += '<div class="mn-card">' +
      '<div class="mn-card-head"><span>' + esc(T('mn_rigs', 'Linked rigs')) + ' (' + d.rigs.length + ')</span>' +
      '<span class="mn-addbtn" id="mn-addtoggle">' + esc(M.addOpen ? T('mn_close', 'Close') : T('mn_add_rig', '+ Add rig')) + '</span></div>';
    html += d.rigs.length ? d.rigs.map(rigRow).join('') : '<div class="mn-empty-small">' + esc(T('mn_no_rigs', 'No mining rigs linked yet.')) + '</div>';
    if (M.addOpen) {
      html += '<div class="mn-available">' + (M.available.length
        ? M.available.map(availableRow).join('')
        : '<div class="mn-empty-small">' + esc(T('mn_no_available', 'No unlinked mining rigs found.')) + '</div>') + '</div>';
    }
    html += '</div>';

    html += '<div class="mn-card">' +
      '<div class="mn-card-head"><span class="tag">' + esc(T('mn_tower_health', 'Tower — part health')) + '</span></div>' +
      '<div class="mn-parts">' + SLOT_ORDER.map(function (s) { return partRow(s, d.parts[s]); }).join('') + '</div>' +
      '</div>';

    html += '</div>'; // .mn-grid

    if (!d.ready) {
      html += '<div class="mn-cta mn-cta-disabled">' + esc(T('mn_not_ready', 'Install all 5 parts to start mining.')) + '</div>';
    } else if (d.running) {
      html += '<div class="mn-cta mn-cta-stop" id="mn-stop">' + esc(T('mn_stop', 'Stop mining')) + '</div>';
    } else {
      html += '<div class="mn-cta mn-cta-start" id="mn-start">' + esc(T('mn_start', 'Start mining')) + '</div>';
    }

    root.innerHTML = html;

    root.querySelectorAll('[data-coin]').forEach(function (el) { el.addEventListener('click', function () { setCoin(el.dataset.coin); }); });
    var startBtn = $('mn-start'); if (startBtn) startBtn.addEventListener('click', start);
    var stopBtn = $('mn-stop'); if (stopBtn) stopBtn.addEventListener('click', stop);
    var addToggle = $('mn-addtoggle'); if (addToggle) addToggle.addEventListener('click', toggleAdd);
    root.querySelectorAll('[data-link]').forEach(function (el) { el.addEventListener('click', function () { linkRig(el.dataset.link); }); });
    root.querySelectorAll('[data-unlink]').forEach(function (el) { el.addEventListener('click', function () { unlinkRig(el.dataset.unlink); }); });
  }

  function load() {
    api('info', {}).then(function (r) {
      M.loading = false;
      if (r && r.success) {
        M.error = false;
        // Phase 6: a payout landed since the last poll (8s) - ping + briefly flash the number. Only
        // once M.prevBalance has a real prior value, so opening the app never pings on its first load.
        M.balanceFlash = M.prevBalance != null && typeof r.data.balance === 'number' && r.data.balance > M.prevBalance;
        M.prevBalance = r.data.balance;
        M.data = r.data;
        if (M.balanceFlash) {
          ping();
          setTimeout(function () { M.balanceFlash = false; var el = $('mn-balance-val'); if (el) el.classList.remove('mn-flash'); }, 900);
        }
        render();
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

  function start() {
    if (M.busy) return;
    M.busy = true;
    api('start', {}).then(function (r) { M.busy = false; if (!(r && r.success)) fail(r); load(); });
  }
  function stop() {
    if (M.busy) return;
    M.busy = true;
    api('stop', {}).then(function (r) { M.busy = false; if (!(r && r.success)) fail(r); load(); });
  }
  function setCoin(coin) {
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
    api('linkRig', { rigKey: rigKey }).then(function (r) { if (!(r && r.success)) fail(r); toggleAdd(); toggleAdd(); load(); });
  }
  function unlinkRig(rigKey) {
    api('unlinkRig', { rigKey: rigKey }).then(function (r) { if (!(r && r.success)) fail(r); load(); });
  }

  var HTML = '<div class="mn" id="mn"></div><div class="mn-toast" id="mn-toast"></div>';

  var root = S.registerApp({
    id: 'mining', icon: ICON_APP, titleKey: 'mn_app_name', titleDef: 'Mining Rig', w: 620, h: 720, html: HTML,
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
