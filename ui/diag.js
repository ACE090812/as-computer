/* Diagnostics: part condition, temperature and the recent fault codes (blue screens) of the computer being used. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;
  var esc = S.esc;
  function T(k, d) { return S.t(k, d); }
  var ICON = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#b45309"/><path d="M5 12h3l2-4 3 8 2-4h4" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var timer = null;
  function name(slot) { return T('hw_slot_' + slot, slot.toUpperCase()); }
  function draw(r) {
    var el = document.getElementById('dg-body');
    if (!el) return;
    if (!r || !r.success) { el.innerHTML = '<div class="dg-empty">-</div>'; return; }
    var hot = r.temp >= (r.hot || 85);
    var slots = Object.keys(r.slots || {}).sort();
    var h = '<div class="dg-top"><div class="dg-card' + (hot ? ' hot' : '') + '"><b>' + esc(T('hw_temp', 'Temperature')) + '</b><span>' + Math.round(r.temp || 0) + '&deg;C</span></div>' +
      '<div class="dg-card"><b>' + esc(T('hw_slot_cpu', 'CPU')) + '</b><span>' + (Math.round((r.perf || 0) * 100) / 100) + 'x</span></div></div>';
    if (r.missing && r.missing.length) h += '<div class="dg-miss">' + esc(T('hw_missing_parts', 'Missing:')) + ' ' + esc(r.missing.map(name).join(', ')) + '</div>';
    slots.forEach(function (s) {
      var p = r.slots[s], hp = Math.max(0, Math.min(100, Math.round(p.wear)));
      h += '<div class="dg-row"><span class="n">' + esc(name(s)) + '</span><span class="t">' + esc(p.tier || '') + '</span><div class="dg-bar"><i class="' + (hp < 25 ? 'low' : hp < 55 ? 'mid' : '') + '" style="width:' + hp + '%"></i></div><span class="p">' + hp + '%</span></div>';
    });
    h += '<div class="dg-h">' + esc(T('hw_faults', 'Recent faults')) + '</div>';
    if (!r.faults || !r.faults.length) h += '<div class="dg-empty">-</div>';
    else r.faults.forEach(function (f) {
      h += '<div class="dg-f">' + esc(new Date(f.at * 1000).toLocaleString()) + ' &nbsp; ' + esc(f.code) + ' (' + esc(f.hex) + ') &nbsp; ' + esc(name(String(f.part || 'cpu'))) + '</div>';
    });
    el.innerHTML = h;
  }
  function refresh() { S.api('hardwareApi', {}).then(draw); }
  S.registerApp({
    id: 'diag', icon: ICON, titleKey: 'app_diag', titleDef: 'Diagnostics', w: 520, h: 480,
    html: '<div class="dg" id="dg-body"></div>',
    onOpen: function () { refresh(); clearInterval(timer); timer = setInterval(refresh, 8000); },
    onClose: function () { clearInterval(timer); },
    onReset: function () { clearInterval(timer); },
    onLocale: function () { refresh(); }
  });
})();
