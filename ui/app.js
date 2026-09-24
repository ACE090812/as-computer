/* Los Santos OS — desktop shell + MOT Testing Service + File Explorer + certificate viewer.
   One page, two render modes (see style.css): html.dui = ambient world texture, html.overlay = focused NUI.
   Lua drives it with NUI/DUI messages: setLocale, setChecklist, open, close, lookupResult, submitResult, certificates. */
(function () {
  'use strict';

  var root = document.documentElement;
  var isDui = root.classList.contains('dui');
  var app = document.getElementById('app');
  function $(id) { return document.getElementById(id); }

  var state = {
    strings: {},            // locale strings from Lua (English fallbacks live at each t() call)
    checklistSections: [],
    checkResults: {},
    notes: {},              // { itemId: text } for items marked advise / fail
    currentPlate: null,
    lastLookup: null,
    lastSubmit: null,
    rect: null,             // {x,y,w,h} 0-1 of the game screen when drawn over a monitor
    busy: false,
    user: '',
    lockEnabled: true,
    lockPassword: false,
    canPrint: false,
    printer: false,
    manageOthers: false,
    certs: null,            // array of certificates (server order: newest first)
    certsState: 'idle',     // idle | loading | ok | error
    certsTimer: null,
    prefs: null,            // this character's Settings (null = defaults)
    internet: true,
    apps: null,             // { [appId]: bool } which apps this job has (null = not sent, show all)
    store: true             // the Store app exists on this server
  };

  // ---------------------------------------------------------------- helpers
  function t(key, fallback) {
    var s = state.strings[key];
    return (s === undefined || s === null) ? fallback : s;
  }
  function fmt(str) {
    var args = Array.prototype.slice.call(arguments, 1), i = 0;
    return str.replace(/%s/g, function () { return args[i++]; });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function loc() { return t('ui_date_locale', 'en-GB'); }

  function parseTs(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    var m = String(v).match(/(\d+)-(\d+)-(\d+)(?:[ T](\d+):(\d+):(\d+))?/);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  function fmtDate(v) {
    var ts = parseTs(v);
    if (ts === null) return '—';
    return new Date(ts).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function unitLabel(u) { return u === 'kilometers' ? t('ui_unit_km', 'km') : t('ui_unit_miles', 'miles'); }
  function fmtPlate(p) {
    p = String(p || '').toUpperCase().replace(/\s+/g, '');
    return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(p) ? p.slice(0, 4) + ' ' + p.slice(4) : p;
  }
  function itemLabel(id) {
    for (var i = 0; i < state.checklistSections.length; i++) {
      var items = state.checklistSections[i].items;
      for (var j = 0; j < items.length; j++) {
        if (items[j].id === id) return { section: state.checklistSections[i].section, label: items[j].label };
      }
    }
    return { section: '—', label: id };
  }
  // "Label — note" list items (HTML-safe). notes = { itemId: text } or undefined.
  function noteOf(notes, id) {
    var n = notes && typeof notes === 'object' ? notes[id] : null;
    return (typeof n === 'string' && n) ? n : '';
  }
  function itemsWithNotes(ids, notes) {
    return (ids || []).map(function (id) {
      var n = noteOf(notes, id);
      return esc(itemLabel(id).label) + (n ? ' <i>(' + esc(n) + ')</i>' : '');
    }).join(', ');
  }

  function postToClient(action, data) {
    fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data || {})
    }).catch(function () { /* not inside FiveM (browser preview) */ });
  }

  // ---------------------------------------------------------------- icons (own artwork)
  var ICONS = {
    start: '<svg viewBox="0 0 24 24"><path d="M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8z" fill="#1d70b8"/><path d="M12 1.6l9 5.2-9 5.2-9-5.2z" fill="#4da3e8"/><text x="12" y="17.2" font-size="7.4" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial">LS</text></svg>',
    crest: '<svg viewBox="0 0 24 24"><path d="M12 1.6l9 5.2v10.4l-9 5.2-9-5.2V6.8z" fill="#1d70b8"/><text x="12" y="15.6" font-size="7.4" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial">LS</text></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#e5b12b"/><path d="M2 9.5a1.5 1.5 0 0 1 1.5-1.5h17A1.5 1.5 0 0 1 22 9.5V18a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z" fill="#f9d566"/></svg>',
    fileimg: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.4" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><circle cx="8.6" cy="9.4" r="1.7" fill="#f5b83d"/><path d="M4.6 18l4.6-5 3.4 3.6 2.6-2.8 4.2 4.2z" fill="#5fae6e"/></svg>',
    filevid: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.4" fill="#3b4a63"/><path d="M10 9.2l5 2.8-5 2.8z" fill="#fff"/></svg>',
    fileaud: '<svg viewBox="0 0 24 24"><path d="M5 2.5h9.2L19 7.3V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><path d="M11 17.2V10l4-1v6.2" fill="none" stroke="#7a5ac8" stroke-width="1.5"/><circle cx="9.8" cy="17.4" r="1.6" fill="#7a5ac8"/><circle cx="13.9" cy="15.6" r="1.6" fill="#7a5ac8"/></svg>',
    filegen: '<svg viewBox="0 0 24 24"><path d="M5 2.5h9.2L19 7.3V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><path d="M14 2.6V7.5h5" fill="#e6e9ef" stroke="#8a93a3" stroke-width="1.1"/><path d="M8 13.5h8M8 16.5h5" stroke="#8a93a3" stroke-width="1.3" stroke-linecap="round"/></svg>',
    filetxt: '<svg viewBox="0 0 24 24"><path d="M5 2.5h9.2L19 7.3V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><path d="M14 2.6V7.5h5" fill="#e6e9ef" stroke="#8a93a3" stroke-width="1.1"/><path d="M7.4 11h9.2M7.4 14h9.2M7.4 17h5.6" stroke="#5b6b85" stroke-width="1.3" stroke-linecap="round"/></svg>',
    pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="1.6" fill="#3b8dea"/><rect x="4.5" y="5.5" width="15" height="9" rx=".8" fill="#9fd0ff"/><path d="M8 20h8M12 16v4" stroke="#556" stroke-width="1.6" stroke-linecap="round"/></svg>',
    mot: '<svg viewBox="0 0 24 24"><rect x="4" y="3.5" width="16" height="18.5" rx="2.6" fill="#1d70b8"/><rect x="8" y="1.6" width="8" height="4.2" rx="1.6" fill="#003078"/><path d="M8 13.4l3 3 5-6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bin: '<svg viewBox="0 0 24 24"><path d="M6 7h12l-1 13a1.6 1.6 0 0 1-1.6 1.4H8.6A1.6 1.6 0 0 1 7 20z" fill="#9aa4b5"/><rect x="4.5" y="4.6" width="15" height="2.4" rx="1.1" fill="#7c8799"/><rect x="9.5" y="2.6" width="5" height="2.4" rx="1" fill="#7c8799"/><path d="M10 10v8M14 10v8" stroke="#eef" stroke-width="1.3" stroke-linecap="round"/></svg>',
    certpass: '<svg viewBox="0 0 24 24"><path d="M5 2.5h9.2L19 7.3V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><path d="M14 2.6V7.5h5" fill="#e3e8f2" stroke="#8a93a3" stroke-width="1.1"/><circle cx="16.5" cy="17" r="5" fill="#1f9d55"/><path d="M14.2 17l1.7 1.7 2.9-3.2" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10.5h6M7 13.5h4" stroke="#b3bccb" stroke-width="1.2" stroke-linecap="round"/></svg>',
    certfail: '<svg viewBox="0 0 24 24"><path d="M5 2.5h9.2L19 7.3V21a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z" fill="#fff" stroke="#8a93a3" stroke-width="1.1"/><path d="M14 2.6V7.5h5" fill="#e3e8f2" stroke="#8a93a3" stroke-width="1.1"/><circle cx="16.5" cy="17" r="5" fill="#d4351c"/><path d="M14.4 14.9l4.2 4.2M18.6 14.9l-4.2 4.2" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M7 10.5h6M7 13.5h4" stroke="#b3bccb" stroke-width="1.2" stroke-linecap="round"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="12" cy="8" r="4.4"/><path d="M3.8 21c0-4.6 3.6-7.4 8.2-7.4s8.2 2.8 8.2 7.4z"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.6 6.6a8 8 0 1 0 10.8 0"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.6 12.4a9.6 9.6 0 0 1 12.8 0"/><path d="M8.8 15.8a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.6L12.5 5v14l-4.9-4.5H4z" fill="currentColor"/><path d="M16 9a4.4 4.4 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 5l-7 7 7 7"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 11l7-7 7 7"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>',
    binfull: '<svg viewBox="0 0 24 24"><rect x="7.5" y="1" width="8" height="7" rx=".6" fill="#fff" stroke="#8a93a3" stroke-width=".8" transform="rotate(-10 11 4.5)"/><rect x="10" y="1.6" width="8" height="7" rx=".6" fill="#f3f6fb" stroke="#8a93a3" stroke-width=".8" transform="rotate(8 14 5)"/><path d="M6 7h12l-1 13a1.6 1.6 0 0 1-1.6 1.4H8.6A1.6 1.6 0 0 1 7 20z" fill="#9aa4b5"/><rect x="4.5" y="6" width="15" height="2.4" rx="1.1" fill="#7c8799"/><path d="M10 11v7M14 11v7" stroke="#eef" stroke-width="1.3" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>',
    restore: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 1 2.4 5.7"/><path d="M4 5v7h7"/></svg>',
    rename: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    printer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 8V3h10v5"/><rect x="3.5" y="8" width="17" height="8.5" rx="2"/><rect x="7" y="13.5" width="10" height="7" fill="#fff"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    calendar: '',
    settings: '<svg viewBox="0 0 24 24"><path d="M10.3 2.5h3.4l.5 2.4c.6.2 1.1.5 1.6.9l2.3-.8 1.7 3-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 3-2.3-.8c-.5.4-1 .7-1.6.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.1-.5-1.6-.9l-2.3.8-1.7-3 1.8-1.6a5.5 5.5 0 0 1 0-1.8L4.2 8l1.7-3 2.3.8c.5-.4 1-.7 1.6-.9z" fill="#7d8797"/><circle cx="12" cy="11" r="3.2" fill="#dfe6f2"/><circle cx="12" cy="11" r="1.6" fill="#0f6cbd"/></svg>',
    se_home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.2L12 4l8.5 7.2"/><path d="M6 9.8V20h4.5v-5.5h3V20H18V9.8"/></svg>',
    se_system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8.5 20h7M12 16.5V20"/></svg>',
    se_network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 9a14 14 0 0 1 18.8 0"/><path d="M5.7 12.3a9.6 9.6 0 0 1 12.6 0"/><path d="M8.8 15.6a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    se_wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.6 9a14 14 0 0 1 18.8 0"/><path d="M5.7 12.3a9.6 9.6 0 0 1 12.6 0"/><path d="M8.8 15.6a5 5 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    se_brush: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4.5l5 5-8.3 8.3a3.4 3.4 0 0 1-4.8 0l-.2-.2a3.4 3.4 0 0 1 0-4.8z"/><path d="M11 8l5 5"/><path d="M5.5 19.5c0-1.5.6-2.6 2-3"/></svg>',
    se_person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.6 20c.5-4 3.6-6 7.4-6s6.9 2 7.4 6"/></svg>',
    se_clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.4 2"/></svg>',
    se_globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><ellipse cx="12" cy="12" rx="3.6" ry="8.6"/><path d="M3.6 12h16.8"/></svg>',
    se_display: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8.5 20h7M12 16.5V20"/></svg>',
    se_about: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4"/><circle cx="12" cy="7.9" r=".6" fill="currentColor"/></svg>',
    se_image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17.5l4.6-4.4 3.4 3 3-2.6 5 4"/></svg>',
    se_palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.9 1.6-1.9-.4-1.2.4-2.1 1.6-2.1H17a3.5 3.5 0 0 0 3.5-3.5C20.5 7 16.7 3.5 12 3.5z"/><circle cx="7.6" cy="11" r="1" fill="currentColor"/><circle cx="10.4" cy="7.4" r="1" fill="currentColor"/><circle cx="14.8" cy="7.6" r="1" fill="currentColor"/></svg>',
    se_lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7"/></svg>',
    se_taskbar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15h18"/><path d="M8 17.4h1M11.5 17.4h1M15 17.4h1"/></svg>',
    se_search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.3"/><path d="M15.4 15.4L20.5 20.5"/></svg>',
    se_key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8.5" cy="14.5" r="3.6"/><path d="M11 12l8-8M16 7l2.4 2.4M14 9l2 2"/></svg>',
    se_sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/></svg>',
    se_moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2z"/></svg>',
    se_mode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.6"/><path d="M12 3.4v17.2a8.6 8.6 0 0 0 0-17.2z" fill="currentColor"/></svg>',
    se_fit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M8 9.5V8h1.5M16 9.5V8h-1.5M8 14.5V16h1.5M16 14.5V16h-1.5"/></svg>',
    se_calfmt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
    se_cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
    se_check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.4 4.4L19 7.4"/></svg>',
    se_chevr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    se_chevd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>',
    se_pc: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12.5" rx="1.6" fill="#3b8dea"/><rect x="4.4" y="5.4" width="15.2" height="9.7" rx=".8" fill="#a9d4ff"/><path d="M8 20h8M12 16.5V20" stroke="#6a7284" stroke-width="1.8" stroke-linecap="round"/></svg>',
    store: '<svg viewBox="0 0 24 24"><path d="M5.2 8.2h13.6l.9 11.6a1.6 1.6 0 0 1-1.6 1.7H5.9a1.6 1.6 0 0 1-1.6-1.7z" fill="#1d70b8"/><path d="M8.4 8.2V6.6a3.6 3.6 0 0 1 7.2 0v1.6" fill="none" stroke="#0b3d75" stroke-width="1.8" stroke-linecap="round"/><rect x="8.2" y="11.6" width="3.4" height="3.4" fill="#f25022"/><rect x="12.4" y="11.6" width="3.4" height="3.4" fill="#7fba00"/><rect x="8.2" y="15.8" width="3.4" height="3.4" fill="#00a4ef"/><rect x="12.4" y="15.8" width="3.4" height="3.4" fill="#ffb900"/></svg>',
    sthome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11L12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/></svg>',
    stapps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.4"/><rect x="13" y="4" width="7" height="7" rx="1.4"/><rect x="4" y="13" width="7" height="7" rx="1.4"/><rect x="13" y="13" width="7" height="7" rx="1.4"/></svg>',
    stlib: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v16M10 4v16"/><path d="M14.4 5.6l4.6 13 1.6-.6-4.6-13z"/></svg>',
    appdef: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="#8a94a6"/><rect x="7" y="7" width="4" height="4" fill="#fff"/><rect x="13" y="7" width="4" height="4" fill="#fff" opacity=".8"/><rect x="7" y="13" width="4" height="4" fill="#fff" opacity=".8"/><rect x="13" y="13" width="4" height="4" fill="#fff" opacity=".6"/></svg>',
    brglobe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1b7fe0"/><ellipse cx="12" cy="12" rx="4.3" ry="10" fill="none" stroke="#fff" stroke-width="1.3"/><path d="M2.4 9h19.2M2.4 15h19.2M12 2v20" stroke="#fff" stroke-width="1.3" fill="none"/><circle cx="12" cy="12" r="10" fill="none" stroke="#0b5cb5" stroke-width="1"/></svg>',
    brhome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 11.2L12 4l8.5 7.2"/><path d="M6 10v9.5h4.6v-5.4h2.8v5.4H18V10"/></svg>',
    brstar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
    brstaron: '<svg viewBox="0 0 24 24" fill="#f9ab00" stroke="#f9ab00" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
    brmore: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>',
    brlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    brx: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    brplus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    min: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 7h10"/></svg>',
    max: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.2" y="2.2" width="9.6" height="9.6" rx="1.4"/></svg>',
    restore: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.2" y="4.4" width="7.4" height="7.4" rx="1.2"/><path d="M4.6 4.4V3.4a1.2 1.2 0 0 1 1.2-1.2h5a1.2 1.2 0 0 1 1.2 1.2v5a1.2 1.2 0 0 1-1.2 1.2h-1.2"/></svg>',
    close: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2.6 2.6l8.8 8.8M11.4 2.6l-8.8 8.8"/></svg>'
  };
  function ic(name) { return ICONS[name] || ''; }
  function icSpan(name) { return '<span class="ic">' + ic(name) + '</span>'; }
  function fillIcons(scope) {
    (scope || document).querySelectorAll('[data-ic]').forEach(function (el) { el.innerHTML = ic(el.dataset.ic); });
  }

  // ---------------------------------------------------------------- locale
  function applyLocale() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var s = state.strings[el.dataset.i18n];
      if (s !== undefined) el.textContent = s;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      var s = state.strings[el.dataset.i18nPlaceholder];
      if (s !== undefined) el.placeholder = s;
    });
  }

  // ---------------------------------------------------------------- overlay scaling
  function fit() {
    if (isDui) return;
    var iw = window.innerWidth, ih = window.innerHeight;
    if (state.rect) {
      // Fill the monitor's screen rect: 1920px design width scaled to the rect's width, page height
      // stretched to whatever the rect's aspect needs. Windows/taskbar are flow-independent of height.
      var rw = state.rect.w * iw, rh = state.rect.h * ih;
      var sc = rw / 1920;
      root.classList.add('onmonitor');
      app.style.width = '1920px';
      app.style.height = (rh / sc) + 'px';
      app.style.left = (state.rect.x * iw) + 'px';
      app.style.top = (state.rect.y * ih) + 'px';
      app.style.transform = 'scale(' + sc + ')';
    } else {
      root.classList.remove('onmonitor');
      app.style.left = ''; app.style.top = ''; app.style.width = ''; app.style.height = '';
      app.style.transform = 'translate(-50%,-50%) scale(' + Math.min(iw / 1920, ih / 1080) + ')';
    }
  }
  window.addEventListener('resize', fit);
  fit();

  function scaleFactor() {
    var r = app.getBoundingClientRect();
    return (app.offsetWidth ? r.width / app.offsetWidth : 1) || 1;
  }

  // ---------------------------------------------------------------- clock
  function tick() {
    var d = new Date(), l = loc(), p = state.prefs || {};
    var time = d.toLocaleTimeString(l, { hour: '2-digit', minute: '2-digit', hour12: p.clock24 === false });
    var f = p.dateFormat, pad = function (n) { return ('0' + n).slice(-2); };
    var date = f === 'mdy' ? pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + '/' + d.getFullYear()
      : f === 'ymd' ? d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      : f === 'dmy' ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() : d.toLocaleDateString(l);
    $('tb-time').textContent = time;
    $('tb-date').textContent = date;
    $('lock-time').textContent = time;
    $('lock-date').textContent = d.toLocaleDateString(l, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  setInterval(tick, 1000);

  // ================================================================ window manager
  var wins = {};
  var zTop = 10;
  var activeId = null;
  var cascade = 0;
  var drag = null;

  function areaSize() { var w = $('windows'); return { w: w.clientWidth, h: w.clientHeight }; }
  function winByEl(el) {
    for (var k in wins) { if (wins[k].el === el) return wins[k]; }
    return null;
  }

  function defWin(id, o) {
    var el = o.el;
    el.classList.add('win');
    var tb = document.createElement('div');
    tb.className = 'titlebar';
    tb.innerHTML = '<span class="tb-ic">' + ic(o.icon) + '</span><span class="tb-title"></span>' +
      '<span class="tb-btns"><button class="wb" data-wb="min">' + ic('min') + '</button>' +
      '<button class="wb" data-wb="max">' + ic('max') + '</button>' +
      '<button class="wb close" data-wb="close">' + ic('close') + '</button></span>';
    el.insertBefore(tb, el.firstChild);
    var grip = document.createElement('div');
    grip.className = 'grip';
    el.appendChild(grip);
    wins[id] = { id: id, el: el, icon: o.icon, titleKey: o.titleKey, titleDef: o.titleDef, title: o.title,
      w: o.w, h: o.h, x: 0, y: 0, open: false, min: false, max: false, dynamic: !!o.dynamic, onOpen: o.onOpen, onClose: o.onClose };
    setTitle(id);
  }

  function setTitle(id) {
    var w = wins[id];
    if (!w) return;
    var text = w.title || t(w.titleKey, w.titleDef);
    w.el.querySelector('.tb-title').textContent = text;
  }
  function retitleAll() { for (var k in wins) setTitle(k); }

  function applyGeom(w) {
    w.el.style.left = w.x + 'px';
    w.el.style.top = w.y + 'px';
    w.el.style.width = w.w + 'px';
    w.el.style.height = w.h + 'px';
  }

  function placeWin(w) {
    var a = areaSize();
    w.w = Math.min(w.w, a.w - 24);
    w.h = Math.min(w.h, a.h - 24);
    var off = (cascade++ % 5) * 34;
    w.x = Math.max(0, Math.round((a.w - w.w) / 2 - 60 + off));
    w.y = Math.max(0, Math.round((a.h - w.h) / 2 - 20 + off));
    applyGeom(w);
  }

  function focusWin(id) {
    var w = wins[id];
    if (!w || !w.open || w.min) return;
    for (var k in wins) wins[k].el.classList.toggle('active', k === id);
    w.el.style.zIndex = ++zTop;
    activeId = id;
    renderTaskbar();
  }

  function openWin(id) {
    var w = wins[id];
    if (!w) return;
    var fresh = !w.open;
    w.open = true;
    w.min = false;
    w.el.classList.add('open');
    w.el.classList.remove('minimised');
    if (fresh) { w.max = false; w.el.classList.remove('max'); syncMaxIcon(w); placeWin(w); }
    if (fresh && w.onOpen) w.onOpen();
    focusWin(id);
  }

  function topOpenWin() {
    var best = null;
    for (var k in wins) {
      var w = wins[k];
      if (w.open && !w.min && (!best || (+w.el.style.zIndex || 0) > (+best.el.style.zIndex || 0))) best = w;
    }
    return best;
  }

  function minWin(id) {
    var w = wins[id];
    if (!w) return;
    w.min = true;
    w.el.classList.add('minimised');
    w.el.classList.remove('active');
    var nxt = topOpenWin();
    if (nxt) focusWin(nxt.id); else { activeId = null; renderTaskbar(); }
  }

  function closeWin(id) {
    var w = wins[id];
    if (!w) return;
    w.open = false;
    w.min = false;
    w.el.classList.remove('open', 'active', 'minimised');
    if (id === 'browser' && typeof brReset === 'function') brReset();
    if (w.onClose) w.onClose();
    if (w.dynamic) { w.el.remove(); delete wins[id]; }
    var nxt = topOpenWin();
    if (nxt) focusWin(nxt.id); else { activeId = null; renderTaskbar(); }
  }

  function syncMaxIcon(w) {
    var b = w.el.querySelector('[data-wb="max"]');
    if (b) b.innerHTML = ic(w.max ? 'restore' : 'max');
  }
  function toggleMax(id) {
    var w = wins[id];
    if (!w) return;
    w.max = !w.max;
    w.el.classList.toggle('max', w.max);
    syncMaxIcon(w);
    focusWin(id);
  }

  function closeAllWindows() {
    Object.keys(wins).forEach(function (k) { closeWin(k); });
    activeId = null;
    cascade = 0;
  }

  // drag / resize
  document.addEventListener('pointerdown', function (e) {
    if (isDui) return;
    var winEl = e.target.closest ? e.target.closest('.win') : null;
    if (!winEl) return;
    var w = winByEl(winEl);
    if (!w) return;
    focusWin(w.id);
    var onBar = e.target.closest('.titlebar') && !e.target.closest('.wb');
    var onGrip = e.target.closest('.grip');
    if (!onBar && !onGrip) return;
    if (onBar && w.max) return;
    drag = { w: w, mode: onGrip ? 'size' : 'move', sx: e.clientX, sy: e.clientY, ox: w.x, oy: w.y, ow: w.w, oh: w.h, sc: scaleFactor() };
    $('windows').classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = (e.clientX - drag.sx) / drag.sc, dy = (e.clientY - drag.sy) / drag.sc;
    var a = areaSize(), w = drag.w;
    if (drag.mode === 'move') {
      w.x = Math.round(Math.min(a.w - 140, Math.max(140 - w.w, drag.ox + dx)));
      w.y = Math.round(Math.min(a.h - 40, Math.max(0, drag.oy + dy)));
    } else {
      w.w = Math.round(Math.max(520, Math.min(a.w - w.x, drag.ow + dx)));
      w.h = Math.round(Math.max(340, Math.min(a.h - w.y, drag.oh + dy)));
    }
    applyGeom(w);
  });
  function endDrag() { drag = null; $('windows').classList.remove('dragging'); }
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);

  // ---------------------------------------------------------------- which apps this job has
  // state.apps comes from the server (Store installs per job). An id it doesn't list is a built-in app.
  function appOn(id) { return !state.apps || state.apps[id] !== false; }
  var EXT = {};   // apps registered from other files with LSOS.registerApp (see the end of this file)
  function appVisible(id) {
    if (EXT[id]) return !!state.apps && state.apps[id] === true;
    if (id === 'store') return !!state.store;
    if (id === 'browser') return !!state.browser && appOn('browser');
    if (id === 'calendar') return !!state.calendar && appOn('calendar');
    return appOn(id);
  }
  var lastMotOn = null;
  function applyApps() {
    document.querySelectorAll('.dicon[data-app]').forEach(function (el) {
      el.classList.toggle('hidden', !appVisible(el.dataset.app));
    });
    // close windows of apps this job no longer has (uninstalled or never installed)
    ['mot', 'browser', 'calendar', 'store'].concat(Object.keys(EXT)).forEach(function (id) {
      if (!appVisible(id) && wins[id] && wins[id].open) closeWin(id);
    });
    var motOn = appVisible('mot');
    if (lastMotOn !== null && lastMotOn !== motOn) { state.certs = null; state.certsState = 'idle'; certStore = {}; }
    lastMotOn = motOn;
    renderTaskbar();
    layoutIcons();
    if (typeof renderExplorer === 'function') renderExplorer();
    if (menuOpen) renderStart();
  }

  // ---------------------------------------------------------------- desktop icons: free positioning
  // Icons snap to a grid cell (GRID.w x GRID.h) inside #desktop. Any icon without a saved position
  // falls back to the classic top-to-bottom, wrap-to-next-column order. Dragging one saves its cell
  // to prefs.iconPos (server-validated in server/settings.lua); dropping onto an occupied cell swaps
  // the two icons instead of stacking them.
  var GRID = { w: 112, h: 118, padX: 10, padY: 10 };
  function iconRows() {
    var h = ($('desktop') && $('desktop').clientHeight) || 600;
    return Math.max(1, Math.floor((h - GRID.padY * 2) / GRID.h));
  }
  function placeIcon(el, c, r) {
    el.style.left = (GRID.padX + c * GRID.w) + 'px';
    el.style.top = (GRID.padY + r * GRID.h) + 'px';
  }
  function layoutIcons() {
    var desk = $('desktop'); if (!desk) return;
    var pos = P().iconPos || {};
    var rows = iconRows();
    var icons = Array.prototype.slice.call(desk.querySelectorAll('.dicon:not(.hidden)'));
    var occupied = {}, withPos = [], withoutPos = [];
    icons.forEach(function (el) {
      var id = el.dataset.app, p = pos[id];
      if (p && typeof p.c === 'number' && typeof p.r === 'number' && p.c >= 0 && p.r >= 0) {
        withPos.push({ el: el, c: p.c, r: p.r });
        occupied[p.c + ',' + p.r] = true;
      } else withoutPos.push(el);
    });
    withPos.forEach(function (o) { placeIcon(o.el, o.c, o.r); });
    var next = 0;
    withoutPos.forEach(function (el) {
      while (occupied[Math.floor(next / rows) + ',' + (next % rows)]) next++;
      var c = Math.floor(next / rows), r = next % rows;
      occupied[c + ',' + r] = true; next++;
      placeIcon(el, c, r);
    });
  }
  window.addEventListener('resize', function () { clearTimeout(window.__iconLayoutT); window.__iconLayoutT = setTimeout(layoutIcons, 150); });

  var ICON_DRAG = null;
  document.addEventListener('mousedown', function (e) {
    if (isDui) return;
    var d = e.target.closest('.dicon'); if (!d || e.button !== 0) return;
    var desk = $('desktop'); if (!desk || !desk.contains(d)) return;
    ICON_DRAG = {
      el: d, id: d.dataset.app, moved: false,
      startX: e.clientX, startY: e.clientY,
      origLeft: parseFloat(d.style.left) || 0, origTop: parseFloat(d.style.top) || 0
    };
  });
  document.addEventListener('mousemove', function (e) {
    if (!ICON_DRAG) return;
    var dx = e.clientX - ICON_DRAG.startX, dy = e.clientY - ICON_DRAG.startY;
    if (!ICON_DRAG.moved && (Math.abs(dx) + Math.abs(dy)) > 4) { ICON_DRAG.moved = true; ICON_DRAG.el.classList.add('dragging'); }
    if (ICON_DRAG.moved) {
      ICON_DRAG.el.style.left = (ICON_DRAG.origLeft + dx) + 'px';
      ICON_DRAG.el.style.top = (ICON_DRAG.origTop + dy) + 'px';
    }
  });
  document.addEventListener('mouseup', function () {
    if (!ICON_DRAG) return;
    var drag = ICON_DRAG; ICON_DRAG = null;
    drag.el.classList.remove('dragging');
    if (!drag.moved) return; // a plain click — existing click handlers (select/open) still fire normally
    var rows = iconRows();
    var c = Math.max(0, Math.round((parseFloat(drag.el.style.left) - GRID.padX) / GRID.w));
    var r = Math.min(Math.max(0, rows - 1), Math.max(0, Math.round((parseFloat(drag.el.style.top) - GRID.padY) / GRID.h)));
    var pos = Object.assign({}, P().iconPos || {});
    var origC = Math.round((drag.origLeft - GRID.padX) / GRID.w), origR = Math.round((drag.origTop - GRID.padY) / GRID.h);
    var swapId = null;
    Object.keys(pos).forEach(function (k) { if (k !== drag.id && pos[k].c === c && pos[k].r === r) swapId = k; });
    if (swapId) pos[swapId] = { c: origC, r: origR };
    pos[drag.id] = { c: c, r: r };
    seSet({ iconPos: pos });
    layoutIcons();
  });

  // ---------------------------------------------------------------- taskbar
  // PINNED_BASE is the factory-default pinned set. Apps registered later via LSOS.registerApp
  // (Notepad, Mechanic, Mail, Calculator, MDT, ...) are NOT auto-added here any more — they only
  // show in the taskbar while actually open, unless the player pins them (right-click > Pin to
  // taskbar), same as real Windows. prefs.pinnedApps, once set, fully replaces this default list.
  var PINNED_BASE = [
    { id: 'store', icon: 'store', key: 'ui_app_store', def: 'Store' },
    { id: 'explorer', icon: 'folder', key: 'ui_app_explorer', def: 'File Explorer' },
    { id: 'browser', icon: 'brglobe', key: 'ui_app_browser', def: 'Scout' },
    { id: 'calendar', icon: 'calendar', key: 'ui_app_calendar', def: 'Calendar' },
    { id: 'mot', icon: 'mot', key: 'ui_service_mot', def: 'MOT Testing Service' }
  ];
  function pinnedIds() {
    var custom = P().pinnedApps;
    if (Array.isArray(custom)) return custom;
    return PINNED_BASE.map(function (p) { return p.id; });
  }
  function isPinned(id) { return pinnedIds().indexOf(id) >= 0; }
  function pinMeta(id) {
    for (var i = 0; i < PINNED_BASE.length; i++) if (PINNED_BASE[i].id === id) return PINNED_BASE[i];
    if (EXT[id]) return { id: id, icon: id, key: null, def: (EXT[id].name ? EXT[id].name() : id) };
    return null;
  }
  function togglePin(id) {
    var cur = pinnedIds().slice(), i = cur.indexOf(id);
    if (i >= 0) cur.splice(i, 1); else cur.push(id);
    seSet({ pinnedApps: cur });
    renderTaskbar();
  }
  function renderTaskbar() {
    var html = '';
    var shown = {};
    pinnedIds().forEach(function (id) {
      if (!appVisible(id)) return;
      var m = pinMeta(id);
      if (!m) return;
      shown[id] = true;
      var w = wins[id];
      var cls = 'tbbtn' + (w && w.open ? ' open' : '') + (activeId === id && w && !w.min ? ' active' : '');
      var label = m.key ? t(m.key, m.def) : m.def;
      html += '<button class="' + cls + '" data-tb="' + esc(id) + '" title="' + esc(label) + '">' + icSpan(m.icon) + '</button>';
    });
    Object.keys(wins).forEach(function (k) {
      if (shown[k] || !wins[k].open) return;
      var w = wins[k];
      var cls = 'tbbtn open' + (activeId === k && !w.min ? ' active' : '');
      html += '<button class="' + cls + '" data-tb="' + esc(k) + '" title="' + esc(w.title || '') + '">' + icSpan(w.icon) + '</button>';
    });
    $('tb-apps').innerHTML = html;
  }

  function taskbarClick(id) {
    var w = wins[id];
    if (!w) return;
    if (!w.open) openWin(id);
    else if (w.min) openWin(id);
    else if (activeId === id) minWin(id);
    else focusWin(id);
  }

  // ---------------------------------------------------------------- menus / lock
  var menuOpen = false;
  function setMenu(open) {
    menuOpen = open;
    $('startmenu').classList.toggle('hidden', !open);
    $('power-menu').classList.add('hidden');
    if (open) {
      $('sm-q').value = '';
      renderStart();
      setTimeout(function () { $('sm-q').focus(); }, 30);
    }
  }

  function renderStart() {
    var q = ($('sm-q').value || '').trim().toLowerCase();
    var pins = [
      { id: 'store', icon: 'store', name: t('ui_app_store', 'Store') },
      { id: 'settings', icon: 'settings', name: t('ui_app_settings', 'Settings') },
      { id: 'mot', icon: 'mot', name: t('ui_service_mot', 'MOT Testing Service') },
      { id: 'explorer', icon: 'folder', name: t('ui_app_explorer', 'File Explorer') },
      { id: 'browser', icon: 'brglobe', name: t('ui_app_browser', 'Scout') },
      { id: 'calendar', icon: 'calendar', name: t('ui_app_calendar', 'Calendar') },
      { id: 'certs', icon: 'certpass', name: t('ui_fx_mot', 'MOT Certificates') },
      { id: 'bin', icon: binCount() ? 'binfull' : 'bin', name: t('ui_app_bin', 'Recycle Bin') }
    ].concat(Object.keys(EXT).map(function (k) { return { id: k, icon: EXT[k].icon, name: EXT[k].name() }; }))
      .filter(function (p) { return (p.id === 'certs' ? appVisible('mot') : appVisible(p.id)) && (!q || p.name.toLowerCase().indexOf(q) !== -1); });
    $('sm-pins').innerHTML = pins.map(function (p) {
      return '<div class="pin" data-pin="' + p.id + '">' + icSpan(p.icon) + '<span>' + esc(p.name) + '</span></div>';
    }).join('');

    var list = liveCerts().filter(function (c) { return !q || certMatches(c, q); }).slice(0, 6);
    var rec = '';
    if (state.certsState === 'loading') rec = '<div class="sm-empty">' + esc(t('ui_fx_loading', 'Loading…')) + '</div>';
    else if (!list.length) rec = '<div class="sm-empty">' + esc(t('ui_start_none', 'No recent certificates')) + '</div>';
    else rec = list.map(function (c) {
      return '<div class="rec" data-rec="' + esc(c.testNumber) + '">' + icSpan(c.passed ? 'certpass' : 'certfail') +
        '<div class="rt"><b>' + esc(fmtPlate(c.plate)) + '</b><span>' + esc(fmtDate(c.issuedAt)) + ' · ' + esc(passWord(c)) + '</span></div></div>';
    }).join('');
    $('sm-rec').innerHTML = rec;
    $('sm-user').textContent = state.user || '—';
  }

  function showLock() {
    setMenu(false);
    if (!isDui) postToClient('sessionState', { state: 'locked' });
    $('lock-name').textContent = state.user || '—';
    var pwbox = $('lock-pwbox'), pw = $('lock-pw');
    if (pwbox) pwbox.classList.toggle('hidden', !state.lockPassword);
    if (pw) pw.value = '';
    showLockErr('');
    $('lock-hint').classList.toggle('hidden', !!state.lockPassword);
    $('lock').classList.remove('hidden');
    tick();
    if (state.lockPassword && pw) setTimeout(function () { pw.focus(); }, 30);
  }
  function signIn() {
    $('lock').classList.add('hidden');
    if (!isDui) postToClient('sessionState', { state: 'active' });
    if (state.certsState === 'idle') refreshCerts();
    if (FS.bin.state === 'idle') fsBinLoad(true);
  }

  // ---------------------------------------------------------------- Phase 0.5: setup / login gates
  function gateApi(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/accountApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
  }

  var GATE = { busy: false };

  function afterSignedIn() {
    $('gate-setup').classList.add('hidden');
    $('gate-login').classList.add('hidden');
    applyPrefs();
    applyApps();
    signIn();
  }

  function showGateSetup() {
    $('gate-login').classList.add('hidden');
    $('gs-user').value = '';
    $('gs-pass').value = '';
    $('gs-pass2').value = '';
    gateErr('gs-err', '');
    $('gate-setup').classList.remove('hidden');
    setTimeout(function () { $('gs-user').focus(); }, 30);
  }

  // fromFreshMachine: true only when this machine has never been set up (reached via the setup
  // wizard's "already have an account?" link) - session:login (server/session.lua) claims the machine
  // for whichever existing account signs in first, so the "create an account instead" link only makes
  // sense in that case. On an ORDINARY login (machine already claimed, this player just isn't signed
  // in on it right now) that link would be actively wrong - Setup always fails once a machine has an
  // owner, so it's kept hidden for the normal `needsLogin` flow.
  function showGateLogin(fromFreshMachine) {
    $('gate-setup').classList.add('hidden');
    $('gl-user').value = '';
    $('gl-pass').value = '';
    gateErr('gl-err', '');
    var sub = $('gl-sub'), link = $('gl-link');
    if (sub) sub.textContent = fromFreshMachine
      ? t('ui_login_sub_fresh', "Sign in with any existing account - it'll become this computer's admin.")
      : t('ui_login_sub', "Enter an account that's been granted access to this computer.");
    if (link) link.classList.toggle('hidden', !fromFreshMachine);
    $('gate-login').classList.remove('hidden');
    setTimeout(function () { $('gl-user').focus(); }, 30);
  }

  function gateErr(id, msg) { var e = $(id); if (e) e.textContent = msg || ''; }

  function submitGateSetup() {
    if (GATE.busy) return;
    var u = ($('gs-user').value || '').trim();
    var p1 = $('gs-pass').value || '';
    var p2 = $('gs-pass2').value || '';
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(u)) { gateErr('gs-err', t('ui_setup_err_user', 'Username must be 3-20 letters, numbers or _')); return; }
    if (p1.length < 4) { gateErr('gs-err', t('ui_setup_err_short', 'Password must be at least 4 characters.')); return; }
    if (p1 !== p2) { gateErr('gs-err', t('ui_setup_err_match', "Passwords don't match.")); return; }
    GATE.busy = true; gateErr('gs-err', '');
    gateApi('setup', { username: u, password: p1 }).then(function (r) {
      GATE.busy = false;
      if (r && r.success) { afterSignedIn(); return; }
      var msg = (r && r.error === 'taken') ? t('ui_setup_err_taken', 'That username is already taken.')
        : (r && r.error === 'already_setup') ? t('ui_setup_err_already', 'This computer has already been set up.')
        : t('notify_error', 'Something went wrong. Try again.');
      gateErr('gs-err', msg);
      if (r && r.error === 'already_setup') setTimeout(showGateLogin, 1200);
    });
  }

  function submitGateLogin() {
    if (GATE.busy) return;
    var u = ($('gl-user').value || '').trim();
    var p = $('gl-pass').value || '';
    if (!u || !p) { gateErr('gl-err', t('ui_login_err_req', 'Enter a username and password.')); return; }
    GATE.busy = true; gateErr('gl-err', '');
    gateApi('login', { username: u, password: p }).then(function (r) {
      GATE.busy = false;
      if (r && r.success) { afterSignedIn(); return; }
      var msg = (r && r.error === 'not_granted') ? t('ui_login_err_notgranted', "That account doesn't have access to this computer.")
        : t('ui_login_err_bad', 'Incorrect username or password.');
      gateErr('gl-err', msg);
      $('gl-pass').value = '';
      $('gl-pass').focus();
    });
  }


  // ================================================================ MOT window (GOV.UK look)
  var motWin = $('win-mot');

  function motShow(view) {
    motWin.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.dataset.view === view); });
  }
  function motReset() {
    state.checkResults = {}; state.notes = {};
    state.busy = false;
    $('reg').value = '';
    motShow('lookup');
    setTimeout(function () { var r = $('reg'); if (r) r.focus(); }, 60);
  }

  var BTN_LABELS = { pass: ['ui_btn_pass', 'Pass'], advise: ['ui_btn_advise', 'Advise'], fail: ['ui_btn_fail', 'Fail'] };

  function renderChecklist() {
    var mount = $('checklist-mount');
    mount.innerHTML = '';
    state.checklistSections.forEach(function (section, idx) {
      var sec = document.createElement('div');
      sec.className = 'checklist-section';
      if (idx === state.checklistSections.length - 1) sec.style.borderBottom = 'none';
      var h2 = document.createElement('h2');
      h2.textContent = (idx + 1) + '. ' + section.section;
      sec.appendChild(h2);
      section.items.forEach(function (item) {
        var wrap = document.createElement('div');
        wrap.className = 'check-wrap';
        var row = document.createElement('div');
        row.className = 'check-item';
        var label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.label;
        row.appendChild(label);
        var trio = document.createElement('div');
        trio.className = 'radio-trio';
        trio.dataset.item = item.id;
        ['pass', 'advise', 'fail'].forEach(function (val) {
          var btn = document.createElement('div');
          btn.className = 'radio-btn';
          btn.dataset.val = val;
          btn.textContent = t(BTN_LABELS[val][0], BTN_LABELS[val][1]);
          if (state.checkResults[item.id] === val) btn.classList.add(val + '-checked');
          trio.appendChild(btn);
        });
        row.appendChild(trio);
        wrap.appendChild(row);

        var noteBox = document.createElement('div');
        noteBox.className = 'note-box';
        var noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.maxLength = 200;
        noteInput.autocomplete = 'off';
        noteInput.dataset.note = item.id;
        noteInput.placeholder = t('ui_note_placeholder', 'Add a note for the vehicle owner (e.g. tread depth 2.1mm)');
        noteInput.value = state.notes[item.id] || '';
        noteBox.appendChild(noteInput);
        noteBox.style.display = (state.checkResults[item.id] === 'advise' || state.checkResults[item.id] === 'fail') ? 'block' : 'none';
        wrap.appendChild(noteBox);
        sec.appendChild(wrap);
      });
      mount.appendChild(sec);
    });
    var lk = state.lastLookup || {};
    $('ck-caption').textContent = (lk.plate || state.currentPlate || '—') + '  ·  ' +
      (lk.model || t('ui_unknown_vehicle', 'Unknown vehicle')) + '  ·  ' +
      t('ui_tester', 'Tester') + ': ' + (lk.testerName || '—');
  }

  function renderOverview(result) {
    $('ov-plate').textContent = result.plate || state.currentPlate || '—';
    $('ov-name').textContent = result.model || t('ui_unknown_vehicle', 'Unknown vehicle');

    var mileageInput = $('mileage'), mileageHint = $('mileage-hint');
    if (result.currentMileage) {
      mileageInput.value = result.currentMileage;
      mileageHint.textContent = fmt(t('ui_mileage_hint_auto', 'Auto-filled from vehicle mileage tracker (%s) — edit if needed'), unitLabel(result.mileageUnit));
    } else {
      mileageInput.value = '';
      mileageHint.textContent = t('ui_mileage_hint_manual', 'Vehicle mileage tracker unavailable — enter manually');
    }

    var statusEl = $('ov-status');
    statusEl.textContent = {
      valid: t('ui_status_valid', 'Valid'),
      expired: t('ui_status_expired', 'Expired'),
      failed_last_test: t('ui_status_failed', 'Failed last test'),
      never_tested: t('ui_status_never', 'Never tested'),
      unknown: t('ui_status_unknown', 'Unknown')
    }[result.status] || t('ui_status_unknown', 'Unknown');
    statusEl.classList.toggle('expired', result.status === 'expired' || result.status === 'failed_last_test' || result.status === 'never_tested');

    var bk = $('ov-booking'), bb = result.booking;
    bk.classList.toggle('hidden', !bb);
    if (bb) bk.textContent = fmt(t('ui_ov_booking', 'Booked for %s at %s (%s)'), bb.date, bb.time, bb.garageName || '');

    var mount = $('history-mount');
    mount.innerHTML = '';
    if (!result.history || !result.history.length) {
      mount.innerHTML = '<p style="color:var(--grey-1)">' + esc(t('ui_no_tests', 'No tests on record.')) + '</p>';
      return;
    }
    result.history.forEach(function (entry, idx) {
      var div = document.createElement('div');
      div.className = 'history-entry';
      if (idx === result.history.length - 1) div.style.borderBottom = 'none';
      var failedText = itemsWithNotes(entry.failedItems, entry.notes) || '—';
      var advisoryText = itemsWithNotes(entry.advisoryItems, entry.notes);
      var unit = unitLabel(entry.mileageUnit);
      div.innerHTML =
        '<div class="history-entry-grid">' +
          '<div><div class="k">' + esc(t('ui_date_tested', 'Date tested')) + '</div><div class="v">' + esc(fmtDate(entry.issuedAt)) + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_mileage', 'Mileage')) + '</div><div class="v">' + (entry.mileage ? esc(entry.mileage + ' ' + unit) : '—') + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_test_number', 'MOT test number')) + '</div><div class="v">' + esc(entry.testNumber || '—') + '</div></div>' +
        '</div>' +
        '<div class="history-entry-grid">' +
          '<div><div class="result-word ' + (entry.passed ? 'pass' : 'fail') + '">' + esc(passWord(entry)) + '</div>' +
            '<a class="view-link" data-cert="' + idx + '" style="cursor:pointer">' + esc(t('ui_cert_view', 'View certificate')) + '</a></div>' +
          '<div><div class="k">' + esc(t('ui_failed_label', 'Failed items')) + '</div><div class="v" style="font-size:16px">' + failedText + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_expiry', 'Expiry date')) + '</div><div class="v" style="' + (entry.passed ? '' : 'color:var(--red)') + '">' + (entry.passed ? esc(fmtDate(entry.expiresAt)) : '—') + '</div></div>' +
        '</div>' +
        (advisoryText ? '<div class="advisory-note">' + esc(t('ui_advisories_prefix', 'Advisories:')) + ' ' + advisoryText + '</div>' : '');
      mount.appendChild(div);
    });
  }

  function renderResult(result) {
    $('result-panel').classList.toggle('fail', !result.passed);
    $('result-heading').textContent = result.passed
      ? ((result.advisoryItems && result.advisoryItems.length) ? t('ui_result_pass_adv', 'This vehicle has PASSED its MOT test (with advisories)') : t('ui_result_pass', 'This vehicle has PASSED its MOT test'))
      : t('ui_result_fail', 'This vehicle has FAILED its MOT test');
    $('result-plate').textContent = state.currentPlate || '—';

    function fill(bodyId, wrapId, ids) {
      var body = $(bodyId);
      body.innerHTML = '';
      (ids || []).forEach(function (id) {
        var info = itemLabel(id);
        var tr = document.createElement('tr');
        tr.innerHTML = '<td>' + esc(info.section) + '</td><td>' + esc(info.label) + '</td><td>' + esc(noteOf(result.notes, id) || '—') + '</td>';
        body.appendChild(tr);
      });
      $(wrapId).style.display = (ids && ids.length) ? '' : 'none';
    }
    fill('result-failed-body', 'result-failed-wrap', result.failedItems);
    fill('result-advisory-body', 'result-advisory-wrap', result.advisoryItems);
  }

  function lockBusy() {
    if (state.busy) return false;
    state.busy = true;
    setTimeout(function () { state.busy = false; }, 8000);
    return true;
  }
  function startLookup(raw) {
    if (!lockBusy()) return;
    state.currentPlate = (raw || '').trim().toUpperCase();
    postToClient('lookupVehicle', { plate: state.currentPlate });
  }
  function submitInspection() {
    if (!lockBusy()) return;
    var mileage = parseInt($('mileage').value, 10) || null;
    var notes = {};
    Object.keys(state.notes).forEach(function (id) {
      var v = (state.notes[id] || '').trim();
      if (v && (state.checkResults[id] === 'advise' || state.checkResults[id] === 'fail')) notes[id] = v;
    });
    postToClient('submitInspection', { plate: state.currentPlate, results: state.checkResults, mileage: mileage, notes: notes });
  }

  motWin.addEventListener('click', function (e) {
    var radio = e.target.closest('.radio-btn');
    if (radio) {
      var group = radio.parentElement;
      group.querySelectorAll('.radio-btn').forEach(function (b) { b.classList.remove('pass-checked', 'fail-checked', 'advise-checked'); });
      radio.classList.add(radio.dataset.val + '-checked');
      var itemId = group.dataset.item;
      state.checkResults[itemId] = radio.dataset.val;
      var box = group.closest('.check-wrap').querySelector('.note-box');
      var needsNote = radio.dataset.val !== 'pass';
      box.style.display = needsNote ? 'block' : 'none';
      if (needsNote) { box.querySelector('input').focus(); }
      else { delete state.notes[itemId]; box.querySelector('input').value = ''; }
      return;
    }
    var certLink = e.target.closest('[data-cert]');
    if (certLink) {
      var entry = state.lastLookup && state.lastLookup.history && state.lastLookup.history[+certLink.dataset.cert];
      if (entry) openCert(certFromHistory(entry));
      return;
    }
    var actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      var action = actionEl.dataset.action;
      if (action === 'lookup') startLookup($('reg').value);
      if (action === 'history') startLookup(state.currentPlate);
      if (action === 'submit') submitInspection();
      if (action === 'viewcert' && state.lastSubmit) openCert(certFromSubmit(state.lastSubmit));
      return;
    }
    var go = e.target.closest('[data-goto]');
    if (!go) return;
    if (go.dataset.goto === 'checklist') { state.checkResults = {}; state.notes = {}; renderChecklist(); }
    motShow(go.dataset.goto);
  });

  motWin.addEventListener('input', function (e) {
    var inp = e.target.closest ? e.target.closest('[data-note]') : null;
    if (inp) state.notes[inp.dataset.note] = inp.value;
  });

  // ================================================================ certificates
  var certStore = {};

  function certFromHistory(h) {
    var lk = state.lastLookup || {};
    return {
      testNumber: h.testNumber, plate: lk.plate || state.currentPlate, model: lk.model, passed: !!h.passed,
      issuedAt: h.issuedAt, expiresAt: h.expiresAt, mileage: h.mileage, mileageUnit: h.mileageUnit,
      testerName: h.testerName, locationLabel: h.locationLabel, failedItems: h.failedItems || [], advisoryItems: h.advisoryItems || [], notes: h.notes
    };
  }
  function certFromSubmit(r) {
    var lk = state.lastLookup || {};
    return {
      testNumber: r.testNumber, plate: lk.plate || state.currentPlate, model: lk.model, passed: !!r.passed,
      issuedAt: r.issuedAt, expiresAt: r.expiresAt, mileage: r.mileage, mileageUnit: r.mileageUnit,
      testerName: r.testerName, locationLabel: r.locationLabel, failedItems: r.failedItems || [], advisoryItems: r.advisoryItems || [], notes: r.notes
    };
  }

  function passWord(c) {
    if (!c.passed) return t('ui_word_fail', 'FAIL');
    return (c.advisoryItems && c.advisoryItems.length) ? t('ui_word_pass_adv', 'PASS (with advisories)') : t('ui_word_pass', 'PASS');
  }

  function certExpired(c) {
    var ex = parseTs(c.expiresAt);
    return !!(c.passed && ex !== null && ex < Date.now());
  }

  function groupHtml(ids, notes) {
    var order = [], groups = {};
    (ids || []).forEach(function (id) {
      var info = itemLabel(id);
      if (!groups[info.section]) { groups[info.section] = []; order.push(info.section); }
      groups[info.section].push({ label: info.label, note: noteOf(notes, id) });
    });
    if (!order.length) return '<ul><li>' + esc(t('ui_cert_none', 'None')) + '</li></ul>';
    return order.map(function (sec) {
      return '<h4>' + esc(sec) + '</h4><ul>' + groups[sec].map(function (l) { return '<li>' + esc(l.label) + (l.note ? '<div class="p-note">' + esc(l.note) + '</div>' : '') + '</li>'; }).join('') + '</ul>';
    }).join('');
  }

  function certHTML(c) {
    var expired = certExpired(c);
    var mileage = c.mileage ? Number(c.mileage).toLocaleString(loc()) + ' ' + unitLabel(c.mileageUnit) : '—';
    var canPrint = state.canPrint;
    return '<div class="cert-wrap">' +
      '<div class="cert-bar"><span>' + esc(fmtPlate(c.plate)) + ' · ' + esc(c.testNumber) + '</span><span class="sp"></span>' +
        '<div class="btn ' + (canPrint ? 'primary' : 'off') + '" data-print="' + esc(c.testNumber) + '" title="' + esc(canPrint ? '' : t('ui_cert_noprinter', 'No printer connected')) + '">' +
          icSpan('printer') + '<span>' + esc(t('ui_cert_print', 'Print')) + '</span></div></div>' +
      '<div class="cert-scroll"><div class="paper">' +
        '<div class="p-head"><div><h1>' + esc(t('ui_cert_title', 'MOT test certificate')) + '</h1><div class="sub">' + esc(t('ui_cert_sub', 'Certificate of roadworthiness')) + '</div></div>' +
          '<div class="p-agency"><span class="crest ic">' + ic('crest') + '</span><br>' + esc(t('ui_cert_agency', 'Vehicle & Testing Standards Agency')) + '</div></div>' +
        '<div class="p-num"><div><div class="k">' + esc(t('ui_test_number', 'MOT test number')) + '</div><div class="v">' + esc(c.testNumber) + '</div></div>' +
          '<div style="text-align:right"><div class="k">' + esc(t('ui_cert_reg', 'Registration number')) + '</div><span class="p-plate">' + esc(fmtPlate(c.plate)) + '</span></div></div>' +
        '<div class="p-grid">' +
          '<div><div class="k">' + esc(t('ui_cert_make', 'Make and model')) + '</div><div class="v">' + esc((c.model || t('ui_unknown_vehicle', 'Unknown vehicle')).toString().toUpperCase()) + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_cert_vin', 'Vehicle identification number')) + '</div><div class="v">' + esc(c.vin || '—') + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_cert_mileage', 'Odometer reading')) + '</div><div class="v">' + esc(mileage) + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_cert_date', 'Date of test')) + '</div><div class="v">' + esc(fmtDate(c.issuedAt)) + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_cert_station', 'Test station')) + '</div><div class="v">' + esc(c.locationLabel || '—') + '</div></div>' +
          '<div><div class="k">' + esc(t('ui_cert_tester', 'Tested by')) + '</div><div class="v">' + esc(c.testerName || '—') + '</div></div>' +
        '</div>' +
        '<div class="p-result' + (c.passed ? '' : ' fail') + '"><div class="w">' + esc(passWord(c)) + '</div>' +
          '<div class="d">' + (c.passed
            ? esc(t('ui_expiry', 'Expiry date')) + ': <b>' + esc(fmtDate(c.expiresAt)) + '</b>' + (expired ? ' — ' + esc(t('ui_status_expired', 'Expired')) : '')
            : esc(t('ui_cert_notissued', 'No MOT certificate issued'))) + '</div></div>' +
        (c.passed ? '' : '<h3>' + esc(t('ui_cert_reasons', 'Reasons for failure')) + '</h3>' + groupHtml(c.failedItems, c.notes)) +
        '<h3>' + esc(t('ui_cert_advisories', 'Advisory notices')) + '</h3>' + groupHtml(c.advisoryItems, c.notes) +
        '<div class="p-foot"><span>' + esc(t('ui_cert_genuine', 'Check that this document is genuine at www.lossantos.gov/check-mot-history')) + '</span></div>' +
      '</div></div></div>';
  }

  function openCert(c) {
    if (!c || !c.testNumber) return;
    var id = 'cert:' + c.testNumber;
    certStore[c.testNumber] = c;
    if (wins[id]) { openWin(id); return; }
    var el = document.createElement('div');
    el.innerHTML = '<div class="win-body">' + certHTML(c) + '</div>';
    var win = document.createElement('div');
    win.appendChild(el.firstChild);
    $('windows').appendChild(win);
    defWin(id, {
      el: win, icon: c.passed ? 'certpass' : 'certfail', dynamic: true, w: 900, h: 800,
      title: t('ui_cert_title', 'MOT test certificate') + ' — ' + fmtPlate(c.plate)
    });
    openWin(id);
  }

  $('windows').addEventListener('click', function (e) {
    var p = e.target.closest('[data-print]');
    if (p && state.canPrint) {
      var c = certStore[p.dataset.print];
      if (c) printCert(c);
    }
  });

  function refreshCerts(silent) {
    if (!silent) state.certsState = 'loading';
    clearTimeout(state.certsTimer);
    state.certsTimer = setTimeout(function () {
      if (state.certsState === 'loading') { state.certsState = 'error'; renderExplorer(); }
    }, 9000);
    if (!silent) renderExplorer();
    postToClient('listCertificates');
  }

  // ---- certificate helpers (rename / recycle bin) ----
  function certName(c) { return c.name || (fmtPlate(c.plate) + ' — ' + c.testNumber); }
  function canManage(c) { return !!(c.mine || state.manageOthers); }
  function liveCerts() { return (state.certs || []).filter(function (c) { return !c.deleted; }); }
  function binCerts() { return (state.certs || []).filter(function (c) { return c.deleted; }); }
  function updateBinIcon() {
    var el = document.querySelector('.dicon[data-app="bin"] .ic');
    if (el) el.innerHTML = ic(binCount() ? 'binfull' : 'bin');
  }
  function nowStr() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function certMatches(c, q) {
    q = q.toLowerCase();
    var hay = [c.plate, fmtPlate(c.plate), c.testNumber, c.model, c.testerName, c.locationLabel, c.name].join(' ').toLowerCase();
    return hay.indexOf(q) !== -1 || hay.replace(/\s+/g, '').indexOf(q.replace(/\s+/g, '')) !== -1;
  }

  // ================================================================ File Explorer
  var NODES = {};
  (function build() {
    function add(k, parent, icn, key, def) { NODES[k] = { k: k, parent: parent, ic: icn, key: key, def: def, kids: [] }; if (parent) NODES[parent].kids.push(k); }
    add('root', null, 'pc', 'ui_fx_pc', 'This PC');
    add('docs', 'root', 'folder', 'ui_fx_docs', 'Documents');
    add('dl', 'root', 'folder', 'ui_fx_dl', 'Downloads');
    add('jobf', 'root', 'folder', 'fl_jobf', 'Shared');
    add('legalf', 'root', 'folder', 'fl_legalf', 'Case Files');
    add('courtf', 'root', 'folder', 'fl_courtf', 'Court Files');
    add('mot', 'root', 'folder', 'ui_fx_mot', 'MOT Certificates');
    add('mot/all', 'mot', 'folder', 'ui_fx_all', 'All certificates');
    add('mot/mine', 'mot', 'folder', 'ui_fx_mine', 'My tests');
    add('mot/passed', 'mot', 'folder', 'ui_fx_passed', 'Passed');
    add('mot/failed', 'mot', 'folder', 'ui_fx_failed', 'Failed');
    add('bin', 'root', 'bin', 'ui_fx_bin', 'Recycle Bin');
  })();
  // the MOT Certificates folder only exists for jobs that have the MOT app
  function kidsOf(k) {
    return NODES[k].kids.filter(function (c) {
      if (c === 'mot') return appVisible('mot');
      if (c === 'jobf') return !!FS.job;
      if (c === 'legalf') return !!FS.legal;
      if (c === 'courtf') return !!FS.court;
      if (c === 'docs' || c === 'dl') return FS.enabled !== false;
      return true;
    });
  }
  function nodeName(k) {
    if (k === 'jobf' && FS.job) return fmt(t('fl_shared', '%s (shared)'), FS.job);
    if (k === 'legalf' && FS.legal) return FS.legal;
    if (k === 'courtf' && FS.court) return FS.court;
    return t(NODES[k].key, NODES[k].def);
  }
  function nodeIcon(k) { return k === 'bin' ? (binCount() ? 'binfull' : 'bin') : NODES[k].ic; }

  var EX = { hist: ['root'], idx: 0, sel: {}, anchor: null, sortKey: 'date', sortDir: -1, q: '', view: [], renaming: null, renameVal: '' };

  // ================================================================ Files: Documents, Downloads, shared job folder
  // Folders (which can nest), text files, and links to images / video / audio / other files, kept on the server
  // (server/files.lua). Every call goes through the 'filesApi' NUI callback (client/files.lua); the server decides who may see
  // or change what, this page only shows it. An Explorer location is 'docs' | 'dl' | 'jobf', or 'docs:12' for the folder with
  // id 12 inside it.
  var FILE_KEY = { docs: 'docs', dl: 'dl', jobf: 'job', legalf: 'legal', courtf: 'court' };
  var FS = { tried: false, enabled: true, job: null, isBoss: false, legal: null, legalWrite: false, court: null, courtWrite: false, phone: false, recycle: true, limits: {}, state: {}, data: {}, seq: {}, edit: {}, bin: { state: 'idle', data: [], days: 0, seq: 0 } };
  var KIND_ICON = { folder: 'folder', text: 'filetxt', image: 'fileimg', video: 'filevid', audio: 'fileaud', file: 'filegen' };

  function fsBase(k) { return String(k).split(':')[0]; }
  function fsPid(k) { var p = String(k).split(':')[1]; return p ? (parseInt(p, 10) || 0) : 0; }
  function fsKey(base, pid) { return pid ? base + ':' + pid : base; }
  function isFileFolder(k) { return Object.prototype.hasOwnProperty.call(FILE_KEY, fsBase(k)) && String(k).split(':').length <= 2; }
  function fsPlace(k) { return FILE_KEY[fsBase(k)]; }
  function isMedia(f) { return f.kind === 'image' || f.kind === 'video' || f.kind === 'audio'; }
  function safeUrl(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return ''; } }
  function kindLabel(k) {
    return { folder: t('fl_type_folder', 'File folder'), text: t('fl_type_text', 'Text document'), image: t('fl_type_image', 'Image'),
      video: t('fl_type_video', 'Video'), audio: t('fl_type_audio', 'Audio'), file: t('fl_type_file', 'File') }[k] || t('fl_type_file', 'File');
  }

  function fileById(id) {
    var f = null;
    Object.keys(FS.data).forEach(function (k) { (FS.data[k] || []).forEach(function (x) { if (String(x.id) === String(id)) f = x; }); });
    return f;
  }
  // A folder the Explorer has been told about (from a list or from opening it) becomes a node so the address bar and Back work.
  function fsNode(key, parentKey, name) {
    if (!NODES[key]) NODES[key] = { k: key, parent: parentKey, ic: 'folder', key: '', def: name, kids: [], dyn: true };
    else { NODES[key].def = name; NODES[key].parent = parentKey; }
  }
  // Rows that no longer exist (deleted): drop every cache that mentions them.
  function fsForget(ids) {
    var gone = {};
    ids.forEach(function (i) { gone[i] = true; var w = wins['file:' + i]; if (w) closeWin(w.id); });
    Object.keys(NODES).forEach(function (key) { if (NODES[key].dyn && gone[fsPid(key)]) delete NODES[key]; });
    Object.keys(FS.data).forEach(function (key) {
      if (gone[fsPid(key)]) { delete FS.data[key]; delete FS.state[key]; }
      else FS.data[key] = (FS.data[key] || []).filter(function (x) { return !gone[x.id]; });
    });
  }

  function fsApi(name, data) {
    if (isDui) return Promise.resolve({ ok: false, reason: 'network' });
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/filesApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  var FS_ERR = {
    not_authorised: ['fl_err_not_authorised', 'You cannot use files from this computer.'],
    invalid: ['fl_err_invalid', 'That could not be done.'],
    too_long: ['fl_err_too_long', 'This file is at its length limit.'],
    too_many: ['fl_err_too_many', 'This folder is full. Delete a file first.'],
    too_deep: ['fl_err_too_deep', 'Folders cannot be nested any deeper.'],
    inside: ['fl_err_inside', 'A folder cannot be put inside itself.'],
    forbidden: ['fl_err_forbidden', 'You can only change your own files in this folder.'],
    bad_link: ['fl_err_bad_link', 'That is not a valid https link.'],
    host: ['fl_err_host', 'Links from that website are not allowed. Ask an admin to add it to the allowed hosts.'],
    unavailable: ['fl_err_unavailable', 'Your phone is not available right now.'],
    busy: ['fl_err_busy', 'Slow down, try again in a moment.'],
    network: ['fl_err_network', 'Could not reach the server.'],
    error: ['fl_err_error', 'Something went wrong.']
  };
  function fsErrText(res) { var e = FS_ERR[res && res.reason] || FS_ERR.error; return t(e[0], e[1]); }
  function fsErrDlg(res) {
    showDlg({ title: t('ui_app_explorer', 'File Explorer'), html: '<div>' + esc(fsErrText(res)) + '</div>', buttons: [{ label: t('fl_ok', 'OK'), primary: true }] });
  }
  function flash(msg) {
    var el = $('ex-sel');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(FS.flashT);
    FS.flashT = setTimeout(function () { renderPreview(); }, 3000);
  }

  function fsLoadFolders() {
    FS.tried = true;
    fsApi('folders').then(function (res) {
      if (!res.ok || !res.data) { if (res.reason === 'not_authorised') { FS.enabled = false; FS.job = null; renderExplorer(); } return; }
      FS.enabled = res.data.enabled !== false;
      FS.job = res.data.job || null;
      FS.isBoss = !!res.data.isBoss;
      FS.legal = res.data.legal || null;
      FS.legalWrite = !!res.data.legalWrite;
      FS.court = res.data.court || null;
      FS.courtWrite = !!res.data.courtWrite;
      FS.phone = !!res.data.phone;
      FS.recycle = res.data.recycleBin !== false;
      fsBinLoad(true);
      FS.limits = res.data.limits || {};
      renderExplorer();
    });
  }
  function fsEnsure(k) { if (FS.state[k] === undefined) fsLoad(k, true); }
  function fsLoad(k, quiet, keep) {   // keep: read again without hiding what is already shown
    var seq = (FS.seq[k] = (FS.seq[k] || 0) + 1);
    if (!keep || FS.state[k] !== 'ok') FS.state[k] = 'loading';
    if (!quiet) renderExplorer();
    fsApi('list', { folder: fsPlace(k), parent: fsPid(k) }).then(function (res) {
      if (seq !== FS.seq[k]) return;
      if (res.ok && res.data) {
        FS.data[k] = res.data.files || []; FS.state[k] = 'ok';
        var base = fsBase(k), prev = base;
        (res.data.path || []).forEach(function (p) { var key = fsKey(base, p.id); fsNode(key, prev, p.name); prev = key; });
      } else if (res.reason === 'invalid' && fsPid(k)) {      // the folder was deleted or moved away
        delete NODES[k]; delete FS.state[k];
        if (curFolder() === k) EX.hist[EX.idx] = fsBase(k);
      } else FS.state[k] = 'error';
      renderExplorer();
    });
  }
  function refreshCurrent() {
    if (isFileFolder(curFolder())) fsLoad(curFolder());
    else { if (curFolder() === 'bin') fsBinLoad(); refreshCerts(); }
  }

  // ---- Recycle Bin: certificates (loaded by the MOT code) plus deleted files (from the server, see 'binList')
  function binFiles() { return FS.bin.data || []; }
  function binCount() { return binCerts().length + binFiles().length; }
  function binCanEmpty() { return binCerts().some(canManage) || binFiles().some(function (f) { return f.manage; }); }
  function selBinFiles() {
    return EX.view.filter(function (it) { return it.type === 'bfile' && EX.sel['b:' + it.f.id]; }).map(function (it) { return it.f; });
  }
  function fsBinLoad(quiet) {
    if (!FS.enabled) return;
    var seq = (FS.bin.seq += 1);
    if (!quiet && FS.bin.state !== 'ok') FS.bin.state = 'loading';
    fsApi('binList').then(function (res) {
      if (seq !== FS.bin.seq) return;
      if (res.ok && res.data) { FS.bin.data = res.data.files || []; FS.bin.days = res.data.days || 0; FS.bin.state = 'ok'; }
      else if (FS.bin.state !== 'ok') FS.bin.state = 'error';
      updateBinIcon();
      if (curFolder() === 'bin') renderExplorer();
    });
  }
  function fsResetCache() { FS.state = {}; FS.data = {}; }   // restored items appear in their folders: read them again when opened
  function fsBinEach(files, op, after) {
    var chain = Promise.resolve(), failed = null;
    files.forEach(function (f) {
      chain = chain.then(function () {
        return fsApi(op, { id: f.id }).then(function (res) {
          if (res.ok) FS.bin.data = FS.bin.data.filter(function (x) { return x.id !== f.id; });
          else failed = failed || res;
        });
      });
    });
    chain.then(function () {
      if (after) after();
      EX.sel = {}; fsBinLoad(true); renderExplorer();
      if (failed) fsErrDlg(failed);
    });
  }
  function fsRestoreFiles(files) { fsBinEach(files, 'restore', fsResetCache); }
  function fsPurgeFiles(files) { fsBinEach(files, 'purge'); }
  function restoreBin(certs, files) {
    certs = certs.filter(canManage); files = files.filter(function (f) { return f.manage; });
    if (certs.length) restoreCerts(certs);
    if (files.length) fsRestoreFiles(files);
  }
  function binPlaceName(pl) { return nodeName(pl === 'job' ? 'jobf' : pl === 'legal' ? 'legalf' : pl === 'court' ? 'courtf' : pl); }
  function binFileRow(f, key, selCls) {
    return '<div class="ex-row' + selCls + '" data-key="' + esc(key) + '"><div class="nm">' + icSpan(KIND_ICON[f.kind] || 'filetxt') + '<span>' + esc(f.name) + '</span></div>' +
      '<div class="dim">' + esc(fmtDate(f.deletedAt)) + '</div><div class="dim">' + esc(kindLabel(f.kind)) + '</div><div class="dim">' + esc(f.deletedBy || '—') + '</div></div>';
  }
  function binFilePreview(f) {
    function kv(k, v) { return '<div class="pv-kv"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
    return '<div class="pv-badge">' + icSpan(KIND_ICON[f.kind] || 'filetxt') + '<b>' + esc(kindLabel(f.kind)) + '</b></div>' +
      '<div class="pv-plate fl-name">' + esc(f.name) + '</div>' +
      kv(t('ui_fx_col_deleted', 'Date deleted'), fmtDate(f.deletedAt)) + kv(t('ui_fx_col_deletedby', 'Deleted by'), f.deletedBy || '—') +
      kv(t('fl_orig_loc', 'Original location'), binPlaceName(f.place)) + kv(t('fl_by', 'Created by'), f.by || '—') +
      (FS.bin.days > 0 ? kv(t('fl_bin_until', 'Removed for good'), fmtDate((f.deletedAt || 0) + FS.bin.days * 86400)) : '') +
      '<div class="btn primary' + (f.manage ? '' : ' off') + '" data-binrestore="1" style="margin-top:6px">' + esc(t('ui_ctx_restore', 'Restore')) + '</div>';
  }
  function showBinFileProps(f) {
    function row(k, v) { return '<div>' + esc(k) + '</div><div><b>' + esc(v) + '</b></div>'; }
    showDlg({
      title: t('ui_ctx_props', 'Properties'),
      html: '<div class="pr">' + row(t('ui_fx_col_name', 'Name'), f.name) + row(t('fl_col_type', 'Type'), kindLabel(f.kind)) +
        row(t('fl_orig_loc', 'Original location'), binPlaceName(f.place)) + row(t('fl_by', 'Created by'), f.by || '—') +
        row(t('ui_fx_col_deleted', 'Date deleted'), fmtDate(f.deletedAt)) + row(t('ui_fx_col_deletedby', 'Deleted by'), f.deletedBy || '—') + '</div>',
      buttons: [{ label: t('ui_dlg_ok', 'OK'), primary: true }]
    });
  }
  function sortBin(items) {
    var key = EX.sortKey, dir = EX.sortDir;
    function val(it) {
      var c = it.c, f = it.f;
      if (key === 'name') return (c ? certName(c) : f.name).toLowerCase();
      if (key === 'result') return c ? (c.passed ? 'pass' : 'fail') : kindLabel(f.kind).toLowerCase();
      if (key === 'expires') return String((c ? c.deletedBy : f.deletedBy) || '').toLowerCase();
      var d = c ? parseTs(c.deletedAt) : parseTs(f.deletedAt); return d === null ? 0 : d;
    }
    return items.slice().sort(function (a, b) { var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  }

  function fmtSize(n) {
    n = Number(n) || 0;
    return n < 1024 ? fmt(t('fl_bytes', '%s B'), n.toLocaleString(loc())) : fmt(t('fl_kb', '%s KB'), (n / 1024).toLocaleString(loc(), { maximumFractionDigits: 1 }));
  }
  function itemsText(n) { return n === 1 ? t('ui_fx_item_one', '1 item') : fmt(t('ui_fx_items', '%s items'), n); }
  function sortFiles(list) {
    var key = EX.sortKey, dir = EX.sortDir;
    function val(f) {
      if (key === 'size') return f.size || 0;
      if (key === 'by') return String(f.by || '').toLowerCase();
      if (key === 'date') return f.updated || 0;
      return String(f.name || '').toLowerCase();
    }
    return list.slice().sort(function (a, b) {
      if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;   // folders first
      var x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }
  function fileRow(f, key, selCls) {
    var nameHtml = (EX.renaming === key)
      ? '<input class="rn" type="text" maxlength="' + esc(String(FS.limits.maxNameLength || 80)) + '" autocomplete="off" value="' + esc(EX.renameVal) + '">'
      : '<span>' + esc(f.name) + '</span>';
    var size = f.kind === 'folder' ? itemsText(f.size || 0) : f.kind === 'text' ? fmtSize(f.size) : kindLabel(f.kind);
    return '<div class="ex-row' + selCls + '" draggable="true" data-key="' + esc(key) + '"><div class="nm">' + icSpan(KIND_ICON[f.kind] || 'filetxt') + nameHtml + '</div>' +
      '<div class="dim">' + esc(fmtDate(f.updated)) + '</div><div class="dim">' + esc(size) + '</div><div class="dim">' + esc(f.by || '—') + '</div></div>';
  }
  function filePreview(f) {
    function kv(k, v) { return '<div class="pv-kv"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
    var url = isMedia(f) || f.kind === 'file' ? safeUrl(f.url) : '';
    return '<div class="pv-badge">' + icSpan(KIND_ICON[f.kind] || 'filetxt') + '<b>' + esc(kindLabel(f.kind)) + '</b></div>' +
      '<div class="pv-plate fl-name">' + esc(f.name) + '</div>' +
      (f.kind === 'image' && url ? '<img class="fl-thumb" alt="" referrerpolicy="no-referrer" src="' + esc(url) + '">' : '') +
      kv(t('fl_col_modified', 'Date modified'), fmtDate(f.updated)) +
      (f.kind === 'folder' ? kv(t('fl_contains', 'Contains'), itemsText(f.size || 0)) : f.kind === 'text' ? kv(t('fl_col_size', 'Size'), fmtSize(f.size)) : kv(t('fl_source', 'Source'), hostOf(url) || '—')) +
      kv(t('fl_by', 'Created by'), f.by || '—') +
      (f.kind === 'text' ? '<div class="fl-snip">' + (f.snippet ? esc(f.snippet) : '<i>' + esc(t('fl_empty_preview', '(empty file)')) + '</i>') + '</div>' : '') +
      '<div class="btn primary" data-fsopen="1" style="margin-top:6px">' + esc(t('fl_open', 'Open')) + '</div>';
  }
  function renderFileCmd(bar) {
    var files = selFiles(), one = files.length === 1 ? files[0] : null, ready = FS.state[curFolder()] !== 'ok';
    var manage = files.length > 0 && files.every(function (f) { return f.manage; });
    bar.classList.remove('hidden');
    bar.innerHTML = cmdBtn('fs-new', 'filetxt', t('fl_new', 'New text document'), ready) +
      cmdBtn('fs-newdir', 'folder', t('fl_newdir', 'New folder'), ready) +
      cmdBtn('fs-add', '', t('fl_add', 'Add') + ' ▾', ready) +
      cmdBtn('fs-open', '', t('fl_open', 'Open'), !one) +
      cmdBtn('fs-rename', 'rename', t('ui_fx_cmd_rename', 'Rename'), !(one && one.manage)) +
      cmdBtn('fs-delete', 'trash', t('ui_fx_cmd_delete', 'Delete'), !manage) +
      (state.printer ? cmdBtn('fs-print', 'printer', t('pr_print', 'Print'), !(one && (one.kind === 'text' || one.kind === 'image'))) : '') +
      cmdBtn('fs-copy', '', t('fl_copy_to', 'Copy to') + '…', !files.length) +
      cmdBtn('fs-move', '', t('fl_move_to', 'Move to') + '…', !manage);
  }

  function fsNewItem(op, name) {
    var k = curFolder();
    if (!isFileFolder(k) || FS.state[k] !== 'ok') return;
    var d = { folder: fsPlace(k), parent: fsPid(k), name: name };
    if (op === 'save') d.body = '';
    fsApi(op, d).then(function (res) {
      if (!res.ok) { fsErrDlg(res); return; }
      var f = res.data.file;
      (FS.data[k] = FS.data[k] || []).push(f);
      if (curFolder() === k) { EX.sel = {}; EX.sel['x:' + f.id] = true; EX.anchor = 'x:' + f.id; EX.renaming = 'x:' + f.id; EX.renameVal = f.name; }
      renderExplorer();
    });
  }
  function fsNew() { fsNewItem('save', t('fl_new_name', 'New Text Document.txt')); }
  function fsNewDir() { fsNewItem('folder', t('fl_newdir_name', 'New folder')); }

  function fsOpenFolder(f) {
    var cur = curFolder(), key = fsKey(fsBase(cur), f.id);
    fsNode(key, cur, f.name);
    navigate(key);
  }
  function fsOpen(f) {
    if (f.kind === 'folder') { fsOpenFolder(f); return; }
    if (f.kind !== 'text') { openMediaViewer(f); return; }
    fsApi('get', { id: f.id }).then(function (res) {
      if (!res.ok) { fsErrDlg(res); if (res.reason === 'invalid') refreshCurrent(); return; }
      openFileEditor(res.data.file);
    });
  }
  function fsStartRename() {
    var files = selFiles();
    if (files.length !== 1 || !files[0].manage) return;
    EX.renaming = 'x:' + files[0].id; EX.renameVal = files[0].name;
    renderExplorer();
  }
  function fsCommitRename(key, val) {
    EX.renaming = null;
    var f = fileById(key.slice(2));
    val = String(val || '').replace(/\s+/g, ' ').trim();
    if (!f || !val || val === f.name) { renderExplorer(); return; }
    fsApi('rename', { id: f.id, name: val }).then(function (res) {
      if (!res.ok) { fsErrDlg(res); return; }
      f.name = res.data.file.name; f.updated = res.data.file.updated;
      var w = wins['file:' + f.id];
      if (w) { w.title = f.name; setTitle(w.id); }
      Object.keys(NODES).forEach(function (nk) { if (NODES[nk].dyn && fsPid(nk) === f.id) NODES[nk].def = f.name; });
      renderExplorer();
    });
    renderExplorer();
  }
  function fsDelete() {
    var files = selFiles().filter(function (f) { return f.manage; });
    if (!files.length) return;
    var hasDir = files.some(function (f) { return f.kind === 'folder'; }), bin = FS.recycle;
    var msg;
    if (bin) {
      msg = files.length === 1
        ? (hasDir ? t('fl_bin_folder', 'Move this folder and everything in it to the Recycle Bin?') : t('fl_bin_one', 'Move this file to the Recycle Bin?'))
        : fmt(t('fl_bin_many', 'Move these %s items to the Recycle Bin?'), files.length);
    } else {
      msg = files.length === 1
        ? (hasDir ? t('fl_delete_folder', 'Are you sure you want to permanently delete this folder and everything in it?') : t('fl_delete_one', 'Are you sure you want to permanently delete this file?'))
        : fmt(hasDir ? t('fl_delete_many_dir', 'Are you sure you want to permanently delete these %s items, and everything inside any folders?') : t('fl_delete_many', 'Are you sure you want to permanently delete these %s files?'), files.length);
    }
    confirmDlg(t('ui_dlg_delete_title', 'Delete'), msg, function () {
        var chain = Promise.resolve(), failed = null, binned = false;
        files.forEach(function (f) {
          chain = chain.then(function () {
            return fsApi('delete', { id: f.id }).then(function (res) {
              if (res.ok) { binned = binned || !!(res.data && res.data.binned); fsForget((res.data && res.data.removed) || [f.id]); }
              else failed = failed || res;
            });
          });
        });
        chain.then(function () { EX.sel = {}; if (binned) fsBinLoad(true); renderExplorer(); if (failed) fsErrDlg(failed); });
      });
  }

  // ---- copy / move (a picker for the destination, or drag and drop)
  function fsTransfer(files, destKey, mode) {
    if (!files.length || !isFileFolder(destKey)) return;
    var chain = Promise.resolve(), ok = 0, failed = null;
    files.forEach(function (f) {
      chain = chain.then(function () {
        return fsApi(mode, { id: f.id, to: fsPlace(destKey), parent: fsPid(destKey) }).then(function (res) { if (res.ok) ok++; else failed = failed || res; });
      });
    });
    chain.then(function () {
      FS.state = {};   // every folder is read again the next time it is shown
      EX.sel = {};
      if (ok) flash(fmt(mode === 'move' ? t('fl_moved', 'Moved to %s') : t('fl_copied', 'Copied to %s'), NODES[destKey] ? nodeName(destKey) : nodeName(fsBase(destKey))));
      renderExplorer();
      if (failed) fsErrDlg(failed);
    });
  }
  function fsPick(mode, files) {
    if (!files.length) return;
    fsApi('tree').then(function (res) {
      if (!res.ok) { fsErrDlg(res); return; }
      var folders = res.data.folders || [], byPlace = { docs: [], dl: [], job: [] }, kids = {}, block = {};
      folders.forEach(function (f) { (byPlace[f.place] = byPlace[f.place] || []).push(f); (kids[f.parent] = kids[f.parent] || []).push(f.id); });
      files.forEach(function (f) { if (f.kind === 'folder') (function m(id) { block[id] = true; (kids[id] || []).forEach(m); })(f.id); });
      var cur = curFolder(), html = '<div class="fl-pick">';
      function line(key, label, depth, off) {
        html += '<label class="fl-pk' + (off ? ' off' : '') + '" style="padding-left:' + (8 + depth * 18) + 'px"><input type="radio" name="fspick" value="' + esc(key) + '"' + (off ? ' disabled' : '') + '>' +
          icSpan('folder') + '<span>' + esc(label) + '</span></label>';
      }
      ['docs', 'dl', 'jobf'].forEach(function (base) {
        if (base === 'jobf' && !FS.job) return;
        line(base, nodeName(base), 0, mode === 'move' && cur === base);
        (function walk(parent, depth) {
          (byPlace[FILE_KEY[base]] || []).filter(function (f) { return f.parent === parent; }).forEach(function (f) {
            var key = fsKey(base, f.id);
            line(key, f.name, depth, !!block[f.id] || (mode === 'move' && cur === key));
            walk(f.id, depth + 1);
          });
        })(0, 1);
      });
      html += '</div>';
      showDlg({
        title: mode === 'move' ? t('fl_move_title', 'Move to') : t('fl_copy_title', 'Copy to'), html: html,
        buttons: [
          { label: mode === 'move' ? t('fl_move_here', 'Move here') : t('fl_copy_here', 'Copy here'), primary: true, run: function () {
            var r = document.querySelector('#dlg-body input[name=fspick]:checked');
            if (r) fsTransfer(files, r.value, mode);
          } },
          { label: t('fl_cancel', 'Cancel') }
        ]
      });
    });
  }

  // ---- adding images and other files (links, phone photos)
  function fsAddLink() {
    var k = curFolder();
    showDlg({
      title: t('fl_add_link', 'Add an image or file from a link'),
      html: '<div class="fl-form"><label for="fl-url">' + esc(t('fl_link_label', 'Link (https://…)')) + '</label><input id="fl-url" type="text" maxlength="500" autocomplete="off" placeholder="https://i.imgur.com/…">' +
        '<label for="fl-lname">' + esc(t('fl_link_name', 'Name (optional)')) + '</label><input id="fl-lname" type="text" maxlength="' + esc(String(FS.limits.maxNameLength || 80)) + '" autocomplete="off">' +
        '<div class="fl-hint">' + esc(t('fl_link_hint', 'Images, video and audio open in the viewer. Only links from allowed websites work.')) + '</div></div>',
      buttons: [
        { label: t('fl_add', 'Add'), primary: true, run: function () {
          var url = ($('fl-url').value || '').trim(), nm = ($('fl-lname').value || '').trim();
          if (!url) return;
          fsApi('link', { folder: fsPlace(k), parent: fsPid(k), url: url, name: nm }).then(function (res) {
            if (!res.ok) { fsErrDlg(res); return; }
            (FS.data[k] = FS.data[k] || []).push(res.data.file);
            renderExplorer();
          });
        } },
        { label: t('fl_cancel', 'Cancel') }
      ]
    });
    setTimeout(function () { var i = $('fl-url'); if (i) i.focus(); }, 30);
  }
  function fsAddPhone() {
    var k = curFolder();
    fsApi('phoneList').then(function (res) {
      if (!res.ok) { fsErrDlg(res); return; }
      var photos = (res.data && res.data.photos) || [], html;
      if (!photos.length) html = '<div>' + esc(t('fl_phone_none', 'There are no photos on your phone yet.')) + '</div>';
      else html = '<div class="fl-ph">' + photos.map(function (p) {
        var u = safeUrl(p.url);
        return '<label class="fl-phi"><input type="checkbox" data-ph="' + esc(p.id) + '">' +
          (p.isVideo || !u ? '<span class="fl-phv">' + ic('filevid') + '</span>' : '<img alt="" loading="lazy" referrerpolicy="no-referrer" src="' + esc(u) + '">') + '</label>';
      }).join('') + '</div><div class="fl-hint">' + esc(t('fl_phone_hint', 'Pick up to 20 photos.')) + '</div>';
      showDlg({
        title: t('fl_phone_title', 'Import from phone Photos'), html: html,
        buttons: (photos.length ? [{ label: t('fl_import', 'Import'), primary: true, run: function () {
          var ids = [].slice.call(document.querySelectorAll('#dlg-body input[data-ph]:checked')).map(function (c) { return c.dataset.ph; }).slice(0, 20);
          if (!ids.length) return;
          fsApi('phoneImport', { folder: fsPlace(k), parent: fsPid(k), ids: ids }).then(function (r2) {
            if (!r2.ok) { fsErrDlg(r2); return; }
            var made = (r2.data && r2.data.files) || [];
            made.forEach(function (f) { (FS.data[k] = FS.data[k] || []).push(f); });
            flash(fmt(t('fl_imported', 'Imported %s photos'), made.length));
            renderExplorer();
            if (r2.data && r2.data.skipped) fsErrDlg({ reason: 'too_many' });
          });
        } }] : []).concat([{ label: photos.length ? t('fl_cancel', 'Cancel') : t('fl_ok', 'OK'), primary: !photos.length }])
      });
    });
  }
  function fsAddMenu() {
    return [
      { label: t('fl_add_link_short', 'Image or file from a link…'), run: fsAddLink },
      { label: t('fl_add_phone', 'Photos from your phone…'), off: !FS.phone, run: fsAddPhone }
    ];
  }

  function fsPrint(f) {
    if (f.kind === 'image') { openPrintDialog({ kind: 'image', title: f.name, url: f.url }); return; }
    fsApi('get', { id: f.id }).then(function (res) {
      if (!res.ok) { fsErrDlg(res); return; }
      openPrintDialog({ kind: 'text', title: f.name, text: res.data.file.body || '' });
    });
  }
  function fsSendToPhone(f) {
    fsApi('toPhone', { id: f.id }).then(function (res) { if (res.ok) flash(t('fl_sent_phone', 'Saved to your phone')); else fsErrDlg(res); });
  }
  function fsRowMenu(key) {
    var files = selFiles(), one = files.length === 1 ? files[0] : null, manage = files.length > 0 && files.every(function (f) { return f.manage; });
    var items = [{ label: t('fl_open', 'Open'), bold: true, off: !one, run: function () { fsOpen(one); } }];
    if (one && (isMedia(one) || one.kind === 'file')) {
      items.push({ label: t('fl_copy_link', 'Copy link'), run: function () { copyText(one.url || ''); flash(t('fl_link_copied', 'Link copied')); } });
      if (FS.phone && (one.kind === 'image' || one.kind === 'video')) items.push({ label: t('fl_send_phone', 'Send to phone Photos'), run: function () { fsSendToPhone(one); } });
    }
    if (one && state.printer && (one.kind === 'text' || one.kind === 'image')) items.push({ label: t('pr_print', 'Print'), run: function () { fsPrint(one); } });
    return items.concat([
      { sep: true },
      { label: t('fl_copy_to', 'Copy to') + '…', run: function () { fsPick('copy', selFiles()); } },
      { label: t('fl_move_to', 'Move to') + '…', off: !manage, run: function () { fsPick('move', selFiles()); } },
      { sep: true },
      { label: t('ui_fx_cmd_rename', 'Rename'), hint: 'F2', off: !(one && one.manage), run: fsStartRename },
      { label: t('ui_fx_cmd_delete', 'Delete'), hint: 'Del', off: !manage, run: fsDelete }
    ]);
  }
  function fsAreaMenu() {
    var busy = FS.state[curFolder()] !== 'ok';
    var items = [{ label: t('fl_new', 'New text document'), off: busy, run: fsNew }, { label: t('fl_newdir', 'New folder'), off: busy, run: fsNewDir },
      { label: t('fl_add_link_short', 'Image or file from a link…'), off: busy, run: fsAddLink },
      { label: t('fl_add_phone', 'Photos from your phone…'), off: busy || !FS.phone, run: fsAddPhone }, { sep: true }];
    [['name', t('ui_fx_col_name', 'Name')], ['date', t('fl_col_modified', 'Date modified')], ['size', t('fl_col_size', 'Size')], ['by', t('fl_col_author', 'Author')]].forEach(function (c) {
      items.push({ label: (EX.sortKey === c[0] ? '✓  ' : '      ') + fmt(t('ui_ctx_sort', 'Sort by %s'), c[1].toLowerCase()), run: function () { setSort(c[0]); } });
    });
    items.push({ sep: true }, { label: t('ui_ctx_refresh', 'Refresh'), hint: 'F5', run: refreshCurrent });
    return items;
  }
  function fsCmd(id, el) {
    if (id === 'fs-new') fsNew();
    else if (id === 'fs-newdir') fsNewDir();
    else if (id === 'fs-open') { var one = selFiles()[0]; if (one) fsOpen(one); }
    else if (id === 'fs-print') { var pf = selFiles()[0]; if (pf && !el.classList.contains('off')) fsPrint(pf); }
    else if (id === 'fs-rename') fsStartRename();
    else if (id === 'fs-delete') fsDelete();
    else if (id === 'fs-copy') { if (!el.classList.contains('off')) fsPick('copy', selFiles()); }
    else if (id === 'fs-move') { if (!el.classList.contains('off')) fsPick('move', selFiles()); }
    else if (id === 'fs-add') {
      if (el.classList.contains('off')) return;
      var r = el.getBoundingClientRect();
      showCtx({ clientX: r.left, clientY: r.bottom }, fsAddMenu());
    }
  }

  // ---- viewer for images, video, audio and other linked files (one window per file)
  function openMediaViewer(f) {
    var id = 'file:' + f.id;
    if (wins[id]) { openWin(id); return; }
    var url = safeUrl(f.url);
    var win = document.createElement('div');
    win.innerHTML = '<div class="win-body"><div class="fe fm"><div class="fe-bar"><span class="fe-st"></span><span class="fe-grow"></span>' +
      (state.printer && f.kind === 'image' ? '<div class="btn fm-print">' + esc(t('pr_print', 'Print')) + '</div>' : '') +
      '<div class="btn fm-copy">' + esc(t('fl_copy_link', 'Copy link')) + '</div>' +
      (FS.phone && (f.kind === 'image' || f.kind === 'video') ? '<div class="btn fm-phone">' + esc(t('fl_send_phone', 'Send to phone Photos')) + '</div>' : '') +
      '</div><div class="fm-stage"></div></div></div>';
    $('windows').appendChild(win);
    var stage = win.querySelector('.fm-stage'), st = win.querySelector('.fe-st'), el;
    function status(msg, bad) { st.textContent = msg; st.classList.toggle('bad', !!bad); }
    if (!url) { stage.textContent = t('fl_err_bad_link', 'That is not a valid https link.'); }
    else if (f.kind === 'image') {
      el = document.createElement('img'); el.referrerPolicy = 'no-referrer'; el.alt = f.name;
      el.onerror = function () { stage.textContent = t('fl_load_failed', 'Could not load this file. The link may have expired.'); };
      el.src = url; stage.appendChild(el);
    } else if (f.kind === 'video' || f.kind === 'audio') {
      el = document.createElement(f.kind === 'video' ? 'video' : 'audio'); el.controls = true; el.preload = 'metadata'; el.referrerPolicy = 'no-referrer';
      el.onerror = function () { status(t('fl_load_failed', 'Could not load this file. The link may have expired.'), true); };
      el.src = url; stage.appendChild(el);
    } else {
      stage.innerHTML = '<div class="fm-card">' + icSpan('filegen') + '<b></b><span></span></div>';
      stage.querySelector('b').textContent = f.name; stage.querySelector('span').textContent = hostOf(url);
    }
    win.querySelector('.fm-copy').addEventListener('click', function () { copyText(f.url || ''); status(t('fl_link_copied', 'Link copied')); });
    var pr = win.querySelector('.fm-print');
    if (pr) pr.addEventListener('click', function () { openPrintDialog({ kind: 'image', title: f.name, url: f.url }); });
    var ph = win.querySelector('.fm-phone');
    if (ph) ph.addEventListener('click', function () {
      fsApi('toPhone', { id: f.id }).then(function (res) { if (res.ok) status(t('fl_sent_phone', 'Saved to your phone')); else status(fsErrText(res), true); });
    });
    defWin(id, { el: win, icon: KIND_ICON[f.kind] || 'filegen', dynamic: true, w: 900, h: 660, title: f.name, onClose: function () { if (el && el.pause) el.pause(); } });
    openWin(id);
  }

  // A file's body is a small rich-text HTML fragment (bold/italic/underline/strikethrough, bulleted/numbered
  // lists), same editor and same server-side sanitizer allowlist as the Notepad app. Word/character counts,
  // dirty checks and printing all need the PLAIN TEXT reading of it, never the markup itself.
  var fePlainDiv = document.createElement('div');
  function fePlainText(html) { fePlainDiv.innerHTML = String(html || ''); return fePlainDiv.textContent || fePlainDiv.innerText || ''; }

  var FE_TOOLS = [
    { cmd: 'bold', key: 'np_bold', def: 'Bold', label: 'B', style: 'font-weight:700' },
    { cmd: 'italic', key: 'np_italic', def: 'Italic', label: 'I', style: 'font-style:italic' },
    { cmd: 'underline', key: 'np_underline', def: 'Underline', label: 'U', style: 'text-decoration:underline' },
    { cmd: 'strikeThrough', key: 'np_strike', def: 'Strikethrough', label: 'S', style: 'text-decoration:line-through' },
    { cmd: 'insertUnorderedList', key: 'np_bullet_list', def: 'Bulleted list', label: '•≡', sep: true },
    { cmd: 'insertOrderedList', key: 'np_numbered_list', def: 'Numbered list', label: '1.2.' },
  ];
  // Fixed font list and heading values, kept in lockstep with server/files.lua's FONTS / allowed h1-h3 tags -
  // same lists the Notepad app's toolbar uses (ui/notepad.js), so a face or heading picked here always survives a save.
  var FE_FONT_LIST = ['Arial', 'Consolas', 'Courier New', 'Georgia', 'Times New Roman', 'Verdana', 'Comic Sans MS'];
  var FE_HEADINGS = [
    { v: 'P', key: 'np_heading_body', def: 'Body text' },
    { v: 'H1', key: 'np_heading_1', def: 'Heading 1' },
    { v: 'H2', key: 'np_heading_2', def: 'Heading 2' },
    { v: 'H3', key: 'np_heading_3', def: 'Heading 3' },
  ];
  function feToolbarHtml() {
    return '<div class="fe-toolbar">' +
      '<select class="fe-tsel" data-fe="heading" title="' + esc(t('np_heading', 'Heading style')) + '">' +
      FE_HEADINGS.map(function (h) { return '<option value="' + h.v + '">' + esc(t(h.key, h.def)) + '</option>'; }).join('') + '</select>' +
      '<select class="fe-tsel fe-tfont" data-fe="fontname" title="' + esc(t('np_font', 'Font')) + '">' +
      FE_FONT_LIST.map(function (f) { return '<option value="' + f + '" style="font-family:\'' + f + '\'">' + f + '</option>'; }).join('') + '</select>' +
      '<input type="color" class="fe-tcolor" data-fe="color" value="#000000" title="' + esc(t('np_color', 'Text colour')) + '">' +
      '<span class="fe-tsep"></span>' +
      FE_TOOLS.map(function (b) {
        return (b.sep ? '<span class="fe-tsep"></span>' : '') +
          '<button type="button" class="fe-tbtn" data-cmd="' + b.cmd + '" title="' + esc(t(b.key, b.def)) + '" style="' + (b.style || '') + '">' + b.label + '</button>';
      }).join('') + '</div>';
  }

  // ---- the text editor window (one per open file; saves by itself a moment after typing stops)
  function openFileEditor(f) {
    var id = 'file:' + f.id;
    if (wins[id]) { openWin(id); return; }
    var win = document.createElement('div');
    win.innerHTML = '<div class="win-body"><div class="fe"><div class="fe-bar"><span class="fe-st"></span><span class="fe-grow"></span><span class="fe-cnt"></span>' +
      (state.printer ? '<div class="btn fe-print">' + esc(t('pr_print', 'Print')) + '</div>' : '') + '<div class="btn primary fe-save">' + esc(t('fl_save', 'Save')) + '</div></div>' +
      (f.manage ? feToolbarHtml() : '') + '<div class="fe-ed" contenteditable="' + (f.manage ? 'true' : 'false') + '" spellcheck="false"></div></div></div>';
    $('windows').appendChild(win);
    var ed = win.querySelector('.fe-ed'), st = win.querySelector('.fe-st'), cnt = win.querySelector('.fe-cnt'), btn = win.querySelector('.fe-save');
    var E = { dirty: false, saving: false, again: false, timer: null };
    FS.edit[id] = E;
    ed.innerHTML = f.body || '';
    ed.setAttribute('data-placeholder', t('fl_placeholder', 'Start typing…'));
    if (!f.manage) btn.style.display = 'none';
    function count() { cnt.textContent = fmt(t('fl_chars', '%s characters'), fePlainText(ed.innerHTML).length.toLocaleString(loc())); }
    function status(msg, bad) { st.textContent = msg; st.classList.toggle('bad', !!bad); }
    function save() {
      clearTimeout(E.timer);
      if (!E.dirty || !f.manage) return;
      if (E.saving) { E.again = true; return; }
      E.saving = true; E.dirty = false; status(t('fl_saving', 'Saving…'));
      var body = ed.innerHTML;
      fsApi('save', { id: f.id, body: body }).then(function (res) {
        E.saving = false;
        if (res.ok) {
          Object.keys(FS.data).forEach(function (k) { (FS.data[k] || []).forEach(function (x) { if (x.id === f.id) { x.size = res.data.file.size; x.updated = res.data.file.updated; x.snippet = res.data.file.snippet; } }); });
          if (!E.dirty) status(t('fl_saved', 'Saved'));
          if (wins.explorer && wins.explorer.open) renderExplorer();
        } else { E.dirty = true; status(fsErrText(res), true); return; }
        if (E.again || E.dirty) { E.again = false; E.timer = setTimeout(save, 300); }
      });
    }
    // one typed character over the limit is trimmed back rather than silently accepted and refused only on
    // save - same approach as the Notepad app's editor.
    function onEdit() {
      if (fePlainText(ed.innerHTML).length > (FS.limits.maxLength || 50000)) { ed.innerHTML = E.lastBody || ''; return; }
      E.lastBody = ed.innerHTML;
      E.dirty = true; count(); status(t('fl_unsaved', 'Not saved yet'));
      clearTimeout(E.timer); E.timer = setTimeout(save, 1200);
    }
    E.lastBody = ed.innerHTML;
    ed.addEventListener('input', onEdit);
    ed.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); }
      e.stopPropagation();
    });
    var feLastRange = null;
    function feRestoreSelection() {
      ed.focus();
      if (!feLastRange || !ed.contains(feLastRange.commonAncestorContainer)) return;
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(feLastRange);
    }
    win.querySelector('.fe').addEventListener('mousedown', function (e) {
      var tb = e.target.closest('.fe-tbtn');
      if (!tb || !f.manage) return;
      e.preventDefault();
      ed.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
      document.execCommand(tb.dataset.cmd, false, null);
      onEdit();
      paintToolbar();
    });
    // font/heading/colour pickers steal focus (and so the selection) the moment they're used, so the last
    // real selection inside the editor is remembered and restored before running their command - same
    // approach as the Notepad app's toolbar (ui/notepad.js).
    win.querySelector('.fe').addEventListener('change', function (e) {
      var fe = e.target.dataset && e.target.dataset.fe;
      if (!fe || !f.manage) return;
      if (fe === 'fontname') {
        feRestoreSelection();
        try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
        document.execCommand('fontName', false, e.target.value);
      } else if (fe === 'heading') {
        feRestoreSelection();
        document.execCommand('formatBlock', false, e.target.value);
      } else if (fe === 'color') {
        feRestoreSelection();
        try { document.execCommand('styleWithCSS', false, false); } catch (e2) { /* not supported here */ }
        document.execCommand('foreColor', false, e.target.value);
      }
      onEdit();
      paintToolbar();
    });
    function paintToolbar() {
      FE_TOOLS.forEach(function (b) {
        var el = win.querySelector('.fe-tbtn[data-cmd="' + b.cmd + '"]');
        if (!el) return;
        var on = false;
        try { on = document.queryCommandState(b.cmd); } catch (e) { /* not supported here, leave off */ }
        el.classList.toggle('on', on);
      });
    }
    document.addEventListener('selectionchange', function () {
      if (document.activeElement !== ed) return;
      paintToolbar();
      var sel = window.getSelection();
      if (sel && sel.rangeCount) feLastRange = sel.getRangeAt(0).cloneRange();
    });
    btn.addEventListener('click', save);
    var pb = win.querySelector('.fe-print');
    if (pb) pb.addEventListener('click', function () { openPrintDialog({ kind: 'text', title: f.name, text: fePlainText(ed.innerHTML) }); });
    count();
    defWin(id, { el: win, icon: 'filetxt', dynamic: true, w: 820, h: 620, title: f.name, onClose: function () { save(); delete FS.edit[id]; } });
    openWin(id);
    ed.focus();
  }

  // drag files onto a folder in the tree, the address bar or the list: the same place moves them, another place copies them
  function fsDropTarget(e) {
    if (!EX.dragging || !e.target.closest) return null;
    var cur = curFolder();
    var nav = e.target.closest('[data-nav]');
    if (nav) { var nk = nav.dataset.nav; return isFileFolder(nk) && nk !== cur ? { key: nk, el: nav } : null; }
    var row = e.target.closest('.ex-row');
    if (row && row.dataset.key.indexOf('x:') === 0 && !EX.sel[row.dataset.key]) {
      var f = fileById(row.dataset.key.slice(2));
      if (f && f.kind === 'folder' && isFileFolder(cur)) return { key: fsKey(fsBase(cur), f.id), el: row };
    }
    return null;
  }

  function certsFor(k) {
    var list = liveCerts();
    switch (k) {
      case 'mot': case 'mot/all': return list;
      case 'mot/mine': return list.filter(function (c) { return c.mine; });
      case 'mot/passed': return list.filter(function (c) { return c.passed; });
      case 'mot/failed': return list.filter(function (c) { return !c.passed; });
      case 'bin': return binCerts();
    }
    return [];
  }

  function curFolder() { return EX.hist[EX.idx]; }

  function sortCerts(list) {
    var key = EX.sortKey, dir = EX.sortDir, inBin = curFolder() === 'bin';
    function val(c) {
      if (key === 'name') return certName(c).toLowerCase();
      if (key === 'result') return c.passed ? 1 : 0;
      if (key === 'expires') {
        if (inBin) return String(c.deletedBy || '').toLowerCase();
        var e = parseTs(c.expiresAt); return e === null ? -1 : e;
      }
      var d = parseTs(inBin ? c.deletedAt : c.issuedAt); return d === null ? 0 : d;
    }
    return list.slice().sort(function (a, b) {
      var x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  // ---- selection ----
  function keyOfItem(it) { return it.type === 'folder' ? 'f:' + it.k : it.type === 'file' ? 'x:' + it.f.id : it.type === 'bfile' ? 'b:' + it.f.id : 'c:' + it.c.testNumber; }
  function selFiles() {
    return EX.view.filter(function (it) { return it.type === 'file' && EX.sel['x:' + it.f.id]; }).map(function (it) { return it.f; });
  }
  function selCerts() {
    return EX.view.filter(function (it) { return it.type === 'cert' && EX.sel['c:' + it.c.testNumber]; }).map(function (it) { return it.c; });
  }
  function selCount() { return Object.keys(EX.sel).length; }
  function setSel(keys) {
    EX.sel = {};
    keys.forEach(function (k) { EX.sel[k] = true; });
    $('ex-rows').querySelectorAll('.ex-row').forEach(function (r) { r.classList.toggle('sel', !!EX.sel[r.dataset.key]); });
    renderPreview();
    renderCmd();
  }

  function navigate(k, push) {
    if (!NODES[k]) return;
    if (push !== false) { EX.hist = EX.hist.slice(0, EX.idx + 1); EX.hist.push(k); EX.idx = EX.hist.length - 1; }
    EX.sel = {}; EX.anchor = null; EX.renaming = null;
    EX.q = '';
    $('ex-search').value = '';
    if (isFileFolder(k) && FS.state[k] === 'ok') fsLoad(k, true, true);   // counts and names may have changed
    if (k === 'bin') fsBinLoad(true);
    renderExplorer();
  }

  function cmdBtn(id, icn, label, off) {
    return '<div class="cmd' + (off ? ' off' : '') + '" data-cmd="' + id + '">' + (icn ? icSpan(icn) : '') + '<span>' + esc(label) + '</span></div>';
  }
  function renderCmd() {
    var k = curFolder(), bar = $('ex-cmd'), certs = selCerts(), one = certs.length === 1 ? certs[0] : null;
    var manage = certs.some(canManage);
    if (isFileFolder(k)) { renderFileCmd(bar); return; }
    if (k === 'bin') {
      bar.classList.remove('hidden');
      var bfs = selBinFiles(), bmanage = manage || bfs.some(function (f) { return f.manage; });
      bar.innerHTML = cmdBtn('empty', 'trash', t('ui_fx_cmd_empty', 'Empty Recycle Bin'), !binCanEmpty()) +
        (certs.length || bfs.length ? cmdBtn('restore', 'restore', t('ui_fx_cmd_restore_sel', 'Restore the selected items'), !bmanage)
                      : cmdBtn('restoreall', 'restore', t('ui_fx_cmd_restore_all', 'Restore all items'), !binCanEmpty()));
    } else if (k.indexOf('mot/') === 0) {
      bar.classList.remove('hidden');
      bar.innerHTML = cmdBtn('rename', 'rename', t('ui_fx_cmd_rename', 'Rename'), !(one && canManage(one))) +
        cmdBtn('delete', 'trash', t('ui_fx_cmd_delete', 'Delete'), !manage) +
        cmdBtn('print', 'printer', t('ui_fx_cmd_print', 'Print'), !(state.canPrint && one));
    } else {
      bar.classList.add('hidden');
      bar.innerHTML = '';
    }
  }

  function renderExplorer() {
    var k = curFolder();
    if (!NODES[k]) { k = (isFileFolder(k) && NODES[fsBase(k)]) ? fsBase(k) : 'root'; EX.hist[EX.idx] = k; }
    var inBin = k === 'bin', isFile = isFileFolder(k);
    if (!FS.tried) fsLoadFolders();
    if (isFile) fsEnsure(k);
    // nav tree
    var nav = '';
    (function walk(key, depth) {
      var n = NODES[key];
      nav += '<div class="nav-item' + ((key === k || (isFile && key === fsBase(k))) ? ' sel' : '') + '" data-nav="' + esc(key) + '" style="padding-left:' + (8 + depth * 16) + 'px">' + icSpan(nodeIcon(key)) + '<span>' + esc(nodeName(key)) + '</span></div>';
      kidsOf(key).forEach(function (c) { walk(c, depth + 1); });
    })('root', 0);
    $('ex-nav').innerHTML = nav;

    // breadcrumb
    var chain = [], cur = k;
    while (cur) { chain.unshift(cur); cur = NODES[cur].parent; }
    $('ex-addr').innerHTML = icSpan(nodeIcon(k)) + chain.map(function (c, i) {
      return (i ? '<span class="crumb-sep">›</span>' : '') + '<span class="crumb" data-nav="' + esc(c) + '">' + esc(nodeName(c)) + '</span>';
    }).join('');

    $('ex-back').disabled = EX.idx <= 0;
    $('ex-fwd').disabled = EX.idx >= EX.hist.length - 1;
    $('ex-up').disabled = !NODES[k].parent;

    // column header
    var cols = [['name', t('ui_fx_col_name', 'Name')],
      ['date', inBin ? t('ui_fx_col_deleted', 'Date deleted') : t('ui_date_tested', 'Date tested')],
      ['result', t('ui_fx_col_result', 'Result')],
      ['expires', inBin ? t('ui_fx_col_deletedby', 'Deleted by') : t('ui_fx_col_expires', 'Expires')]];
    if (isFile) cols = [['name', t('ui_fx_col_name', 'Name')], ['date', t('fl_col_modified', 'Date modified')], ['size', t('fl_col_size', 'Size')], ['by', t('fl_col_author', 'Author')]];
    $('ex-head').innerHTML = cols.map(function (c) {
      return '<div data-sort="' + c[0] + '">' + esc(c[1]) + (EX.sortKey === c[0] ? '<span class="arrow">' + (EX.sortDir < 0 ? '▼' : '▲') + '</span>' : '') + '</div>';
    }).join('');

    // items
    var q = EX.q.trim();
    var isCertFolder = k.indexOf('mot/') === 0 || inBin || (k === 'mot' && !!q);
    var items = [];
    if (!q) kidsOf(k).forEach(function (sub) { items.push({ type: 'folder', k: sub }); });
    var msg = '';
    if (isCertFolder && !(inBin && !appVisible('mot'))) {   // (a job without the MOT app has no certificates, only files, in its bin)
      if (state.certsState === 'loading' || state.certsState === 'idle') msg = esc(t('ui_fx_loading', 'Loading…'));
      else if (state.certsState === 'error') msg = esc(t('ui_fx_error', "Couldn't load certificates")) + '<br><div class="btn" data-retry="1">' + esc(t('ui_fx_retry', 'Try again')) + '</div>';
      else {
        var certs = certsFor(k).filter(function (c) { return !q || certMatches(c, q); });
        sortCerts(certs).forEach(function (c) { items.push({ type: 'cert', c: c }); });
      }
    }
    if (inBin) {
      binFiles().filter(function (f) { return !q || f.name.toLowerCase().indexOf(q.toLowerCase()) !== -1; }).forEach(function (f) { items.push({ type: 'bfile', f: f }); });
      items = sortBin(items);
    }
    if (isFile) {
      var fst = FS.state[k];
      if (fst === 'error') msg = esc(t('fl_error', "Couldn't load the files")) + '<br><div class="btn" data-retry="1">' + esc(t('fl_retry', 'Try again')) + '</div>';
      else if (fst !== 'ok') msg = esc(t('fl_loading', 'Loading…'));
      else sortFiles((FS.data[k] || []).filter(function (f) { return !q || f.name.toLowerCase().indexOf(q.toLowerCase()) !== -1; })).forEach(function (f) { items.push({ type: 'file', f: f }); });
    }
    if (!msg && !items.length) msg = esc(inBin ? t('ui_fx_bin_empty', 'Recycle Bin is empty') : t('ui_fx_empty', 'This folder is empty'));
    EX.view = items;

    // drop selections that no longer exist
    var present = {};
    items.forEach(function (it) { present[keyOfItem(it)] = true; });
    Object.keys(EX.sel).forEach(function (key) { if (!present[key]) delete EX.sel[key]; });
    if (EX.renaming && !present[EX.renaming]) EX.renaming = null;

    var rows = items.map(function (it) {
      var key = keyOfItem(it), selCls = EX.sel[key] ? ' sel' : '';
      if (it.type === 'file') return fileRow(it.f, key, selCls);
      if (it.type === 'bfile') return binFileRow(it.f, key, selCls);
      if (it.type === 'folder') {
        var cnt = (state.certsState === 'ok' && (it.k.indexOf('mot/') === 0)) ? '<span class="dim" style="margin-left:8px">' + certsFor(it.k).length + '</span>' : '';
        return '<div class="ex-row' + selCls + '" data-key="' + esc(key) + '"><div class="nm">' + icSpan(nodeIcon(it.k)) + '<span>' + esc(nodeName(it.k)) + '</span>' + cnt + '</div><div></div><div></div><div></div></div>';
      }
      var c = it.c, exp = certExpired(c);
      var nameHtml = (EX.renaming === key)
        ? '<input class="rn" type="text" maxlength="60" autocomplete="off" value="' + esc(EX.renameVal) + '">'
        : '<span>' + esc(certName(c)) + '</span>';
      var col2 = inBin ? fmtDate(c.deletedAt) : fmtDate(c.issuedAt);
      var col4 = inBin ? (c.deletedBy || '—') : (c.passed ? fmtDate(c.expiresAt) : '—');
      return '<div class="ex-row' + selCls + '" data-key="' + esc(key) + '"><div class="nm">' + icSpan(c.passed ? 'certpass' : 'certfail') + nameHtml + '</div>' +
        '<div class="dim">' + esc(col2) + '</div>' +
        '<div><span class="chip ' + (c.passed ? 'pass' : 'fail') + '">' + esc(c.passed ? t('ui_word_pass', 'PASS') : t('ui_word_fail', 'FAIL')) + '</span></div>' +
        '<div class="dim' + (!inBin && exp ? ' late' : '') + '">' + esc(col4) + '</div></div>';
    }).join('');
    $('ex-rows').innerHTML = rows + (msg ? '<div class="ex-msg">' + msg + '</div>' : '');

    if (EX.renaming) {
      var inp = $('ex-rows').querySelector('.rn');
      if (inp) { inp.focus(); inp.select(); }
    }

    var n = items.length;
    $('ex-count').textContent = n === 1 ? t('ui_fx_item_one', '1 item') : fmt(t('ui_fx_items', '%s items'), n);
    renderPreview();
    renderCmd();
    updateBinIcon();
  }

  function renderPreview() {
    var count = selCount();
    $('ex-sel').textContent = count === 0 ? '' : (count === 1 ? t('ui_fx_selected', '1 item selected') : fmt(t('ui_fx_selected_n', '%s items selected'), count));
    var el = $('ex-prev');
    var certs = selCerts();
    var pf = selFiles();
    if (pf.length === 1 && count === 1) { el.innerHTML = filePreview(pf[0]); return; }
    var pb = selBinFiles();
    if (pb.length === 1 && count === 1) { el.innerHTML = binFilePreview(pb[0]); return; }
    if (certs.length !== 1) {
      el.innerHTML = '<div class="hint">' + esc(count > 1 ? fmt(t('ui_fx_selected_n', '%s items selected'), count) : t('ui_fx_select', 'Select a file to preview')) + '</div>';
      return;
    }
    var c = certs[0];
    var exp = certExpired(c), inBin = curFolder() === 'bin';
    function kv(k, v) { return '<div class="pv-kv"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>'; }
    function list(ids) { return '<ul class="pv-list">' + ids.map(function (id) { var n = noteOf(c.notes, id); return '<li>' + esc(itemLabel(id).label) + (n ? '<div class="pv-note">' + esc(n) + '</div>' : '') + '</li>'; }).join('') + '</ul>'; }
    el.innerHTML =
      '<div class="pv-badge">' + icSpan(c.passed ? 'certpass' : 'certfail') + '<b>' + esc(c.passed ? (exp ? t('ui_status_expired', 'Expired') : ((c.advisoryItems || []).length ? t('ui_word_pass_adv', 'PASS (with advisories)') : t('ui_status_valid', 'Valid'))) : t('ui_word_fail', 'FAIL')) + '</b></div>' +
      '<div class="pv-plate">' + esc(fmtPlate(c.plate)) + '</div>' +
      '<div class="pv-model">' + esc(c.model || t('ui_unknown_vehicle', 'Unknown vehicle')) + '</div>' +
      kv(t('ui_fx_col_name', 'Name'), certName(c)) +
      kv(t('ui_test_number', 'MOT test number'), c.testNumber) +
      kv(t('ui_date_tested', 'Date tested'), fmtDate(c.issuedAt)) +
      (c.passed ? kv(t('ui_expiry', 'Expiry date'), fmtDate(c.expiresAt)) : '') +
      kv(t('ui_mileage', 'Mileage'), c.mileage ? Number(c.mileage).toLocaleString(loc()) + ' ' + unitLabel(c.mileageUnit) : '—') +
      kv(t('ui_cert_tester', 'Tested by'), c.testerName || '—') +
      kv(t('ui_cert_station', 'Test station'), c.locationLabel || '—') +
      (inBin ? kv(t('ui_fx_col_deleted', 'Date deleted'), fmtDate(c.deletedAt)) + kv(t('ui_fx_col_deletedby', 'Deleted by'), c.deletedBy || '—') : '') +
      ((c.failedItems || []).length ? '<div class="pv-kv"><div class="k">' + esc(t('ui_failed_label', 'Failed items')) + '</div></div>' + list(c.failedItems) : '') +
      ((c.advisoryItems || []).length ? '<div class="pv-kv"><div class="k">' + esc(t('ui_advisories', 'Advisories')) + '</div></div>' + list(c.advisoryItems) : '') +
      (inBin ? '' : '<div class="btn primary" data-openpv="1" style="margin-top:6px">' + esc(t('ui_fx_open', 'Open')) + '</div>');
  }

  function openRowKey(key) {
    if (!key) return;
    if (key.indexOf('f:') === 0) { navigate(key.slice(2)); return; }
    if (key.indexOf('x:') === 0) { var ff = fileById(key.slice(2)); if (ff) fsOpen(ff); return; }
    if (key.indexOf('b:') === 0) { var bf0 = binFiles().filter(function (x) { return String(x.id) === key.slice(2); })[0]; if (bf0) showBinFileProps(bf0); return; }
    var c = null, tn = key.slice(2);
    EX.view.forEach(function (it) { if (it.type === 'cert' && it.c.testNumber === tn) c = it.c; });
    if (!c) return;
    if (curFolder() === 'bin') showProps(c); else openCert(c);
  }

  // ---- dialogs ----
  var dlgBtns = null;
  function showDlg(o) {
    $('dlg-title').textContent = o.title;
    $('dlg-body').innerHTML = o.html;
    $('dlg-foot').innerHTML = o.buttons.map(function (b, i) {
      return '<div class="btn' + (b.primary ? ' primary' : '') + '" data-dlg="' + i + '">' + esc(b.label) + '</div>';
    }).join('');
    dlgBtns = o.buttons;
    $('dialog').classList.remove('hidden');
  }
  function closeDlg() { $('dialog').classList.add('hidden'); dlgBtns = null; }
  function confirmDlg(title, text, onYes) {
    showDlg({ title: title, html: '<div>' + esc(text) + '</div>', buttons: [
      { label: t('ui_dlg_yes', 'Yes'), primary: true, run: onYes },
      { label: t('ui_dlg_no', 'No') }
    ] });
  }
  $('dialog').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dlg]');
    if (!b || !dlgBtns) return;
    var run = dlgBtns[+b.dataset.dlg].run;
    closeDlg();
    if (run) run();
  });


  // ---- printing (as-printer): pick a printer near you, colour or black and white, a design and a letterhead
  //   job = { kind: 'cert' | 'text' | 'image', title, text, url, testNumber }
  function prApi(name, data) {
    if (isDui) return Promise.resolve({ ok: false, reason: 'network' });
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/printApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }
  function prErr(res) {
    if (res && res.message) return res.message;
    var m = { not_authorised: ['pr_err_not_authorised', 'You cannot print from this computer.'], invalid: ['pr_err_invalid', 'That cannot be printed.'],
      network: ['pr_err_network', 'Could not reach the server.'], no_printer: ['pr_err_no_printer', 'There is no printer nearby.'] };
    var e = m[res && res.reason] || ['pr_err_error', 'Printing failed. Try again.'];
    return t(e[0], e[1]);
  }
  function openPrintDialog(job) {
    if (!state.printer || !job) return;
    showDlg({ title: t('pr_title', 'Print'), html: '<div class="pr-msg">' + esc(t('pr_looking', 'Looking for printers nearby…')) + '</div>', buttons: [{ label: t('ui_dlg_cancel', 'Cancel') }] });
    var mine = ++prSeq;
    prApi('options').then(function (res) {
      if (mine !== prSeq) return;
      var d = res && res.ok && res.data;
      if (!d || !d.available || !(d.printers || []).length) {
        showDlg({ title: t('pr_title', 'Print'), html: '<div class="pr-msg">' + esc(d && d.available ? t('pr_none', 'There is no printer within range. Move closer to one.') : (res && res.ok ? t('pr_off', 'Printing is not available.') : prErr(res))) + '</div>',
          buttons: [{ label: t('ui_dlg_ok', 'OK'), primary: true }] });
        return;
      }
      var first = null;
      var popts = d.printers.map(function (p) {
        var bad = !p.allowed || p.paper <= 0 || p.black <= 0;
        if (!bad && !first) first = p.key;
        return '<option value="' + esc(p.key) + '"' + (bad ? ' disabled' : '') + '>' + esc(p.label + ' · ' + Math.round(p.distance) + ' m · ' + (p.allowed ? fmt(t('pr_levels', 'paper %s, black %s, colour %s'), p.paper, p.black, p.colour) : t('pr_restricted', 'restricted'))) + '</option>';
      }).join('');
      var dopts = (d.designs || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + '</option>'; }).join('');
      var lopts = '<option value="">' + esc(t('pr_no_letterhead', 'None')) + '</option>' + (d.letterheads || []).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.label) + '</option>'; }).join('');
      showDlg({
        title: t('pr_title', 'Print') + ' — ' + (job.title || ''),
        html: '<div class="pr-form"><label>' + esc(t('pr_printer', 'Printer')) + '</label><select id="pr-printer">' + popts + '</select>' +
          '<label>' + esc(t('pr_mode', 'Colour')) + '</label><select id="pr-colour"><option value="0">' + esc(t('pr_bw', 'Black and white')) + '</option><option value="1">' + esc(t('pr_colour', 'Colour')) + '</option></select>' +
          (job.kind === 'cert' ? '' : '<label>' + esc(t('pr_design', 'Paper design')) + '</label><select id="pr-design">' + dopts + '</select>') +
          '<label>' + esc(t('pr_letterhead', 'Letterhead')) + '</label><select id="pr-letter">' + lopts + '</select></div>',
        buttons: [
          { label: t('pr_print', 'Print'), primary: true, run: function () {
            var sel = $('pr-printer'), body = {
              printer: sel ? sel.value : '', colour: !!($('pr-colour') && $('pr-colour').value === '1'),
              design: $('pr-design') ? $('pr-design').value : '', letterhead: $('pr-letter') ? $('pr-letter').value : '',
              title: job.title, text: job.text, url: job.url, testNumber: job.testNumber
            };
            prApi(job.kind, body).then(function (r2) {
              showDlg({ title: t('pr_title', 'Print'), html: '<div class="pr-msg">' + esc(r2 && r2.ok ? fmt(t('pr_sent', 'Sent to %s. Collect it from the tray in about %s seconds.'), r2.data.printer || t('pr_printer', 'Printer'), r2.data.seconds || 0) : prErr(r2)) + '</div>',
                buttons: [{ label: t('ui_dlg_ok', 'OK'), primary: true }] });
            });
          } },
          { label: t('ui_dlg_cancel', 'Cancel') }
        ]
      });
      if (first && $('pr-printer')) $('pr-printer').value = first;
    });
  }
  var prSeq = 0;
  function printCert(c) { if (state.printer) openPrintDialog({ kind: 'cert', title: certName(c), testNumber: c.testNumber }); else postToClient('printCertificate', c); }

  function showProps(c) {
    function row(k, v) { return '<div>' + esc(k) + '</div><div><b>' + esc(v) + '</b></div>'; }
    var result = c.passed ? ((c.advisoryItems || []).length ? t('ui_word_pass_adv', 'PASS (with advisories)') : t('ui_word_pass', 'PASS')) : t('ui_word_fail', 'FAIL');
    showDlg({
      title: t('ui_ctx_props', 'Properties'),
      html: '<div class="pr">' +
        row(t('ui_fx_col_name', 'Name'), certName(c)) + row(t('ui_test_number', 'MOT test number'), c.testNumber) +
        row(t('ui_cert_reg', 'Registration number'), fmtPlate(c.plate)) + row(t('ui_cert_make', 'Make and model'), c.model || '—') +
        row(t('ui_fx_col_result', 'Result'), result) + row(t('ui_date_tested', 'Date tested'), fmtDate(c.issuedAt)) +
        (c.passed ? row(t('ui_expiry', 'Expiry date'), fmtDate(c.expiresAt)) : '') +
        row(t('ui_cert_tester', 'Tested by'), c.testerName || '—') + row(t('ui_cert_station', 'Test station'), c.locationLabel || '—') +
        (c.deleted ? row(t('ui_fx_col_deleted', 'Date deleted'), fmtDate(c.deletedAt)) + row(t('ui_fx_col_deletedby', 'Deleted by'), c.deletedBy || '—') : '') +
        '</div>',
      buttons: [{ label: t('ui_dlg_ok', 'OK'), primary: true }]
    });
  }

  // ---- file actions (server enforces ownership; UI updates optimistically, then re-syncs) ----
  function tnList(certs) { return certs.map(function (c) { return c.testNumber; }); }

  function deleteSelected() {
    if (isFileFolder(curFolder())) { fsDelete(); return; }
    var certs = selCerts().filter(canManage), inBin = curFolder() === 'bin';
    var bfs = inBin ? selBinFiles().filter(function (f) { return f.manage; }) : [];
    if (!certs.length && !bfs.length) return;
    if (inBin) {
      var total = certs.length + bfs.length;
      confirmDlg(t('ui_dlg_delete_title', 'Delete'),
        total === 1 ? (certs.length ? t('ui_dlg_delete_one', 'Are you sure you want to permanently delete this certificate?') : t('fl_bin_delete_one', 'Are you sure you want to permanently delete this item?'))
          : (bfs.length ? fmt(t('fl_bin_delete_many', 'Are you sure you want to permanently delete these %s items?'), total) : fmt(t('ui_dlg_delete_many', 'Are you sure you want to permanently delete these %s certificates?'), certs.length)),
        function () {
          if (certs.length) {
            var gone = {}; tnList(certs).forEach(function (n) { gone[n] = true; });
            state.certs = (state.certs || []).filter(function (c) { return !gone[c.testNumber]; });
            postToClient('certPurge', { list: tnList(certs) });
          }
          EX.sel = {}; renderExplorer();
          if (bfs.length) fsPurgeFiles(bfs);
        });
    } else {
      certs.forEach(function (c) { c.deleted = true; c.deletedAt = nowStr(); c.deletedBy = state.user; });
      EX.sel = {}; renderExplorer();
      postToClient('certDelete', { list: tnList(certs) });
    }
  }
  function restoreCerts(certs) {
    certs = certs.filter(canManage);
    if (!certs.length) return;
    certs.forEach(function (c) { c.deleted = false; c.deletedAt = null; c.deletedBy = null; });
    EX.sel = {}; renderExplorer();
    postToClient('certRestore', { list: tnList(certs) });
  }
  function emptyBin() {
    var certs = binCerts().filter(canManage), files = binFiles().filter(function (f) { return f.manage; });
    if (!certs.length && !files.length) return;
    confirmDlg(t('ui_dlg_delete_title', 'Delete'), fmt(t('ui_dlg_empty', 'Are you sure you want to permanently delete all %s items in the Recycle Bin?'), certs.length + files.length), function () {
      if (certs.length) {
        var gone = {}; tnList(certs).forEach(function (n) { gone[n] = true; });
        state.certs = (state.certs || []).filter(function (c) { return !gone[c.testNumber]; });
        postToClient('certPurge', { list: tnList(certs) });
      }
      if (files.length) {
        FS.bin.data = binFiles().filter(function (f) { return !f.manage; });
        fsApi('binEmpty').then(function (res) { fsBinLoad(true); if (!res.ok) fsErrDlg(res); });
      }
      EX.sel = {}; renderExplorer();
    });
  }

  function startRename() {
    if (isFileFolder(curFolder())) { fsStartRename(); return; }
    var certs = selCerts();
    if (certs.length !== 1 || !canManage(certs[0]) || curFolder() === 'bin') return;
    EX.renaming = 'c:' + certs[0].testNumber;
    EX.renameVal = certName(certs[0]);
    renderExplorer();
  }
  function commitRename(val) {
    var key = EX.renaming;
    if (!key) return;
    if (key.indexOf('x:') === 0) { fsCommitRename(key, val); return; }
    EX.renaming = null;
    var tn = key.slice(2), c = null;
    (state.certs || []).forEach(function (x) { if (x.testNumber === tn) c = x; });
    if (c) {
      val = String(val || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      var def = fmtPlate(c.plate) + ' — ' + c.testNumber;
      var newName = (val === def) ? '' : val;
      if ((c.name || '') !== newName) {
        c.name = newName;
        postToClient('certRename', { testNumber: tn, name: newName });
      }
    }
    renderExplorer();
  }
  function cancelRename() { EX.renaming = null; renderExplorer(); }

  function copyText(s) {
    var i = document.createElement('input');
    i.value = s; i.style.position = 'fixed'; i.style.opacity = '0';
    document.body.appendChild(i); i.select();
    try { document.execCommand('copy'); } catch (err) { /* ignore */ }
    i.remove();
  }

  function setSort(key) {
    if (EX.sortKey === key) EX.sortDir = -EX.sortDir; else { EX.sortKey = key; EX.sortDir = (key === 'date' || key === 'expires') ? -1 : 1; }
    renderExplorer();
  }

  // ---- context menus ----
  var ctx = { open: false, items: [] };
  function hideCtx() { $('ctxmenu').classList.add('hidden'); ctx.open = false; }
  function showCtx(e, items) {
    var m = $('ctxmenu');
    m.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="ci-sep"></div>';
      return '<div class="ci' + (it.off ? ' off' : '') + (it.bold ? ' bold' : '') + '" data-ci="' + i + '"><span>' + esc(it.label) + '</span>' + (it.hint ? '<span class="hint">' + esc(it.hint) + '</span>' : '') + '</div>';
    }).join('');
    ctx.items = items;
    m.classList.remove('hidden');
    var r = app.getBoundingClientRect(), sc = scaleFactor();
    var x = (e.clientX - r.left) / sc, y = (e.clientY - r.top) / sc;
    var w = m.offsetWidth, h = m.offsetHeight, aw = app.offsetWidth, ah = app.offsetHeight;
    if (x + w > aw - 4) x = Math.max(4, x - w);
    if (y + h > ah - 4) y = Math.max(4, y - h);
    m.style.left = Math.round(x) + 'px';
    m.style.top = Math.round(y) + 'px';
    ctx.open = true;
  }
  $('ctxmenu').addEventListener('click', function (e) {
    var el = e.target.closest('[data-ci]');
    if (!el) return;
    var it = ctx.items[+el.dataset.ci];
    if (!it || it.off) return;
    hideCtx();
    if (it.run) it.run();
  });
  document.addEventListener('mousedown', function (e) {
    if (ctx.open && !e.target.closest('#ctxmenu')) hideCtx();
  }, true);
  window.addEventListener('blur', function () {
    hideCtx();
    var a = document.activeElement;   // a click inside a website's iframe: bring its window to the front
    if (a && a.tagName === 'IFRAME') { var wf = winByEl(a.closest('.win')); if (wf) focusWin(wf.id); }
  });

  function rowMenu(key) {
    if (!EX.sel[key]) setSel([key]);
    if (key.indexOf('f:') === 0) return [{ label: t('ui_ctx_open', 'Open'), bold: true, run: function () { navigate(key.slice(2)); } }];
    if (key.indexOf('x:') === 0) return fsRowMenu(key);
    var certs = selCerts(), one = certs.length === 1 ? certs[0] : null, manage = certs.some(canManage);
    if (curFolder() === 'bin') {
      var bfs = selBinFiles(), bmanage = manage || bfs.some(function (f) { return f.manage; });
      return [
        { label: t('ui_ctx_restore', 'Restore'), bold: true, off: !bmanage, run: function () { restoreBin(selCerts(), selBinFiles()); } },
        { sep: true },
        { label: t('ui_fx_cmd_delete', 'Delete'), hint: 'Del', off: !bmanage, run: deleteSelected },
        { sep: true },
        { label: t('ui_ctx_props', 'Properties'), off: certs.length + bfs.length !== 1, run: function () { if (one) showProps(one); else showBinFileProps(bfs[0]); } }
      ];
    }
    return [
      { label: t('ui_ctx_open', 'Open'), bold: true, off: !one, run: function () { openCert(one); } },
      { label: t('ui_fx_cmd_print', 'Print'), off: !(state.canPrint && one), run: function () { printCert(one); } },
      { label: t('ui_ctx_copy', 'Copy test number'), off: !one, run: function () { copyText(one.testNumber); } },
      { sep: true },
      { label: t('ui_fx_cmd_rename', 'Rename'), hint: 'F2', off: !(one && canManage(one)), run: startRename },
      { label: t('ui_fx_cmd_delete', 'Delete'), hint: 'Del', off: !manage, run: deleteSelected },
      { sep: true },
      { label: t('ui_ctx_props', 'Properties'), off: !one, run: function () { showProps(one); } }
    ];
  }

  function areaMenu() {
    if (isFileFolder(curFolder())) return fsAreaMenu();
    var k = curFolder(), inBin = k === 'bin', items = [];
    if (inBin) items.push({ label: t('ui_fx_cmd_empty', 'Empty Recycle Bin'), off: !binCanEmpty(), run: emptyBin }, { sep: true });
    if (inBin || k.indexOf('mot/') === 0) {
      [['name', t('ui_fx_col_name', 'Name')], ['date', inBin ? t('ui_fx_col_deleted', 'Date deleted') : t('ui_date_tested', 'Date tested')],
       ['result', t('ui_fx_col_result', 'Result')], ['expires', inBin ? t('ui_fx_col_deletedby', 'Deleted by') : t('ui_fx_col_expires', 'Expires')]].forEach(function (c) {
        items.push({ label: (EX.sortKey === c[0] ? '✓  ' : '      ') + fmt(t('ui_ctx_sort', 'Sort by %s'), c[1].toLowerCase()), run: function () { setSort(c[0]); } });
      });
      items.push({ sep: true });
    }
    items.push({ label: t('ui_ctx_refresh', 'Refresh'), hint: 'F5', run: function () { refreshCurrent(); } });
    return items;
  }

  function openExplorer(folder, q) {
    openWin('explorer');
    navigate(folder || curFolder());
    if (q) { EX.q = q; $('ex-search').value = q; renderExplorer(); }
  }

  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (isDui || !e.target.closest) return;
    if ($('dialog') && !$('dialog').classList.contains('hidden')) return;
    if (!$('lock').classList.contains('hidden')) return;
    var items = null, row = e.target.closest('.ex-row'), nav = e.target.closest('.nav-item'), icon = e.target.closest('.dicon'), tbbtn = e.target.closest('.tbbtn[data-tb]');
    if (row && !e.target.closest('.rn')) items = rowMenu(row.dataset.key);
    else if (e.target.closest('.rn')) return;
    else if (nav && exWin.contains(nav)) {
      var nk = nav.dataset.nav;
      items = [{ label: t('ui_ctx_open', 'Open'), bold: true, run: function () { navigate(nk); } }];
      if (nk === 'bin') items.push({ label: t('ui_fx_cmd_empty', 'Empty Recycle Bin'), off: !binCanEmpty(), run: emptyBin });
    }
    else if (e.target.closest('#ex-rows') || e.target.closest('.ex-list')) { setSel([]); items = areaMenu(); }
    else if (icon) {
      var app_ = icon.dataset.app;
      items = [{ label: t('ui_ctx_open', 'Open'), bold: true, run: function () { openApp(app_); } }];
      if (app_ !== 'bin') {
        items.push({ label: isPinned(app_) ? t('ui_ctx_unpin_tb', 'Unpin from taskbar') : t('ui_ctx_pin_tb', 'Pin to taskbar'), run: function () { togglePin(app_); } });
      }
      if (app_ === 'bin') items.push({ label: t('ui_fx_cmd_empty', 'Empty Recycle Bin'), off: !binCanEmpty(), run: emptyBin });
    }
    else if (tbbtn) {
      var tid = tbbtn.dataset.tb;
      items = [{ label: isPinned(tid) ? t('ui_ctx_unpin_tb', 'Unpin from taskbar') : t('ui_ctx_pin_tb', 'Pin to taskbar'), bold: true, run: function () { togglePin(tid); } }];
      var tw = wins[tid];
      if (tw && tw.open) items.push({ sep: true }, { label: t('ui_ctx_close_window', 'Close window'), run: function () { closeWin(tid); } });
    }
    else if (e.target.closest('#desktop') || e.target.closest('#wallpaper')) {
      items = [{ label: t('ui_ctx_open_explorer', 'Open File Explorer'), run: function () { openWin('explorer'); } }]
        .concat([{ label: t('ui_ctx_display', 'Display settings'), run: function () { openSettings('system/display'); } },
                 { label: t('ui_ctx_personalise', 'Personalise'), run: function () { openSettings('personal'); } }])
        .concat(appVisible('store') ? [{ label: t('ui_ctx_open_store', 'Open Store'), run: function () { openWin('store'); } }] : [])
        .concat(appVisible('mot') ? [{ label: t('ui_ctx_open_mot', 'Open MOT Testing Service'), run: function () { openWin('mot'); } }] : [])
        .concat(appVisible('calendar') ? [{ label: t('ui_ctx_open_calendar', 'Open Calendar'), run: function () { openWin('calendar'); } }] : [])
        .concat(appVisible('browser') ? [{ label: t('ui_ctx_open_browser', 'Open Scout'), run: function () { openWin('browser'); } }] : []).concat([
        { sep: true },
        { label: t('ui_ctx_refresh', 'Refresh'), run: function () { refreshCerts(true); } }
      ]);
    }
    else if (e.target.closest('#win-calendar') && !isDui) {
      var cev = e.target.closest('[data-ev]');
      if (cev) {
        var ced = calEventById(cev.dataset.ev), cid = cev.dataset.ev;
        items = [
          { label: t('ui_cal_edit', 'Edit'), bold: true, run: function () { if (ced) calOpenForm(ced); } },
          { sep: true },
          { label: t('ui_fx_cmd_delete', 'Delete'), run: function () { calDeleteEvent(+cid); } }
        ];
      } else {
        var ccell = e.target.closest('.cm-cell, .ad, .slot, .dh'), cdate = null, ctime = null;
        if (ccell) {
          if (ccell.classList.contains('slot')) { cdate = ccell.closest('.col').dataset.date; ctime = pad2(+ccell.dataset.hour) + ':00'; }
          else cdate = ccell.dataset.date;
        }
        if (cdate) items = [
          { label: t('ui_cal_new_event', 'New event'), bold: true, run: function () { calOpenForm(null, cdate, ctime); } },
          { label: t('ui_cal_view_day', 'View day'), run: function () { calSetDate(fromYmd(cdate), 'day'); } },
          { sep: true },
          { label: t('ui_cal_today', 'Today'), run: function () { calSetDate(calToday()); } }
        ];
      }
    }
    else if (e.target.closest('.br-chip') && !isDui) {
      var chip = e.target.closest('.br-chip'), cu = chip.dataset.bmurl;
      items = [
        { label: t('ui_ctx_open', 'Open'), bold: true, run: function () { brGo(brActive(), cu); } },
        { label: t('ui_br_open_tab', 'Open in new tab'), run: function () { if (BR.tabs.length < BR_MAX) brNewTab(cu, true); else brToast(fmt(t('ui_br_tab_limit', 'You can have up to %s tabs open.'), BR_MAX)); } },
        { sep: true },
        { label: t('ui_br_remove', 'Remove'), run: function () { brRemoveBm(cu); } }
      ];
    }
    if (items) showCtx(e, items); else hideCtx();
  });

  var exWin = $('win-explorer');
  exWin.addEventListener('click', function (e) {
    if (e.target.closest('.rn')) return;
    var nav = e.target.closest('[data-nav]');
    if (nav) { navigate(nav.dataset.nav); return; }
    var sort = e.target.closest('[data-sort]');
    if (sort) { setSort(sort.dataset.sort); return; }
    if (e.target.closest('[data-retry]')) { refreshCurrent(); return; }
    var cmd = e.target.closest('[data-cmd]');
    if (cmd) {
      var id = cmd.dataset.cmd;
      if (id.indexOf('fs-') === 0) { fsCmd(id, cmd); return; }
      if (id === 'rename') startRename();
      else if (id === 'delete') deleteSelected();
      else if (id === 'print') { var one = selCerts()[0]; if (one && state.canPrint) printCert(one); }
      else if (id === 'empty') emptyBin();
      else if (id === 'restore') restoreBin(selCerts(), selBinFiles());
      else if (id === 'restoreall') restoreBin(binCerts(), binFiles());
      return;
    }
    if (e.target.closest('[data-binrestore]')) { restoreBin([], selBinFiles()); return; }
    if (e.target.closest('[data-fsopen]')) { var pf1 = selFiles()[0]; if (pf1) fsOpen(pf1); return; }
    if (e.target.closest('[data-openpv]')) { var sc = selCerts()[0]; if (sc) openCert(sc); return; }
    var row = e.target.closest('.ex-row');
    if (row) {
      var key = row.dataset.key;
      if (e.ctrlKey) {
        var next = Object.keys(EX.sel);
        var at = next.indexOf(key);
        if (at === -1) next.push(key); else next.splice(at, 1);
        EX.anchor = key; setSel(next);
      } else if (e.shiftKey && EX.anchor) {
        var keys = EX.view.map(keyOfItem), a = keys.indexOf(EX.anchor), b = keys.indexOf(key);
        if (a === -1) a = b;
        setSel(keys.slice(Math.min(a, b), Math.max(a, b) + 1));
      } else { EX.anchor = key; setSel([key]); }
      return;
    }
    if (e.target.closest('.ex-list') && !e.target.closest('#ex-head')) setSel([]);
  });
  exWin.addEventListener('dblclick', function (e) {
    if (e.target.closest('.rn')) return;
    var row = e.target.closest('.ex-row');
    if (row) openRowKey(row.dataset.key);
  });
  exWin.addEventListener('dragstart', function (e) {
    var row = e.target.closest && e.target.closest('.ex-row');
    if (!row || row.dataset.key.indexOf('x:') !== 0) { e.preventDefault(); return; }
    if (!EX.sel[row.dataset.key]) setSel([row.dataset.key]);
    EX.dragging = true;
    try { e.dataTransfer.setData('text/plain', 'files'); e.dataTransfer.effectAllowed = 'copy'; } catch (err) { /* ignore */ }
  });
  exWin.addEventListener('dragover', function (e) {
    exWin.querySelectorAll('.drop').forEach(function (n) { n.classList.remove('drop'); });
    var d = fsDropTarget(e);
    if (d) { e.preventDefault(); d.el.classList.add('drop'); }
  });
  exWin.addEventListener('drop', function (e) {
    var d = fsDropTarget(e);
    exWin.querySelectorAll('.drop').forEach(function (n) { n.classList.remove('drop'); });
    if (d) { e.preventDefault(); fsTransfer(selFiles(), d.key, (e.ctrlKey || fsBase(d.key) !== fsBase(curFolder())) ? 'copy' : 'move'); }
    EX.dragging = false;
  });
  exWin.addEventListener('dragend', function () {
    EX.dragging = false;
    exWin.querySelectorAll('.drop').forEach(function (n) { n.classList.remove('drop'); });
  });
  $('ex-rows').addEventListener('keydown', function (e) {
    if (!e.target.classList || !e.target.classList.contains('rn')) return;
    if (e.key === 'Enter') { e.preventDefault(); commitRename(e.target.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
  });
  $('ex-rows').addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('rn')) EX.renameVal = e.target.value;
  });
  $('ex-rows').addEventListener('focusout', function (e) {
    if (e.target.classList && e.target.classList.contains('rn') && EX.renaming) commitRename(e.target.value);
  });
  $('ex-back').addEventListener('click', function () { if (EX.idx > 0) { EX.idx--; EX.sel = {}; EX.renaming = null; renderExplorer(); } });
  $('ex-fwd').addEventListener('click', function () { if (EX.idx < EX.hist.length - 1) { EX.idx++; EX.sel = {}; EX.renaming = null; renderExplorer(); } });
  $('ex-up').addEventListener('click', function () { var p = NODES[curFolder()].parent; if (p) navigate(p); });
  $('ex-refresh').addEventListener('click', function () { refreshCurrent(); });
  $('ex-search').addEventListener('input', function (e) { EX.q = e.target.value; EX.sel = {}; renderExplorer(); });

  // ================================================================ desktop, taskbar, start menu events
  function openApp(id) {
    if (!appVisible(id) && id !== 'explorer' && id !== 'bin') return;
    if (id === 'mot') openWin('mot');
    else if (id === 'explorer') openWin('explorer');
    else if (id === 'store') openWin('store');
    else if (id === 'settings') openSettings();
    else if (id === 'browser') openWin('browser');
    else if (id === 'calendar') openWin('calendar');
    else if (EXT[id]) openWin(id);
    else if (id === 'bin') openExplorer('bin');
  }

  $('desktop').addEventListener('click', function (e) {
    var d = e.target.closest('.dicon');
    document.querySelectorAll('.dicon').forEach(function (x) { x.classList.toggle('sel', x === d); });
  });
  $('desktop').addEventListener('dblclick', function (e) {
    var d = e.target.closest('.dicon');
    if (d) openApp(d.dataset.app);
  });
  $('wallpaper').addEventListener('click', function () {
    document.querySelectorAll('.dicon.sel').forEach(function (x) { x.classList.remove('sel'); });
  });

  $('tb-apps').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tb]');
    if (b) taskbarClick(b.dataset.tb);
  });
  $('tb-wifi').addEventListener('click', function () { openSettings('network'); });
  $('tray-clock').addEventListener('click', function () { if (appVisible('calendar')) openWin('calendar'); });
  $('tb-start').addEventListener('click', function () { setMenu(!menuOpen); });
  $('tb-search').addEventListener('click', function () { setMenu(true); });

  $('sm-q').addEventListener('input', renderStart);
  $('sm-q').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      var q = e.target.value.trim();
      setMenu(false);
      if (q) openExplorer(appVisible('mot') ? 'mot' : 'root', q); else if (appVisible('mot')) openWin('mot');
    }
  });
  $('sm-pins').addEventListener('click', function (e) {
    var p = e.target.closest('[data-pin]');
    if (!p) return;
    setMenu(false);
    if (p.dataset.pin === 'certs') openExplorer('mot/all'); else openApp(p.dataset.pin);
  });
  $('sm-rec').addEventListener('click', function (e) {
    var r = e.target.closest('[data-rec]');
    if (!r) return;
    var c = null;
    (state.certs || []).forEach(function (x) { if (x.testNumber === r.dataset.rec) c = x; });
    setMenu(false);
    if (c) openCert(c);
  });
  $('sm-power').addEventListener('click', function () { $('power-menu').classList.toggle('hidden'); });
  $('power-menu').addEventListener('click', function (e) {
    var p = e.target.closest('[data-power]');
    if (!p) return;
    if (p.dataset.power === 'lock') showLock();
    else postToClient('close', { off: true });   // Shut down: ends the session, next time starts fresh
  });

  // outside clicks close the start menu / power menu
  document.addEventListener('mousedown', function (e) {
    if (!menuOpen) return;
    if (e.target.closest('#startmenu') || e.target.closest('#tb-start') || e.target.closest('#tb-search')) {
      if (!e.target.closest('#sm-power') && !e.target.closest('#power-menu')) $('power-menu').classList.add('hidden');
      return;
    }
    setMenu(false);
  });

  // window buttons + titlebar double-click
  $('windows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-wb]');
    if (!b) return;
    var w = winByEl(b.closest('.win'));
    if (!w) return;
    if (b.dataset.wb === 'min') minWin(w.id);
    else if (b.dataset.wb === 'max') toggleMax(w.id);
    else closeWin(w.id);
  });
  $('windows').addEventListener('dblclick', function (e) {
    var tb = e.target.closest('.titlebar');
    if (!tb || e.target.closest('.wb')) return;
    var w = winByEl(tb.closest('.win'));
    if (w) toggleMax(w.id);
  });

  $('lock').addEventListener('click', function (e) {
    if (state.lockPassword) {
      if (e.target.closest('#lock-pwbox')) return;
      if (e.target.closest('#lock-btn')) { attemptUnlock(); return; }
      var pw = $('lock-pw'); if (pw) pw.focus();
      return;
    }
    signIn();
  });

  // Phase 0.5 setup / login gate screens - registered here alongside the lock screen's own listeners.
  (function () {
    var gsBtn = $('gs-btn'), glBtn = $('gl-btn'), gsLink = $('gs-link'), glLink = $('gl-link');
    if (gsBtn) gsBtn.addEventListener('click', submitGateSetup);
    if (glBtn) glBtn.addEventListener('click', submitGateLogin);
    // gs-link: "already have an account?" on the fresh-machine setup wizard -> login screen, flagged
    // as a fresh-machine claim so it shows the right subtitle/link (see showGateLogin above).
    if (gsLink) gsLink.addEventListener('click', function () { showGateLogin(true); });
    // gl-link: only visible when showGateLogin(true) put it there - takes the player back to Setup.
    if (glLink) glLink.addEventListener('click', showGateSetup);
    ['gs-user', 'gs-pass', 'gs-pass2'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitGateSetup(); });
    });
    ['gl-user', 'gl-pass'].forEach(function (id) {
      var el = $(id); if (el) el.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitGateLogin(); });
    });
  })();

  document.addEventListener('keydown', function (e) {
    if (isDui) return;
    if (dlgBtns) {
      e.preventDefault();
      if (e.key === 'Escape') closeDlg();
      else if (e.key === 'Enter') {
        var pi = -1;
        dlgBtns.forEach(function (bt, i) { if (bt.primary && pi === -1) pi = i; });
        var run = pi > -1 ? dlgBtns[pi].run : null;
        closeDlg();
        if (run) run();
      }
      return;
    }
    if (ctx.open && e.key === 'Escape') { hideCtx(); return; }
    if (!$('lock').classList.contains('hidden')) {
      if (e.key === 'Enter') { e.preventDefault(); attemptUnlock(); }
      else if (e.key === ' ' && !state.lockPassword) { e.preventDefault(); signIn(); }
      else if (e.key === 'Escape' && !state.lockPassword) postToClient('close');
      return;
    }
    if (e.target && e.target.classList && e.target.classList.contains('rn')) return; // inline rename handles its own keys
    if (e.key === 'Escape') {
      if (menuOpen) setMenu(false); else postToClient('close');
      return;
    }
    if (e.key === 'Enter' && e.target && e.target.id === 'reg') { startLookup(e.target.value); return; }
    if (activeId === 'calendar' && !(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA'))) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); calGo(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); calGo(1); return; }
      if (e.key === 't' || e.key === 'T') { calSetDate(calToday()); return; }
    }
    if (activeId === 'browser') {
      var btab = brActive();
      if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); $('br-url').focus(); return; }
      if (e.key === 'F5' && btab) { e.preventDefault(); $('br-reload').click(); return; }
      if (e.altKey && e.key === 'ArrowLeft' && btab) { e.preventDefault(); brStep(btab, -1); return; }
      if (e.altKey && e.key === 'ArrowRight' && btab) { e.preventDefault(); brStep(btab, 1); return; }
    }
    if (activeId === 'explorer' && !(e.target && e.target.tagName === 'INPUT')) {
      var keys = EX.view.map(keyOfItem), cur = -1;
      keys.forEach(function (kk, i) { if (EX.sel[kk]) cur = i; });
      if (e.key === 'ArrowDown' && keys.length) { e.preventDefault(); EX.anchor = keys[Math.min(keys.length - 1, cur + 1)]; setSel([EX.anchor]); }
      else if (e.key === 'ArrowUp' && keys.length) { e.preventDefault(); EX.anchor = keys[Math.max(0, cur - 1)]; setSel([EX.anchor]); }
      else if (e.key === 'Enter') { var sk = Object.keys(EX.sel)[0]; if (sk) openRowKey(sk); }
      else if (e.key === 'Delete') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'F2') { e.preventDefault(); startRename(); }
      else if (e.key === 'F5') { e.preventDefault(); refreshCurrent(); }
      else if ((e.key === 'a' || e.key === 'A') && e.ctrlKey) { e.preventDefault(); setSel(EX.view.filter(function (it) { return it.type === 'cert' || it.type === 'file'; }).map(keyOfItem)); }
      else if (e.key === 'Backspace') { var p = NODES[curFolder()].parent; if (p) navigate(p); }
    }
  });

  // ================================================================ Scout (as-browser websites)
  // Chrome-style browser: tabs, address bar, search, bookmarks, history. Websites are as-browser's own pages
  // (sites/<name>/index.html) loaded in an iframe; they talk to this shell with postMessage (sdk/site.js) and
  // the shell forwards their requests to the server through the 'browserApi' NUI callback.
  var BR = { sites: [], by: {}, sitesOk: true, tabs: [], active: null, bm: [], dict: {}, cur: '£', next: 1, tok: 0, toastT: null,
    themeOverride: '', osMode: 'light', textSize: 'normal' };
  var BR_MAX = 8;
  var BR_TEXT_SCALES = { small: 0.88, normal: 1, large: 1.18 };
  var BR_COLORS = ['#4285f4', '#ea4335', '#f9ab00', '#4285f4', '#34a853', '#ea4335'];
  var brNui = /^cfx-nui-/.test(location.host);
  var brView = $('br-view');

  function brApi(name, a, b, c) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/browserApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, a: a, b: b, c: c })
    }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
  }

  function brParse(url) {
    url = String(url || 'about:newtab');
    if (url.indexOf('about:') === 0) {
      var rest = url.slice(6), qi = rest.indexOf('?'), q = {};
      var name = qi < 0 ? rest : rest.slice(0, qi);
      if (qi >= 0) rest.slice(qi + 1).split('&').forEach(function (kv) {
        var i = kv.indexOf('='); if (i < 0) return;
        try { q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) { /* bad escape */ }
      });
      return { kind: 'about', name: name || 'newtab', q: q };
    }
    var m = url.match(/^([^\/#?]+)(.*)$/);
    var host = (m ? m[1] : url).toLowerCase().replace(/^www\./, '');
    var path = (m && m[2]) || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    return { kind: 'site', host: host, path: path, site: BR.by[host] || null };
  }
  function brDisplay(url) {
    var p = brParse(url);
    return p.kind === 'about' ? '' : p.host + (p.path === '/' ? '' : p.path);
  }
  function brResolve(text) {
    var q = String(text || '').trim();
    if (!q) return 'about:newtab';
    var s = q.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    var host = s.split(/[\/#?]/)[0].toLowerCase();
    if (BR.by[host]) return host + s.slice(host.length);
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return 'about:error?e=notfound&u=' + encodeURIComponent(host);
    return 'about:search?q=' + encodeURIComponent(q);
  }
  function brFrameUrl(site, path) {
    return (brNui ? 'https://cfx-nui-' + site.resource + '/' : '/') + site.page + '#' + path;
  }
  function brCur(tab) { return tab.hist[tab.idx]; }
  function brActive() {
    for (var i = 0; i < BR.tabs.length; i++) if (BR.tabs[i].id === BR.active) return BR.tabs[i];
    return null;
  }
  function brToast(msg) {
    var el = $('br-toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(BR.toastT);
    BR.toastT = setTimeout(function () { el.classList.remove('on'); }, 2200);
  }

  // ---- Scout's own theme + text size (set from the browser's 3-dot menu > Settings, not the OS Settings app)
  function brTheme() { return (BR.themeOverride || BR.osMode) === 'dark' ? 'dark' : 'light'; }
  function brApplyTheme() {
    var win = $('win-browser');
    if (win) win.classList.toggle('br-dark', brTheme() === 'dark');
    BR.tabs.forEach(function (x) { brToFrame(x, { type: 'theme', theme: brTheme() }); });
  }
  function brApplyTextSize() {
    var scale = BR_TEXT_SCALES[BR.textSize] || 1;
    var win = $('win-browser');
    if (win) win.style.setProperty('--br-ts', scale);
    BR.tabs.forEach(function (x) { brToFrame(x, { type: 'textsize', scale: scale }); });
  }
  function brSavePrefs() {
    seApi('settingsApi', { name: 'set', data: { scoutTheme: BR.themeOverride, scoutTextSize: BR.textSize } });
  }
  function brSetThemeOverride(v) {
    BR.themeOverride = (v === 'light' || v === 'dark') ? v : '';
    brApplyTheme(); brSavePrefs();
  }
  function brSetTextSize(v) {
    BR.textSize = BR_TEXT_SCALES[v] ? v : 'normal';
    brApplyTextSize(); brSavePrefs();
  }

  // ---- tabs
  function brNewTab(url, activate) {
    var tab = { id: BR.next++, hist: [url || 'about:newtab'], idx: 0, title: t('ui_br_unnamed', 'New tab'), el: document.createElement('div'),
      frame: null, frameDomain: null, loading: false, histTimer: null, loadTimer: null, rendered: false };
    tab.el.className = 'br-tabview';
    brView.appendChild(tab.el);
    BR.tabs.push(tab);
    if (activate !== false) brActivate(tab);
    return tab;
  }
  function brActivate(tab) {
    if (typeof brMenuClose === 'function') brMenuClose();
    BR.active = tab.id;
    BR.tabs.forEach(function (x) { x.el.classList.toggle('active', x === tab); });
    if (!tab.rendered) brShow(tab); else brChrome();
  }
  function brClose(tab) {
    var i = BR.tabs.indexOf(tab);
    if (i < 0) return;
    brDestroyFrame(tab);
    clearTimeout(tab.histTimer); clearTimeout(tab.loadTimer);
    tab.el.remove();
    BR.tabs.splice(i, 1);
    if (!BR.tabs.length) { brNewTab('about:newtab', true); return; }
    if (BR.active === tab.id) brActivate(BR.tabs[Math.min(i, BR.tabs.length - 1)]); else brChrome();
  }
  function brGo(tab, url, opts) {
    opts = opts || {};
    if (!tab) return;
    if (opts.replace) tab.hist[tab.idx] = url;
    else { tab.hist = tab.hist.slice(0, tab.idx + 1); tab.hist.push(url); tab.idx = tab.hist.length - 1; }
    brShow(tab, opts);
  }
  function brStep(tab, d) {
    var n = tab.idx + d;
    if (!tab || n < 0 || n >= tab.hist.length) return;
    tab.idx = n;
    brShow(tab, {});
  }
  function brAddTab() {
    if (BR.tabs.length >= BR_MAX) { brToast(fmt(t('ui_br_tab_limit', 'You can have up to %s tabs open.'), BR_MAX)); return; }
    brNewTab('about:newtab', true);
  }

  // ---- frames
  function brDestroyFrame(tab) {
    if (tab.frame) { tab.frame.remove(); tab.frame = null; tab.frameDomain = null; }
    brSetLoading(tab, false);
  }
  function brSetLoading(tab, on) {
    clearTimeout(tab.loadTimer);
    tab.loading = on;
    if (on) tab.loadTimer = setTimeout(function () { tab.loading = false; brChrome(); }, 6000);
    brChrome();
  }
  function brToFrame(tab, msg) {
    if (!tab.frame || !tab.frame.contentWindow) return;
    msg.__asb = 1;
    try { tab.frame.contentWindow.postMessage(msg, '*'); } catch (e) { /* frame gone */ }
  }
  function brEnsureFrame(tab, p, opts) {
    if (tab.frame && tab.frameDomain === p.host) {
      if (!opts.fromSite) brToFrame(tab, { type: 'route', path: p.path });
      return;
    }
    brDestroyFrame(tab);
    tab.el.innerHTML = '';
    var f = document.createElement('iframe');
    f.className = 'br-frame';
    f.title = p.site.title;
    f.src = brFrameUrl(p.site, p.path);
    tab.el.appendChild(f);
    tab.el.classList.add('site');
    tab.frame = f; tab.frameDomain = p.host;
    brSetLoading(tab, true);
  }
  function brQueueHistory(tab) {
    clearTimeout(tab.histTimer);
    tab.histTimer = setTimeout(function () {
      var p = brParse(brCur(tab));
      if (p.kind !== 'site') return;
      brApi('history:add', brDisplay(brCur(tab)) || p.host, tab.title);
    }, 900);
  }

  // ---- rendering a tab
  function brShow(tab, opts) {
    opts = opts || {};
    tab.rendered = true;
    var url = brCur(tab), p = brParse(url);
    if (p.kind === 'site' && !p.site) {
      url = 'about:error?e=' + (BR.sitesOk ? 'notfound' : 'offline') + '&u=' + encodeURIComponent(p.host);
      tab.hist[tab.idx] = url; p = brParse(url);
    }
    if (p.kind === 'about') {
      brDestroyFrame(tab);
      tab.el.classList.remove('site');
      var built = brAbout(tab, p);
      tab.title = built.title;
      tab.el.innerHTML = '<div class="br-page">' + built.html + '</div>';
      tab.el.scrollTop = 0;
      if (built.after) built.after(tab.el);
      var q = tab.el.querySelector('.br-q');
      if (q && BR.active === tab.id) setTimeout(function () { try { q.focus(); q.select(); } catch (e) { /* hidden */ } }, 30);
    } else {
      tab.title = p.site.title;
      brEnsureFrame(tab, p, opts);
      brQueueHistory(tab);
    }
    brChrome();
  }

  function brIcon(s, cls) {
    return '<span class="br-ico' + (cls ? ' ' + cls : '') + '" style="background:' + esc((s && s.color) || '#7a8599') + '">' + esc((s && s.icon) || '🌐') + '</span>';
  }
  function brSiteFor(url) { return brParse(url).site; }

  function brChrome() {
    var tab = brActive();
    // tab strip
    var html = BR.tabs.map(function (x) {
      var p = brParse(brCur(x)), site = p.kind === 'site' ? p.site : null;
      return '<div class="br-tab' + (x.id === BR.active ? ' active' : '') + '" data-tab="' + x.id + '">' +
        (site ? brIcon(site, 'sm') : '<span class="br-ico sm plain">' + ic('brglobe') + '</span>') +
        '<span class="tt">' + esc(x.title || t('ui_br_unnamed', 'New tab')) + '</span>' +
        '<button class="x" data-tabx="' + x.id + '" title="' + esc(t('ui_br_closetab', 'Close tab')) + '">' + ic('brx') + '</button></div>';
    }).join('');
    $('br-tabs').innerHTML = html + '<button class="br-plus" id="br-plus" title="' + esc(t('ui_br_newtab', 'New tab')) + '">' + ic('brplus') + '</button>';
    if (!tab) return;
    var url = brCur(tab), p2 = brParse(url), input = $('br-url');
    if (document.activeElement !== input) input.value = brDisplay(url);
    $('br-lock').innerHTML = p2.kind === 'site' ? ic('brlock') : '';
    $('br-back').disabled = tab.idx <= 0;
    $('br-fwd').disabled = tab.idx >= tab.hist.length - 1;
    var marked = p2.kind === 'site' && brIsMarked(brDisplay(url));
    $('br-star').disabled = p2.kind !== 'site';
    $('br-star').classList.toggle('on', marked);
    $('br-star').innerHTML = ic(marked ? 'brstaron' : 'brstar');
    $('br-reload').disabled = p2.kind !== 'site';
    $('br-bar').classList.toggle('loading', !!tab.loading);
  }

  function brRenderBm() {
    var bar = $('br-bm');
    bar.classList.toggle('hidden', !BR.bm.length);
    bar.innerHTML = BR.bm.slice(0, 12).map(function (b) {
      var s = brSiteFor(b.url);
      return '<button class="br-chip" data-go="' + esc(b.url) + '" data-bmurl="' + esc(b.url) + '">' + (s ? brIcon(s, 'sm') : '<span class="br-ico sm plain">' + ic('brstar') + '</span>') +
        '<span>' + esc(b.title || b.url) + '</span></button>';
    }).join('');
  }

  // ---- native pages
  function brWordmark(txt) {
    return '<div class="br-logo">' + String(txt).split('').map(function (ch, i) {
      return '<span style="color:' + BR_COLORS[i % BR_COLORS.length] + '">' + esc(ch) + '</span>';
    }).join('') + '</div>';
  }
  function brSearchBox(value) {
    return '<div class="br-sbox"><span class="ic">' + ic('search') + '</span><input class="br-q" type="text" autocomplete="off" spellcheck="false" placeholder="' +
      esc(t('ui_br_search_ph', 'Search Scout or type an address')) + '" value="' + esc(value || '') + '"><button class="br-sbtn" data-act="search">' + esc(t('ui_br_search', 'Search')) + '</button></div>';
  }
  function brTile(url, site, label) {
    return '<button class="br-tile" data-go="' + esc(url) + '">' + brIcon(site) + '<span class="lbl">' + esc(label) + '</span></button>';
  }
  function brRow(url, site, title, sub, desc) {
    return '<button class="br-row" data-go="' + esc(url) + '">' + brIcon(site) + '<div class="txt"><div class="t">' + esc(title) + '</div><div class="u">' + esc(sub) + '</div>' +
      (desc ? '<div class="d">' + esc(desc) + '</div>' : '') + '</div></button>';
  }
  function brEmpty(icon, title, sub) {
    return '<div class="br-empty"><div class="big">' + icon + '</div><div class="h">' + esc(title) + '</div>' + (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function brNewTabPage() {
    var html = '<div class="br-home">' + brWordmark(t('ui_br_engine', 'Scout')) + brSearchBox('');
    var tiles = [], seen = {};
    BR.bm.slice(0, 8).forEach(function (b) {
      var s = brSiteFor(b.url); seen[b.url] = 1;
      tiles.push(brTile(b.url, s || { icon: '🔖' }, b.title || b.url));
    });
    BR.sites.forEach(function (s) { if (tiles.length < 8 && !seen[s.domain] && s.featured !== false) tiles.push(brTile(s.domain, s, s.title)); });
    if (!BR.sitesOk) html += brEmpty('📡', t('ui_br_off_title', "Can't connect"), t('ui_br_off_body', 'The test network is not reachable right now.'));
    else if (!BR.sites.length) html += brEmpty('🌐', t('ui_br_no_sites', 'No websites are available.'));
    else html += '<div class="br-tiles">' + tiles.join('') + '</div>';
    return { html: html + '</div>', title: t('ui_br_newtab', 'New tab') };
  }

  function brScore(terms, fields) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var best = 0;
      for (var j = 0; j < fields.length; j++) {
        if (String(fields[j][0] || '').toLowerCase().indexOf(terms[i]) >= 0 && fields[j][1] > best) best = fields[j][1];
      }
      if (!best) return 0;
      total += best;
    }
    return total;
  }
  function brSearchAll(q) {
    var terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean), out = [];
    if (!terms.length) return out;
    BR.sites.forEach(function (s) {
      var sc = brScore(terms, [[s.title, 5], [s.domain, 4], [(s.keywords || []).join(' '), 3], [s.description, 1], [s.category, 1]]);
      if (sc > 0) out.push({ site: s, title: s.title, url: s.domain, desc: s.description, score: sc + 2 });
      (s.pages || []).forEach(function (pg) {
        var ps = brScore(terms, [[pg.title, 5], [(pg.keywords || []).join(' '), 3], [pg.description, 1]]);
        if (ps > 0) out.push({ site: s, title: pg.title, url: s.domain + pg.path, desc: pg.description || s.title, score: ps });
      });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 25);
  }
  function brSearchPage(q) {
    var res = brSearchAll(q);
    var html = '<div class="br-results"><div class="br-rhead">' + brWordmark(t('ui_br_engine', 'Scout')).replace('br-logo', 'br-logo sm') + brSearchBox(q) + '</div>';
    if (!res.length) html += brEmpty('🔍', fmt(t('ui_br_no_results', 'No results for "%s"'), q), t('ui_br_no_results_hint', 'Try different words, or type the address of a site.'));
    else {
      html += '<div class="br-count">' + esc(res.length === 1 ? t('ui_br_result_one', '1 result') : fmt(t('ui_br_result_other', '%s results'), res.length)) + '</div>';
      html += res.map(function (r) {
        return '<button class="br-res" data-go="' + esc(r.url) + '"><div class="ru">' + brIcon(r.site, 'sm') + '<span>' + esc(r.url) + '</span></div><div class="rt">' + esc(r.title) + '</div>' +
          (r.desc ? '<div class="rd">' + esc(r.desc) + '</div>' : '') + '</button>';
      }).join('');
    }
    return { html: html + '</div>', title: q ? q + ' — ' + t('ui_br_engine', 'Scout') : t('ui_br_search', 'Search') };
  }
  function brBookmarksPage() {
    var html = '<div class="br-list"><h1>' + esc(t('ui_br_bookmarks', 'Bookmarks')) + '</h1>';
    if (!BR.bm.length) html += brEmpty('☆', t('ui_br_empty_bm', 'No bookmarks yet'), t('ui_br_empty_bm_hint', 'Press the star in the address bar to save a page.'));
    else html += BR.bm.map(function (b) {
      return '<div class="br-line">' + brRow(b.url, brSiteFor(b.url) || { icon: '🔖' }, b.title || b.url, b.url) +
        '<button class="rm" data-bmdel="' + esc(b.url) + '" title="' + esc(t('ui_br_remove', 'Remove')) + '">' + ic('brx') + '</button></div>';
    }).join('');
    return { html: html + '</div>', title: t('ui_br_bookmarks', 'Bookmarks') };
  }
  function brFmtTime(ts) {
    var d = new Date(Number(ts) * 1000), loc = t('ui_date_locale', 'en-GB');
    return isNaN(d) ? '' : d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  }
  function brHistoryPage(tab) {
    var tok = ++BR.tok; tab.tok = tok;
    return {
      html: '<div class="br-list"><div class="br-lhead"><h1>' + esc(t('ui_br_history', 'History')) + '</h1><span id="br-hclear"></span></div><div id="br-hbody" class="br-empty s">' + esc(t('ui_br_loading', 'Loading…')) + '</div></div>',
      title: t('ui_br_history', 'History'),
      after: function (el) {
        brApi('history:list').then(function (rows) {
          if (tab.tok !== tok || !el.contains($('br-hbody'))) return;
          rows = Array.isArray(rows) ? rows : [];
          var body = $('br-hbody');
          if (!rows.length) { body.outerHTML = brEmpty('🕘', t('ui_br_empty_hist', 'No history yet')); return; }
          $('br-hclear').innerHTML = '<button class="br-link" data-act="clearhist">' + esc(t('ui_br_clear', 'Clear')) + '</button>';
          body.className = '';
          body.innerHTML = rows.map(function (r) {
            return brRow(r.url, brSiteFor(r.url) || { icon: '🌐' }, r.title || r.url, r.url, brFmtTime(r.visitedAt));
          }).join('');
        });
      }
    };
  }
  function brErrorPage(q) {
    var off = q.e === 'offline';
    var html = '<div class="br-err"><div class="big">' + (off ? '📡' : '🧭') + '</div><h1>' + esc(off ? t('ui_br_off_title', "Can't connect") : t('ui_br_nf_title', "This site can't be reached")) + '</h1><p>' +
      esc(off ? t('ui_br_off_body', 'The test network is not reachable right now.') : fmt(t('ui_br_nf_body', '%s could not be found. Check the address and try again.'), q.u || '')) + '</p>' +
      '<button class="br-pill" data-go="' + esc(q.u ? 'about:search?q=' + encodeURIComponent(q.u) : 'about:newtab') + '">' + esc(q.u ? t('ui_br_search_for', 'Search for it') : t('ui_br_go_start', 'Go to the start page')) + '</button></div>';
    return { html: html, title: t('ui_br_nf_title', "This site can't be reached") };
  }
  function brSeg(group, options, current) {
    return '<div class="br-segrow" data-seggroup="' + esc(group) + '">' + options.map(function (o) {
      return '<button class="br-seg' + (o.value === current ? ' on' : '') + '" data-seg="' + esc(o.value) + '">' + esc(o.label) + '</button>';
    }).join('') + '</div>';
  }
  function brSettingsPage() {
    var html = '<div class="br-list br-settings"><h1>' + esc(t('ui_br_settings', 'Settings')) + '</h1>' +
      '<h2>' + esc(t('ui_br_appearance', 'Appearance')) + '</h2>' +
      brSeg('theme', [
        { value: 'match', label: t('ui_br_match_pc', 'Match this PC') },
        { value: 'light', label: t('ui_br_light', 'Light') },
        { value: 'dark', label: t('ui_br_dark', 'Dark') },
      ], BR.themeOverride || 'match') +
      '<h2>' + esc(t('ui_br_textsize', 'Text size')) + '</h2>' +
      brSeg('textsize', [
        { value: 'small', label: t('ui_br_small', 'Small') },
        { value: 'normal', label: t('ui_br_normal', 'Normal') },
        { value: 'large', label: t('ui_br_large', 'Large') },
      ], BR.textSize) +
      '<h2>' + esc(t('ui_br_privacy', 'Privacy')) + '</h2>' +
      '<div class="br-rows"><button class="br-row" data-act="clearhist"><div class="txt"><div class="t">' + esc(t('ui_br_m_delete', 'Delete browsing data…')) + '</div></div></button></div>' +
      '</div>';
    return { html: html, title: t('ui_br_settings', 'Settings') };
  }
  function brAbout(tab, p) {
    switch (p.name) {
      case 'search': return brSearchPage(p.q.q || '');
      case 'bookmarks': return brBookmarksPage();
      case 'history': return brHistoryPage(tab);
      case 'settings': return brSettingsPage();
      case 'error': return brErrorPage(p.q);
      default: return brNewTabPage();
    }
  }

  // ---- bookmarks
  function brIsMarked(url) {
    for (var i = 0; i < BR.bm.length; i++) if (BR.bm[i].url === url) return true;
    return false;
  }
  function brRemoveBm(url) {
    BR.bm = BR.bm.filter(function (b) { return b.url !== url; });
    brRenderBm(); brChrome();
    return brApi('bookmarks:remove', url);
  }
  function brToggleBm() {
    var tab = brActive();
    if (!tab) return;
    var url = brDisplay(brCur(tab));
    if (!url) return;
    if (brIsMarked(url)) { brRemoveBm(url).then(function () { brToast(t('ui_br_bm_removed', 'Bookmark removed')); }); return; }
    BR.bm.unshift({ url: url, title: tab.title });
    brRenderBm(); brChrome();
    brApi('bookmarks:add', url, tab.title).then(function (res) {
      if (res && res.ok) { brToast(t('ui_br_bookmarked', 'Bookmarked')); return; }
      BR.bm = BR.bm.filter(function (b) { return b.url !== url; });
      brRenderBm(); brChrome();
      brToast((res && res.error) || t('ui_br_bm_failed', "Couldn't save the bookmark"));
    });
  }

  // ---- messages from the websites (as-browser's sdk/site.js protocol)
  function brReply(tab, id, ok, payload) {
    var msg = { type: 'reply', id: id, ok: ok };
    if (ok) msg.data = payload; else msg.error = payload;
    brToFrame(tab, msg);
  }
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.__asb !== 1) return;
    var tab = null;
    for (var i = 0; i < BR.tabs.length; i++) if (BR.tabs[i].frame && BR.tabs[i].frame.contentWindow === ev.source) { tab = BR.tabs[i]; break; }
    if (!tab) return;
    var domain = tab.frameDomain;
    switch (d.type) {
      case 'hello':
        brSetLoading(tab, false);
        brToFrame(tab, { type: 'init', theme: brTheme(), textScale: BR_TEXT_SCALES[BR.textSize] || 1, domain: domain, currency: BR.cur, path: brParse(brCur(tab)).path, title: tab.title });
        break;
      case 'locale': brReply(tab, d.id, true, BR.dict); break;
      case 'snapshot': { var sw = MIR.waiting[d.id]; if (sw) { delete MIR.waiting[d.id]; sw(d.data || null); } break; }
      case 'call':
        brApi('siteCall', domain, d.name, d.data || {}).then(function (res) {
          if (res && res.ok) brReply(tab, d.id, true, res.data);
          else brReply(tab, d.id, false, (res && res.error) || t('ui_br_off_body', 'The test network is not reachable right now.'));
        });
        break;
      case 'player':
        brApi('player').then(function (res) { brReply(tab, d.id, !!res, res || t('ui_br_off_body', 'The test network is not reachable right now.')); });
        break;
      case 'path': {
        var path = String(d.path || '/');
        if (path.charAt(0) !== '/') path = '/' + path;
        if (path.length > 120 || /\s/.test(path)) break;
        var cur = brParse(brCur(tab));
        if (cur.host !== domain || cur.path !== path) brGo(tab, domain + path, { fromSite: true });
        break;
      }
      case 'title':
        tab.title = String(d.title || '').slice(0, 80) || tab.title;
        brChrome();
        break;
      case 'open': brGo(tab, brResolve(String(d.url || ''))); break;
      case 'notify': brToast(String(d.title || d.content || '')); break;
      case 'saveLogin': brReply(tab, d.id, false, t('ui_br_no_save', 'Saving logins is not available on this computer.')); break;
      case 'copy': copyText(String(d.text || '')); brToast(t('ui_br_copied', 'Copied')); brReply(tab, d.id, true, true); break;
      case 'back': brStep(tab, -1); break;
    }
  });

  // ---- lifecycle
  function brReset() {
    BR.tabs.forEach(function (x) { brDestroyFrame(x); clearTimeout(x.histTimer); clearTimeout(x.loadTimer); });
    BR.tabs = []; BR.active = null;
    if (typeof brMenuClose === 'function') brMenuClose();
    brView.innerHTML = '';
    $('br-tabs').innerHTML = '';
  }
  function brStart() {
    brReset();
    if (isDui) return;
    brNewTab('about:newtab', true);
    brRenderBm();
    Promise.all([brApi('shellInfo'), brApi('sites'), brApi('bookmarks:list')]).then(function (r) {
      var info = r[0];
      if (info && typeof info.dict === 'object' && info.dict) { BR.dict = info.dict; BR.cur = info.currency || '£'; }
      BR.sitesOk = Array.isArray(r[1]);
      BR.sites = BR.sitesOk ? r[1] : [];
      BR.by = {};
      BR.sites.forEach(function (s) { BR.by[String(s.domain).toLowerCase()] = s; });
      BR.bm = Array.isArray(r[2]) ? r[2] : [];
      brRenderBm();
      BR.tabs.forEach(function (x) { var p = brParse(brCur(x)); if (p.kind === 'about' && x.rendered) brShow(x); });
    });
    seApi('settingsInfo').then(function (r) {
      var p = r && r.ok && r.prefs;
      if (p) {
        BR.osMode = p.mode === 'dark' ? 'dark' : 'light';
        BR.themeOverride = (p.scoutTheme === 'light' || p.scoutTheme === 'dark') ? p.scoutTheme : '';
        BR.textSize = BR_TEXT_SCALES[p.scoutTextSize] ? p.scoutTextSize : 'normal';
      }
      brApplyTheme(); brApplyTextSize();
      var tab = brActive();
      if (tab && brParse(brCur(tab)).name === 'settings' && tab.rendered) brShow(tab);
    });
  }

  // ---- events
  $('br-tabs').addEventListener('click', function (e) {
    var x = e.target.closest('[data-tabx]');
    if (x) { var ct = null; BR.tabs.forEach(function (tb) { if (String(tb.id) === x.dataset.tabx) ct = tb; }); if (ct) brClose(ct); return; }
    if (e.target.closest('#br-plus')) { brAddTab(); return; }
    var tabEl = e.target.closest('[data-tab]');
    if (tabEl) BR.tabs.forEach(function (tb) { if (String(tb.id) === tabEl.dataset.tab) brActivate(tb); });
  });
  $('br-tabs').addEventListener('auxclick', function (e) {
    if (e.button !== 1) return;
    var tabEl = e.target.closest('[data-tab]');
    if (tabEl) BR.tabs.forEach(function (tb) { if (String(tb.id) === tabEl.dataset.tab) brClose(tb); });
  });
  $('br-back').addEventListener('click', function () { brStep(brActive(), -1); });
  $('br-fwd').addEventListener('click', function () { brStep(brActive(), 1); });
  $('br-reload').addEventListener('click', function () {
    var tab = brActive();
    if (!tab) return;
    if (tab.frame) { brSetLoading(tab, true); tab.frame.src = tab.frame.src; } else brShow(tab);
  });
  $('br-home').addEventListener('click', function () { brGo(brActive(), 'about:newtab'); });
  $('br-star').addEventListener('click', brToggleBm);
  // ---- three-dots menu (Chrome-style): new tab, history, bookmarks >, delete data, zoom, exit
  var BR_ZOOMS = [.25, .33, .5, .67, .75, .8, .9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  var brDd = document.createElement('div');
  brDd.id = 'br-dd'; brDd.className = 'br-dd hidden';
  $('br-toast').parentNode.appendChild(brDd);
  var brSub = document.createElement('div');
  brSub.id = 'br-sub'; brSub.className = 'br-dd sub hidden';
  $('br-toast').parentNode.appendChild(brSub);

  function brZoomOf(tab) { return tab && tab.zoom ? tab.zoom : 1; }
  function brApplyZoom(tab) {
    if (!tab) return;
    tab.el.style.zoom = brZoomOf(tab) === 1 ? '' : String(brZoomOf(tab));
    var lbl = brDd.querySelector('.zv');
    if (lbl && tab === brActive()) lbl.textContent = Math.round(brZoomOf(tab) * 100) + '%';
  }
  function brZoomStep(tab, d) {
    if (!tab) return;
    var i = 0, z = brZoomOf(tab);
    BR_ZOOMS.forEach(function (v, k) { if (Math.abs(v - z) < Math.abs(BR_ZOOMS[i] - z)) i = k; });
    tab.zoom = d === 0 ? 1 : BR_ZOOMS[Math.max(0, Math.min(BR_ZOOMS.length - 1, i + d))];
    brApplyZoom(tab);
  }
  function brMenuClose() { brDd.classList.add('hidden'); brSub.classList.add('hidden'); $('br-menu').classList.remove('on'); }
  function brMenuOpen() { return !brDd.classList.contains('hidden'); }
  function brDeleteData() {
    var tab = brActive();
    brApi('history:clear').then(function () {
      brToast(t('ui_br_m_deleted', 'Browsing data deleted'));
      if (tab && brParse(brCur(tab)).kind === 'about') brShow(tab);
    });
  }
  function brBmSub() {
    var tab = brActive(), site = tab && brParse(brCur(tab)).kind === 'site';
    var h = '<div class="dd-i' + (site ? '' : ' off') + '" data-dd="bmthis"><span>' + esc(brIsMarked(brDisplay(brCur(tab))) && site ? t('ui_br_bm_remove_this', 'Remove bookmark') : t('ui_br_bookmark', 'Bookmark this page')) + '</span><span class="dd-k">Ctrl+D</span></div>' +
      '<div class="dd-i" data-dd="bmall"><span>' + esc(t('ui_br_m_bm_manager', 'Bookmarks manager')) + '</span></div><div class="dd-sep"></div>';
    if (!BR.bm.length) h += '<div class="dd-i off"><span>' + esc(t('ui_br_m_bm_none', 'No bookmarks')) + '</span></div>';
    BR.bm.slice(0, 12).forEach(function (b, i) {
      h += '<div class="dd-i" data-dd="bmgo" data-i="' + i + '"><span class="dd-t">' + esc(b.title || b.url) + '</span></div>';
    });
    return h;
  }
  function brMenuShow() {
    var tab = brActive();
    brDd.innerHTML =
      '<div class="dd-i" data-dd="newtab"><span>' + esc(t('ui_br_newtab', 'New tab')) + '</span><span class="dd-k">Ctrl+T</span></div>' +
      '<div class="dd-sep"></div>' +
      '<div class="dd-i" data-dd="history"><span>' + esc(t('ui_br_history', 'History')) + '</span><span class="dd-k">Ctrl+H</span></div>' +
      '<div class="dd-i" data-dd="bm" data-sub="1"><span>' + esc(t('ui_br_bookmarks', 'Bookmarks')) + '</span><span class="dd-k dd-arrow">›</span></div>' +
      '<div class="dd-i" data-dd="clear"><span>' + esc(t('ui_br_m_delete', 'Delete browsing data…')) + '</span></div>' +
      '<div class="dd-i" data-dd="settings"><span>' + esc(t('ui_br_settings', 'Settings')) + '</span></div>' +
      '<div class="dd-sep"></div>' +
      '<div class="dd-zoom"><span>' + esc(t('ui_br_m_zoom', 'Zoom')) + '</span><span class="dd-zc">' +
        '<button data-dd="zout" title="Ctrl+−">−</button><span class="zv">' + Math.round(brZoomOf(tab) * 100) + '%</span><button data-dd="zin" title="Ctrl++">+</button>' +
        '<button data-dd="full" class="zf" title="' + esc(t('ui_br_m_fullscreen', 'Full screen')) + '">' + ic('max') + '</button></span></div>' +
      '<div class="dd-sep"></div>' +
      '<div class="dd-i" data-dd="exit"><span>' + esc(t('ui_br_m_exit', 'Exit')) + '</span></div>';
    brSub.classList.add('hidden');
    brDd.classList.remove('hidden');
    $('br-menu').classList.add('on');
  }
  function brSubShow(row) {
    brSub.innerHTML = brBmSub();
    brSub.classList.remove('hidden');
    var host = brDd.parentNode.getBoundingClientRect(), d = brDd.getBoundingClientRect(), r = row.getBoundingClientRect(), sc = scaleFactor();
    var w = brSub.offsetWidth;
    var left = (d.left - host.left) / sc - w - 2;
    if (left < 4) left = (d.right - host.left) / sc + 2;
    brSub.style.left = Math.round(left) + 'px';
    brSub.style.top = Math.round((r.top - host.top) / sc - 6) + 'px';
  }
  function brDdRun(act, el) {
    var tab = brActive();
    switch (act) {
      case 'newtab': brMenuClose(); brAddTab(); break;
      case 'history': brMenuClose(); brGo(tab, 'about:history'); break;
      case 'clear': brMenuClose(); brDeleteData(); break;
      case 'settings': brMenuClose(); brGo(tab, 'about:settings'); break;
      case 'zin': brZoomStep(tab, 1); break;
      case 'zout': brZoomStep(tab, -1); break;
      case 'full': toggleMax('browser'); break;
      case 'exit': brMenuClose(); closeWin('browser'); break;
      case 'bm': brSubShow(el); break;
      case 'bmthis': if (el.classList.contains('off')) return; brMenuClose(); brToggleBm(); break;
      case 'bmall': brMenuClose(); brGo(tab, 'about:bookmarks'); break;
      case 'bmgo': brMenuClose(); if (BR.bm[+el.dataset.i]) brGo(tab, BR.bm[+el.dataset.i].url); break;
    }
  }
  $('br-menu').addEventListener('click', function (e) {
    e.stopPropagation();
    if (brMenuOpen()) brMenuClose(); else brMenuShow();
  });
  function brDdClick(e) {
    e.stopPropagation();
    var el = e.target.closest('[data-dd]');
    if (el && !el.classList.contains('off')) brDdRun(el.dataset.dd, el);
  }
  brDd.addEventListener('click', brDdClick);
  brSub.addEventListener('click', brDdClick);
  brDd.addEventListener('mouseover', function (e) {
    var el = e.target.closest('.dd-i');
    if (el && el.dataset.sub) { if (brSub.classList.contains('hidden')) brSubShow(el); }
    else if (!e.target.closest('.dd-sep')) brSub.classList.add('hidden');
  });
  document.addEventListener('mousedown', function (e) {
    if (brMenuOpen() && !e.target.closest('#br-dd, #br-sub, #br-menu')) brMenuClose();
  }, true);
  document.addEventListener('keydown', function (e) {
    if (!wins.browser || !wins.browser.open || activeId !== 'browser') return;
    var tab = brActive();
    if (e.key === 'Escape' && brMenuOpen()) { e.stopPropagation(); brMenuClose(); return; }
    if (!e.ctrlKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 't' && !e.shiftKey) { e.preventDefault(); brAddTab(); }
    else if (k === 'h') { e.preventDefault(); brGo(tab, 'about:history'); }
    else if (k === 'd') { e.preventDefault(); brToggleBm(); }
    else if (k === 'delete' && e.shiftKey) { e.preventDefault(); brDeleteData(); }
    else if (k === '=' || k === '+') { e.preventDefault(); brZoomStep(tab, 1); }
    else if (k === '-') { e.preventDefault(); brZoomStep(tab, -1); }
    else if (k === '0') { e.preventDefault(); brZoomStep(tab, 0); }
  });
  $('br-url').addEventListener('focus', function (e) { e.target.select(); });
  $('br-url').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { var tab = brActive(); if (tab) brGo(tab, brResolve(e.target.value)); e.target.blur(); }
    else if (e.key === 'Escape') { e.stopPropagation(); e.target.blur(); brChrome(); }
  });
  $('br-url').addEventListener('blur', function () { brChrome(); });

  function brDoSearch(input) {
    var tab = brActive();
    if (tab && input) brGo(tab, brResolve(input.value));
  }
  brView.addEventListener('click', function (e) {
    var tab = brActive();
    var bd = e.target.closest('[data-bmdel]');
    if (bd) { brRemoveBm(bd.dataset.bmdel).then(function () { if (tab) brShow(tab); }); return; }
    var act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'search') brDoSearch(act.parentNode.querySelector('.br-q'));
      else if (act.dataset.act === 'clearhist') brApi('history:clear').then(function () { if (tab) brShow(tab); });
      return;
    }
    var seg = e.target.closest('[data-seg]');
    if (seg) {
      var group = seg.parentNode.dataset.seggroup;
      if (group === 'theme') brSetThemeOverride(seg.dataset.seg === 'match' ? '' : seg.dataset.seg);
      else if (group === 'textsize') brSetTextSize(seg.dataset.seg);
      if (tab) brShow(tab);
      return;
    }
    var go = e.target.closest('[data-go]');
    if (go && tab) brGo(tab, go.dataset.go);
  });
  brView.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('br-q')) brDoSearch(e.target);
    else if (e.key === 'Escape' && e.target.classList && e.target.classList.contains('br-q')) { e.stopPropagation(); e.target.blur(); }
  });
  $('br-bm').addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) brGo(brActive(), go.dataset.go);
  });

  // ================================================================ Calendar (shared team calendar)
  // Month / Week / Day views. Events live in the mot_calendar table and are shared by every tester.
  // "Today" is the real date of the PC (same as the taskbar clock).
  var CAL = { on: false, weekStart: 1, view: 'month', cur: null, events: [], state: 'idle', key: '', editing: null, tok: 0, miniCur: null };
  var CAL_COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'grey'];
  var CAL_HOUR = 52; // px per hour in the day/week grid
  var calWin = $('win-calendar');

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fromYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12, 0, 0); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12, 0, 0); return x; }
  function calToday() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 12, 0, 0); }
  function weekStartOf(d) { var diff = (d.getDay() - CAL.weekStart + 7) % 7; return addDays(d, -diff); }
  function calLoc() { return t('ui_date_locale', 'en-GB'); }
  function calFmt(d, opts) { return d.toLocaleDateString(calLoc(), opts); }
  function minutesOf(hhmm) { var p = String(hhmm).split(':'); return (+p[0]) * 60 + (+p[1]); }
  function calColor(c) { return CAL_COLORS.indexOf(c) >= 0 ? c : 'blue'; }

  function calApi(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/calendarApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
  }

  // visible date range of the current view
  function calRange() {
    if (CAL.view === 'day') return { from: CAL.cur, to: CAL.cur };
    if (CAL.view === 'week') { var w = weekStartOf(CAL.cur); return { from: w, to: addDays(w, 6) }; }
    var first = weekStartOf(new Date(CAL.cur.getFullYear(), CAL.cur.getMonth(), 1, 12, 0, 0));
    return { from: first, to: addDays(first, 41) };
  }

  function calLoad(silent) {
    var r = calRange(), key = ymd(r.from) + '|' + ymd(r.to), tok = ++CAL.tok;
    CAL.key = key;
    if (!silent) { CAL.state = 'loading'; calRender(); }
    calApi('list', { from: ymd(r.from), to: ymd(r.to) }).then(function (res) {
      if (tok !== CAL.tok) return; // a newer request superseded this one
      if (res && res.ok) { CAL.events = res.items || []; CAL.state = 'ok'; } else { CAL.events = []; CAL.state = 'error'; }
      calRender();
    });
  }

  function calGo(delta) {
    var c = CAL.cur;
    if (CAL.view === 'month') CAL.cur = new Date(c.getFullYear(), c.getMonth() + delta, 1, 12, 0, 0);
    else CAL.cur = addDays(c, delta * (CAL.view === 'week' ? 7 : 1));
    CAL.miniCur = null;
    calLoad();
  }
  function calSetDate(d, view) {
    CAL.cur = d;
    if (view) CAL.view = view;
    CAL.miniCur = null;
    calLoad();
  }

  function calEventsOn(dateStr) { return CAL.events.filter(function (e) { return e.date === dateStr; }); }
  function calTimeLabel(e) { return e.allDay ? '' : (e.startTime + (e.endTime ? '–' + e.endTime : '')); }

  // ---- header + sidebar
  function calTitle() {
    var c = CAL.cur;
    if (CAL.view === 'month') return calFmt(c, { month: 'long', year: 'numeric' });
    if (CAL.view === 'day') return calFmt(c, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var w = weekStartOf(c), e = addDays(w, 6);
    if (w.getMonth() === e.getMonth()) return w.getDate() + ' – ' + calFmt(e, { day: 'numeric', month: 'long', year: 'numeric' });
    return calFmt(w, { day: 'numeric', month: 'short' }) + ' – ' + calFmt(e, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function calWeekdays(style) {
    var base = new Date(2024, 0, 1 + ((CAL.weekStart + 6) % 7), 12, 0, 0), out = []; // 2024-01-01 is a Monday
    for (var i = 0; i < 7; i++) out.push(calFmt(addDays(base, i), { weekday: style }));
    return out;
  }
  function calMini() {
    var m = CAL.miniCur || new Date(CAL.cur.getFullYear(), CAL.cur.getMonth(), 1, 12, 0, 0);
    CAL.miniCur = m;
    var first = weekStartOf(new Date(m.getFullYear(), m.getMonth(), 1, 12, 0, 0)), today = ymd(calToday()), sel = ymd(CAL.cur);
    var html = '<div class="mh"><b>' + esc(calFmt(m, { month: 'long', year: 'numeric' })) + '</b><span><button data-cal="mini-prev">' + ic('up') + '</button><button data-cal="mini-next">' + ic('down') + '</button></span></div><div class="mg">';
    calWeekdays('narrow').forEach(function (w) { html += '<i class="wd">' + esc(w) + '</i>'; });
    for (var i = 0; i < 42; i++) {
      var d = addDays(first, i), s = ymd(d);
      html += '<button class="md' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (s === today ? ' today' : '') + (s === sel ? ' sel' : '') + '" data-mini="' + s + '">' + d.getDate() + '</button>';
    }
    $('cal-mini').innerHTML = html + '</div>';
  }

  function calRender() {
    if (!CAL.cur) return;
    $('cal-title').textContent = calTitle();
    calWin.querySelectorAll('[data-view]').forEach(function (b) { b.classList.toggle('on', b.dataset.view === CAL.view); });
    $('cal-status').textContent = CAL.state === 'loading' ? t('ui_cal_loading', 'Loading…') : (CAL.state === 'error' ? t('ui_cal_error', "Couldn't load the calendar") : '');
    calMini();
    var keepScroll = $('cal-body').querySelector('.cal-scroll');
    var st = keepScroll ? keepScroll.scrollTop : null;
    $('cal-body').innerHTML = CAL.view === 'month' ? calMonthHtml() : calGridHtml();
    var sc = $('cal-body').querySelector('.cal-scroll');
    if (sc) {
      if (st !== null && CAL.keepScroll) sc.scrollTop = st;
      else sc.scrollTop = Math.max(0, (CAL.view === 'day' || CAL.view === 'week' ? 7 : 0) * CAL_HOUR - 4);
    }
    CAL.keepScroll = false;
  }

  // ---- month view
  function calChip(e) {
    return '<div class="cal-ev c-' + calColor(e.color) + (e.allDay ? ' allday' : '') + '" data-ev="' + e.id + '" title="' + esc(e.title) + '">' +
      (e.allDay ? '' : '<b>' + esc(e.startTime) + '</b> ') + esc(e.title) + '</div>';
  }
  function calMonthHtml() {
    var r = calRange(), today = ymd(calToday()), sel = ymd(CAL.cur), html = '<div class="cal-month"><div class="cm-head">';
    calWeekdays('short').forEach(function (w) { html += '<div>' + esc(w) + '</div>'; });
    html += '</div><div class="cm-grid">';
    for (var i = 0; i < 42; i++) {
      var d = addDays(r.from, i), s = ymd(d), evs = calEventsOn(s);
      html += '<div class="cm-cell' + (d.getMonth() !== CAL.cur.getMonth() ? ' out' : '') + (s === today ? ' today' : '') + (s === sel ? ' sel' : '') + '" data-date="' + s + '">' +
        '<div class="dn"><span>' + (d.getDate() === 1 ? calFmt(d, { day: 'numeric', month: 'short' }) : d.getDate()) + '</span></div>';
      evs.slice(0, 3).forEach(function (e) { html += calChip(e); });
      if (evs.length > 3) html += '<div class="cal-more" data-more="' + s + '">' + esc(fmt(t('ui_cal_more', '+%s more'), evs.length - 3)) + '</div>';
      html += '</div>';
    }
    return html + '</div></div>';
  }

  // ---- week / day view
  function calLayout(evs) {
    // lay overlapping timed events side by side
    var list = evs.map(function (e) {
      var s = minutesOf(e.startTime), en = e.endTime ? Math.max(minutesOf(e.endTime), s + 20) : s + 60;
      return { e: e, s: s, en: Math.min(en, 1440), lane: 0, lanes: 1 };
    }).sort(function (a, b) { return a.s - b.s || b.en - a.en; });
    var cluster = [], clusterEnd = -1;
    function flush() { var n = 0; cluster.forEach(function (c) { n = Math.max(n, c.lane + 1); }); cluster.forEach(function (c) { c.lanes = n; }); cluster = []; }
    list.forEach(function (it) {
      if (cluster.length && it.s >= clusterEnd) { flush(); clusterEnd = -1; }
      var used = {};
      cluster.forEach(function (c) { if (c.en > it.s) used[c.lane] = true; });
      var lane = 0; while (used[lane]) lane++;
      it.lane = lane; cluster.push(it); clusterEnd = Math.max(clusterEnd, it.en);
    });
    flush();
    return list;
  }
  function calGridHtml() {
    var days = [], r = calRange(), n = CAL.view === 'day' ? 1 : 7, today = ymd(calToday()), i;
    for (i = 0; i < n; i++) days.push(addDays(r.from, i));
    var html = '<div class="cal-grid n' + n + '"><div class="cg-head"><div class="gut"></div>';
    days.forEach(function (d) {
      var s = ymd(d);
      html += '<div class="dh' + (s === today ? ' today' : '') + '" data-date="' + s + '"><span class="w">' + esc(calFmt(d, { weekday: 'short' })) + '</span><span class="n">' + d.getDate() + '</span></div>';
    });
    html += '</div><div class="cg-allday"><div class="gut"></div>';
    days.forEach(function (d) {
      html += '<div class="ad" data-date="' + ymd(d) + '">' + calEventsOn(ymd(d)).filter(function (e) { return e.allDay; }).map(calChip).join('') + '</div>';
    });
    html += '</div><div class="cal-scroll"><div class="cg-body" style="height:' + (24 * CAL_HOUR) + 'px"><div class="gut">';
    for (i = 0; i < 24; i++) html += '<div class="hr" style="top:' + (i * CAL_HOUR) + 'px">' + (i ? pad2(i) + ':00' : '') + '</div>';
    html += '</div>';
    var now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    days.forEach(function (d) {
      var s = ymd(d), timed = calEventsOn(s).filter(function (e) { return !e.allDay; });
      html += '<div class="col' + (s === today ? ' today' : '') + '" data-date="' + s + '">';
      for (i = 0; i < 24; i++) html += '<div class="slot" style="top:' + (i * CAL_HOUR) + 'px" data-hour="' + i + '"></div>';
      calLayout(timed).forEach(function (it) {
        var e = it.e, top = it.s / 60 * CAL_HOUR, h = Math.max(22, (it.en - it.s) / 60 * CAL_HOUR - 2);
        html += '<div class="cal-ev blk c-' + calColor(e.color) + '" data-ev="' + e.id + '" style="top:' + top + 'px;height:' + h + 'px;left:calc(' + (it.lane * 100 / it.lanes) + '% + 2px);width:calc(' + (100 / it.lanes) + '% - 5px)" title="' + esc(e.title) + '">' +
          '<b>' + esc(e.title) + '</b><span>' + esc(calTimeLabel(e)) + '</span></div>';
      });
      if (s === today) html += '<div class="nowline" style="top:' + (nowMin / 60 * CAL_HOUR) + 'px"></div>';
      html += '</div>';
    });
    return html + '</div></div></div>';
  }

  // ---- event form
  function calOpenForm(ev, date, time) {
    var f = $('cal-form');
    CAL.editing = ev ? ev.id : null;
    $('cf-heading').textContent = ev ? t('ui_cal_edit_event', 'Edit event') : t('ui_cal_new_event', 'New event');
    $('cf-title').value = ev ? ev.title : '';
    $('cf-date').value = ev ? ev.date : (date || ymd(CAL.cur));
    var allDay = ev ? !!ev.allDay : !time;
    $('cf-allday').checked = allDay;
    $('cf-start').value = ev && ev.startTime ? ev.startTime : (time || '09:00');
    $('cf-end').value = ev && ev.endTime ? ev.endTime : (time ? pad2(Math.min(23, +time.slice(0, 2) + 1)) + time.slice(2) : '10:00');
    $('cf-notes').value = ev && ev.notes ? ev.notes : '';
    f.dataset.curColor = ev ? calColor(ev.color) : 'blue';
    $('cf-err').textContent = '';
    $('cf-by').textContent = ev && ev.createdBy ? fmt(t('ui_cal_by', 'Added by %s'), ev.createdBy) : '';
    var ro = !!(ev && ev.booking);   // website MOT bookings are view-only
    f.classList.toggle('ro', ro);
    ['cf-title', 'cf-date', 'cf-allday', 'cf-start', 'cf-end', 'cf-notes'].forEach(function (id) { $(id).disabled = ro; });
    $('cf-save').classList.toggle('hidden', ro);
    if (ro) { $('cf-heading').textContent = t('ui_cal_booking', 'MOT booking'); $('cf-by').textContent = t('ui_cal_booking_note', ''); }
    $('cf-delete').classList.toggle('hidden', !ev || ro);
    f.classList.remove('hidden');
    calFormSync();
    if (!ro) setTimeout(function () { $('cf-title').focus(); if (!ev) $('cf-title').select(); }, 30);
  }
  function calFormSync() {
    var f = $('cal-form'), all = $('cf-allday').checked;
    $('cf-times').classList.toggle('hidden', all);
    f.querySelectorAll('[data-color]').forEach(function (b) { b.classList.toggle('on', b.dataset.color === f.dataset.curColor); });
  }
  function calCloseForm() { $('cal-form').classList.add('hidden'); CAL.editing = null; }

  function calSave() {
    var title = $('cf-title').value.replace(/\s+/g, ' ').trim(), date = $('cf-date').value, all = $('cf-allday').checked;
    var st = all ? null : $('cf-start').value, en = all ? null : $('cf-end').value;
    var err = '';
    if (!title) err = t('ui_cal_err_title', 'Give the event a title.');
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err = t('ui_cal_err_date', 'Pick a valid date.');
    else if (!all && !/^\d{2}:\d{2}$/.test(st || '')) err = t('ui_cal_err_time', 'Enter a start time, or tick All day.');
    else if (!all && en && en < st) err = t('ui_cal_err_end', 'The end time must be after the start time.');
    if (err) { $('cf-err').textContent = err; return; }
    var payload = { id: CAL.editing, title: title, date: date, startTime: st, endTime: en || null, color: $('cal-form').dataset.curColor, notes: $('cf-notes').value };
    $('cf-save').disabled = true;
    calApi('save', payload).then(function (res) {
      $('cf-save').disabled = false;
      if (!(res && res.ok)) { $('cf-err').textContent = t('ui_cal_err_save', "Couldn't save the event."); return; }
      calCloseForm();
      var d = fromYmd(date);
      if (ymd(d) !== ymd(CAL.cur) && CAL.view !== 'month') CAL.cur = d;
      CAL.keepScroll = true;
      calLoad(true);
    });
  }
  function calDeleteEvent(id) {
    var ev = null; CAL.events.forEach(function (e) { if (e.id === id) ev = e; });
    confirmDlg(t('ui_cal_delete_title', 'Delete event'), fmt(t('ui_cal_delete_q', 'Delete "%s"?'), ev ? ev.title : ''), function () {
      calApi('delete', { id: id }).then(function () { calCloseForm(); CAL.keepScroll = true; calLoad(true); });
    });
  }
  function calEventById(id) { var ev = null; CAL.events.forEach(function (e) { if (String(e.id) === String(id)) ev = e; }); return ev; }

  function calStart() {
    var n = calToday();
    CAL.cur = n; CAL.view = 'month'; CAL.miniCur = null; CAL.events = []; CAL.state = 'idle';
    calCloseForm();
    calLoad();
  }
  function calIconSvg() {
    var d = new Date().getDate();
    return '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2.6" fill="#fff" stroke="#c6cbd6" stroke-width=".8"/><path d="M3 7.6a3.6 3.6 0 0 1 3.6-3.6h10.8A3.6 3.6 0 0 1 21 7.6V9H3z" fill="#c42b1c"/><rect x="7" y="2.4" width="2" height="3.6" rx="1" fill="#7a1d12"/><rect x="15" y="2.4" width="2" height="3.6" rx="1" fill="#7a1d12"/><text x="12" y="18.2" font-size="8.6" font-weight="700" fill="#1b1b1b" text-anchor="middle" font-family="Segoe UI,Arial">' + d + '</text></svg>';
  }
  function calRefreshIcon() { ICONS.calendar = calIconSvg(); fillIcons(); renderTaskbar(); }

  // ---- events
  calWin.addEventListener('click', function (e) {
    var act = e.target.closest('[data-cal]');
    if (act) {
      var a = act.dataset.cal;
      if (a === 'today') calSetDate(calToday());
      else if (a === 'prev') calGo(-1);
      else if (a === 'next') calGo(1);
      else if (a === 'new') calOpenForm(null, ymd(CAL.cur), null);
      else if (a === 'mini-prev' || a === 'mini-next') { var m = CAL.miniCur; CAL.miniCur = new Date(m.getFullYear(), m.getMonth() + (a === 'mini-next' ? 1 : -1), 1, 12, 0, 0); calMini(); }
      return;
    }
    var vw = e.target.closest('[data-view]');
    if (vw) { CAL.view = vw.dataset.view; CAL.miniCur = null; calLoad(); return; }
    var mini = e.target.closest('[data-mini]');
    if (mini) { calSetDate(fromYmd(mini.dataset.mini)); return; }
    if (e.target.closest('#cal-form')) return;
    var ev = e.target.closest('[data-ev]');
    if (ev) { var evd = calEventById(ev.dataset.ev); if (evd) calOpenForm(evd); return; }
    var more = e.target.closest('[data-more]');
    if (more) { calSetDate(fromYmd(more.dataset.more), 'day'); return; }
    var cell = e.target.closest('.cm-cell');
    if (cell) { CAL.cur = fromYmd(cell.dataset.date); CAL.miniCur = null; if (cell.classList.contains('out')) calLoad(); else calRender(); return; }
    var dh = e.target.closest('.dh');
    if (dh) { calSetDate(fromYmd(dh.dataset.date), 'day'); }
  });
  calWin.addEventListener('dblclick', function (e) {
    if (e.target.closest('#cal-form') || e.target.closest('[data-ev]') || e.target.closest('.cal-more')) return;
    var cell = e.target.closest('.cm-cell'), slot = e.target.closest('.slot'), ad = e.target.closest('.ad');
    if (cell) calOpenForm(null, cell.dataset.date, null);
    else if (slot) calOpenForm(null, slot.closest('.col').dataset.date, pad2(+slot.dataset.hour) + ':00');
    else if (ad) calOpenForm(null, ad.dataset.date, null);
  });
  $('cf-allday').addEventListener('change', calFormSync);
  $('cal-form').addEventListener('click', function (e) {
    var c = e.target.closest('[data-color]');
    if (c) { $('cal-form').dataset.curColor = c.dataset.color; calFormSync(); return; }
    var b = e.target.closest('[data-cf]');
    if (!b) return;
    if (b.dataset.cf === 'save') calSave();
    else if (b.dataset.cf === 'cancel') calCloseForm();
    else if (b.dataset.cf === 'delete' && CAL.editing) calDeleteEvent(CAL.editing);
  });
  $('cal-form').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); calCloseForm(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); calSave(); }
    e.stopPropagation();
  });

  // ================================================================ Settings (Windows 11 layout)
  // Personal choices are saved per character on the server (computer_settings). applyPrefs() paints them.
  var WALLPAPERS = [
    { id: 'bloom', css: 'radial-gradient(47% 57% at 18% 12%,rgba(58,141,255,.85),transparent 62%),radial-gradient(52% 70% at 88% 92%,rgba(126,74,235,.75),transparent 60%),radial-gradient(36% 46% at 60% 40%,rgba(20,190,230,.35),transparent 65%),linear-gradient(135deg,#051a4a,#0a3a8c 55%,#0b2a70)' },
    { id: 'midnight', css: 'radial-gradient(50% 60% at 80% 10%,rgba(80,90,220,.6),transparent 60%),radial-gradient(60% 70% at 10% 95%,rgba(20,120,200,.45),transparent 60%),linear-gradient(160deg,#04060f,#0a1030 60%,#0d1440)' },
    { id: 'sunrise', css: 'radial-gradient(60% 70% at 85% 95%,rgba(255,190,90,.9),transparent 60%),radial-gradient(55% 60% at 15% 10%,rgba(255,110,120,.75),transparent 62%),linear-gradient(140deg,#5b2a86,#c2456b 55%,#f08a4b)' },
    { id: 'forest', css: 'radial-gradient(55% 65% at 20% 15%,rgba(80,200,140,.6),transparent 62%),radial-gradient(60% 70% at 85% 90%,rgba(20,120,110,.7),transparent 60%),linear-gradient(140deg,#04231b,#0b4a3a 55%,#0a3a2c)' },
    { id: 'lavender', css: 'radial-gradient(55% 65% at 15% 10%,rgba(215,190,255,.9),transparent 62%),radial-gradient(60% 70% at 88% 90%,rgba(120,150,255,.7),transparent 60%),linear-gradient(140deg,#5a4bb5,#8a7be0 55%,#b7a8f5)' },
    { id: 'graphite', css: 'radial-gradient(55% 65% at 20% 10%,rgba(160,170,190,.35),transparent 62%),linear-gradient(140deg,#15171c,#2a2e37 55%,#1b1e25)' },
    { id: 'coast', css: 'radial-gradient(60% 70% at 15% 10%,rgba(120,230,230,.75),transparent 62%),radial-gradient(60% 70% at 90% 95%,rgba(30,110,190,.8),transparent 60%),linear-gradient(140deg,#075985,#0e8aa8 55%,#33b5c9)' },
    { id: 'ember', css: 'radial-gradient(55% 65% at 80% 90%,rgba(255,120,40,.8),transparent 62%),radial-gradient(60% 70% at 15% 10%,rgba(190,40,60,.6),transparent 60%),linear-gradient(140deg,#200a0a,#5a1616 55%,#3b0f12)' }
  ];
  var THEMES = [
    { id: 'ls', wallpaper: 'bloom', mode: 'light', accent: '#0f6cbd' },
    { id: 'midnight', wallpaper: 'midnight', mode: 'dark', accent: '#7c8cff' },
    { id: 'sunrise', wallpaper: 'sunrise', mode: 'light', accent: '#e8590c' },
    { id: 'forest', wallpaper: 'forest', mode: 'dark', accent: '#2f9e44' },
    { id: 'lavender', wallpaper: 'lavender', mode: 'light', accent: '#7048e8' },
    { id: 'graphite', wallpaper: 'graphite', mode: 'dark', accent: '#868e96' }
  ];
  var ACCENTS = ['#ffb900', '#ff8c00', '#f7630c', '#ca5010', '#da3b01', '#ef6950', '#d13438', '#ff4343',
    '#e74856', '#e81123', '#ea005e', '#c30052', '#e3008c', '#bf0077', '#c239b3', '#9a0089',
    '#0078d4', '#0f6cbd', '#0063b1', '#8e8cd8', '#6b69d6', '#8764b8', '#744da9', '#b146c2',
    '#0099bc', '#2d7d9a', '#00b7c3', '#038387', '#00b294', '#018574', '#00cc6a', '#10893e',
    '#7a7574', '#5d5a58', '#68768a', '#515c6b', '#567c73', '#486860', '#498205', '#107c10'];
  var DEFAULT_PREFS = { wallpaper: 'bloom', fit: 'fill', mode: 'light', accent: '#0f6cbd', accentBars: false, taskbarAlign: 'center',
    search: 'box', lockShow: true, brightness: 100, night: false, nightStrength: 40, clock24: true, dateFormat: 'dmy', weekStart: 1,
    pinnedApps: null,  // null = use the factory PINNED_BASE set; once the player pins/unpins anything it becomes an explicit array
    iconPos: null,     // null = use the default top-to-bottom, wrap-to-next-column layout; { appId: {c,r} } once dragged
    avatar: '' };      // '' = the default person icon; otherwise an https picture address (Settings > Accounts)

  function P() { return state.prefs || DEFAULT_PREFS; }
  function wpById(id) { for (var i = 0; i < WALLPAPERS.length; i++) if (WALLPAPERS[i].id === id) return WALLPAPERS[i]; return null; }
  function urlOk(u) { return typeof u === 'string' && /^https:\/\/[^\s"'()\\]+$/.test(u); }
  var avaOk = urlOk;
  // A profile-picture avatar span, used everywhere a person icon appears (Settings sidebar, the Accounts
  // pages, the lock screen uses its own copy of this since it isn't rebuilt on every render).
  function avaSpan(cls, p) {
    p = p || P();
    if (avaOk(p.avatar)) {
      return '<span class="se-ava' + (cls ? ' ' + cls : '') + '" style="background-image:url(&quot;' + esc(p.avatar) + '&quot;);background-size:cover;background-position:center"></span>';
    }
    return '<span class="se-ava' + (cls ? ' ' + cls : '') + '"><span class="ic" data-ic="user"></span></span>';
  }

  // CSS for a wallpaper choice: { image, size, repeat, pos, color }
  function wpLook(p, fitOverride) {
    var fit = fitOverride || p.fit || 'fill';
    if (p.wallpaper === 'custom' && urlOk(p.wallpaperUrl)) {
      var f = { fill: ['cover', 'no-repeat', 'center'], fit: ['contain', 'no-repeat', 'center'], stretch: ['100% 100%', 'no-repeat', 'center'],
        tile: ['auto', 'repeat', 'top left'], center: ['auto', 'no-repeat', 'center'] }[fit] || ['cover', 'no-repeat', 'center'];
      return { image: 'url("' + p.wallpaperUrl + '")', size: f[0], repeat: f[1], pos: f[2], color: '#0b0f1a' };
    }
    var extra = (SE.info && SE.info.wallpapers) || [];
    for (var i = 0; i < extra.length; i++) {
      if (extra[i].id === p.wallpaper && urlOk(extra[i].url)) return wpLook({ wallpaper: 'custom', wallpaperUrl: extra[i].url, fit: fit }, fit);
    }
    var w = wpById(p.wallpaper) || WALLPAPERS[0];
    return { image: w.css, size: 'auto', repeat: 'no-repeat', pos: '0 0', color: 'transparent', id: w.id };
  }
  function paintWallpaper(el, look) {
    el.style.backgroundColor = look.color;
    el.style.backgroundImage = look.image;
    el.style.backgroundSize = look.size;
    el.style.backgroundRepeat = look.repeat;
    el.style.backgroundPosition = look.pos;
  }

  var wpToken = 0;
  function applyPrefs() {
    var p = P(), root = document.documentElement;
    root.classList.toggle('dark', p.mode === 'dark');
    root.classList.toggle('accent-bars', !!p.accentBars);
    BR.osMode = p.mode === 'dark' ? 'dark' : 'light';
    brApplyTheme();
    root.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#0f6cbd');
    root.style.setProperty('--accent-ink', inkFor(p.accent));

    var look = wpLook(p), tok = ++wpToken;
    var plain = look.id !== 'bloom';
    $('wallpaper').classList.toggle('wp-plain', plain);
    if (look.id === 'bloom') { $('wallpaper').removeAttribute('style'); }
    else {
      paintWallpaper($('wallpaper'), look);
      if (look.image.indexOf('url(') === 0) {
        var im = new Image();
        im.onerror = function () {
          if (tok !== wpToken) return;
          $('wallpaper').style.backgroundImage = WALLPAPERS[0].css; $('wallpaper').style.backgroundSize = 'auto';
          if (SE.page) { SE.notice = { kind: 'err', text: t('se_bg_load_fail', "That picture couldn't be loaded.") }; seRender(); }
        };
        im.src = look.image.slice(5, -2);
      }
    }
    var lk = $('lock'); lk.style.background = '';
    if (look.id !== 'bloom') paintWallpaper(lk, look); else { lk.style.backgroundColor = ''; lk.style.backgroundImage = ''; lk.style.backgroundSize = ''; lk.style.backgroundRepeat = ''; lk.style.backgroundPosition = ''; }

    var lkAva = $('lock-avatar');
    if (lkAva) {
      if (avaOk(p.avatar)) { lkAva.style.backgroundImage = 'url("' + p.avatar + '")'; lkAva.innerHTML = ''; }
      else { lkAva.style.backgroundImage = ''; lkAva.innerHTML = '<span class="ic" data-ic="user"></span>'; fillIcons(lkAva); }
    }

    var tb = $('taskbar');
    tb.classList.toggle('left', p.taskbarAlign === 'left');
    var ts = $('tb-search');
    ts.classList.toggle('hidden', p.search === 'hidden');
    ts.classList.toggle('icon', p.search === 'icon');

    $('dim').style.opacity = String(Math.max(0, Math.min(90, 100 - (p.brightness || 100))) / 100 * 0.8);
    var nl = $('night');
    nl.style.opacity = p.night ? String(0.12 + (p.nightStrength || 0) / 100 * 0.5) : '0';

    if (typeof p.weekStart === 'number' && CAL) { var was = CAL.weekStart; CAL.weekStart = p.weekStart; if (was !== p.weekStart && CAL.on && typeof calRender === 'function' && wins.calendar && wins.calendar.open) { calRender(); } }
    tick();
  }
  function inkFor(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var n = parseInt(m[1], 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 170 ? '#111' : '#fff';
  }

  // ---------------------------------------------------------------- Settings window
  var SE = { page: 'home', info: null, state: 'idle', notice: null, q: '', pending: {}, timer: null, tok: 0,
             wifiOpenId: null, wifiErr: '', wifiBusy: false,
             pwOpen: false, pwErr: '', pwBusy: false };
  var seWin = $('win-settings');

  function seApi(action, body) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
  }

  var NAV = [
    { id: 'home', ic: 'se_home', key: 'se_home', def: 'Home' },
    { id: 'system', ic: 'se_system', key: 'se_system', def: 'System' },
    { id: 'network', ic: 'se_network', key: 'se_network', def: 'Network & internet' },
    { id: 'personal', ic: 'se_brush', key: 'se_personal', def: 'Personalisation' },
    { id: 'accounts', ic: 'se_person', key: 'se_accounts', def: 'Accounts' },
    { id: 'time', ic: 'se_clock', key: 'se_time', def: 'Time & language' }
  ];
  var SUB = {
    'system/display': ['system', 'se_display', 'Display'], 'system/about': ['system', 'se_about', 'About'],
    'network/wifi': ['network', 'se_wifi', 'Wi-Fi'],
    'personal/background': ['personal', 'se_background', 'Background'], 'personal/colors': ['personal', 'se_colors', 'Colours'],
    'personal/themes': ['personal', 'se_themes', 'Themes'], 'personal/lock': ['personal', 'se_lockscreen', 'Lock screen'],
    'personal/taskbar': ['personal', 'se_taskbar', 'Taskbar'],
    'accounts/info': ['accounts', 'se_yourinfo', 'Your info'], 'accounts/signin': ['accounts', 'se_signin', 'Sign-in options'],
    'time/datetime': ['time', 'se_datetime', 'Date & time'], 'time/language': ['time', 'se_language', 'Language & region']
  };
  // settings you can search for: [page, locale key, default text, extra words]
  var INDEX = [
    ['system/display', 'se_brightness', 'Brightness', 'screen dim'], ['system/display', 'se_night', 'Night light', 'warm blue light colour'],
    ['system/about', 'se_devspec', 'Device specifications', 'processor ram computer name pc'], ['system/about', 'se_winspec', 'Windows specifications', 'edition version build os'],
    ['personal/background', 'se_bg_choose', 'Choose a picture', 'wallpaper image photo desktop background url'], ['personal/background', 'se_bg_fit', 'Choose a fit for your desktop image', 'fill stretch tile center'],
    ['personal/colors', 'se_mode', 'Choose your mode', 'dark light theme'], ['personal/colors', 'se_accent', 'Accent colour', 'colour color'],
    ['personal/themes', 'se_themes', 'Themes', 'theme'], ['personal/lock', 'se_lock_show', 'Show the lock screen', 'sign in'],
    ['personal/taskbar', 'se_tb_search', 'Search', 'taskbar box icon hide'], ['personal/taskbar', 'se_tb_align', 'Taskbar alignment', 'left centre center'],
    ['network/wifi', 'se_wifi', 'Wi-Fi', 'network internet connection ssid'],
    ['accounts/info', 'se_yourinfo', 'Your info', 'name job profile account'], ['accounts/signin', 'se_signin', 'Sign-in options', 'lock password'],
    ['time/datetime', 'se_24h', 'Use a 24-hour clock', 'time format'], ['time/language', 'se_dispLang', 'Display language', 'language'],
    ['time/language', 'se_dateFmt', 'Date format', 'region regional format'], ['time/language', 'se_weekStart', 'First day of week', 'calendar monday sunday']
  ];

  function seTitleOf(page) {
    if (SUB[page]) return t(SUB[page][1], SUB[page][2]);
    for (var i = 0; i < NAV.length; i++) if (NAV[i].id === page) return t(NAV[i].key, NAV[i].def);
    return '';
  }
  function seTop(page) { return SUB[page] ? SUB[page][0] : page; }

  // ---- building blocks
  function tg(key, on) {
    return '<span class="se-tgl"><span class="se-tglt">' + esc(on ? t('se_on', 'On') : t('se_off', 'Off')) + '</span>' +
      '<button class="se-tg' + (on ? ' on' : '') + '" data-tg="' + key + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"><span class="k"></span></button></span>';
  }
  function sel(key, opts, cur) {
    return '<span class="se-selw"><select class="se-sel" data-sel="' + key + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(cur) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select><span class="ic se-selv" data-ic="se_chevd"></span></span>';
  }
  function row(o) {
    var go = o.go ? ' data-go="' + o.go + '"' : '';
    return '<div class="se-row' + (o.go ? ' nav' : '') + '"' + go + '>' +
      (o.ic ? '<span class="ic se-ric" data-ic="' + o.ic + '"></span>' : '') +
      '<div class="se-rt"><div class="se-rn">' + esc(o.title) + '</div>' + (o.desc ? '<div class="se-rd">' + esc(o.desc) + '</div>' : '') + '</div>' +
      (o.right ? '<div class="se-rr">' + o.right + '</div>' : '') +
      (o.go ? '<span class="ic se-chev" data-ic="se_chevr"></span>' : '') + '</div>';
  }
  function card(rows) { return '<div class="se-card">' + rows.join('') + '</div>'; }
  function kv(k, v) { return '<div class="se-kv"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v == null || v === '' ? '—' : v) + '</div></div>'; }
  function noticeHtml() {
    if (!SE.notice) return '';
    return '<div class="se-note ' + esc(SE.notice.kind) + '">' + esc(SE.notice.text) + '</div>';
  }

  // mini desktop that shows the current look (used on Personalisation, Background, Colours)
  function preview(p, cls) {
    var look = wpLook(p);
    var st = 'background-color:' + look.color + ';background-image:' + look.image + ';background-size:' + look.size + ';background-repeat:' + look.repeat + ';background-position:' + look.pos;
    return '<div class="se-prev ' + (cls || '') + (p.mode === 'dark' ? ' dk' : '') + '" style="' + st.replace(/"/g, '&quot;') + '">' +
      '<div class="pv-win"><div class="pv-tb" style="background:' + esc(p.accent) + '"></div><div class="pv-l"></div><div class="pv-l s"></div></div>' +
      '<div class="pv-bar' + (p.accentBars ? ' ac' : '') + '" style="' + (p.accentBars ? 'background:' + esc(p.accent) : '') + '"><span class="pv-dot"></span><span class="pv-dot"></span><span class="pv-dot"></span></div></div>';
  }

  function wpThumbs() {
    var p = P(), h = '';
    WALLPAPERS.forEach(function (w) {
      h += '<button class="se-wp' + (p.wallpaper === w.id ? ' on' : '') + '" data-wp="' + w.id + '" title="' + esc(t('se_wp_' + w.id, w.id)) + '" style="background:' + w.css.replace(/"/g, '&quot;') + '"></button>';
    });
    ((SE.info && SE.info.wallpapers) || []).forEach(function (w) {
      if (!urlOk(w.url)) return;
      h += '<button class="se-wp' + (p.wallpaper === w.id ? ' on' : '') + '" data-wp="' + esc(w.id) + '" title="' + esc(w.label || w.id) + '" style="background:#111 url(&quot;' + esc(w.url) + '&quot;) center/cover"></button>';
    });
    if (p.wallpaper === 'custom' && urlOk(p.wallpaperUrl)) {
      h += '<button class="se-wp on" data-wp="custom" title="' + esc(t('se_bg_custom', 'Your picture')) + '" style="background:#111 url(&quot;' + esc(p.wallpaperUrl) + '&quot;) center/cover"></button>';
    }
    return '<div class="se-wps">' + h + '</div>';
  }

  // ---- pages
  var PAGE = {};

  PAGE.home = function () {
    var i = SE.info || {}, p = P(), d = i.device || {}, n = i.network || {}, a = i.account || {};
    return '<div class="se-tiles">' +
      '<div class="se-tile" data-go="system/about"><span class="ic big" data-ic="se_pc"></span><div><div class="tn">' + esc(d.name || '—') + '</div><div class="ts">' + esc([d.manufacturer, d.model].filter(Boolean).join(' ')) + '</div></div></div>' +
      '<div class="se-tile" data-go="network/wifi"><span class="ic big" data-ic="se_network"></span><div><div class="tn">' + esc(n.ssid || t('se_wifi', 'Wi-Fi')) + '</div><div class="ts">' + esc(n.online === false ? t('se_no_internet', 'Connected, no internet') : t('se_connected', 'Connected, secured')) + '</div></div></div>' +
      '<div class="se-tile" data-go="personal"><span class="se-mini" style="background:' + esc(wpLook(p).image.indexOf('url(') === 0 ? '#111' : 'transparent') + ';background-image:' + wpLook(p).image.replace(/"/g, '&quot;') + ';background-size:cover"></span><div><div class="tn">' + esc(t('se_personal', 'Personalisation')) + '</div><div class="ts">' + esc(t('se_home_pers', 'Background, colours, themes')) + '</div></div></div></div>' +
      '<div class="se-sec">' + esc(t('se_home_you', 'Your account')) + '</div>' +
      card([row({ ic: 'se_person', title: a.name || '—', desc: [a.job, a.grade].filter(Boolean).join(' · '), go: 'accounts/info' })]);
  };

  PAGE.system = function () {
    var d = (SE.info || {}).device || {};
    return '<div class="se-hero"><span class="ic big" data-ic="se_pc"></span><div><div class="hn">' + esc(d.name || '—') + '</div><div class="hs">' + esc([d.manufacturer, d.model].filter(Boolean).join(' ')) + '</div></div></div>' +
      card([
        row({ ic: 'se_display', title: t('se_display', 'Display'), desc: t('se_display_d', 'Brightness, night light'), go: 'system/display' }),
        row({ ic: 'se_about', title: t('se_about', 'About'), desc: t('se_about_d', 'Device specifications, Windows specifications'), go: 'system/about' })
      ]);
  };

  PAGE['system/display'] = function () {
    var p = P();
    var out = card([row({ ic: 'se_sun', title: t('se_brightness', 'Brightness'), desc: t('se_brightness_d', 'Adjust the brightness of the built-in display'),
      right: '<input type="range" class="se-range" data-range="brightness" min="10" max="100" value="' + (p.brightness || 100) + '">' })]);
    var rows = [row({ ic: 'se_moon', title: t('se_night', 'Night light'), desc: t('se_night_d', 'Use warmer colours to help block blue light'), right: tg('night', !!p.night) })];
    if (p.night) rows.push(row({ title: t('se_strength', 'Strength'), right: '<input type="range" class="se-range" data-range="nightStrength" min="0" max="100" value="' + (p.nightStrength || 0) + '">' }));
    return out + '<div class="se-gap"></div>' + card(rows);
  };

  PAGE['system/about'] = function () {
    var d = (SE.info || {}).device || {}, j = (SE.info || {}).account || {};
    var spec = card([
      '<div class="se-cardhead"><div class="ch">' + esc(t('se_devspec', 'Device specifications')) + '</div><button class="se-btn" data-act="copy">' + esc(t('se_copy', 'Copy')) + '</button></div>',
      kv(t('se_dev_name', 'Device name'), d.name), kv(t('se_dev_maker', 'Manufacturer'), d.manufacturer), kv(t('se_dev_model', 'Model'), d.model),
      kv(t('se_dev_cpu', 'Processor'), d.processor), kv(t('se_dev_ram', 'Installed RAM'), d.ram), kv(t('se_dev_gpu', 'Graphics'), d.graphics),
      kv(t('se_dev_id', 'Device ID'), d.deviceId), kv(t('se_dev_type', 'System type'), d.systemType), kv(t('se_dev_loc', 'Location'), d.location)
    ]);
    var win = card([
      '<div class="se-cardhead"><div class="ch">' + esc(t('se_winspec', 'Windows specifications')) + '</div></div>',
      kv(t('se_edition', 'Edition'), d.edition), kv(t('se_version', 'Version'), d.version), kv(t('se_signed', 'Signed in as'), j.name),
      kv(t('se_org', 'Organisation'), j.job)
    ]);
    return spec + '<div class="se-gap"></div>' + win;
  };

  function netStatus(n) {
    if (!n.wifiOn) return t('se_wifi_off', 'Wi-Fi is off');
    if (n.online === false) return t('se_no_internet', 'Connected, no internet');
    return t('se_connected', 'Connected, secured');
  }
  // 4-bar signal strength, same look as the network picker mockup.
  function netBars(signal) {
    var lv = Math.max(0, Math.min(4, Math.ceil(((signal == null ? 100 : signal) / 100) * 4)));
    var h = '';
    for (var i = 1; i <= 4; i++) h += '<span class="se-bar' + (i <= lv ? ' on' : '') + '" style="height:' + (i * 25) + '%"></span>';
    return '<span class="se-bars">' + h + '</span>';
  }
  function netRow(n) {
    var open = SE.wifiOpenId === n.id;
    var secured = n.security && n.security !== 'Open';
    var sub = n.connected ? '<span class="se-net-ok">' + esc(t('se_connected_short', 'Connected')) + (n.security ? ', ' + esc(n.security) : '') + '</span>' : esc(n.security || t('se_net_open', 'Open'));
    var head = '<div class="se-netrow' + (n.connected ? ' on' : ' click') + '" data-net="' + esc(n.id) + '">' +
      netBars(n.signal) +
      '<div class="se-rt"><div class="se-rn">' + esc(n.ssid || '—') + '</div><div class="se-rd">' + sub + '</div></div>' +
      (secured ? '<span class="ic se-ric" data-ic="se_lock"></span>' : '') +
      (n.connected ? '<span class="ic se-chev on" data-ic="se_check"></span>' : (!secured ? '<span class="ic se-chev" data-ic="se_chevr"></span>' : '')) +
      '</div>';
    if (!open || n.connected) return head;
    return head + '<div class="se-netform">' +
      (SE.wifiErr ? '<div class="se-note err">' + esc(SE.wifiErr) + '</div>' : '') +
      '<input type="password" class="se-inp" id="se-wifi-pass" placeholder="' + esc(t('se_net_password', 'Network security key')) + '" autocomplete="off">' +
      '<div class="se-netform-btns"><button class="se-btn" data-act="wifi-cancel">' + esc(t('ui_cancel', 'Cancel')) + '</button>' +
      '<button class="se-btn primary" data-act="wifi-connect" data-net="' + esc(n.id) + '"' + (SE.wifiBusy ? ' disabled' : '') + '>' + esc(t('se_net_connect', 'Connect')) + '</button></div></div>';
  }

  PAGE.network = function () {
    var n = (SE.info || {}).network || {};
    return '<div class="se-hero"><span class="ic big" data-ic="se_network"></span><div><div class="hn">' + esc(n.wifiOn === false ? t('se_wifi', 'Wi-Fi') : (n.ssid || '—')) + '</div><div class="hs">' +
      esc(netStatus(n)) + '</div></div></div>' +
      card([row({ ic: 'se_wifi', title: t('se_wifi', 'Wi-Fi'), desc: n.wifiOn === false ? t('se_off', 'Off') : (n.ssid || '') + (n.band ? ' · ' + n.band : ''), go: 'network/wifi' })]);
  };
  PAGE['network/wifi'] = function () {
    var n = (SE.info || {}).network || {};
    var list = n.list || [];
    var toggle = card([row({ ic: 'se_wifi', title: t('se_wifi', 'Wi-Fi'), desc: t('se_wifi_toggle_d', 'Connect to nearby networks'), right: tg('wifiOn', n.wifiOn !== false) })]);
    if (n.wifiOn === false) {
      return toggle + '<div class="se-gap"></div><div class="se-empty">' + esc(t('se_wifi_off_msg', 'Turn on Wi-Fi to see nearby networks.')) + '</div>';
    }
    var connected = list.filter(function (x) { return x.connected; })[0];
    var hero = connected ? card([
      '<div class="se-cardhead"><div class="ch">' + esc(connected.ssid || '—') + '</div><span class="se-tag ' + (n.online === false ? 'warn' : 'ok') + '">' + esc(netStatus(n)) + '</span></div>',
      kv(t('se_net_profile', 'Network profile type'), t('se_net_private', 'Private')), kv(t('se_net_proto', 'Protocol'), n.protocol),
      kv(t('se_net_sec', 'Security type'), connected.security), kv(t('se_net_band', 'Network band'), connected.band),
      kv(t('se_net_online', 'Internet access'), n.online === false ? t('se_no', 'No') : t('se_yes', 'Yes'))
    ]) : '';
    var avail = '<div class="se-sec">' + esc(t('se_wifi_available', 'Available networks')) + '</div>' +
      '<div class="se-card se-netlist">' + list.map(netRow).join('') + '</div>';
    return toggle + '<div class="se-gap"></div>' + hero + (hero ? '<div class="se-gap"></div>' : '') + avail;
  };

  PAGE.personal = function () {
    var p = P(), th = '';
    THEMES.forEach(function (x) {
      var cur = p.wallpaper === x.wallpaper && p.mode === x.mode && p.accent.toLowerCase() === x.accent;
      th += '<button class="se-th' + (cur ? ' on' : '') + '" data-theme="' + x.id + '" title="' + esc(t('se_theme_' + x.id, x.id)) + '">' + preview({ wallpaper: x.wallpaper, mode: x.mode, accent: x.accent, fit: 'fill' }, 'sm') + '</button>';
    });
    return '<div class="se-persona"><div class="pl">' + preview(p) + '</div><div class="pr"><div class="se-sec tight">' + esc(t('se_theme_pick', 'Select a theme to apply')) + '</div><div class="se-ths">' + th + '</div></div></div>' +
      card([
        row({ ic: 'se_image', title: t('se_background', 'Background'), desc: t('se_background_d', 'Background image, fit'), go: 'personal/background' }),
        row({ ic: 'se_palette', title: t('se_colors', 'Colours'), desc: t('se_colors_d', 'Accent colour, light or dark mode'), go: 'personal/colors' }),
        row({ ic: 'se_brush', title: t('se_themes', 'Themes'), desc: t('se_themes_d', 'Install, create, manage'), go: 'personal/themes' }),
        row({ ic: 'se_lock', title: t('se_lockscreen', 'Lock screen'), desc: t('se_lockscreen_d', 'Show the lock screen when the computer opens'), go: 'personal/lock' }),
        row({ ic: 'se_taskbar', title: t('se_taskbar', 'Taskbar'), desc: t('se_taskbar_d', 'Taskbar behaviours, search'), go: 'personal/taskbar' })
      ]);
  };

  PAGE['personal/background'] = function () {
    var p = P(), i = SE.info || {};
    var out = noticeHtml() + '<div class="se-persona one"><div class="pl">' + preview(p) + '</div></div>';
    out += card([
      '<div class="se-cardhead"><div class="ch">' + esc(t('se_bg_choose', 'Choose a picture')) + '</div></div><div class="se-pad">' + wpThumbs() + '</div>'
    ]) + '<div class="se-gap"></div>';
    if (i.allowCustom !== false) {
      out += card([
        '<div class="se-cardhead"><div class="ch">' + esc(t('se_bg_url', 'Use a picture from the web')) + '</div></div>' +
        '<div class="se-pad"><div class="se-urlrow"><input type="text" id="se-url" maxlength="300" autocomplete="off" spellcheck="false" placeholder="https://" value="' + esc(p.wallpaper === 'custom' ? (p.wallpaperUrl || '') : '') + '">' +
        '<button class="se-btn primary" data-act="useurl">' + esc(t('se_bg_apply', 'Use picture')) + '</button></div><div class="se-rd">' + esc(t('se_bg_url_d', 'Paste the address of an image (https). JPG, PNG or GIF.')) + '</div></div>'
      ]) + '<div class="se-gap"></div>';
    }
    out += card([row({ ic: 'se_fit', title: t('se_bg_fit', 'Choose a fit for your desktop image'),
      right: sel('fit', [['fill', t('se_fit_fill', 'Fill')], ['fit', t('se_fit_fit', 'Fit')], ['stretch', t('se_fit_stretch', 'Stretch')], ['tile', t('se_fit_tile', 'Tile')], ['center', t('se_fit_center', 'Centre')]], p.fit) })]);
    return out;
  };

  PAGE['personal/colors'] = function () {
    var p = P(), sw = '';
    ACCENTS.forEach(function (c) {
      sw += '<button class="se-sw' + (p.accent.toLowerCase() === c ? ' on' : '') + '" data-accent="' + c + '" style="background:' + c + '"><span class="ic" data-ic="se_check" style="color:' + inkFor(c) + '"></span></button>';
    });
    return '<div class="se-persona one"><div class="pl">' + preview(p) + '</div></div>' +
      card([row({ ic: 'se_mode', title: t('se_mode', 'Choose your mode'), desc: t('se_mode_d', 'Change the colours that appear in Start, the taskbar and Settings'),
        right: sel('mode', [['light', t('se_mode_light', 'Light')], ['dark', t('se_mode_dark', 'Dark')]], p.mode) })]) + '<div class="se-gap"></div>' +
      card([
        '<div class="se-cardhead"><div class="ch">' + esc(t('se_accent', 'Accent colour')) + '</div></div><div class="se-pad"><div class="se-sws">' + sw + '</div>' +
        '<div class="se-urlrow hex"><span class="se-hexlab">' + esc(t('se_accent_custom', 'Custom colour')) + '</span><input type="text" id="se-hex" maxlength="7" autocomplete="off" spellcheck="false" placeholder="#0f6cbd" value="' + esc(p.accent) + '">' +
        '<button class="se-btn" data-act="usehex">' + esc(t('se_accent_apply', 'Apply')) + '</button></div></div>',
        row({ title: t('se_accent_bars', 'Show accent colour on Start and taskbar'), right: tg('accentBars', !!p.accentBars) })
      ]);
  };

  PAGE['personal/themes'] = function () {
    var p = P(), th = '';
    THEMES.forEach(function (x) {
      var cur = p.wallpaper === x.wallpaper && p.mode === x.mode && p.accent.toLowerCase() === x.accent;
      th += '<button class="se-th big' + (cur ? ' on' : '') + '" data-theme="' + x.id + '">' + preview({ wallpaper: x.wallpaper, mode: x.mode, accent: x.accent, fit: 'fill' }, 'sm') +
        '<span class="tl">' + esc(t('se_theme_' + x.id, x.id)) + '</span></button>';
    });
    return '<div class="se-sec tight">' + esc(t('se_theme_pick', 'Select a theme to apply')) + '</div><div class="se-thgrid">' + th + '</div>';
  };

  PAGE['personal/lock'] = function () {
    var p = P();
    return '<div class="se-persona one"><div class="pl"><div class="se-prev lockprev" style="background:' + (wpLook(p).image.replace(/"/g, '&quot;')) + ';background-size:cover"><div class="lp-t">' + esc(new Date().toLocaleTimeString(t('ui_date_locale', 'en-GB'), { hour: '2-digit', minute: '2-digit', hour12: p.clock24 === false })) + '</div></div></div></div>' +
      card([row({ ic: 'se_lock', title: t('se_lock_show', 'Show the lock screen'), desc: t('se_lock_show_d', 'Show the lock screen when the computer opens, before the desktop'), right: tg('lockShow', p.lockShow !== false) }),
        row({ ic: 'se_image', title: t('se_lock_bg', 'Lock screen background'), desc: t('se_lock_bg_d', 'The lock screen uses your desktop background'), go: 'personal/background' })]);
  };

  PAGE['personal/taskbar'] = function () {
    var p = P();
    return card([row({ ic: 'se_search', title: t('se_tb_search', 'Search'), desc: t('se_tb_search_d', 'Show or hide search on the taskbar'),
      right: sel('search', [['hidden', t('se_srch_hide', 'Hide')], ['icon', t('se_srch_icon', 'Search icon only')], ['box', t('se_srch_box', 'Search box')]], p.search) })]) +
      '<div class="se-gap"></div>' +
      card([row({ ic: 'se_taskbar', title: t('se_tb_align', 'Taskbar alignment'), right: sel('taskbarAlign', [['left', t('se_align_left', 'Left')], ['center', t('se_align_center', 'Centre')]], p.taskbarAlign) })]);
  };

  PAGE.accounts = function () {
    var a = (SE.info || {}).account || {};
    return '<div class="se-hero">' + avaSpan() + '<div><div class="hn">' + esc(a.name || '—') + '</div><div class="hs">' + esc([a.job, a.grade].filter(Boolean).join(' · ')) + '</div></div></div>' +
      card([
        row({ ic: 'se_person', title: t('se_yourinfo', 'Your info'), desc: t('se_yourinfo_d', 'Your name, job and profile picture'), go: 'accounts/info' }),
        row({ ic: 'se_key', title: t('se_signin', 'Sign-in options'), desc: t('se_signin_d', 'The lock screen, sign-in password'), go: 'accounts/signin' })
      ]);
  };
  PAGE['accounts/info'] = function () {
    var a = (SE.info || {}).account || {}, p = P();
    var out = card([
      '<div class="se-avarow">' + avaSpan('xl') + '<div style="flex:1"><div class="an">' + esc(a.name || '—') + '</div><div class="aj">' + esc([a.job, a.grade].filter(Boolean).join(' · ')) + '</div>' +
      '<div class="abtns"><button class="se-btn primary" data-act="ava-change">' + esc(t('se_ava_change', 'Change picture')) + '</button>' +
      (avaOk(p.avatar) ? '<button class="se-btn danger" data-act="ava-remove">' + esc(t('se_ava_remove', 'Remove')) + '</button>' : '') + '</div></div></div>'
    ]);
    out += '<div class="se-gap"></div>' + card([kv(t('se_acc_name', 'Name'), a.name), kv(t('se_acc_job', 'Job'), a.job), kv(t('se_acc_grade', 'Position'), a.grade),
      kv(t('se_acc_type', 'Account type'), a.isBoss ? t('se_acc_boss', 'Administrator (boss)') : t('se_acc_std', 'Standard user'))]);
    return out;
  };
  PAGE['accounts/signin'] = function () {
    var p = P(), a = (SE.info || {}).account || {}, hasPw = !!a.hasPassword;
    var out = card([row({ ic: 'se_lock', title: t('se_lock_show', 'Show the lock screen'), desc: t('se_lock_show_d', 'Show the lock screen when the computer opens, before the desktop'), right: tg('lockShow', p.lockShow !== false) })]);
    out += '<div class="se-gap"></div>' + '<div class="se-sec">' + esc(t('se_signin_opts', 'SIGN-IN OPTIONS')) + '</div>';
    var pwRow = row({ ic: 'se_key', title: t('se_password', 'Password'),
      desc: hasPw ? t('se_pw_set', 'Set - required to sign back in') : t('se_pw_notset', 'Not set - anyone can sign in'),
      right: '<button class="se-btn" data-act="pw-open">' + esc(hasPw ? t('se_pw_change', 'Change') : t('se_pw_add', 'Add')) + '</button>' });
    var body = '';
    if (SE.pwOpen) {
      body = '<div class="se-pwform">' +
        (SE.pwErr ? '<div class="se-note err">' + esc(SE.pwErr) + '</div>' : '') +
        '<div class="se-rd">' + esc(t('se_pw_hint', 'Set a password to lock this computer when you step away — anyone else will need it to sign back in.')) + '</div>' +
        (hasPw ? '<div class="se-pwform-fields"><div class="field"><label>' + esc(t('se_pw_current', 'Current password')) + '</label><input type="password" class="se-inp" id="se-pw-current" autocomplete="off"></div></div>' : '') +
        '<div class="se-pwform-fields">' +
        '<div class="field"><label>' + esc(t('se_pw_new', 'New password')) + '</label><input type="password" class="se-inp" id="se-pw-new" autocomplete="off"></div>' +
        '<div class="field"><label>' + esc(t('se_pw_confirm', 'Confirm password')) + '</label><input type="password" class="se-inp" id="se-pw-confirm" autocomplete="off"></div>' +
        '</div>' +
        '<div class="se-pwform-btns">' + (hasPw ? '<button class="se-btn danger" data-act="pw-remove"' + (SE.pwBusy ? ' disabled' : '') + '>' + esc(t('se_pw_removebtn', 'Remove password')) + '</button>' : '') +
        '<span style="flex:1"></span><button class="se-btn" data-act="pw-cancel">' + esc(t('ui_cancel', 'Cancel')) + '</button>' +
        '<button class="se-btn primary" data-act="pw-save"' + (SE.pwBusy ? ' disabled' : '') + '>' + esc(t('ui_save', 'Save')) + '</button></div></div>';
    }
    out += '<div class="se-card">' + pwRow + body + '</div>';
    return out;
  };

  PAGE.time = function () {
    var p = P();
    return '<div class="se-hero clockhero"><div><div class="hn big" id="se-clock"></div><div class="hs" id="se-cdate"></div></div></div>' +
      card([
        row({ ic: 'se_clock', title: t('se_datetime', 'Date & time'), desc: t('se_datetime_d', 'Time format'), go: 'time/datetime' }),
        row({ ic: 'se_globe', title: t('se_language', 'Language & region'), desc: t('se_language_d', 'Display language, regional format'), go: 'time/language' })
      ]);
  };
  PAGE['time/datetime'] = function () {
    var p = P();
    return '<div class="se-hero clockhero"><div><div class="hn big" id="se-clock"></div><div class="hs" id="se-cdate"></div></div></div>' +
      card([row({ ic: 'se_clock', title: t('se_24h', 'Use a 24-hour clock'), desc: t('se_24h_d', 'Applies to the taskbar and lock screen'), right: tg('clock24', p.clock24 !== false) })]);
  };
  PAGE['time/language'] = function () {
    var p = P(), langs = ((SE.info || {}).languages || [{ code: 'en', name: 'English (United Kingdom)' }]).map(function (l) { return [l.code, l.name]; });
    var d = new Date(2026, 2, 27, 12);
    var dfmt = [['dmy', seFmtDate(d, 'dmy')], ['mdy', seFmtDate(d, 'mdy')], ['ymd', seFmtDate(d, 'ymd')]];
    return card([row({ ic: 'se_globe', title: t('se_dispLang', 'Display language'), desc: t('se_dispLang_d', 'Language used by this computer'), right: sel('lang', langs, p.lang || 'en') })]) + '<div class="se-gap"></div>' +
      card([
        row({ ic: 'se_calfmt', title: t('se_dateFmt', 'Date format'), right: sel('dateFormat', dfmt, p.dateFormat || 'dmy') }),
        row({ ic: 'se_cal', title: t('se_weekStart', 'First day of week'), desc: t('se_weekStart_d', 'Used by the Calendar'),
          right: sel('weekStart', [[1, t('se_day_mon', 'Monday')], [0, t('se_day_sun', 'Sunday')], [6, t('se_day_sat', 'Saturday')]], p.weekStart == null ? 1 : p.weekStart) })
      ]);
  };

  // ---- shell
  function seRender() {
    if (!SE.info && SE.state === 'loading') { $('se-page').innerHTML = '<div class="se-empty">' + esc(t('ui_fx_loading', 'Loading…')) + '</div>'; return; }
    if (SE.state === 'error') { $('se-page').innerHTML = '<div class="se-empty">' + esc(t('se_error', "Couldn't load settings.")) + '<br><br><button class="se-btn" data-act="retry">' + esc(t('ui_fx_retry', 'Try again')) + '</button></div>'; return; }
    var a = (SE.info || {}).account || {};
    $('se-user').innerHTML = avaSpan() + '<div class="un"><b>' + esc(a.name || state.user || '—') + '</b><span>' + esc(a.job || '') + '</span></div>';
    var top = seTop(SE.page);
    $('se-navlist').innerHTML = NAV.map(function (n) {
      return '<button class="se-ni' + (n.id === top ? ' on' : '') + '" data-go="' + n.id + '"><span class="ic" data-ic="' + n.ic + '"></span><span>' + esc(t(n.key, n.def)) + '</span></button>';
    }).join('');
    var head = SUB[SE.page]
      ? '<div class="se-head"><button class="crumb" data-go="' + SUB[SE.page][0] + '">' + esc(seTitleOf(SUB[SE.page][0])) + '</button><span class="ic se-sep" data-ic="se_chevr"></span><b>' + esc(seTitleOf(SE.page)) + '</b></div>'
      : '<div class="se-head"><b>' + esc(seTitleOf(SE.page)) + '</b></div>';
    var page = (PAGE[SE.page] || PAGE.home)();
    var notice = SE.page === 'personal/background' ? '' : noticeHtml();
    $('se-page').innerHTML = head + notice + page;
    fillIcons($('se-root'));
    seTickClock();
  }

  function seTickClock() {
    var c = $('se-clock');
    if (!c) return;
    var d = new Date(), p = P();
    c.textContent = d.toLocaleTimeString(t('ui_date_locale', 'en-GB'), { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: p.clock24 === false });
    $('se-cdate').textContent = d.toLocaleDateString(t('ui_date_locale', 'en-GB'), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  setInterval(seTickClock, 1000);

  function seGo(page) {
    if (!PAGE[page]) page = 'home';
    SE.page = page; SE.notice = null; SE.q = ''; $('se-q').value = ''; $('se-results').classList.add('hidden');
    seRender();
    $('se-page').scrollTop = 0;
  }
  function openSettings(page) {
    SE.want = page || null;
    if (wins.settings.open) { wins.settings.min = false; openWin('settings'); if (page) seGo(page); }
    else openWin('settings');
  }

  function seLoad() {
    var tok = ++SE.tok;
    if (!SE.info) { SE.state = 'loading'; seRender(); }
    seApi('settingsInfo').then(function (r) {
      if (tok !== SE.tok) return;
      if (r && r.ok) {
        SE.info = r; SE.state = 'ok';
        state.prefs = Object.assign({}, DEFAULT_PREFS, r.prefs || {});
        state.user = (r.account && r.account.name) || state.user;
        if (r.account && typeof r.account.hasPassword === 'boolean') state.lockPassword = r.account.hasPassword;
        applyPrefs();
      } else { SE.state = 'error'; }
      seRender();
    });
  }
  function seStart() { SE.page = SE.want || 'home'; SE.want = null; SE.notice = null; SE.q = ''; $('se-q').value = ''; $('se-results').classList.add('hidden'); seLoad(); }

  // apply now, save shortly after (a slider drag becomes one save)
  function seSet(obj) {
    state.prefs = Object.assign({}, P(), obj);
    Object.keys(obj).forEach(function (k) { SE.pending[k] = obj[k]; });
    applyPrefs();
    clearTimeout(SE.timer);
    SE.timer = setTimeout(seFlush, 350);
  }
  function seFlush() {
    var data = SE.pending; SE.pending = {};
    if (!Object.keys(data).length) return;
    seApi('settingsApi', { name: 'set', data: data }).then(function (r) {
      if (r && r.ok && r.prefs) {
        state.prefs = Object.assign({}, DEFAULT_PREFS, r.prefs);
        if (SE.info) SE.info.prefs = r.prefs;
        applyPrefs();
        // wifiOn changes online/status text, which nothing else already redraws optimistically - refresh it.
        if (r.network && SE.info) { SE.info.network = r.network; if (SE.page.indexOf('network') === 0) seRender(); }
        return;   // already shown (applied optimistically); don't redraw under the user's typing
      } else if (SE.info && SE.info.prefs) {
        // refused (or the server was unreachable): go back to what is saved
        state.prefs = Object.assign({}, DEFAULT_PREFS, SE.info.prefs);
        applyPrefs();
        if (r && r.reason === 'bad_url') SE.notice = { kind: 'err', text: t('notify_settings_url', "That image address isn't allowed.") };
        else SE.notice = { kind: 'err', text: t('notify_error', 'Something went wrong. Try again.') };
      }
      seRender();
    });
  }

  // Joining a network isn't a plain preference (it needs a password check server-side), so it bypasses
  // seSet/seFlush entirely and calls settingsApi directly.
  function wifiConnect(id, password) {
    if (SE.wifiBusy) return;
    SE.wifiBusy = true; SE.wifiErr = ''; seRender();
    seApi('settingsApi', { name: 'wifiConnect', data: { id: id, password: password || '' } }).then(function (r) {
      SE.wifiBusy = false;
      if (r && r.ok) {
        if (SE.info) { SE.info.network = r.network; SE.info.prefs = r.prefs; }
        state.prefs = Object.assign({}, DEFAULT_PREFS, r.prefs || {});
        applyPrefs();
        SE.wifiOpenId = null; SE.wifiErr = '';
      } else {
        var reason = r && r.reason;
        SE.wifiErr = reason === 'wrong_password' ? t('se_wifi_wrong', 'Incorrect password. Try again.')
          : reason === 'busy' ? t('se_wifi_busy', 'Slow down and try again in a moment.')
          : t('notify_error', 'Something went wrong. Try again.');
      }
      seRender();
    });
  }

  // ---- profile picture (Settings > Accounts > Your info)
  function avaChangeDlg() {
    var p = P();
    showDlg({
      title: t('se_ava_change', 'Change picture'),
      html: '<div class="fl-form"><label for="se-ava-url">' + esc(t('se_ava_link', 'Picture link (https://…)')) + '</label>' +
        '<input id="se-ava-url" type="text" maxlength="300" autocomplete="off" spellcheck="false" placeholder="https://i.imgur.com/…" value="' + esc(avaOk(p.avatar) ? p.avatar : '') + '">' +
        '<div class="fl-hint">' + esc(t('se_ava_hint', 'Paste the address of an image (https). JPG, PNG or GIF.')) + '</div></div>',
      buttons: [
        { label: t('ui_save', 'Save'), primary: true, run: function () {
          var u = ($('se-ava-url').value || '').trim();
          if (!u) { seSet({ avatar: '' }); return; }
          if (!avaOk(u)) { SE.notice = { kind: 'err', text: t('notify_settings_url', "That image address isn't allowed.") }; seRender(); return; }
          seSet({ avatar: u }); seRender();
        } },
        { label: t('fl_cancel', 'Cancel') }
      ]
    });
    setTimeout(function () { var i = $('se-ava-url'); if (i) i.focus(); }, 30);
  }
  function avaRemove() { seSet({ avatar: '' }); seRender(); }

  // ---- sign-in password (Settings > Accounts > Sign-in options)
  function pwField(id) { var el = $(id); return el ? el.value : ''; }
  function passwordSubmit() {
    var hasPw = !!(((SE.info || {}).account || {}).hasPassword);
    var cur = hasPw ? pwField('se-pw-current') : '', nw = pwField('se-pw-new'), cf = pwField('se-pw-confirm');
    if (!nw || nw !== cf) { SE.pwErr = t('se_pw_err_mismatch', "Passwords don't match."); seRender(); return; }
    if (SE.pwBusy) return;
    SE.pwBusy = true; SE.pwErr = ''; seRender();
    seApi('settingsApi', { name: 'passwordSet', data: { current: cur, newPassword: nw, confirm: cf } }).then(function (r) {
      SE.pwBusy = false;
      if (r && r.ok) {
        if (SE.info) SE.info.account = Object.assign({}, SE.info.account, r.account);
        if (r.account && typeof r.account.hasPassword === 'boolean') state.lockPassword = r.account.hasPassword;
        SE.pwOpen = false; SE.pwErr = '';
      } else {
        var reason = r && r.reason;
        SE.pwErr = reason === 'wrong_password' ? t('se_pw_err_current', 'That current password is wrong.')
          : reason === 'bad_length' ? t('se_pw_err_length', 'Choose a longer password.')
          : reason === 'mismatch' ? t('se_pw_err_mismatch', "Passwords don't match.")
          : t('notify_error', 'Something went wrong. Try again.');
      }
      seRender();
    });
  }
  function passwordRemoveNow() {
    if (SE.pwBusy) return;
    var cur = pwField('se-pw-current');
    SE.pwBusy = true; SE.pwErr = ''; seRender();
    seApi('settingsApi', { name: 'passwordRemove', data: { current: cur } }).then(function (r) {
      SE.pwBusy = false;
      if (r && r.ok) {
        if (SE.info) SE.info.account = Object.assign({}, SE.info.account, r.account);
        if (r.account && typeof r.account.hasPassword === 'boolean') state.lockPassword = r.account.hasPassword;
        SE.pwOpen = false; SE.pwErr = '';
      } else {
        SE.pwErr = (r && r.reason === 'wrong_password') ? t('se_pw_err_current', 'That current password is wrong.') : t('notify_error', 'Something went wrong. Try again.');
      }
      seRender();
    });
  }

  // ---- lock screen unlock (asks the server, never checks a password client-side)
  var LOCK = { busy: false };
  function showLockErr(msg) { var e = $('lock-pwerr'); if (e) e.textContent = msg || ''; }
  function attemptUnlock() {
    if (!state.lockPassword) { signIn(); return; }
    if (LOCK.busy) return;
    var pw = $('lock-pw'), val = pw ? pw.value : '';
    if (!val) { showLockErr(t('ui_lock_pw_req', 'Enter your password.')); if (pw) pw.focus(); return; }
    LOCK.busy = true; showLockErr('');
    seApi('settingsApi', { name: 'passwordCheck', data: { password: val } }).then(function (r) {
      LOCK.busy = false;
      if (r && r.ok) { signIn(); return; }
      showLockErr(r && r.reason === 'busy' ? t('se_wifi_busy', 'Slow down and try again in a moment.') : t('ui_lock_pw_wrong', 'Incorrect password. Try again.'));
      if (pw) { pw.value = ''; pw.focus(); }
    });
  }

  function seFmtDate(d, f) {
    var dd = ('0' + d.getDate()).slice(-2), mm = ('0' + (d.getMonth() + 1)).slice(-2), yy = d.getFullYear();
    return f === 'mdy' ? mm + '/' + dd + '/' + yy : f === 'ymd' ? yy + '-' + mm + '-' + dd : dd + '/' + mm + '/' + yy;
  }

  function seCopySpec() {
    var d = (SE.info || {}).device || {};
    var text = [['se_dev_name', 'Device name', d.name], ['se_dev_cpu', 'Processor', d.processor], ['se_dev_ram', 'Installed RAM', d.ram], ['se_dev_id', 'Device ID', d.deviceId], ['se_dev_type', 'System type', d.systemType]]
      .map(function (r) { return t(r[0], r[1]) + '\t' + (r[2] || ''); }).join('\n');
    var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* not available */ }
    document.body.removeChild(ta);
    SE.notice = { kind: ok ? 'ok' : 'err', text: ok ? t('ui_br_copied', 'Copied') : t('se_copy_fail', "Couldn't copy.") };
    seRender();
  }

  // ---- events
  seWin.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { seGo(go.dataset.go); return; }
    var tgl = e.target.closest('[data-tg]');
    if (tgl) { var k = tgl.dataset.tg, o = {}; o[k] = !(k === 'lockShow' ? P().lockShow !== false : k === 'clock24' ? P().clock24 !== false : !!P()[k]); seSet(o); seRender(); return; }
    var wp = e.target.closest('[data-wp]');
    if (wp) { var w = { wallpaper: wp.dataset.wp }; seSet(w); SE.notice = null; seRender(); return; }
    var th = e.target.closest('[data-theme]');
    if (th) { THEMES.forEach(function (x) { if (x.id === th.dataset.theme) seSet({ wallpaper: x.wallpaper, mode: x.mode, accent: x.accent }); }); seRender(); return; }
    var ac = e.target.closest('[data-accent]');
    if (ac) { seSet({ accent: ac.dataset.accent }); seRender(); return; }
    var netRow = e.target.closest('.se-netrow[data-net]');
    if (netRow && !e.target.closest('[data-act]')) {
      var list = ((SE.info || {}).network || {}).list || [];
      var entry = list.filter(function (x) { return x.id === netRow.dataset.net; })[0];
      if (entry && !entry.connected) {
        SE.wifiErr = '';
        if (entry.security && entry.security !== 'Open') {
          SE.wifiOpenId = SE.wifiOpenId === entry.id ? null : entry.id;
          seRender();
        } else {
          wifiConnect(entry.id, '');
        }
      }
      return;
    }
    var act = e.target.closest('[data-act]');
    if (act) {
      var a = act.dataset.act;
      if (a === 'retry') seLoad();
      else if (a === 'copy') seCopySpec();
      else if (a === 'wifi-cancel') { SE.wifiOpenId = null; SE.wifiErr = ''; seRender(); }
      else if (a === 'wifi-connect') {
        var pw = $('se-wifi-pass'); wifiConnect(act.dataset.net, pw ? pw.value : '');
      }
      else if (a === 'ava-change') { avaChangeDlg(); }
      else if (a === 'ava-remove') { avaRemove(); }
      else if (a === 'pw-open') { SE.pwOpen = true; SE.pwErr = ''; seRender(); setTimeout(function () { var i = $('se-pw-current') || $('se-pw-new'); if (i) i.focus(); }, 30); }
      else if (a === 'pw-cancel') { SE.pwOpen = false; SE.pwErr = ''; seRender(); }
      else if (a === 'pw-save') { passwordSubmit(); }
      else if (a === 'pw-remove') { passwordRemoveNow(); }
      else if (a === 'useurl') {
        var u = ($('se-url').value || '').trim();
        if (!urlOk(u)) { SE.notice = { kind: 'err', text: t('notify_settings_url', "That image address isn't allowed.") }; seRender(); return; }
        SE.notice = null; seSet({ wallpaper: 'custom', wallpaperUrl: u }); seRender();
      } else if (a === 'usehex') {
        var hx = ($('se-hex').value || '').trim();
        if (hx.charAt(0) !== '#') hx = '#' + hx;
        if (!/^#[0-9a-f]{6}$/i.test(hx)) { SE.notice = { kind: 'err', text: t('se_accent_bad', 'Enter a colour like #0f6cbd.') }; seRender(); return; }
        seSet({ accent: hx.toLowerCase() }); seRender();
      }
    }
  });
  seWin.addEventListener('change', function (e) {
    var s = e.target.closest('[data-sel]');
    if (s) {
      var k = s.dataset.sel, v = s.value;
      if (k === 'weekStart') v = +v;
      var o = {}; o[k] = v; seSet(o); seRender(); return;
    }
    var r = e.target.closest('[data-range]');
    if (r) { seFlush(); seRender(); }
  });
  seWin.addEventListener('input', function (e) {
    var r = e.target.closest('[data-range]');
    if (r) { var o = {}; o[r.dataset.range] = +r.value; state.prefs = Object.assign({}, P(), o); SE.pending[r.dataset.range] = +r.value; applyPrefs(); clearTimeout(SE.timer); SE.timer = setTimeout(seFlush, 500); return; }
    if (e.target.id === 'se-q') seSearch(e.target.value);
  });
  seWin.addEventListener('keydown', function (e) {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.key !== 'Escape') e.stopPropagation();
    if (e.key === 'Enter' && e.target.id === 'se-url') { e.preventDefault(); seWin.querySelector('[data-act="useurl"]').click(); }
    if (e.key === 'Enter' && e.target.id === 'se-hex') { e.preventDefault(); seWin.querySelector('[data-act="usehex"]').click(); }
  });

  function seSearch(q) {
    q = (q || '').trim().toLowerCase();
    var box = $('se-results');
    if (!q) { box.classList.add('hidden'); return; }
    var hits = INDEX.filter(function (x) { return (t(x[1], x[2]) + ' ' + x[3]).toLowerCase().indexOf(q) !== -1; }).slice(0, 8);
    box.innerHTML = hits.length ? hits.map(function (x) {
      return '<div class="se-hit" data-go="' + x[0] + '"><b>' + esc(t(x[1], x[2])) + '</b><span>' + esc(seTitleOf(SUB[x[0]][0]) + ' › ' + seTitleOf(x[0])) + '</span></div>';
    }).join('') : '<div class="se-hit none">' + esc(t('se_no_results', 'No results found')) + '</div>';
    box.classList.remove('hidden');
  }

  // ================================================================ Store
  // Apps are installed per JOB: a boss installs once and everyone on the job has the app.
  var ST = { page: 'home', app: null, q: '', state: 'idle', data: null, msg: null, busy: false, tok: 0 };
  var stWin = $('win-store');

  function stApi(name, id) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/storeApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, id: id })
    }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
  }

  function stName(a) { return a.label || t('store_' + a.id + '_name', a.id); }
  function stDesc(a) { return a.desc || t('store_' + a.id + '_desc', ''); }
  function stFeatures(a) {
    if (a.features && a.features.length) return a.features;
    var out = [];
    for (var i = 1; i <= 4; i++) { var f = t('store_' + a.id + '_f' + i, ''); if (f) out.push(f); }
    return out;
  }
  function stCat(a) { return a.category ? t('store_cat_' + a.category, a.category) : ''; }
  function stCur() { return (ST.data && ST.data.currency) || '£'; }
  function stPrice(a) { return a.price > 0 ? stCur() + a.price : t('store_free', 'Free'); }
  function stJobs(a) {
    if (!a.jobs || !a.jobs.length) return t('store_any_job', 'Any job');
    return a.jobs.map(function (j) { return j.label; }).join(', ');
  }
  function stFind(id) {
    var f = null;
    ((ST.data && ST.data.apps) || []).forEach(function (a) { if (a.id === id) f = a; });
    return f;
  }
  function stRgba(hex, al) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 'rgba(120,130,150,' + al + ')';
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + al + ')';
  }
  function stTile(a, size) {
    var bg = 'linear-gradient(145deg,' + stRgba(a.tint, .12) + ',' + stRgba(a.tint, .32) + ')';
    return '<span class="st-tile ' + size + '" style="background:' + bg + '">' + icSpan(ICONS[a.icon] ? a.icon : 'appdef') + '</span>';
  }
  function stStatusTag(a) {
    if (a.installed) return '<span class="st-tag ok">' + esc(t('store_installed', 'Installed')) + '</span>';
    if (!a.allowed) return '<span class="st-tag lock">' + esc(t('store_locked', 'Not for your job')) + '</span>';
    return '<span class="st-tag">' + esc(stPrice(a)) + '</span>';
  }
  function stMatches(a, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (stName(a) + ' ' + (a.publisher || '') + ' ' + stCat(a) + ' ' + stDesc(a)).toLowerCase().indexOf(q) !== -1;
  }

  function stCard(a) {
    return '<div class="st-card' + (a.allowed ? '' : ' locked') + '" data-app="' + esc(a.id) + '">' + stTile(a, 's56') +
      '<div class="ct"><div class="cn">' + esc(stName(a)) + '</div><div class="cp">' + esc(a.publisher || '') + (a.publisher && stCat(a) ? ' · ' : '') + esc(stCat(a)) + '</div>' +
      '<div class="cf">' + stStatusTag(a) + '</div></div></div>';
  }

  function stMsgHtml() {
    if (!ST.msg) return '';
    return '<div class="st-note ' + esc(ST.msg.kind) + '">' + esc(ST.msg.text) + '</div>';
  }

  function stHome() {
    var apps = ST.data.apps;
    var mine = apps.filter(function (a) { return a.allowed; });
    var others = apps.filter(function (a) { return !a.allowed; });
    var feat = null;
    mine.forEach(function (a) { if (!feat && !a.installed) feat = a; });
    if (!feat && mine.length) feat = mine[0];
    var h = stMsgHtml();
    if (feat) {
      h += '<div class="st-hero"><div class="htext"><div class="kick">' + esc(t('store_featured', 'Featured for ' + ST.data.job.label).replace('%s', ST.data.job.label)) + '</div>' +
        '<h2>' + esc(stName(feat)) + '</h2><p>' + esc(stDesc(feat)) + '</p>' +
        '<button class="st-btn light" data-app="' + esc(feat.id) + '">' + esc(feat.installed ? t('store_view', 'View') : t('store_get_it', 'Get it')) + '</button></div>' +
        stTile(feat, 's132') + '</div>';
    }
    h += '<div class="st-sec"><h2 class="st-h">' + esc(t('store_for_job', 'Apps for %s').replace('%s', ST.data.job.label)) + '</h2>' +
      (mine.length ? '<div class="st-grid">' + mine.map(stCard).join('') + '</div>' : '<div class="st-empty">' + esc(t('store_none_job', 'No apps for your job yet.')) + '</div>') + '</div>';
    if (others.length) {
      h += '<div class="st-sec"><h2 class="st-h">' + esc(t('store_other_jobs', 'Made for other jobs')) + '</h2><div class="st-grid">' + others.map(stCard).join('') + '</div></div>';
    }
    return h;
  }

  function stApps() {
    var q = ST.q.trim();
    var list = ST.data.apps.filter(function (a) { return stMatches(a, q); });
    var h = stMsgHtml() + '<h2 class="st-h">' + esc(q ? fmt(t('store_results', 'Results for "%s"'), q) : t('store_all_apps', 'All apps')) + '</h2>';
    h += list.length ? '<div class="st-grid">' + list.map(stCard).join('') + '</div>' : '<div class="st-empty">' + esc(t('store_no_results', 'No apps found.')) + '</div>';
    return h;
  }

  function stLib() {
    var list = ST.data.apps.filter(function (a) { return a.installed && stMatches(a, ST.q.trim()); });
    var h = stMsgHtml() + '<h2 class="st-h">' + esc(t('store_library', 'Library')) + '</h2><p class="st-sub">' +
      esc(t('store_library_sub', 'Apps installed for %s').replace('%s', ST.data.job.label)) + '</p>';
    if (!list.length) return h + '<div class="st-empty">' + esc(t('store_lib_empty', 'Nothing installed yet.')) + '</div>';
    return h + list.map(function (a) {
      var who = a.installedBy ? fmt(t('store_installed_by', 'Installed by %s · %s'), a.installedBy, a.installedAt || '') : t('store_installed', 'Installed');
      return '<div class="st-row">' + stTile(a, 's56') + '<div class="rt"><div class="rn">' + esc(stName(a)) + '</div><div class="rs">' + esc(who) + '</div></div>' +
        '<div class="ra"><button class="st-btn primary" data-act="open" data-id="' + esc(a.id) + '">' + esc(t('store_open', 'Open')) + '</button>' +
        (a.canManage ? '<button class="st-btn danger" data-act="uninstall" data-id="' + esc(a.id) + '">' + esc(t('store_uninstall', 'Uninstall')) + '</button>' : '') + '</div></div>';
    }).join('');
  }

  function stProduct() {
    var a = stFind(ST.app);
    if (!a) return '<div class="st-empty">' + esc(t('store_no_results', 'No apps found.')) + '</div>';
    var d = ST.data;
    var buttons = '', note = '';
    if (a.installed) {
      buttons = '<button class="st-btn primary" data-act="open" data-id="' + esc(a.id) + '">' + esc(t('store_open', 'Open')) + '</button>' +
        (a.canManage ? '<button class="st-btn danger" data-act="uninstall" data-id="' + esc(a.id) + '">' + esc(t('store_uninstall', 'Uninstall')) + '</button>' : '');
      note = '<div class="st-note ok">' + esc(fmt(t('store_note_installed', 'Installed for everyone on %s.'), d.job.label)) + '</div>';
    } else if (!a.allowed) {
      buttons = '<button class="st-btn primary" disabled>' + esc(t('store_get', 'Get')) + '</button>';
      note = '<div class="st-note warn">' + esc(fmt(t('store_note_locked', 'This app is made for: %s. Your job (%s) can’t install it.'), stJobs(a), d.job.label)) + '</div>';
    } else if (!a.canManage) {
      buttons = '<button class="st-btn primary" disabled>' + esc(t('store_get', 'Get')) + '</button>';
      note = '<div class="st-note">' + esc(fmt(t('store_note_boss', 'Only the boss of %s can install apps. Once they do, everyone on the job gets it.'), d.job.label)) + '</div>';
    } else {
      buttons = '<button class="st-btn primary" data-act="install" data-id="' + esc(a.id) + '"' + (ST.busy ? ' disabled' : '') + '>' +
        esc(a.price > 0 && !a.paid ? fmt(t('store_buy', 'Buy %s'), stCur() + a.price) : t('store_get', 'Get')) + '</button>';
      note = '<div class="st-note">' + esc(fmt(t('store_note_all', 'Installing adds it for everyone on %s.'), d.job.label)) +
        (a.price > 0 && !a.paid ? ' ' + esc(fmt(t('store_note_pay', 'The %s is paid from the job’s society account.'), stCur() + a.price)) : '') +
        (a.price > 0 && !a.paid && d.funds != null ? ' ' + esc(fmt(t('store_note_funds', 'Balance: %s.'), stCur() + d.funds)) : '') + '</div>';
    }
    var feats = stFeatures(a);
    var facts = [
      [t('store_f_publisher', 'Publisher'), a.publisher || '—'],
      [t('store_f_category', 'Category'), stCat(a) || '—'],
      [t('store_f_version', 'Version'), a.version || '—'],
      [t('store_f_price', 'Price'), stPrice(a) + (a.paid && !a.installed && a.price > 0 ? ' (' + t('store_paid', 'already paid') + ')' : '')],
      [t('store_f_jobs', 'Available to'), stJobs(a)]
    ];
    if (a.installed && a.installedBy) facts.push([t('store_f_installed', 'Installed'), (a.installedAt || '') + ' · ' + a.installedBy]);
    return '<button class="st-back" data-act="back"><span class="ic" data-ic="back"></span><span>' + esc(t('store_back', 'Back')) + '</span></button>' + stMsgHtml() +
      '<div class="st-prod">' + stTile(a, 's96') + '<div class="pi"><h1>' + esc(stName(a)) + '</h1>' +
      '<div class="ps">' + esc(a.publisher || '') + (a.publisher && stCat(a) ? ' · ' : '') + esc(stCat(a)) + '</div>' +
      '<div class="pa"><span class="st-price">' + esc(stPrice(a)) + '</span>' + buttons + '</div></div></div>' + note +
      '<div class="st-cols"><div class="l"><h3>' + esc(t('store_about', 'About this app')) + '</h3><p>' + esc(stDesc(a)) + '</p>' +
      (feats.length ? '<h3>' + esc(t('store_features', 'What it does')) + '</h3><ul class="st-feat">' + feats.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>' : '') +
      '</div><div class="r"><div class="st-facts">' + facts.map(function (f) { return '<div class="k">' + esc(f[0]) + '</div><div class="v">' + esc(f[1]) + '</div>'; }).join('') + '</div></div></div>';
  }

  function stRender() {
    stWin.querySelectorAll('.st-nav').forEach(function (b) {
      var on = b.dataset.st === ST.page || (ST.page === 'app' && b.dataset.st === 'apps');
      b.classList.toggle('on', on);
    });
    var body = $('st-body'), chip = $('st-chip');
    if (ST.state === 'loading' && !ST.data) { body.innerHTML = '<div class="st-empty">' + esc(t('ui_fx_loading', 'Loading…')) + '</div>'; chip.innerHTML = ''; return; }
    if (ST.state === 'error' || !ST.data) {
      body.innerHTML = '<div class="st-empty">' + esc(t('store_error', "Couldn't reach the Store.")) + '<br><br><button class="st-btn" data-act="retry">' + esc(t('ui_fx_retry', 'Try again')) + '</button></div>';
      chip.innerHTML = '';
      return;
    }
    var d = ST.data;
    chip.innerHTML = '<span>' + esc(t('store_your_job', 'Job')) + '</span><span class="pill">' + esc(d.job.label) + '</span>' +
      (d.funds != null ? '<span>' + esc(t('store_society', 'Society')) + ' <b>' + esc(stCur() + d.funds) + '</b></span>' : '');
    var scroll = body.scrollTop;
    body.innerHTML = ST.page === 'app' ? stProduct() : ST.page === 'apps' ? stApps() : ST.page === 'lib' ? stLib() : stHome();
    fillIcons(body);
    body.scrollTop = ST.page === 'app' ? 0 : scroll;
  }

  // Which of this job's apps are installed now: refreshes the desktop, start menu and taskbar.
  function stSyncDesktop() {
    if (!ST.data) return;
    var map = state.apps ? Object.assign({}, state.apps) : {};
    ST.data.apps.forEach(function (a) { map[a.id] = a.allowed && a.installed; });
    state.apps = map;
    applyApps();
  }

  function stLoad(keepMsg) {
    var tok = ++ST.tok;
    if (!ST.data) { ST.state = 'loading'; stRender(); }
    stApi('list').then(function (r) {
      if (tok !== ST.tok) return;
      if (r && r.ok) { ST.data = r; ST.state = 'ok'; stSyncDesktop(); } else { ST.state = 'error'; }
      if (!keepMsg) ST.msg = null;
      stRender();
    });
  }

  function stStart() { ST.page = 'home'; ST.app = null; ST.q = ''; ST.msg = null; ST.busy = false; $('st-q').value = ''; stLoad(); }

  function stGo(page, id) { ST.page = page; ST.app = id || null; ST.msg = null; stRender(); }

  function stReasonText(reason) {
    var m = { not_boss: 'notify_store_boss', not_for_job: 'notify_store_job', no_funds: 'notify_store_funds', no_bank: 'notify_store_bank' };
    return t(m[reason] || 'notify_error', 'Something went wrong. Try again.');
  }

  function stDo(kind, id) {
    var a = stFind(id);
    if (!a || ST.busy) return;
    ST.busy = true;
    ST.msg = null;
    stApi(kind, id).then(function (r) {
      ST.busy = false;
      if (r && r.ok) {
        var name = stName(a);
        ST.msg = { kind: 'ok', text: kind === 'install'
          ? fmt(t('store_done_install', '%s is now installed for everyone on %s.'), name, ST.data.job.label)
          : fmt(t('store_done_uninstall', '%s was removed for everyone on %s.'), name, ST.data.job.label) };
      } else {
        ST.msg = { kind: 'err', text: stReasonText(r && r.reason) };
      }
      stLoad(true);
    });
    stRender();
  }

  function stConfirm(kind, id) {
    var a = stFind(id);
    if (!a) return;
    var job = ST.data.job.label;
    if (kind === 'uninstall') {
      confirmDlg(t('store_uninstall', 'Uninstall'), fmt(t('store_uninstall_q', 'Remove %s for everyone on %s?'), stName(a), job), function () { stDo('uninstall', id); });
    } else if (a.price > 0 && !a.paid) {
      confirmDlg(fmt(t('store_buy', 'Buy %s'), stCur() + a.price), fmt(t('store_buy_q', 'Buy %s for %s? The cost comes out of the %s society account and everyone on the job gets the app.'), stName(a), stCur() + a.price, job), function () { stDo('install', id); });
    } else {
      stDo('install', id);
    }
  }

  stWin.addEventListener('click', function (e) {
    var nav = e.target.closest('[data-st]');
    if (nav) { stGo(nav.dataset.st); return; }
    var act = e.target.closest('[data-act]');
    if (act) {
      var k = act.dataset.act;
      if (k === 'back') stGo('apps');
      else if (k === 'retry') stLoad();
      else if (k === 'open') { openApp(act.dataset.id); }
      else if (k === 'install' || k === 'uninstall') stConfirm(k, act.dataset.id);
      return;
    }
    var card = e.target.closest('[data-app]');
    if (card) stGo('app', card.dataset.app);
  });
  $('st-q').addEventListener('input', function (e) {
    ST.q = e.target.value;
    if (ST.page === 'home' || ST.page === 'app') ST.page = ST.q.trim() ? 'apps' : ST.page;
    if (ST.data) stRender();
  });
  $('st-q').addEventListener('keydown', function (e) { e.stopPropagation(); });

  // ================================================================ windows setup
  defWin('mot', { el: motWin, icon: 'mot', titleKey: 'ui_service_mot', titleDef: 'MOT Testing Service', w: 1240, h: 820, onOpen: motReset });
  defWin('settings', { el: seWin, icon: 'settings', titleKey: 'ui_app_settings', titleDef: 'Settings', w: 1180, h: 780, onOpen: seStart });
  defWin('store', { el: stWin, icon: 'store', titleKey: 'ui_app_store', titleDef: 'Store', w: 1240, h: 800, onOpen: stStart });
  defWin('browser', { el: $('win-browser'), icon: 'brglobe', titleKey: 'ui_app_browser', titleDef: 'Scout', w: 1240, h: 800, onOpen: brStart });
  ICONS.calendar = calIconSvg();
  defWin('calendar', { el: calWin, icon: 'calendar', titleKey: 'ui_app_calendar', titleDef: 'Calendar', w: 1240, h: 800, onOpen: calStart });
  defWin('explorer', { el: exWin, icon: 'folder', titleKey: 'ui_app_explorer', titleDef: 'File Explorer', w: 1280, h: 740,
    onOpen: function () { if (appVisible('mot')) { EX.hist = ['root', 'mot', 'mot/all']; EX.idx = 2; } else { EX.hist = ['root']; EX.idx = 0; } EX.sel = {}; EX.renaming = null; EX.q = ''; $('ex-search').value = ''; FS.tried = false; FS.state = {}; renderExplorer(); if (state.certsState === 'idle') refreshCerts(); } });

  fillIcons();
  renderTaskbar();
  renderExplorer();
  applyApps();
  tick();

  // ================================================================ session control
  function resetSession() {
    closeAllWindows();
    Object.keys(EXT).forEach(function (k) { if (EXT[k].onReset) EXT[k].onReset(); });
    brReset();
    calCloseForm();
    setMenu(false);
    SE.info = null; SE.state = 'idle'; SE.notice = null;
    state.certs = null;
    state.certsState = 'idle';
    state.lastLookup = null;
    state.lastSubmit = null;
    certStore = {};
    EX.hist = ['root']; EX.idx = 0; EX.sel = {}; EX.anchor = null; EX.renaming = null; EX.q = '';
    closeDlg(); hideCtx();
    $('ex-search').value = '';
    document.querySelectorAll('.dicon.sel').forEach(function (x) { x.classList.remove('sel'); });
    renderExplorer();
  }

  function renderAll() {
    applyLocale();
    retitleAll();
    Object.keys(EXT).forEach(function (k) { if (EXT[k].onLocale) EXT[k].onLocale(); });
    renderTaskbar();
    renderExplorer();
    if (menuOpen) renderStart();
    tick();
  }

  // ================================================================ live monitor view
  // While someone uses the computer, the desktop draws itself to a small JPEG about once a second (html-to-image,
  // ui/vendor). Scout websites live in iframes the snapshot can't see into, so each visible site page is asked for
  // its own picture (as-browser's SDK answers 'snapshot') and it is painted over the iframe's spot. The client sends
  // the frame to the server, which passes it to players near this computer; they see it on the monitor.
  var MIR = { on: false, busy: false, t: null, cfg: {}, waiting: {}, seq: 0 };
  var MIR_PH = 'data:image/gif;base64,R0lGODlhAQABAIAAAMzMzAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==';
  function mirrorStart(cfg) {
    MIR.cfg = cfg || {};
    if (MIR.on) return;
    MIR.on = true;
    MIR.t = setTimeout(mirrorTick, 600);
  }
  function mirrorStop() { MIR.on = false; clearTimeout(MIR.t); MIR.waiting = {}; }
  function mirrorTick() {
    if (!MIR.on) return;
    MIR.t = setTimeout(mirrorTick, Math.max(400, MIR.cfg.interval || 1000));
    if (MIR.busy || !window.htmlToImage || !root.classList.contains('open')) return;
    MIR.busy = true;
    mirrorSnap().then(function (data) {
      if (data && MIR.on) postToClient('mirrorFrame', { data: data });
    }).catch(function () { /* skip this frame */ }).then(function () { MIR.busy = false; });
  }
  function mirrorSites(k) {
    var base = app.getBoundingClientRect(), sc = scaleFactor(), jobs = [];
    document.querySelectorAll('iframe.br-frame').forEach(function (f) {
      var r = f.getBoundingClientRect();
      if (!f.contentWindow || r.width < 4 || r.height < 4 || f.offsetParent === null) return;
      var box = { x: (r.left - base.left) / sc * k, y: (r.top - base.top) / sc * k, w: r.width / sc * k, h: r.height / sc * k };
      jobs.push(new Promise(function (resolve) {
        var id = 'm' + (++MIR.seq);
        var timer = setTimeout(function () { delete MIR.waiting[id]; resolve(null); }, 900);
        MIR.waiting[id] = function (data) {
          clearTimeout(timer);
          if (!data) return resolve(null);
          var img = new Image();
          img.onload = function () { resolve({ img: img, box: box }); };
          img.onerror = function () { resolve(null); };
          img.src = data;
        };
        try { f.contentWindow.postMessage({ __asb: 1, type: 'snapshot', id: id, w: Math.round(box.w) }, '*'); } catch (e) { resolve(null); }
      }));
    });
    return Promise.all(jobs);
  }
  function mirrorSnap() {
    var aw = app.offsetWidth || 1920, ah = app.offsetHeight || 1080;
    var W = Math.max(320, Math.min(1920, MIR.cfg.width || 960)), H = Math.round(W * ah / aw), k = W / aw;
    var desk = window.htmlToImage.toCanvas(app, {
      width: aw, height: ah, canvasWidth: W, canvasHeight: H, pixelRatio: 1,
      skipFonts: true, cacheBust: false, imagePlaceholder: MIR_PH,
      style: { transform: 'none', position: 'static', margin: '0', boxShadow: 'none' },
      // Only what is actually on screen: closed windows, hidden apps and menus are skipped (the page has
      // ~1000 elements, usually <100 visible, and that is what keeps a snapshot cheap).
      filter: function (n) { return n.nodeType !== 1 || (n.tagName !== 'IFRAME' && n.getClientRects().length > 0); },
    });
    return Promise.all([desk, mirrorSites(k)]).then(function (r) {
      var cv = r[0], ctx = cv.getContext('2d');
      r[1].forEach(function (s) { if (s) ctx.drawImage(s.img, s.box.x, s.box.y, s.box.w, s.box.h); });
      return cv.toDataURL('image/jpeg', MIR.cfg.quality || 0.6);
    });
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};

    if (d.action === 'setLocale') { state.strings = d.strings || {}; renderAll(); }
    if (d.action === 'apps') { state.apps = (d.apps && typeof d.apps === 'object') ? d.apps : null; applyApps(); if (wins.store && wins.store.open && typeof stLoad === 'function') stLoad(true); }
    if (d.action === 'setChecklist') { state.checklistSections = d.sections || []; }

    if (d.action === 'open') {
      state.rect = d.rect || null;
      state.user = d.user || '';
      state.canPrint = !!d.print || !!d.printer;
      state.printer = !!d.printer;
      state.browser = !!d.browser;
      state.calendar = !!d.calendar;
      if (d.calendar && typeof d.calendar === 'object') CAL.weekStart = d.calendar.weekStart === 0 ? 0 : 1;
      state.apps = (d.apps && typeof d.apps === 'object') ? d.apps : null;
      state.store = d.store !== false;
      state.internet = d.internet !== false;
      state.prefs = (d.prefs && typeof d.prefs === 'object') ? Object.assign({}, DEFAULT_PREFS, d.prefs) : null;
      if (d.prefs && typeof d.prefs === 'object') state.lockEnabled = d.prefs.lockShow !== false;
      calRefreshIcon();
      state.manageOthers = !!d.manageOthers;
      state.lockEnabled = d.lock !== false;
      state.lockPassword = !!d.lockPassword;
      root.classList.toggle('debug', !!d.debug);
      fit();
      root.classList.add('open');
      // d.resume: this player left this computer without shutting it down and nobody else has used it since,
      // so everything they had open is still here. d.locked: they locked it before leaving.
      if (d.mirror && !isDui) mirrorStart(d.mirror); else mirrorStop();
      // Phase 0.5: a machine nobody has ever set up, or one with no resumable session for this player,
      // shows the setup wizard / login screen instead of the desktop - checked before any resume/lock logic.
      if (d.needsSetup) {
        resetSession();
        showGateSetup();
      } else if (d.needsLogin) {
        resetSession();
        showGateLogin();
      } else if (d.resume) {
        applyPrefs();
        applyApps();
        if (d.locked) showLock(); else { $('lock').classList.add('hidden'); postToClient('sessionState', { state: 'active' }); }
      } else {
        resetSession();
        applyPrefs();
        applyApps();
        if (state.lockEnabled) showLock(); else { $('lock').classList.add('hidden'); signIn(); }
      }
    }

    if (d.action === 'close') {
      mirrorStop();
      root.classList.remove('open');
      state.rect = null;
      if (!d.keep) resetSession();   // keep = walked away without shutting down: leave the apps as they are
    }

    if (d.action === 'lookupResult') {
      state.busy = false;
      var result = d.result;
      if (!result || !result.found) return; // client script shows the notification
      state.lastLookup = result;
      renderOverview(result);
      motShow('overview');
    }

    if (d.action === 'submitResult') {
      state.busy = false;
      var res = d.result;
      if (!res || !res.ok) return;
      state.lastSubmit = res;
      renderResult(res);
      motShow('result');
      if (!isDui) refreshCerts(); // new certificate shows up in File Explorer
    }

    if (d.action === 'certActionResult') { refreshCerts(true); }

    if (d.action === 'certificates') {
      clearTimeout(state.certsTimer);
      var r = d.result;
      if (r && r.ok && r.items) { state.certs = r.items; state.certsState = 'ok'; }
      else { state.certs = null; state.certsState = 'error'; }
      renderExplorer();
      if (menuOpen) renderStart();
    }
  });

  // ================================================================ app hook for other files
  // ui/mechanic.js (and any later app) registers itself here instead of being wired into this file.
  //   LSOS.registerApp({ id, icon: '<svg…>', titleKey, titleDef, w, h, html, onOpen, onClose, onReset, onLocale })
  // The server decides who has the app (Config.Apps.<id> + the Store), exactly like the built-in ones.
  window.LSOS = {
    t: t, fmt: fmt, esc: esc, fmtPlate: fmtPlate, ic: ic, icSpan: icSpan, fillIcons: fillIcons, confirmDlg: confirmDlg,
    showDlg: showDlg, closeDlg: closeDlg, print: openPrintDialog, isDui: isDui, state: state,
    winOpen: function (id) { return !!(wins[id] && wins[id].open); },
    registerApp: function (o) {
      if (EXT[o.id] || isDui) return null;
      ICONS[o.id] = o.icon;
      var el = document.createElement('div');
      el.id = 'win-' + o.id;
      el.innerHTML = '<div class="win-body">' + o.html + '</div>';
      $('windows').appendChild(el);
      defWin(o.id, { el: el, icon: o.id, titleKey: o.titleKey, titleDef: o.titleDef, w: o.w || 1240, h: o.h || 760, onOpen: o.onOpen, onClose: o.onClose });
      EXT[o.id] = { icon: o.id, name: function () { return t(o.titleKey, o.titleDef); }, onReset: o.onReset, onLocale: o.onLocale };
      // not auto-pinned to the taskbar any more — it'll show while open, and the player can pin it
      // themselves (right-click the desktop icon or the open taskbar button > Pin to taskbar).
      var d = document.createElement('div');
      d.className = 'dicon hidden';
      d.dataset.app = o.id;
      d.innerHTML = '<span class="ic" data-ic="' + o.id + '"></span><span class="l"></span>';
      var lab = d.querySelector('.l');
      lab.textContent = t(o.titleKey, o.titleDef);
      lab.dataset.i18n = o.titleKey;
      $('desktop').insertBefore(d, $('desktop').querySelector('[data-app="explorer"]'));
      fillIcons();
      applyApps();
      return el;
    }
  };

  applyLocale();
})();
