/* Mechanic app for Los Santos OS: dashboard, job cards, quotes, invoices, customers, vehicle history, parts stock.
   Registers itself with LSOS.registerApp (see the end of app.js). Every server call goes through the 'mechanicApi'
   NUI callback (client/mechanic.lua -> server/mechanic.lua); the server does all the checking, this file only draws. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc, fmtPlate = S.fmtPlate;
  function T(key, def) { return S.t(key, def); }
  function F(key, def) {
    var a = Array.prototype.slice.call(arguments, 2), i = 0;
    return T(key, def).replace(/%s/g, function () { return a[i++]; });
  }
  function $(id) { return document.getElementById(id); }

  // ------------------------------------------------------------------ icons
  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#c2410c"/><path d="M16.2 5.6a4 4 0 0 0-4.9 5.2l-4.6 4.6a1.5 1.5 0 0 0 2.1 2.1l4.6-4.6a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.1-.6-.6-2.1z" fill="#fff"/></svg>';
  var NAV_ICONS = {
    dash: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
    jobs: '<path d="M8 4h8v3H8zM6 5.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-1"/><path d="M8 12l2 2 4-4M8 18h8"/>',
    quotes: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>',
    invoices: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    customers: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.6 2.6-5.6 6-5.6s6 2 6 5.6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.6c1.8.7 3 2.3 3 5.4"/>',
    vehicles: '<path d="M4 15l1.6-5A2 2 0 0 1 7.5 8.6h9a2 2 0 0 1 1.9 1.4L20 15v4h-2.4v-1.6H6.4V19H4z"/><circle cx="7.6" cy="14.2" r=".9"/><circle cx="16.4" cy="14.2" r=".9"/>',
    parts: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>'
  };
  function navSvg(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + NAV_ICONS[k] + '</svg>';
  }

  // ------------------------------------------------------------------ state
  var VIEWS = ['dash', 'jobs', 'quotes', 'invoices', 'customers', 'vehicles', 'parts'];
  var VIEW_NAMES = {
    dash: ['mx_nav_dash', 'Overview'], jobs: ['mx_nav_jobs', 'Job cards'], quotes: ['mx_nav_quotes', 'Quotes'],
    invoices: ['mx_nav_invoices', 'Invoices'], customers: ['mx_nav_customers', 'Customers'],
    vehicles: ['mx_nav_vehicles', 'Vehicles'], parts: ['mx_nav_parts', 'Parts stock']
  };

  var M;
  function freshState(keepCfg) {
    var cfg = keepCfg && M ? M.cfg : { currency: '£', vatRate: 0, labourRate: 60, categories: [], methods: { card: false, manual: true }, canDelete: false, me: '' };
    M = {
      view: 'dash', cfg: cfg, dash: null, dashState: 'idle', ready: false,
      jobs: { items: [], filter: 'active', mine: false, q: '', sel: null, det: null, state: 'idle', tok: 0 },
      quotes: { kind: 'quote', items: [], filter: 'open', q: '', sel: null, det: null, state: 'idle', tok: 0 },
      invoices: { kind: 'invoice', items: [], filter: 'open', q: '', sel: null, det: null, state: 'idle', tok: 0 },
      customers: { items: [], q: '', sel: null, det: null, state: 'idle', tok: 0 },
      vehicles: { items: [], q: '', plate: null, det: null, state: 'idle', tok: 0 },
      parts: { items: [], q: '', cat: '', low: false, value: 0, state: 'idle', tok: 0 },
      modal: null, busy: false, timers: {}
    };
  }
  freshState(false);

  // ------------------------------------------------------------------ server
  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/mechanicApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }

  var ERR = {
    not_authorised: ['mx_err_not_authorised', 'You are not allowed to do that.'],
    invalid: ['mx_err_invalid', 'Check the details and try again.'],
    invalid_line: ['mx_err_invalid_line', 'Every line needs a description and a quantity above zero.'],
    no_lines: ['mx_err_no_lines', 'Add at least one line.'],
    too_many_lines: ['mx_err_too_many_lines', 'That is too many lines for one document.'],
    not_found: ['mx_err_not_found', 'That no longer exists.'],
    locked: ['mx_err_locked', 'This document can no longer be changed.'],
    not_boss: ['mx_err_not_boss', 'Only the boss can do that.'],
    no_stock: ['mx_err_no_stock', 'Not enough stock.'],
    no_bank: ['mx_err_no_bank', 'No society bank is set up, so card payments are not available.'],
    no_customer: ['mx_err_no_customer', 'This customer is not linked to a character, so they cannot be contacted or charged.'],
    customer_offline: ['mx_err_customer_offline', 'The customer is not online.'],
    too_far: ['mx_err_too_far', 'They are too far away.'],
    no_player: ['mx_err_no_player', 'There is no player with that ID.'],
    declined: ['mx_err_declined', 'The customer declined the payment.'],
    no_answer: ['mx_err_no_answer', 'The customer did not answer in time.'],
    no_funds: ['mx_err_no_funds', 'The customer cannot afford it.'],
    method_off: ['mx_err_method_off', 'That payment method is switched off.'],
    limit: ['mx_err_limit', 'The limit has been reached.'],
    empty: ['mx_err_empty', 'Enter a registration number.'],
    network: ['mx_err_network', 'Could not reach the server.'],
    error: ['mx_err_error', 'Something went wrong. Try again.']
  };
  function errText(res) {
    var r = res && res.reason, e = ERR[r] || ERR.error;
    var s = T(e[0], e[1]);
    if (r === 'no_stock' && res.part) s += ' (' + res.part + ')';
    return s;
  }

  // ------------------------------------------------------------------ formatting
  function cur() { return M.cfg.currency || '£'; }
  function money(n) {
    n = Math.round(+n || 0);
    return (n < 0 ? '-' : '') + cur() + Math.abs(n).toLocaleString('en-GB');
  }
  function qtyStr(q) { q = +q || 0; return q === Math.floor(q) ? String(q) : String(Math.round(q * 100) / 100); }
  function loc() { return T('ui_date_locale', 'en-GB'); }
  function dateOf(ts) {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function dateTime(ts) {
    if (!ts) return '—';
    var d = new Date(ts * 1000);
    return d.toLocaleDateString(loc(), { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
      d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
  }
  function ago(ts) {
    if (!ts) return '—';
    var s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 90) return T('mx_just_now', 'Just now');
    if (s < 3600) return F('mx_min_ago', '%s min ago', Math.round(s / 60));
    if (s < 86400) return F('mx_hours_ago', '%s h ago', Math.round(s / 3600));
    if (s < 86400 * 14) return F('mx_days_ago', '%s d ago', Math.round(s / 86400));
    return dateOf(ts);
  }
  function plateHtml(p) { return p ? '<span class="mx-plate">' + esc(fmtPlate(p)) + '</span>' : ''; }
  function cleanPlateJs(p) { return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }

  var JOB_STATUS = {
    open: ['mx_st_open', 'Open', 'blue'], in_progress: ['mx_st_in_progress', 'In progress', 'purple'],
    waiting_parts: ['mx_st_waiting_parts', 'Waiting for parts', 'orange'], ready: ['mx_st_ready', 'Ready', 'green'],
    completed: ['mx_st_completed', 'Completed', 'grey'], cancelled: ['mx_st_cancelled', 'Cancelled', 'red']
  };
  var DOC_STATUS = {
    draft: ['mx_ds_draft', 'Draft', 'grey'], sent: ['mx_ds_sent', 'Sent', 'blue'], accepted: ['mx_ds_accepted', 'Accepted', 'green'],
    declined: ['mx_ds_declined', 'Declined', 'red'], invoiced: ['mx_ds_invoiced', 'Invoiced', 'purple'],
    issued: ['mx_ds_issued', 'Issued', 'blue'], paid: ['mx_ds_paid', 'Paid', 'green'], void: ['mx_ds_void', 'Void', 'grey'],
    overdue: ['mx_ds_overdue', 'Overdue', 'red']
  };
  function pill(def) { return '<span class="mx-pill c-' + def[2] + '">' + esc(T(def[0], def[1])) + '</span>'; }
  function jobPill(s) { return pill(JOB_STATUS[s] || ['x', s, 'grey']); }
  function docPill(doc) {
    var s = doc.overdue ? 'overdue' : doc.status;
    return pill(DOC_STATUS[s] || ['x', s, 'grey']);
  }

  function spinner() { return '<div class="mx-empty"><div class="mx-spin"></div></div>'; }
  function empty(text, sub) { return '<div class="mx-empty"><b>' + esc(text) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>'; }
  function btn(label, a, cls, extra) {
    return '<button class="mx-btn' + (cls ? ' ' + cls : '') + '" data-a="' + a + '"' + (extra || '') + '>' + esc(label) + '</button>';
  }
  function kv(k, v) { return '<div class="mx-kv"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; }
  function txt(v) { return v ? esc(v) : '<i class="mx-none">—</i>'; }

  // ------------------------------------------------------------------ toast + modal
  function toast(msg, bad) {
    var el = $('mx-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'mx-toast on' + (bad ? ' bad' : '');
    clearTimeout(M.timers.toast);
    M.timers.toast = setTimeout(function () { el.className = 'mx-toast'; }, 3600);
  }
  function fail(res) { toast(errText(res), true); }

  function openModal(o) {
    // o = { title, html, wide, buttons: [{ label, a, cls }] }
    var foot = (o.buttons || []).map(function (b) {
      return '<button class="mx-btn ' + (b.cls || '') + '" data-a="' + b.a + '"' + (b.extra || '') + '>' + esc(b.label) + '</button>';
    }).join('');
    $('mx-modal').innerHTML = '<div class="mx-box' + (o.wide ? ' wide' : '') + '"><div class="mx-box-h">' + esc(o.title) +
      '<button class="mx-x" data-a="modal.close" title="' + esc(T('mx_close', 'Close')) + '">×</button></div><div class="mx-box-b" id="mx-box-b">' + o.html +
      '</div>' + (foot ? '<div class="mx-box-f">' + foot + '</div>' : '') + '</div>';
    $('mx-modal').classList.remove('hidden');
    M.modal = o.id || 'modal';
    var first = $('mx-modal').querySelector('[data-focus]');
    if (first) setTimeout(function () { first.focus(); }, 30);
  }
  function closeModal() {
    $('mx-modal').classList.add('hidden');
    $('mx-modal').innerHTML = '';
    M.modal = null;
    M.ed = null;
  }
  function fv(id) { var el = $(id); return el ? el.value : ''; }
  function setBusy(on) {
    M.busy = on;
    var b = document.querySelectorAll('#mx-modal .mx-box-f .mx-btn');
    for (var i = 0; i < b.length; i++) b[i].disabled = on;
  }

  // ------------------------------------------------------------------ shell
  var HTML = '<div class="mx" id="mx">' +
    '<div class="mx-rail" id="mx-rail"></div>' +
    '<div class="mx-main"><div class="mx-head" id="mx-head"></div><div class="mx-body" id="mx-body"></div></div>' +
    '<div class="mx-modal hidden" id="mx-modal"></div><div class="mx-toast" id="mx-toast"></div></div>';

  function renderRail() {
    var d = M.dash || {}, c = d.counts || {};
    var active = (c.open || 0) + (c.in_progress || 0) + (c.waiting_parts || 0) + (c.ready || 0);
    var badge = { jobs: active, invoices: d.overdue, parts: d.lowStock };
    var html = VIEWS.map(function (v) {
      var b = badge[v] ? '<span class="bd' + (v === 'jobs' ? ' soft' : '') + '">' + badge[v] + '</span>' : '';
      return '<button class="mx-nav' + (M.view === v ? ' on' : '') + '" data-a="nav" data-v="' + v + '">' + navSvg(v) +
        '<span class="nl">' + esc(T(VIEW_NAMES[v][0], VIEW_NAMES[v][1])) + '</span>' + b + '</button>';
    }).join('');
    $('mx-rail').innerHTML = '<div class="mx-brand"><span class="ic">' + ICON_APP + '</span><b>' + esc(T('mx_app_name', 'Mechanic')) + '</b></div>' + html;
  }

  var JOB_FILTERS = [['active', 'mx_f_active', 'Active'], ['open', 'mx_st_open', 'Open'], ['in_progress', 'mx_st_in_progress', 'In progress'],
    ['waiting_parts', 'mx_st_waiting_parts', 'Waiting for parts'], ['ready', 'mx_st_ready', 'Ready'], ['completed', 'mx_st_completed', 'Completed'],
    ['all', 'mx_f_all', 'All']];
  var QUOTE_FILTERS = [['open', 'mx_f_open', 'Open'], ['draft', 'mx_ds_draft', 'Draft'], ['sent', 'mx_ds_sent', 'Sent'], ['accepted', 'mx_ds_accepted', 'Accepted'],
    ['declined', 'mx_ds_declined', 'Declined'], ['invoiced', 'mx_ds_invoiced', 'Invoiced'], ['all', 'mx_f_all', 'All']];
  var INVOICE_FILTERS = [['open', 'mx_f_open', 'Open'], ['draft', 'mx_ds_draft', 'Draft'], ['issued', 'mx_ds_issued', 'Issued'], ['overdue', 'mx_ds_overdue', 'Overdue'],
    ['paid', 'mx_ds_paid', 'Paid'], ['void', 'mx_ds_void', 'Void'], ['all', 'mx_f_all', 'All']];

  function chips(list, cur) {
    return '<div class="mx-chips">' + list.map(function (f) {
      return '<button class="mx-chip' + (cur === f[0] ? ' on' : '') + '" data-a="f.set" data-f="' + f[0] + '">' + esc(T(f[1], f[2])) + '</button>';
    }).join('') + '</div>';
  }
  function searchBox(val, ph) {
    return '<div class="mx-search"><input type="text" id="mx-q" maxlength="40" autocomplete="off" value="' + esc(val) + '" placeholder="' + esc(ph) + '"></div>';
  }

  function renderHead() {
    var v = M.view, h = '<div class="mx-title">' + esc(T(VIEW_NAMES[v][0], VIEW_NAMES[v][1])) + '</div><div class="mx-tools">';
    if (v === 'dash') {
      h += '<span class="mx-hi">' + esc(F('mx_hi', 'Signed in as %s', M.cfg.me || '')) + '</span>' + btn(T('mx_refresh', 'Refresh'), 'refresh');
    } else if (v === 'jobs') {
      h += chips(JOB_FILTERS, M.jobs.filter) +
        '<label class="mx-chk"><input type="checkbox" data-a="jobs.mine"' + (M.jobs.mine ? ' checked' : '') + '> ' + esc(T('mx_mine', 'Mine')) + '</label>' +
        searchBox(M.jobs.q, T('mx_search_jobs', 'Search job cards')) + btn(T('mx_new_job', 'New job card'), 'jobs.new', 'primary');
    } else if (v === 'quotes') {
      h += chips(QUOTE_FILTERS, M.quotes.filter) + searchBox(M.quotes.q, T('mx_search_docs', 'Search plate or customer')) + btn(T('mx_new_quote', 'New quote'), 'docs.new', 'primary', ' data-kind="quote"');
    } else if (v === 'invoices') {
      h += chips(INVOICE_FILTERS, M.invoices.filter) + searchBox(M.invoices.q, T('mx_search_docs', 'Search plate or customer')) + btn(T('mx_new_invoice', 'New invoice'), 'docs.new', 'primary', ' data-kind="invoice"');
    } else if (v === 'customers') {
      h += searchBox(M.customers.q, T('mx_search_customers', 'Search name, phone or email')) +
        btn(T('mx_add_nearby', 'Add person nearby'), 'cust.nearby') + btn(T('mx_new_customer', 'New customer'), 'cust.new', 'primary');
    } else if (v === 'vehicles') {
      h += '<div class="mx-search plate"><input type="text" id="mx-q" maxlength="12" autocomplete="off" value="' + esc(M.vehicles.q) + '" placeholder="' + esc(T('mx_search_plate', 'Registration, e.g. LX19 KTP')) + '"></div>' +
        btn(T('mx_lookup', 'Look up'), 'veh.lookup', 'primary');
    } else if (v === 'parts') {
      var cats = (M.cfg.categories || []).slice();
      M.parts.items.forEach(function (p) { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
      h += '<select id="mx-cat" data-a="parts.cat"><option value="">' + esc(T('mx_all_categories', 'All categories')) + '</option>' +
        cats.map(function (c) { return '<option' + (M.parts.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
        '<label class="mx-chk"><input type="checkbox" data-a="parts.low"' + (M.parts.low ? ' checked' : '') + '> ' + esc(T('mx_low_only', 'Low stock only')) + '</label>' +
        searchBox(M.parts.q, T('mx_search_parts', 'Search parts')) + btn(T('mx_new_part', 'Add part'), 'parts.new', 'primary');
    }
    $('mx-head').innerHTML = h + '</div>';
  }

  function renderBody() {
    var v = M.view;
    if (v === 'dash') { $('mx-body').innerHTML = '<div class="mx-dash" id="mx-dash"></div>'; renderDash(); }
    else if (v === 'parts') { $('mx-body').innerHTML = '<div class="mx-full" id="mx-list"></div>'; renderList(); }
    else { $('mx-body').innerHTML = '<div class="mx-split"><div class="mx-list" id="mx-list"></div><div class="mx-det" id="mx-det"></div></div>'; renderList(); renderDetail(); }
  }

  function setView(v, keepLoaded) {
    closeModal();
    M.view = v;
    renderRail(); renderHead(); renderBody();
    if (v === 'dash') loadDash();
    else if (!keepLoaded) loadList();
  }

  function loadList() {
    var v = M.view;
    if (v === 'jobs') loadJobs();
    else if (v === 'quotes' || v === 'invoices') loadDocs(v);
    else if (v === 'customers') loadCustomers();
    else if (v === 'vehicles') loadVehicles();
    else if (v === 'parts') loadParts();
  }
  function renderList() {
    var v = M.view;
    if (v === 'jobs') listJobs();
    else if (v === 'quotes' || v === 'invoices') listDocs(v);
    else if (v === 'customers') listCustomers();
    else if (v === 'vehicles') listVehicles();
    else if (v === 'parts') listParts();
  }
  function renderDetail() {
    var v = M.view;
    if (!$('mx-det')) return;
    if (v === 'jobs') detailJob();
    else if (v === 'quotes' || v === 'invoices') detailDoc(v);
    else if (v === 'customers') detailCustomer();
    else if (v === 'vehicles') detailVehicle();
  }

  // ------------------------------------------------------------------ dashboard
  function loadDash() {
    M.dashState = M.dash ? 'ok' : 'loading';
    renderDash();
    api('overview').then(function (r) {
      if (!r.ok) { M.dashState = 'error'; renderDash(); return; }
      M.dash = r; M.dashState = 'ok';
      M.cfg = { currency: r.currency, vatRate: r.vatRate, labourRate: r.labourRate, categories: r.categories || [], methods: r.methods || {}, canDelete: !!r.canDelete, me: r.me };
      renderRail();
      if (M.view === 'dash') { renderHead(); renderDash(); }
    });
  }

  function tile(cls, big, label, a, extra) {
    return '<button class="mx-tile ' + cls + '" data-a="' + a + '"' + (extra || '') + '><div class="big">' + big + '</div><div class="lb">' + esc(label) + '</div></button>';
  }

  function renderDash() {
    var el = $('mx-dash');
    if (!el) return;
    if (M.dashState === 'loading' || !M.dash) { el.innerHTML = M.dashState === 'error' ? empty(T('mx_err_error', 'Something went wrong. Try again.')) : spinner(); return; }
    var d = M.dash, c = d.counts || {};
    var active = (c.open || 0) + (c.in_progress || 0) + (c.waiting_parts || 0) + (c.ready || 0);
    var html = '<div class="mx-tiles">' +
      tile('t-blue', active, T('mx_t_active', 'Active job cards'), 'dash.go', ' data-v="jobs" data-f="active"') +
      tile('t-orange', c.waiting_parts || 0, T('mx_t_waiting', 'Waiting for parts'), 'dash.go', ' data-v="jobs" data-f="waiting_parts"') +
      tile('t-green', c.ready || 0, T('mx_t_ready', 'Ready for collection'), 'dash.go', ' data-v="jobs" data-f="ready"') +
      tile('t-blue', money(d.unpaidTotal) + '<small>' + esc(F('mx_t_unpaid_n', '%s invoices', d.unpaidCount)) + '</small>', T('mx_t_unpaid', 'Unpaid invoices'), 'dash.go', ' data-v="invoices" data-f="issued"') +
      tile(d.overdue ? 't-red' : 't-grey', d.overdue || 0, T('mx_t_overdue', 'Overdue invoices'), 'dash.go', ' data-v="invoices" data-f="overdue"') +
      tile('t-purple', d.quotesWaiting || 0, T('mx_t_quotes', 'Quotes awaiting reply'), 'dash.go', ' data-v="quotes" data-f="sent"') +
      tile('t-green', money(d.paidWeek), T('mx_t_week', 'Paid in the last 7 days'), 'dash.go', ' data-v="invoices" data-f="paid"') +
      tile(d.lowStock ? 't-red' : 't-grey', d.lowStock || 0, T('mx_t_low', 'Parts low on stock'), 'dash.go', ' data-v="parts" data-f="low"') +
      '</div>';

    html += '<div class="mx-panels"><div class="mx-panel"><div class="mx-ph">' + esc(T('mx_p_active', 'Active job cards')) + '</div>';
    if (!d.recent.length) html += empty(T('mx_no_active', 'Nothing in the workshop right now.'));
    else html += d.recent.map(function (j) {
      return '<div class="mx-row slim" data-a="dash.job" data-id="' + j.id + '"><div class="r1"><span class="ref">' + esc(j.ref) + '</span>' + plateHtml(j.plate) + jobPill(j.status) + '</div>' +
        '<div class="r2">' + esc(j.title) + '</div><div class="r3">' + esc([j.vehicle, j.customer].filter(Boolean).join(' · ')) + '<span class="when">' + ago(j.updatedAt) + '</span></div></div>';
    }).join('');
    html += '</div><div class="mx-panel"><div class="mx-ph">' + esc(T('mx_p_bookings', "Today's MOT bookings")) + '</div>';
    if (!d.bookings.length) html += empty(T('mx_no_bookings', 'No MOT bookings today.'));
    else html += d.bookings.map(function (b) {
      return '<div class="mx-row slim static"><div class="r1"><span class="ref">' + esc(b.time || '') + (b.endTime ? '–' + esc(b.endTime) : '') + '</span><span>' + esc(b.title || '') + '</span>' +
        (b.status === 'done' ? pill(['x', T('mx_booking_done', 'Done'), 'green']) : '') + '</div><div class="r3">' + esc(b.who || '') + '</div></div>';
    }).join('');
    html += '</div></div>';
    el.innerHTML = html;
  }

  // ------------------------------------------------------------------ job cards
  function loadJobs() {
    var s = M.jobs, tok = ++s.tok;
    s.state = 'loading'; listJobs();
    api('jobs.list', { status: s.filter, mine: s.mine, q: s.q }).then(function (r) {
      if (tok !== s.tok) return;
      if (r.ok) { s.items = r.items || []; s.state = 'ok'; } else { s.items = []; s.state = 'error'; fail(r); }
      if (M.view === 'jobs') listJobs();
    });
  }
  function listJobs() {
    var el = $('mx-list'), s = M.jobs;
    if (!el) return;
    if (s.state === 'loading' && !s.items.length) { el.innerHTML = spinner(); return; }
    if (!s.items.length) { el.innerHTML = empty(T('mx_no_jobs', 'No job cards here.'), T('mx_no_jobs_sub', 'Create one with “New job card”.')); return; }
    el.innerHTML = s.items.map(function (j) {
      return '<div class="mx-row' + (s.sel === j.id ? ' sel' : '') + '" data-a="jobs.open" data-id="' + j.id + '">' +
        '<div class="r1"><span class="ref">' + esc(j.ref) + '</span>' + plateHtml(j.plate) + jobPill(j.status) + '</div>' +
        '<div class="r2">' + esc(j.title) + '</div>' +
        '<div class="r3">' + esc([j.vehicle, j.customer, j.assigned].filter(Boolean).join(' · ')) + '<span class="when">' + ago(j.updatedAt) + '</span></div></div>';
    }).join('');
  }

  function openJob(id, noList) {
    var s = M.jobs;
    s.sel = id; s.det = null;
    if (!noList) listJobs();
    detailJob();
    api('jobs.get', { id: id }).then(function (r) {
      if (s.sel !== id) return;
      if (!r.ok) { fail(r); s.sel = null; s.det = null; }
      else s.det = r;
      if (M.view === 'jobs') { detailJob(); listJobs(); }
    });
  }

  function detailJob() {
    var el = $('mx-det'), s = M.jobs;
    if (!el) return;
    if (!s.sel) { el.innerHTML = empty(T('mx_pick_job', 'Select a job card')); return; }
    if (!s.det) { el.innerHTML = spinner(); return; }
    var j = s.det.job, docs = s.det.docs || [], cust = s.det.customer;
    var steps = ['open', 'in_progress', 'waiting_parts', 'ready', 'completed'].map(function (st) {
      var d = JOB_STATUS[st];
      return '<button class="mx-step c-' + d[2] + (j.status === st ? ' on' : '') + '" data-a="jobs.status" data-s="' + st + '">' + esc(T(d[0], d[1])) + '</button>';
    }).join('') + (j.status === 'cancelled' ? '' : '<button class="mx-step c-red" data-a="jobs.status" data-s="cancelled">' + esc(T('mx_st_cancelled', 'Cancelled')) + '</button>');
    var tasks = (j.tasks || []).map(function (tk, i) {
      return '<div class="mx-task' + (tk.done ? ' done' : '') + '"><label><input type="checkbox" data-a="jobs.task" data-i="' + i + '"' + (tk.done ? ' checked' : '') + '> <span>' + esc(tk.t) + '</span></label>' +
        '<button class="mx-mini" data-a="jobs.taskdel" data-i="' + i + '" title="' + esc(T('mx_remove', 'Remove')) + '">×</button></div>';
    }).join('');
    var docRows = docs.length ? docs.map(function (d) {
      return '<div class="mx-link-row" data-a="doc.jump" data-id="' + d.id + '" data-kind="' + d.kind + '"><span class="ref">' + esc(d.ref) + '</span><span>' + esc(money(d.total)) + '</span>' + docPill(d) + '</div>';
    }).join('') : '<div class="mx-none">' + esc(T('mx_no_docs', 'No quotes or invoices yet.')) + '</div>';

    el.innerHTML = '<div class="mx-dpane">' +
      '<div class="mx-dh"><div><div class="mx-ref">' + esc(j.ref) + '</div><h2>' + esc(j.title) + '</h2></div>' + jobPill(j.status) + '</div>' +
      '<div class="mx-steps">' + steps + '</div>' +
      '<div class="mx-grid">' +
        kv(T('mx_vehicle', 'Vehicle'), plateHtml(j.plate) + ' ' + txt(j.vehicle)) +
        kv(T('mx_mileage', 'Mileage'), j.mileage != null ? esc(Number(j.mileage).toLocaleString('en-GB')) : txt('')) +
        kv(T('mx_customer', 'Customer'), cust ? '<a class="mx-a" data-a="go.customer" data-id="' + cust.id + '">' + esc(cust.name) + '</a>' + (cust.phone ? ' <span class="mx-sub">' + esc(cust.phone) + '</span>' : '') : txt('')) +
        kv(T('mx_assigned', 'Assigned to'), txt(j.assigned)) +
        kv(T('mx_created', 'Created'), esc(dateTime(j.createdAt)) + (j.createdBy ? ' <span class="mx-sub">' + esc(j.createdBy) + '</span>' : '')) +
        kv(j.completedAt ? T('mx_completed', 'Completed') : T('mx_updated', 'Updated'), esc(dateTime(j.completedAt || j.updatedAt))) +
      '</div>' +
      (j.description ? '<div class="mx-sec">' + esc(T('mx_description', 'Description')) + '</div><div class="mx-pre">' + esc(j.description) + '</div>' : '') +
      '<div class="mx-sec">' + esc(T('mx_tasks', 'Tasks')) + '</div><div class="mx-tasks">' + tasks +
        '<div class="mx-addtask"><input type="text" id="mx-newtask" maxlength="80" placeholder="' + esc(T('mx_add_task', 'Add a task and press Enter')) + '"></div></div>' +
      '<div class="mx-sec">' + esc(T('mx_documents', 'Quotes and invoices')) + '</div><div class="mx-links">' + docRows + '</div>' +
      '<div class="mx-actions">' + btn(T('mx_edit', 'Edit'), 'jobs.edit') + btn(T('mx_new_quote', 'New quote'), 'jobs.quote') + btn(T('mx_new_invoice', 'New invoice'), 'jobs.invoice') +
        btn(T('mx_vehicle_history', 'Vehicle history'), 'go.vehicle', '', ' data-plate="' + esc(j.plate) + '"') +
        (M.cfg.canDelete ? btn(T('mx_delete', 'Delete'), 'jobs.delete', 'danger') : '') + '</div></div>';
  }

  function saveTasks() {
    var s = M.jobs, j = s.det && s.det.job;
    if (!j) return;
    api('jobs.tasks', { id: j.id, tasks: j.tasks }).then(function (r) { if (!r.ok) fail(r); });
  }

  // ------------------------------------------------------------------ shared form pieces
  function custOptions(list, selected) {
    return '<option value="">' + esc(T('mx_no_customer', '— no customer —')) + '</option>' + list.map(function (c) {
      return '<option value="' + c.id + '"' + (String(selected) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + (c.phone ? ' · ' + esc(c.phone) : '') + '</option>';
    }).join('');
  }
  function newCustRow(prefix) {
    return '<div class="mx-frow hidden" id="' + prefix + '-nc"><label></label><div class="mx-inl">' +
      '<input type="text" id="' + prefix + '-ncn" maxlength="80" placeholder="' + esc(T('mx_cust_name', 'Name')) + '">' +
      '<input type="text" id="' + prefix + '-ncp" maxlength="30" placeholder="' + esc(T('mx_cust_phone', 'Phone')) + '">' +
      '<button class="mx-btn" data-a="f.addcust" data-p="' + prefix + '">' + esc(T('mx_add', 'Add')) + '</button></div></div>';
  }
  function addCustomerInline(prefix, selId) {
    var name = fv(prefix + '-ncn').replace(/\s+/g, ' ').trim();
    if (!name) { toast(T('mx_err_invalid', 'Check the details and try again.'), true); return; }
    api('customers.save', { name: name, phone: fv(prefix + '-ncp') }).then(function (r) {
      if (!r.ok) return fail(r);
      api('customers.list', {}).then(function (l) {
        if (M.modal === null) return;
        if (M.ed) M.ed.customers = l.items || [];
        $(selId).innerHTML = custOptions(l.items || [], r.id);
        $(prefix + '-nc').classList.add('hidden');
        $(prefix + '-ncn').value = ''; $(prefix + '-ncp').value = '';
      });
    });
  }
  function lookupInfoHtml(r) {
    if (!r) return '';
    var out = '';
    if (r.flags && r.flags.length) {
      out += '<div class="mx-warn">' + r.flags.map(function (f) {
        return esc(T('mx_flag_' + f.flag, String(f.flag).replace(/_/g, ' '))) + (f.note ? ' (' + esc(f.note) + ')' : '');
      }).join(' · ') + '</div>';
    }
    var bits = [];
    if (r.found) bits.push(esc(T('mx_registered', 'Registered vehicle')) + (r.model ? ': <b>' + esc(r.model) + '</b>' : ''));
    else bits.push(esc(T('mx_not_registered', 'Not found in the vehicle register')));
    if (r.mot) bits.push(esc(T('mx_mot', 'MOT')) + ': ' + esc(motLabel(r.mot.status)));
    if (r.visits) bits.push(esc(F('mx_visits', '%s previous visits', r.visits)));
    if (r.owner && r.owner.name) bits.push(esc(T('mx_owner', 'Owner')) + ': ' + esc(r.owner.name) + ' <a class="mx-a" data-a="f.addowner">' + esc(T('mx_add_as_customer', 'Add as customer')) + '</a>');
    return out + '<div class="mx-info">' + bits.join(' · ') + '</div>';
  }
  function motLabel(s) {
    var m = { valid: ['ui_status_valid', 'Valid'], expired: ['ui_status_expired', 'Expired'], failed_last_test: ['ui_status_failed', 'Failed last test'], never_tested: ['ui_status_never', 'Never tested'] }[s];
    return m ? T(m[0], m[1]) : (s || '—');
  }

  // ------------------------------------------------------------------ job form
  function openJobForm(preset) {
    preset = preset || {};
    var j = preset.job || null;
    M.ed = { type: 'job', id: j ? j.id : null, preset: preset, customers: [], staff: [], lookup: null };
    openModal({ id: 'job', title: j ? T('mx_edit_job', 'Edit job card') : T('mx_new_job', 'New job card'), wide: true, html: spinner(),
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_save', 'Save'), a: 'jf.save', cls: 'primary' }] });
    Promise.all([api('customers.list', {}), api('staff.list', {})]).then(function (res) {
      if (M.modal !== 'job') return;
      var ed = M.ed, cs = res[0], st = res[1];
      ed.customers = cs.ok ? cs.items : []; ed.staff = st.ok ? st.staff : [];
      var v = j || preset;
      var assignedName = j ? j.assigned : '';
      $('mx-box-b').innerHTML = '<div class="mx-form">' +
        '<div class="mx-frow"><label>' + esc(T('mx_registration', 'Registration')) + '</label><div class="mx-inl"><input type="text" id="jf-plate" class="plate" maxlength="12" value="' + esc(fmtPlate(v.plate || '')) + '" data-focus>' +
          '<button class="mx-btn" data-a="jf.lookup">' + esc(T('mx_lookup', 'Look up')) + '</button></div></div>' +
        '<div id="jf-lookup">' + (preset.lookup ? lookupInfoHtml(preset.lookup) : '') + '</div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_vehicle', 'Vehicle')) + '</label><input type="text" id="jf-vehicle" maxlength="80" value="' + esc(v.vehicle || '') + '"></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_mileage', 'Mileage')) + '</label><input type="number" id="jf-mileage" min="0" step="1" value="' + esc(v.mileage != null ? v.mileage : '') + '"></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_customer', 'Customer')) + '</label><div class="mx-inl"><select id="jf-cust">' + custOptions(ed.customers, v.customerId) + '</select>' +
          '<button class="mx-btn" data-a="f.newcust" data-p="jf">' + esc(T('mx_new', 'New')) + '</button></div></div>' + newCustRow('jf') +
        '<div class="mx-frow"><label>' + esc(T('mx_job_title', 'Work required')) + '</label><input type="text" id="jf-title" maxlength="100" value="' + esc(v.title || '') + '" placeholder="' + esc(T('mx_job_title_ph', 'e.g. Front brakes squealing')) + '"></div>' +
        '<div class="mx-frow top"><label>' + esc(T('mx_description', 'Description')) + '</label><textarea id="jf-desc" maxlength="600">' + esc(v.description || '') + '</textarea></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_assigned', 'Assigned to')) + '</label><select id="jf-assign"><option value="">' + esc(T('mx_unassigned', '— unassigned —')) + '</option>' +
          ed.staff.map(function (s) { return '<option value="' + esc(s.cid) + '"' + (assignedName && assignedName === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
        (j ? '' : '<div class="mx-frow top"><label>' + esc(T('mx_tasks', 'Tasks')) + '</label><textarea id="jf-tasks" maxlength="800" placeholder="' + esc(T('mx_tasks_ph', 'One task per line (optional)')) + '"></textarea></div>') +
        '</div>';
      if (!j && preset.plate && !preset.lookup) jfLookup(true);
      var f = $('jf-plate'); if (f && !preset.plate) f.focus();
    });
  }

  function jfLookup(silent) {
    var plate = cleanPlateJs(fv('jf-plate'));
    if (!plate) { if (!silent) toast(T('mx_err_empty', 'Enter a registration number.'), true); return; }
    api('vehicles.lookup', { plate: plate }).then(function (r) {
      if (M.modal !== 'job') return;
      if (!r.ok) { if (!silent) fail(r); return; }
      M.ed.lookup = r;
      $('jf-lookup').innerHTML = lookupInfoHtml(r);
      if (!fv('jf-vehicle')) $('jf-vehicle').value = r.model || r.lastVehicle || '';
      if (r.mileage != null && !fv('jf-mileage')) $('jf-mileage').value = r.mileage;
      if (r.customer && !fv('jf-cust')) {
        var sel = $('jf-cust');
        if (!sel.querySelector('option[value="' + r.customer.id + '"]')) { sel.insertAdjacentHTML('beforeend', '<option value="' + r.customer.id + '">' + esc(r.customer.name) + '</option>'); }
        sel.value = String(r.customer.id);
      }
    });
  }

  function jfSave() {
    var plate = cleanPlateJs(fv('jf-plate')), title = fv('jf-title').replace(/\s+/g, ' ').trim();
    if (!plate || !title) { toast(T('mx_err_job_fields', 'Enter a registration and what work is needed.'), true); return; }
    var tasks = fv('jf-tasks').split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) { return { t: l.slice(0, 80), done: false }; });
    var existing = M.ed.id ? M.jobs.det && M.jobs.det.job : null;
    var payload = { id: M.ed.id, plate: plate, vehicle: fv('jf-vehicle'), mileage: fv('jf-mileage'), customerId: fv('jf-cust') ? +fv('jf-cust') : null,
      title: title, description: fv('jf-desc'), assignedCid: fv('jf-assign') || null,
      tasks: existing ? existing.tasks : tasks };
    setBusy(true);
    api('jobs.save', payload).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      closeModal();
      toast(T('mx_saved', 'Saved.'));
      M.jobs.sel = r.id;
      if (M.view !== 'jobs') { M.jobs.filter = 'active'; M.jobs.q = ''; setView('jobs'); } else loadJobs();
      openJob(r.id, true);
    });
  }

  // ------------------------------------------------------------------ quotes and invoices: list + document
  function loadDocs(view) {
    var s = M[view], tok = ++s.tok;
    s.state = 'loading'; listDocs(view);
    api('docs.list', { kind: s.kind, status: s.filter, q: s.q }).then(function (r) {
      if (tok !== s.tok) return;
      if (r.ok) { s.items = r.items || []; s.state = 'ok'; } else { s.items = []; s.state = 'error'; fail(r); }
      if (M.view === view) listDocs(view);
    });
  }
  function listDocs(view) {
    var el = $('mx-list'), s = M[view];
    if (!el) return;
    if (s.state === 'loading' && !s.items.length) { el.innerHTML = spinner(); return; }
    if (!s.items.length) { el.innerHTML = empty(view === 'quotes' ? T('mx_no_quotes', 'No quotes here.') : T('mx_no_invoices', 'No invoices here.')); return; }
    el.innerHTML = s.items.map(function (d) {
      return '<div class="mx-row' + (s.sel === d.id ? ' sel' : '') + '" data-a="doc.open" data-id="' + d.id + '">' +
        '<div class="r1"><span class="ref">' + esc(d.ref) + '</span>' + plateHtml(d.plate) + docPill(d) + '<span class="amt">' + esc(money(d.total)) + '</span></div>' +
        '<div class="r3">' + esc([d.customer, d.vehicle].filter(Boolean).join(' · ') || '—') + '<span class="when">' +
          esc(d.kind === 'invoice' && d.status === 'issued' && d.dueAt ? F('mx_due', 'Due %s', dateOf(d.dueAt)) : ago(d.updatedAt)) + '</span></div></div>';
    }).join('');
  }

  function openDoc(view, id, noList) {
    var s = M[view];
    s.sel = id; s.det = null;
    if (!noList) listDocs(view);
    detailDoc(view);
    api('docs.get', { id: id }).then(function (r) {
      if (s.sel !== id) return;
      if (!r.ok) { fail(r); s.sel = null; s.det = null; } else s.det = r;
      if (M.view === view) { detailDoc(view); listDocs(view); }
    });
  }

  function paperHtml(det) {
    var d = det.doc, b = det.business || {}, c = det.customer, isInv = d.kind === 'invoice';
    var stamp = '';
    if (d.status === 'paid') stamp = '<div class="mx-stamp green">' + esc(T('mx_stamp_paid', 'PAID')) + '</div>';
    else if (d.status === 'void') stamp = '<div class="mx-stamp grey">' + esc(T('mx_stamp_void', 'VOID')) + '</div>';
    else if (d.overdue) stamp = '<div class="mx-stamp red">' + esc(T('mx_stamp_overdue', 'OVERDUE')) + '</div>';
    else if (d.status === 'declined') stamp = '<div class="mx-stamp red">' + esc(T('mx_stamp_declined', 'DECLINED')) + '</div>';
    var rows = (det.lines || []).map(function (l) {
      return '<tr><td>' + esc(l.description) + '<span class="lk">' + esc(T('mx_lk_' + l.kind, l.kind)) + '</span></td><td class="n">' + esc(qtyStr(l.qty)) + '</td><td class="n">' + esc(money(l.unitPrice)) + '</td><td class="n">' + esc(money(l.total)) + '</td></tr>';
    }).join('');
    var dates = [[T('mx_created', 'Created'), dateOf(d.createdAt)]];
    if (isInv && d.issuedAt) dates.push([T('mx_issued', 'Issued'), dateOf(d.issuedAt)]);
    if (isInv && d.dueAt && d.status !== 'draft') dates.push([T('mx_due_date', 'Due'), dateOf(d.dueAt)]);
    if (d.paidAt) dates.push([T('mx_paid_on', 'Paid'), dateOf(d.paidAt) + (d.paidMethod ? ' (' + (d.paidMethod === 'card' ? T('mx_pm_card', 'card') : T('mx_pm_manual', 'in person')) + ')' : '')]);
    return '<div class="mx-paper">' + stamp +
      '<div class="pp-head"><div class="pp-biz"><b>' + esc(b.name || '') + '</b>' + (b.address ? '<div>' + esc(b.address) + '</div>' : '') + (b.phone ? '<div>' + esc(b.phone) + '</div>' : '') +
        (b.vatNumber ? '<div>' + esc(T('mx_vat_no', 'VAT no.')) + ' ' + esc(b.vatNumber) + '</div>' : '') + '</div>' +
        '<div class="pp-title">' + esc(isInv ? T('mx_invoice', 'INVOICE') : T('mx_quote', 'QUOTE')) + '<span>' + esc(d.ref) + '</span>' + docPill(d) + '</div></div>' +
      '<div class="pp-meta"><div><div class="k">' + esc(isInv ? T('mx_bill_to', 'Bill to') : T('mx_quote_for', 'Quote for')) + '</div><div class="v">' +
        (c ? '<a class="mx-a" data-a="go.customer" data-id="' + c.id + '">' + esc(c.name) + '</a>' + (c.phone ? '<div class="mx-sub">' + esc(c.phone) + '</div>' : '') : esc(d.customer || '—')) + '</div></div>' +
        '<div><div class="k">' + esc(T('mx_vehicle', 'Vehicle')) + '</div><div class="v">' + (d.plate ? '<a class="mx-a" data-a="go.vehicle" data-plate="' + esc(d.plate) + '">' + plateHtml(d.plate) + '</a> ' : '') + esc(d.vehicle || '') +
          (d.jobRef ? '<div class="mx-sub">' + esc(T('mx_job_card', 'Job card')) + ' <a class="mx-a" data-a="doc.job" data-id="' + d.jobCardId + '">' + esc(d.jobRef) + '</a></div>' : '') + '</div></div>' +
        '<div><div class="k">' + esc(T('mx_dates', 'Dates')) + '</div><div class="v">' + dates.map(function (x) { return '<div>' + esc(x[0]) + ': ' + esc(x[1]) + '</div>'; }).join('') + '</div></div></div>' +
      '<table class="pp-lines"><thead><tr><th>' + esc(T('mx_col_desc', 'Description')) + '</th><th class="n">' + esc(T('mx_col_qty', 'Qty')) + '</th><th class="n">' + esc(T('mx_col_unit', 'Unit price')) + '</th><th class="n">' + esc(T('mx_col_total', 'Total')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="pp-totals">' + (d.vatRate > 0 ? '<div><span>' + esc(T('mx_subtotal', 'Subtotal')) + '</span><span>' + esc(money(d.subtotal)) + '</span></div><div><span>' + esc(F('mx_vat_pct', 'VAT (%s%)', d.vatRate)) + '</span><span>' + esc(money(d.vat)) + '</span></div>' : '') +
        '<div class="tot"><span>' + esc(T('mx_total', 'Total')) + '</span><span>' + esc(money(d.total)) + '</span></div></div>' +
      (d.notes ? '<div class="pp-notes"><div class="k">' + esc(T('mx_notes', 'Notes')) + '</div>' + esc(d.notes) + '</div>' : '') + '</div>';
  }

  function docActions(det) {
    var d = det.doc, out = [];
    if (d.kind === 'quote') {
      if (d.status === 'draft') out.push(btn(T('mx_edit', 'Edit'), 'doc.edit'), btn(T('mx_mark_sent', 'Mark as sent'), 'doc.status', 'primary', ' data-s="sent"'));
      else if (d.status === 'sent') out.push(btn(T('mx_edit', 'Edit'), 'doc.edit'), btn(T('mx_mark_accepted', 'Customer accepted'), 'doc.status', 'primary', ' data-s="accepted"'), btn(T('mx_mark_declined', 'Customer declined'), 'doc.status', '', ' data-s="declined"'));
      else if (d.status === 'accepted') out.push(btn(T('mx_edit', 'Edit'), 'doc.edit'));
      else if (d.status === 'declined') out.push(btn(T('mx_reopen', 'Send again'), 'doc.status', '', ' data-s="sent"'));
      if (d.status === 'sent' || d.status === 'accepted') out.push(btn(T('mx_to_invoice', 'Convert to invoice'), 'doc.convert', d.status === 'accepted' ? 'primary' : ''));
    } else {
      if (d.status === 'draft') out.push(btn(T('mx_edit', 'Edit'), 'doc.edit'), btn(T('mx_issue', 'Issue invoice'), 'doc.issue', 'primary'));
      if (d.status === 'issued') out.push(btn(T('mx_take_payment', 'Take payment'), 'doc.pay', 'primary'), btn(T('mx_void', 'Void invoice'), 'doc.void', 'danger'));
    }
    if (d.status !== 'draft' && det.canMail && d.status !== 'invoiced') out.push(btn(T('mx_email', 'Email to customer'), 'doc.email'));
    if (d.status === 'invoiced') out.push('<span class="mx-sub">' + esc(T('mx_invoiced_note', 'This quote has been turned into an invoice.')) + '</span>');
    var removable = d.status === 'draft' || (M.cfg.canDelete && (d.status === 'declined' || d.status === 'void'));
    if (removable) out.push(btn(T('mx_delete', 'Delete'), 'doc.delete', 'danger'));
    return '<div class="mx-actions">' + out.join('') + '</div>';
  }

  function detailDoc(view) {
    var el = $('mx-det'), s = M[view];
    if (!el) return;
    if (!s.sel) { el.innerHTML = empty(view === 'quotes' ? T('mx_pick_quote', 'Select a quote') : T('mx_pick_invoice', 'Select an invoice')); return; }
    if (!s.det) { el.innerHTML = spinner(); return; }
    el.innerHTML = '<div class="mx-dpane">' + docActions(s.det) + paperHtml(s.det) + '</div>';
  }

  function refreshDoc(view, id) {
    var s = M[view];
    loadDocs(view);
    openDoc(view, id || s.sel, true);
  }
  function curDoc() { var s = M[M.view]; return s && s.det ? s.det : null; }

  function docAct(name, extra) {
    var view = M.view, det = curDoc();
    if (!det) return;
    var id = det.doc.id;
    api(name, Object.assign({ id: id }, extra || {})).then(function (r) {
      if (!r.ok) return fail(r);
      if (name === 'docs.convert') {
        toast(T('mx_converted', 'Invoice created from the quote.'));
        M.invoices.filter = 'open'; M.invoices.q = '';
        setView('invoices'); openDoc('invoices', r.id, true);
        return;
      }
      if (name === 'docs.delete') { M[view].sel = null; M[view].det = null; loadDocs(view); detailDoc(view); toast(T('mx_deleted', 'Deleted.')); return; }
      if (name === 'docs.email') toast(T('mx_emailed', 'Sent to the customer.')); else toast(T('mx_saved', 'Saved.'));
      refreshDoc(view, id);
    });
  }

  // ------------------------------------------------------------------ quote / invoice editor
  function round2(n) { return Math.round((+n || 0) * 100) / 100; }
  function lineTotal(l) { return Math.floor(round2(l.kind === 'part' && l.partId ? Math.floor(+l.qty || 0) : l.qty) * (Math.max(0, Math.floor(+l.unitPrice || 0))) + 0.5); }
  function edTotals() {
    var sub = 0;
    M.ed.lines.forEach(function (l) { sub += lineTotal(l); });
    var rate = M.ed.vatRate;
    var vat = Math.floor(sub * rate / 100 + 0.5);
    return { sub: sub, vat: vat, total: sub + vat };
  }
  function renderEdTotals() {
    var t = edTotals(), el = $('de-totals');
    if (!el) return;
    el.innerHTML = (M.ed.vatRate > 0 ? '<div><span>' + esc(T('mx_subtotal', 'Subtotal')) + '</span><span>' + esc(money(t.sub)) + '</span></div><div><span>' +
      esc(F('mx_vat_pct', 'VAT (%s%)', M.ed.vatRate)) + '</span><span>' + esc(money(t.vat)) + '</span></div>' : '') +
      '<div class="tot"><span>' + esc(T('mx_total', 'Total')) + '</span><span>' + esc(money(t.total)) + '</span></div>';
    M.ed.lines.forEach(function (l, i) { var c = $('de-lt-' + i); if (c) c.textContent = money(lineTotal(l)); });
  }
  function renderEdLines() {
    var el = $('de-lines');
    if (!el) return;
    if (!M.ed.lines.length) { el.innerHTML = '<tr><td colspan="5" class="mx-none">' + esc(T('mx_no_lines_yet', 'No lines yet. Add labour, a part or something else below.')) + '</td></tr>'; renderEdTotals(); return; }
    el.innerHTML = M.ed.lines.map(function (l, i) {
      var whole = l.kind === 'part' && l.partId;
      return '<tr><td><span class="lk">' + esc(T('mx_lk_' + l.kind, l.kind)) + '</span><input type="text" data-li="' + i + '" data-lf="description" maxlength="120" value="' + esc(l.description) + '"></td>' +
        '<td class="n"><input type="number" data-li="' + i + '" data-lf="qty" min="' + (whole ? 1 : 0.25) + '" step="' + (whole ? 1 : 0.25) + '" value="' + esc(l.qty) + '"></td>' +
        '<td class="n"><input type="number" data-li="' + i + '" data-lf="unitPrice" min="0" step="1" value="' + esc(l.unitPrice) + '"></td>' +
        '<td class="n" id="de-lt-' + i + '">' + esc(money(lineTotal(l))) + '</td>' +
        '<td><button class="mx-mini" data-a="de.rm" data-i="' + i + '" title="' + esc(T('mx_remove', 'Remove')) + '">×</button></td></tr>';
    }).join('');
    renderEdTotals();
  }

  function openDocEditor(o) {
    // o = { kind, det (existing), job (job card), plate, vehicle, customerId }
    var det = o.det || null, d = det ? det.doc : null;
    var kind = d ? d.kind : o.kind;
    M.ed = { type: 'doc', id: d ? d.id : null, kind: kind, vatRate: d ? +d.vatRate || 0 : +M.cfg.vatRate || 0, customers: [], parts: null,
      lines: det ? det.lines.map(function (l) { return { kind: l.kind, description: l.description, qty: l.qty, unitPrice: l.unitPrice, partId: l.partId || null }; }) : [],
      jobCardId: d ? d.jobCardId : (o.job ? o.job.id : null), jobRef: d ? d.jobRef : (o.job ? o.job.ref : null) };
    var title = d ? (kind === 'invoice' ? T('mx_edit_invoice', 'Edit invoice') + ' ' + d.ref : T('mx_edit_quote', 'Edit quote') + ' ' + d.ref) : (kind === 'invoice' ? T('mx_new_invoice', 'New invoice') : T('mx_new_quote', 'New quote'));
    openModal({ id: 'doc', title: title, wide: true, html: spinner(),
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_save', 'Save'), a: 'de.save', cls: 'primary' }] });
    Promise.all([api('customers.list', {}), api('parts.list', {})]).then(function (res) {
      if (M.modal !== 'doc') return;
      var ed = M.ed, cs = res[0], ps = res[1];
      ed.customers = cs.ok ? cs.items : []; ed.parts = ps.ok ? ps.items : [];
      var v = d ? { plate: d.plate, vehicle: d.vehicle, customerId: d.customerId, notes: d.notes } : {
        plate: o.job ? o.job.plate : o.plate, vehicle: o.job ? o.job.vehicle : o.vehicle,
        customerId: o.job ? o.job.customerId : o.customerId, notes: '' };
      $('mx-box-b').innerHTML = '<div class="mx-form">' +
        (ed.jobRef ? '<div class="mx-frow"><label>' + esc(T('mx_job_card', 'Job card')) + '</label><div><span class="ref">' + esc(ed.jobRef) + '</span></div></div>' : '') +
        '<div class="mx-frow"><label>' + esc(T('mx_customer', 'Customer')) + '</label><div class="mx-inl"><select id="de-cust">' + custOptions(ed.customers, v.customerId) + '</select>' +
          '<button class="mx-btn" data-a="f.newcust" data-p="de">' + esc(T('mx_new', 'New')) + '</button></div></div>' + newCustRow('de') +
        '<div class="mx-frow"><label>' + esc(T('mx_registration', 'Registration')) + '</label><input type="text" id="de-plate" class="plate" maxlength="12" value="' + esc(fmtPlate(v.plate || '')) + '"></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_vehicle', 'Vehicle')) + '</label><input type="text" id="de-vehicle" maxlength="80" value="' + esc(v.vehicle || '') + '"></div>' +
        '</div>' +
        '<table class="mx-edlines"><thead><tr><th>' + esc(T('mx_col_desc', 'Description')) + '</th><th class="n">' + esc(T('mx_col_qty', 'Qty')) + '</th><th class="n">' + esc(T('mx_col_unit', 'Unit price')) +
          '</th><th class="n">' + esc(T('mx_col_total', 'Total')) + '</th><th></th></tr></thead><tbody id="de-lines"></tbody></table>' +
        '<div class="mx-addbar"><button class="mx-btn" data-a="de.addlabour">+ ' + esc(T('mx_add_labour', 'Labour')) + '</button>' +
          '<span class="mx-inl"><select id="de-part"><option value="">' + esc(T('mx_pick_part', 'Choose a part from stock…')) + '</option>' +
          ed.parts.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + esc(F('mx_in_stock', '%s in stock', p.qty)) + ' · ' + esc(money(p.price)) + '</option>'; }).join('') + '</select>' +
          '<button class="mx-btn" data-a="de.addpart">+ ' + esc(T('mx_add_part', 'Part')) + '</button></span>' +
          '<button class="mx-btn" data-a="de.addother">+ ' + esc(T('mx_add_other', 'Other')) + '</button></div>' +
        '<div class="pp-totals ed" id="de-totals"></div>' +
        '<div class="mx-form"><div class="mx-frow top"><label>' + esc(T('mx_notes', 'Notes')) + '</label><textarea id="de-notes" maxlength="600" placeholder="' + esc(T('mx_notes_ph', 'Shown on the document (optional)')) + '">' + esc(v.notes || '') + '</textarea></div></div>';
      renderEdLines();
    });
  }

  function edAdd(l) { M.ed.lines.push(l); renderEdLines(); var el = $('de-lines'); if (el && el.parentNode.parentNode) el.parentNode.parentNode.scrollTop = 1e6; }

  function deSave() {
    var ed = M.ed;
    var payload = { id: ed.id, kind: ed.kind, customerId: fv('de-cust') ? +fv('de-cust') : null, jobCardId: ed.jobCardId, plate: cleanPlateJs(fv('de-plate')),
      vehicle: fv('de-vehicle'), notes: fv('de-notes'),
      lines: ed.lines.map(function (l) { return { kind: l.kind, description: String(l.description || '').trim(), qty: +l.qty, unitPrice: Math.max(0, Math.floor(+l.unitPrice || 0)), partId: l.partId || null }; }) };
    setBusy(true);
    api('docs.save', payload).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      var view = ed.kind === 'invoice' ? 'invoices' : 'quotes';
      closeModal();
      toast(T('mx_saved', 'Saved.'));
      if (M.view !== view) { M[view].filter = 'open'; M[view].q = ''; setView(view, false); } else loadDocs(view);
      openDoc(view, r.id, true);
    });
  }

  // ------------------------------------------------------------------ payment
  function openPay() {
    var det = curDoc();
    if (!det) return;
    var d = det.doc, cardOk = !!(det.canCard && M.cfg.methods.card), manualOk = M.cfg.methods.manual !== false;
    var html = '<div class="mx-payamt">' + esc(money(d.total)) + '<span>' + esc(d.ref) + '</span></div>' +
      '<div class="mx-paychoice"><b>' + esc(T('mx_pay_card', 'Card payment')) + '</b><p>' +
        esc(cardOk ? T('mx_pay_card_help', 'The customer is asked to accept on their own screen. The money goes to the garage account.') :
          T('mx_pay_card_off', 'Needs the customer linked to a character, online and nearby, and a society bank.')) + '</p>' +
        '<button class="mx-btn primary" data-a="pay.card"' + (cardOk ? '' : ' disabled') + '>' + esc(T('mx_pay_card_go', 'Ask customer to pay')) + '</button></div>' +
      '<div class="mx-paychoice"><b>' + esc(T('mx_pay_manual', 'Paid in person')) + '</b><p>' + esc(T('mx_pay_manual_help', 'Marks the invoice as paid. Use this when you have already been paid in cash or by another method.')) + '</p>' +
        '<button class="mx-btn" data-a="pay.manual"' + (manualOk ? '' : ' disabled') + '>' + esc(T('mx_pay_manual_go', 'Mark as paid')) + '</button></div>' +
      '<div class="mx-payst" id="mx-payst"></div>';
    openModal({ id: 'pay', title: T('mx_take_payment', 'Take payment'), html: html, buttons: [{ label: T('mx_close', 'Close'), a: 'modal.close' }] });
  }
  function doPay(method) {
    var det = curDoc();
    if (!det || M.busy) return;
    var id = det.doc.id, view = M.view;
    setBusy(true);
    var st = $('mx-payst'), pb = document.querySelectorAll('#mx-modal .mx-paychoice .mx-btn');
    for (var i = 0; i < pb.length; i++) pb[i].disabled = true;
    if (st) st.textContent = method === 'card' ? T('mx_pay_waiting', 'Waiting for the customer to accept…') : '';
    api('docs.pay', { id: id, method: method }).then(function (r) {
      setBusy(false);
      if (M.modal === 'pay') {
        if (r.ok) closeModal();
        else { for (var j = 0; j < pb.length; j++) pb[j].disabled = false; if (st) st.textContent = ''; }
      }
      if (!r.ok) return fail(r);
      toast(T('mx_paid_toast', 'Payment recorded.'));
      if (M.view === view || view === 'invoices') { if (M.view === 'invoices') refreshDoc('invoices', id); }
      M.dash = null;
      renderRail();
    });
  }

  // ------------------------------------------------------------------ customers
  function loadCustomers() {
    var s = M.customers, tok = ++s.tok;
    s.state = 'loading'; listCustomers();
    api('customers.list', { q: s.q }).then(function (r) {
      if (tok !== s.tok) return;
      if (r.ok) { s.items = r.items || []; s.state = 'ok'; } else { s.items = []; s.state = 'error'; fail(r); }
      if (M.view === 'customers') listCustomers();
    });
  }
  function listCustomers() {
    var el = $('mx-list'), s = M.customers;
    if (!el) return;
    if (s.state === 'loading' && !s.items.length) { el.innerHTML = spinner(); return; }
    if (!s.items.length) { el.innerHTML = empty(T('mx_no_customers', 'No customers yet.'), T('mx_no_customers_sub', 'Add one with “New customer”, or add the person standing next to you.')); return; }
    el.innerHTML = s.items.map(function (c) {
      return '<div class="mx-row' + (s.sel === c.id ? ' sel' : '') + '" data-a="cust.open" data-id="' + c.id + '"><div class="r1"><b>' + esc(c.name) + '</b>' +
        (c.linked ? pill(['x', T('mx_linked', 'Linked'), 'green']) : '') + (c.owed ? '<span class="amt owed">' + esc(money(c.owed)) + '</span>' : '') + '</div>' +
        '<div class="r3">' + esc([c.phone, c.email].filter(Boolean).join(' · ') || '—') + '<span class="when">' + esc(F('mx_n_jobs', '%s jobs', c.jobs || 0)) + '</span></div></div>';
    }).join('');
  }
  function openCustomer(id, noList) {
    var s = M.customers;
    s.sel = id; s.det = null;
    if (!noList) listCustomers();
    detailCustomer();
    api('customers.get', { id: id }).then(function (r) {
      if (s.sel !== id) return;
      if (!r.ok) { fail(r); s.sel = null; s.det = null; } else s.det = r;
      if (M.view === 'customers') detailCustomer();
    });
  }
  function detailCustomer() {
    var el = $('mx-det'), s = M.customers;
    if (!el) return;
    if (!s.sel) { el.innerHTML = empty(T('mx_pick_customer', 'Select a customer')); return; }
    if (!s.det) { el.innerHTML = spinner(); return; }
    var d = s.det, c = d.customer;
    var vehicles = (d.vehicles || []).map(function (v) {
      return '<div class="mx-link-row" data-a="go.vehicle" data-plate="' + esc(v.plate) + '">' + plateHtml(v.plate) + '<span>' + esc(v.vehicle || '') + '</span><span class="mx-sub">' + ago(v.last) + '</span></div>';
    }).join('') || '<div class="mx-none">' + esc(T('mx_no_vehicles', 'No vehicles yet.')) + '</div>';
    var jobs = (d.jobs || []).map(function (j) {
      return '<div class="mx-link-row" data-a="go.job" data-id="' + j.id + '"><span class="ref">' + esc(j.ref) + '</span>' + plateHtml(j.plate) + '<span>' + esc(j.title) + '</span>' + jobPill(j.status) + '</div>';
    }).join('') || '<div class="mx-none">' + esc(T('mx_no_jobs', 'No job cards here.')) + '</div>';
    var docs = (d.docs || []).map(function (x) {
      return '<div class="mx-link-row" data-a="doc.jump" data-id="' + x.id + '" data-kind="' + x.kind + '"><span class="ref">' + esc(x.ref) + '</span><span>' + esc(money(x.total)) + '</span>' + docPill(x) + '</div>';
    }).join('') || '<div class="mx-none">' + esc(T('mx_no_docs', 'No quotes or invoices yet.')) + '</div>';
    el.innerHTML = '<div class="mx-dpane"><div class="mx-dh"><div><h2>' + esc(c.name) + '</h2></div>' + (c.linked ? pill(['x', T('mx_linked', 'Linked'), 'green']) : '') + '</div>' +
      '<div class="mx-grid">' + kv(T('mx_cust_phone', 'Phone'), txt(c.phone)) + kv(T('mx_cust_email', 'Email'), txt(c.email)) +
        kv(T('mx_paid_total', 'Total paid'), esc(money(d.spent))) + kv(T('mx_owes', 'Owes'), d.owed ? '<b class="mx-owed">' + esc(money(d.owed)) + '</b>' : txt('')) +
        kv(T('mx_customer_since', 'Customer since'), esc(dateOf(c.createdAt))) + '</div>' +
      (c.notes ? '<div class="mx-sec">' + esc(T('mx_notes', 'Notes')) + '</div><div class="mx-pre">' + esc(c.notes) + '</div>' : '') +
      (c.linked ? '' : '<div class="mx-info">' + esc(T('mx_not_linked_help', 'Not linked to a character: cannot be emailed or charged by card. Use “Add person nearby” to link.')) + '</div>') +
      '<div class="mx-sec">' + esc(T('mx_vehicles', 'Vehicles')) + '</div><div class="mx-links">' + vehicles + '</div>' +
      '<div class="mx-sec">' + esc(T('mx_nav_jobs', 'Job cards')) + '</div><div class="mx-links">' + jobs + '</div>' +
      '<div class="mx-sec">' + esc(T('mx_documents', 'Quotes and invoices')) + '</div><div class="mx-links">' + docs + '</div>' +
      '<div class="mx-actions">' + btn(T('mx_edit', 'Edit'), 'cust.edit') + btn(T('mx_new_job', 'New job card'), 'cust.job', 'primary') +
        (M.cfg.canDelete ? btn(T('mx_delete', 'Delete'), 'cust.delete', 'danger') : '') + '</div></div>';
  }
  function openCustomerForm(c) {
    M.ed = { type: 'cust', id: c ? c.id : null };
    openModal({ id: 'cust', title: c ? T('mx_edit_customer', 'Edit customer') : T('mx_new_customer', 'New customer'),
      html: '<div class="mx-form"><div class="mx-frow"><label>' + esc(T('mx_cust_name', 'Name')) + '</label><input type="text" id="cf-name" maxlength="80" value="' + esc(c ? c.name : '') + '" data-focus></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_cust_phone', 'Phone')) + '</label><input type="text" id="cf-phone" maxlength="30" value="' + esc(c && c.phone || '') + '"></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_cust_email', 'Email')) + '</label><input type="text" id="cf-email" maxlength="120" value="' + esc(c && c.email || '') + '"></div>' +
        '<div class="mx-frow top"><label>' + esc(T('mx_notes', 'Notes')) + '</label><textarea id="cf-notes" maxlength="300">' + esc(c && c.notes || '') + '</textarea></div></div>',
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_save', 'Save'), a: 'cf.save', cls: 'primary' }] });
  }
  function cfSave() {
    var id = M.ed.id, name = fv('cf-name').replace(/\s+/g, ' ').trim();
    if (!name) { toast(T('mx_err_invalid', 'Check the details and try again.'), true); return; }
    setBusy(true);
    api('customers.save', { id: id, name: name, phone: fv('cf-phone'), email: fv('cf-email'), notes: fv('cf-notes') }).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      closeModal(); toast(T('mx_saved', 'Saved.'));
      if (M.view !== 'customers') setView('customers'); else loadCustomers();
      openCustomer(r.id, true);
    });
  }
  function openNearby() {
    M.ed = { type: 'nearby' };
    openModal({ id: 'nearby', title: T('mx_add_nearby', 'Add person nearby'),
      html: '<div class="mx-form"><p class="mx-help">' + esc(T('mx_nearby_help', 'Ask the person for their player ID (shown in their pause menu). They must be close to you. Linking lets you email invoices and take card payments.')) + '</p>' +
        '<div class="mx-frow"><label>' + esc(T('mx_player_id', 'Player ID')) + '</label><input type="number" id="nb-id" min="1" max="65535" step="1" data-focus></div></div>',
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_add', 'Add'), a: 'nb.go', cls: 'primary' }] });
  }
  function nbGo() {
    var sid = parseInt(fv('nb-id'), 10);
    if (!sid || sid < 1) { toast(T('mx_err_no_player', 'There is no player with that ID.'), true); return; }
    setBusy(true);
    api('customers.fromPlayer', { serverId: sid }).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      closeModal(); toast(T('mx_customer_added', 'Customer added.'));
      M.customers.q = '';
      if (M.view !== 'customers') setView('customers'); else { renderHead(); loadCustomers(); }
      openCustomer(r.id, true);
    });
  }

  // ------------------------------------------------------------------ vehicles
  function loadVehicles() {
    var s = M.vehicles, tok = ++s.tok;
    s.state = 'loading'; listVehicles();
    api('vehicles.recent').then(function (r) {
      if (tok !== s.tok) return;
      if (r.ok) { s.items = r.items || []; s.state = 'ok'; } else { s.items = []; s.state = 'error'; fail(r); }
      if (M.view === 'vehicles') listVehicles();
    });
  }
  function listVehicles() {
    var el = $('mx-list'), s = M.vehicles;
    if (!el) return;
    if (s.state === 'loading' && !s.items.length) { el.innerHTML = spinner(); return; }
    var q = cleanPlateJs(s.q);
    var items = q ? s.items.filter(function (v) { return String(v.plate).indexOf(q) >= 0; }) : s.items;
    if (!items.length) { el.innerHTML = empty(T('mx_no_vehicles_seen', 'No vehicles yet.'), T('mx_no_vehicles_sub', 'Type a registration above and press Look up to check any vehicle.')); return; }
    el.innerHTML = items.map(function (v) {
      return '<div class="mx-row' + (s.plate === v.plate ? ' sel' : '') + '" data-a="veh.open" data-plate="' + esc(v.plate) + '"><div class="r1">' + plateHtml(v.plate) + '<span>' + esc(v.vehicle || '') + '</span></div>' +
        '<div class="r3">' + esc(F('mx_n_visits', '%s visits', v.visits)) + '<span class="when">' + ago(v.last) + '</span></div></div>';
    }).join('');
  }
  function openVehicle(plate, noList) {
    var s = M.vehicles;
    s.plate = plate; s.det = null;
    if (!noList) listVehicles();
    detailVehicle();
    api('vehicles.history', { plate: plate }).then(function (r) {
      if (s.plate !== plate) return;
      if (!r.ok) { fail(r); s.plate = null; s.det = null; } else s.det = r;
      if (M.view === 'vehicles') detailVehicle();
    });
  }
  function detailVehicle() {
    var el = $('mx-det'), s = M.vehicles;
    if (!el) return;
    if (!s.plate) { el.innerHTML = empty(T('mx_pick_vehicle', 'Select a vehicle or look one up')); return; }
    if (!s.det) { el.innerHTML = spinner(); return; }
    var d = s.det, info = d.info || {};
    var flags = (info.flags || []).length ? '<div class="mx-warn">' + info.flags.map(function (f) {
      return esc(T('mx_flag_' + f.flag, String(f.flag).replace(/_/g, ' '))) + (f.note ? ' (' + esc(f.note) + ')' : '');
    }).join(' · ') + '</div>' : '';
    var tl = (d.timeline || []).map(function (e) {
      var ic = { job: 'jobs', quote: 'quotes', invoice: 'invoices', mot: 'vehicles' }[e.kind] || 'jobs';
      var attrs = e.kind === 'job' ? ' data-a="go.job" data-id="' + e.id + '"' : (e.kind === 'quote' || e.kind === 'invoice') ? ' data-a="doc.jump" data-id="' + e.id + '" data-kind="' + e.kind + '"' : '';
      var title, tag;
      if (e.kind === 'mot') { title = T('mx_tl_mot', 'MOT test') + ' — ' + (e.status === 'passed' ? T('mx_tl_pass', 'Pass') : T('mx_tl_fail', 'Fail')); tag = pill(['x', e.status === 'passed' ? T('mx_tl_pass', 'Pass') : T('mx_tl_fail', 'Fail'), e.status === 'passed' ? 'green' : 'red']); }
      else if (e.kind === 'job') { title = e.ref + ' — ' + e.title; tag = jobPill(e.status); }
      else { title = e.ref + (e.total != null ? ' · ' + money(e.total) : ''); tag = docPill({ status: e.status }); }
      return '<div class="mx-tl' + (attrs ? ' click' : '') + '"' + attrs + '><span class="dot k-' + e.kind + '"></span><div class="tb"><div class="t1">' + esc(title) + ' ' + tag + '</div>' +
        '<div class="t2">' + esc(dateOf(e.ts)) + (e.mileage != null && e.mileage >= 0 ? ' · ' + esc(Number(e.mileage).toLocaleString('en-GB')) + ' ' + esc(e.unit || T('mx_miles', 'miles')) : '') +
        (e.who ? ' · ' + esc(e.who) : '') + (e.sub ? ' · ' + esc(e.sub) : '') + '</div></div></div>';
    }).join('') || '<div class="mx-none">' + esc(T('mx_no_history', 'Nothing recorded for this vehicle yet.')) + '</div>';
    var bits = [];
    if (info.mot) bits.push(kv(T('mx_mot', 'MOT'), esc(motLabel(info.mot.status))));
    if (info.mileage != null && info.mileage >= 0) bits.push(kv(T('mx_mileage', 'Mileage'), esc(Number(info.mileage).toLocaleString('en-GB')) + ' ' + esc(info.unit || '')));
    bits.push(kv(T('mx_visits_label', 'Visits'), esc(String(info.visits || 0))));
    var owner = info.customer ? '<a class="mx-a" data-a="go.customer" data-id="' + info.customer.id + '">' + esc(info.customer.name) + '</a>' :
      (info.owner && info.owner.name ? esc(info.owner.name) + ' <a class="mx-a" data-a="veh.addowner">' + esc(T('mx_add_as_customer', 'Add as customer')) + '</a>' : '');
    if (owner) bits.push(kv(T('mx_owner', 'Owner'), owner));
    el.innerHTML = '<div class="mx-dpane"><div class="mx-dh"><div><h2>' + plateHtml(d.plate) + '</h2><div class="mx-sub">' + esc(d.vehicle || d.model || '') +
      (info.found ? '' : ' ' + esc(T('mx_not_registered', 'Not found in the vehicle register'))) + '</div></div></div>' + flags +
      '<div class="mx-grid">' + bits.join('') + '</div>' +
      '<div class="mx-actions">' + btn(T('mx_new_job', 'New job card'), 'veh.job', 'primary') + btn(T('mx_new_quote', 'New quote'), 'veh.quote') + '</div>' +
      '<div class="mx-sec">' + esc(T('mx_history', 'History')) + '</div><div class="mx-timeline">' + tl + '</div></div>';
  }

  // ------------------------------------------------------------------ parts stock
  function loadParts() {
    var s = M.parts, tok = ++s.tok;
    s.state = 'loading'; listParts();
    api('parts.list', { q: s.q, category: s.cat, low: s.low }).then(function (r) {
      if (tok !== s.tok) return;
      if (r.ok) { s.items = r.items || []; s.value = r.stockValue || 0; s.state = 'ok'; } else { s.items = []; s.state = 'error'; fail(r); }
      if (M.view === 'parts') listParts();
    });
  }
  function listParts() {
    var el = $('mx-list'), s = M.parts;
    if (!el) return;
    if (s.state === 'loading' && !s.items.length) { el.innerHTML = spinner(); return; }
    if (!s.items.length) { el.innerHTML = empty(T('mx_no_parts', 'No parts here.'), T('mx_no_parts_sub', 'Add stock with “Add part”.')); return; }
    var rows = s.items.map(function (p) {
      return '<tr class="' + (p.low ? 'low' : '') + '"><td><b>' + esc(p.name) + '</b>' + (p.sku ? '<div class="mx-sub">' + esc(p.sku) + '</div>' : '') + '</td><td>' + txt(p.category) + '</td>' +
        '<td class="n"><span class="qtyc' + (p.low ? ' low' : '') + '">' + esc(String(p.qty)) + '</span>' + (p.low ? ' ' + pill(['x', T('mx_low', 'Low'), 'red']) : '') + '</td>' +
        '<td class="n">' + (p.minQty ? esc(String(p.minQty)) : '—') + '</td><td class="n">' + esc(money(p.cost)) + '</td><td class="n">' + esc(money(p.price)) + '</td><td>' + txt(p.supplier) + '</td>' +
        '<td class="acts"><button class="mx-btn sm" data-a="parts.receive" data-id="' + p.id + '">' + esc(T('mx_receive', 'Receive')) + '</button>' +
        '<button class="mx-btn sm" data-a="parts.adjust" data-id="' + p.id + '">' + esc(T('mx_adjust', 'Adjust')) + '</button>' +
        '<button class="mx-btn sm" data-a="parts.log" data-id="' + p.id + '">' + esc(T('mx_log', 'Log')) + '</button>' +
        '<button class="mx-btn sm" data-a="parts.edit" data-id="' + p.id + '">' + esc(T('mx_edit', 'Edit')) + '</button>' +
        (M.cfg.canDelete ? '<button class="mx-btn sm danger" data-a="parts.delete" data-id="' + p.id + '">' + esc(T('mx_delete', 'Delete')) + '</button>' : '') + '</td></tr>';
    }).join('');
    el.innerHTML = '<div class="mx-partsum">' + esc(F('mx_parts_count', '%s parts', s.items.length)) + ' · ' + esc(T('mx_stock_value', 'Stock value at cost')) + ': <b>' + esc(money(s.value)) + '</b></div>' +
      '<table class="mx-table"><thead><tr><th>' + esc(T('mx_part', 'Part')) + '</th><th>' + esc(T('mx_category', 'Category')) + '</th><th class="n">' + esc(T('mx_in_stock_h', 'In stock')) + '</th><th class="n">' +
      esc(T('mx_min', 'Minimum')) + '</th><th class="n">' + esc(T('mx_cost', 'Cost')) + '</th><th class="n">' + esc(T('mx_price', 'Price')) + '</th><th>' + esc(T('mx_supplier', 'Supplier')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function partById(id) { for (var i = 0; i < M.parts.items.length; i++) if (String(M.parts.items[i].id) === String(id)) return M.parts.items[i]; return null; }
  function openPartForm(p) {
    M.ed = { type: 'part', id: p ? p.id : null };
    var cats = (M.cfg.categories || []).slice();
    if (p && p.category && cats.indexOf(p.category) < 0) cats.push(p.category);
    function num(id, label, v) { return '<div class="mx-frow"><label>' + esc(label) + '</label><input type="number" id="' + id + '" min="0" step="1" value="' + esc(v) + '"></div>'; }
    openModal({ id: 'part', title: p ? T('mx_edit_part', 'Edit part') : T('mx_new_part', 'Add part'),
      html: '<div class="mx-form"><div class="mx-frow"><label>' + esc(T('mx_part_name', 'Name')) + '</label><input type="text" id="pf-name" maxlength="80" value="' + esc(p ? p.name : '') + '" data-focus></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_sku', 'Part number')) + '</label><input type="text" id="pf-sku" maxlength="30" value="' + esc(p && p.sku || '') + '"></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_category', 'Category')) + '</label><select id="pf-cat"><option value=""></option>' + cats.map(function (c) { return '<option' + (p && p.category === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        (p ? '' : num('pf-qty', T('mx_qty_start', 'Quantity in stock'), 0)) + num('pf-min', T('mx_min_help', 'Warn when at or below'), p ? p.minQty : 0) +
        num('pf-cost', T('mx_cost', 'Cost'), p ? p.cost : 0) + num('pf-price', T('mx_price', 'Price'), p ? p.price : 0) +
        '<div class="mx-frow"><label>' + esc(T('mx_supplier', 'Supplier')) + '</label><input type="text" id="pf-sup" maxlength="60" value="' + esc(p && p.supplier || '') + '"></div></div>',
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_save', 'Save'), a: 'pf.save', cls: 'primary' }] });
  }
  function pfSave() {
    var name = fv('pf-name').replace(/\s+/g, ' ').trim();
    if (!name) { toast(T('mx_err_invalid', 'Check the details and try again.'), true); return; }
    setBusy(true);
    api('parts.save', { id: M.ed.id, name: name, sku: fv('pf-sku'), category: fv('pf-cat'), qty: fv('pf-qty'), minQty: fv('pf-min'), cost: fv('pf-cost'), price: fv('pf-price'), supplier: fv('pf-sup') }).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      closeModal(); toast(T('mx_saved', 'Saved.')); loadParts();
    });
  }
  function openAdjust(p, receive) {
    M.ed = { type: 'adjust', id: p.id, receive: receive };
    openModal({ id: 'adjust', title: (receive ? T('mx_receive', 'Receive') : T('mx_adjust', 'Adjust')) + ': ' + p.name,
      html: '<div class="mx-form"><div class="mx-frow"><label>' + esc(T('mx_in_stock_h', 'In stock')) + '</label><div><b>' + esc(String(p.qty)) + '</b></div></div>' +
        '<div class="mx-frow"><label>' + esc(receive ? T('mx_qty_received', 'Quantity received') : T('mx_change_by', 'Change by (use − to remove)')) + '</label><input type="number" id="ad-delta" step="1" ' + (receive ? 'min="1" value="1"' : 'value="-1"') + ' data-focus></div>' +
        '<div class="mx-frow"><label>' + esc(T('mx_reason', 'Reason')) + '</label><input type="text" id="ad-reason" maxlength="80" placeholder="' + esc(receive ? T('mx_reason_ph_in', 'e.g. Delivery from supplier') : T('mx_reason_ph_out', 'e.g. Damaged, stock count')) + '"></div></div>',
      buttons: [{ label: T('mx_cancel', 'Cancel'), a: 'modal.close' }, { label: T('mx_save', 'Save'), a: 'ad.save', cls: 'primary' }] });
  }
  function adSave() {
    var delta = parseInt(fv('ad-delta'), 10);
    if (!delta) { toast(T('mx_err_invalid', 'Check the details and try again.'), true); return; }
    setBusy(true);
    api('parts.adjust', { id: M.ed.id, delta: delta, reason: fv('ad-reason') }).then(function (r) {
      setBusy(false);
      if (!r.ok) return fail(r);
      closeModal(); toast(T('mx_saved', 'Saved.')); loadParts(); M.dash = null; renderRail();
    });
  }
  function openPartLog(p) {
    M.ed = { type: 'log' };
    openModal({ id: 'log', title: T('mx_stock_history', 'Stock history') + ': ' + p.name, html: spinner(), buttons: [{ label: T('mx_close', 'Close'), a: 'modal.close' }] });
    api('parts.log', { id: p.id }).then(function (r) {
      if (M.modal !== 'log') return;
      if (!r.ok) { closeModal(); return fail(r); }
      $('mx-box-b').innerHTML = r.items.length ? '<table class="mx-table"><thead><tr><th>' + esc(T('mx_when', 'When')) + '</th><th class="n">' + esc(T('mx_change', 'Change')) + '</th><th>' + esc(T('mx_reason', 'Reason')) + '</th><th>' + esc(T('mx_by', 'By')) + '</th></tr></thead><tbody>' +
        r.items.map(function (x) { return '<tr><td>' + esc(dateTime(x.at)) + '</td><td class="n"><b class="' + (x.delta > 0 ? 'pos' : 'neg') + '">' + (x.delta > 0 ? '+' : '') + esc(String(x.delta)) + '</b></td><td>' + txt(x.reason) + '</td><td>' + txt(x.by) + '</td></tr>'; }).join('') + '</tbody></table>' :
        empty(T('mx_no_stock_log', 'No stock changes recorded.'));
    });
  }

  // ------------------------------------------------------------------ navigation helpers
  function gotoJob(id) {
    M.jobs.filter = 'all'; M.jobs.q = ''; M.jobs.mine = false;
    setView('jobs'); openJob(id, true);
  }
  function gotoDoc(kind, id) {
    var view = kind === 'quote' ? 'quotes' : 'invoices';
    M[view].filter = 'all'; M[view].q = '';
    setView(view); openDoc(view, id, true);
  }
  function gotoCustomer(id) { M.customers.q = ''; setView('customers'); openCustomer(id, true); }
  function gotoVehicle(plate) { M.vehicles.q = ''; setView('vehicles', true); loadVehicles(); openVehicle(cleanPlateJs(plate), true); }

  function afterJobChange(id) { M.dash = null; renderRail(); loadJobs(); openJob(id, true); }

  function ask(title, text, fn) { S.confirmDlg(title, text, fn); }

  // ------------------------------------------------------------------ actions
  var A = {};
  A.nav = function (el) { setView(el.dataset.v); };
  A.refresh = function () { loadDash(); };
  A['modal.close'] = function () { if (!M.busy) closeModal(); };
  A['f.set'] = function (el) { var s = M[M.view]; s.filter = el.dataset.f; s.sel = null; s.det = null; renderHead(); renderDetail(); loadList(); };
  A['jobs.mine'] = function (el) { M.jobs.mine = el.checked; loadJobs(); };
  A['jobs.new'] = function () { openJobForm(); };
  A['docs.new'] = function (el) { openDocEditor({ kind: el.dataset.kind }); };
  A['cust.nearby'] = function () { openNearby(); };
  A['cust.new'] = function () { openCustomerForm(null); };
  A['veh.lookup'] = function () {
    var p = cleanPlateJs(fv('mx-q'));
    if (!p) { toast(T('mx_err_empty', 'Enter a registration number.'), true); return; }
    openVehicle(p);
  };
  A['parts.cat'] = function (el) { M.parts.cat = el.value; loadParts(); };
  A['parts.low'] = function (el) { M.parts.low = el.checked; loadParts(); };
  A['parts.new'] = function () { openPartForm(null); };
  A['dash.go'] = function (el) {
    var v = el.dataset.v, f = el.dataset.f;
    if (v === 'parts') { M.parts.low = f === 'low'; M.parts.cat = ''; M.parts.q = ''; }
    else { var s = M[v]; s.filter = f; s.q = ''; s.sel = null; s.det = null; if (v === 'jobs') M.jobs.mine = false; }
    setView(v);
  };
  A['dash.job'] = function (el) { M.jobs.filter = 'active'; M.jobs.q = ''; M.jobs.mine = false; setView('jobs'); openJob(+el.dataset.id, true); };
  A['go.job'] = function (el) { gotoJob(+el.dataset.id); };
  A['jobs.open'] = function (el) { openJob(+el.dataset.id); };
  A['jobs.status'] = function (el) {
    var j = M.jobs.det && M.jobs.det.job;
    if (!j || j.status === el.dataset.s) return;
    var id = j.id;
    api('jobs.status', { id: id, status: el.dataset.s }).then(function (r) { if (!r.ok) return fail(r); toast(T('mx_saved', 'Saved.')); afterJobChange(id); });
  };
  A['jobs.task'] = function (el) {
    var j = M.jobs.det && M.jobs.det.job, i = +el.dataset.i;
    if (!j || !j.tasks[i]) return;
    j.tasks[i].done = el.checked; saveTasks(); detailJob();
  };
  A['jobs.taskdel'] = function (el) {
    var j = M.jobs.det && M.jobs.det.job;
    if (!j) return;
    j.tasks.splice(+el.dataset.i, 1); saveTasks(); detailJob();
  };
  A['doc.jump'] = function (el) { gotoDoc(el.dataset.kind, +el.dataset.id); };
  A['doc.job'] = function (el) { gotoJob(+el.dataset.id); };
  A['doc.open'] = function (el) { openDoc(M.view, +el.dataset.id); };
  A['go.customer'] = function (el) { gotoCustomer(+el.dataset.id); };
  A['go.vehicle'] = function (el) { gotoVehicle(el.dataset.plate); };
  A['jobs.edit'] = function () { var d = M.jobs.det; if (d) openJobForm({ job: d.job }); };
  A['jobs.quote'] = function () { var d = M.jobs.det; if (d) openDocEditor({ kind: 'quote', job: d.job }); };
  A['jobs.invoice'] = function () { var d = M.jobs.det; if (d) openDocEditor({ kind: 'invoice', job: d.job }); };
  A['jobs.delete'] = function () {
    var d = M.jobs.det;
    if (!d) return;
    ask(T('mx_delete', 'Delete'), F('mx_confirm_delete_job', 'Delete job card %s? Quotes and invoices stay, but lose the link.', d.job.ref), function () {
      api('jobs.delete', { id: d.job.id }).then(function (r) {
        if (!r.ok) return fail(r);
        M.jobs.sel = null; M.jobs.det = null; toast(T('mx_deleted', 'Deleted.')); M.dash = null; renderRail(); loadJobs(); detailJob();
      });
    });
  };
  A['doc.edit'] = function () { var d = curDoc(); if (d) openDocEditor({ det: d }); };
  A['doc.status'] = function (el) { docAct('docs.status', { status: el.dataset.s }); };
  A['doc.convert'] = function () { docAct('docs.convert'); };
  A['doc.email'] = function () { docAct('docs.email'); };
  A['doc.pay'] = function () { openPay(); };
  A['doc.issue'] = function () {
    var d = curDoc();
    if (!d) return;
    ask(T('mx_issue', 'Issue invoice'), F('mx_confirm_issue', 'Issue %s? Parts will be taken from stock and the invoice can no longer be edited.', d.doc.ref), function () { docAct('docs.issue'); M.dash = null; });
  };
  A['doc.void'] = function () {
    var d = curDoc();
    if (!d) return;
    ask(T('mx_void', 'Void invoice'), F('mx_confirm_void', 'Void %s? Parts go back into stock.', d.doc.ref), function () { docAct('docs.void'); M.dash = null; });
  };
  A['doc.delete'] = function () {
    var d = curDoc();
    if (!d) return;
    ask(T('mx_delete', 'Delete'), F('mx_confirm_delete_doc', 'Delete %s?', d.doc.ref), function () { docAct('docs.delete'); });
  };
  A['f.newcust'] = function (el) { var r = $(el.dataset.p + '-nc'); if (r) { r.classList.toggle('hidden'); var i = $(el.dataset.p + '-ncn'); if (i) i.focus(); } };
  A['f.addcust'] = function (el) { var p = el.dataset.p; addCustomerInline(p, p === 'jf' ? 'jf-cust' : 'de-cust'); };
  A['f.addowner'] = function () {
    var lk = M.ed && M.ed.lookup;
    if (!lk) return;
    api('customers.fromVehicle', { plate: lk.plate }).then(function (r) {
      if (!r.ok) return fail(r);
      api('customers.list', {}).then(function (l) {
        if (M.modal !== 'job') return;
        M.ed.customers = l.items || [];
        $('jf-cust').innerHTML = custOptions(M.ed.customers, r.id);
        jfLookup(true);
      });
    });
  };
  A['jf.lookup'] = function () { jfLookup(false); };
  A['jf.save'] = function () { if (!M.busy) jfSave(); };
  A['de.rm'] = function (el) { M.ed.lines.splice(+el.dataset.i, 1); renderEdLines(); };
  A['de.addlabour'] = function () { edAdd({ kind: 'labour', description: T('mx_labour', 'Labour'), qty: 1, unitPrice: +M.cfg.labourRate || 0 }); };
  A['de.addother'] = function () { edAdd({ kind: 'other', description: '', qty: 1, unitPrice: 0 }); };
  A['de.addpart'] = function () {
    var id = fv('de-part');
    if (!id) return;
    var p = (M.ed.parts || []).filter(function (x) { return String(x.id) === id; })[0];
    if (!p) return;
    var same = M.ed.lines.filter(function (l) { return l.partId === p.id; })[0];
    if (same) { same.qty = (+same.qty || 0) + 1; renderEdLines(); return; }
    edAdd({ kind: 'part', description: p.name, qty: 1, unitPrice: p.price, partId: p.id });
    $('de-part').value = '';
  };
  A['de.save'] = function () { if (!M.busy) deSave(); };
  A['pay.card'] = function () { doPay('card'); };
  A['pay.manual'] = function () { doPay('manual'); };
  A['cust.open'] = function (el) { openCustomer(+el.dataset.id); };
  A['cust.edit'] = function () { var d = M.customers.det; if (d) openCustomerForm(d.customer); };
  A['cust.job'] = function () { var d = M.customers.det; if (d) openJobForm({ customerId: d.customer.id }); };
  A['cust.delete'] = function () {
    var d = M.customers.det;
    if (!d) return;
    ask(T('mx_delete', 'Delete'), F('mx_confirm_delete_cust', 'Delete %s? Their job cards and documents are kept.', d.customer.name), function () {
      api('customers.delete', { id: d.customer.id }).then(function (r) {
        if (!r.ok) return fail(r);
        M.customers.sel = null; M.customers.det = null; toast(T('mx_deleted', 'Deleted.')); loadCustomers(); detailCustomer();
      });
    });
  };
  A['cf.save'] = function () { if (!M.busy) cfSave(); };
  A['nb.go'] = function () { if (!M.busy) nbGo(); };
  A['veh.open'] = function (el) { openVehicle(el.dataset.plate); };
  A['veh.addowner'] = function () {
    var d = M.vehicles.det;
    if (!d) return;
    api('customers.fromVehicle', { plate: d.plate }).then(function (r) { if (!r.ok) return fail(r); toast(T('mx_customer_added', 'Customer added.')); openVehicle(d.plate, true); });
  };
  A['veh.job'] = function () {
    var d = M.vehicles.det;
    if (!d) return;
    openJobForm({ plate: d.plate, vehicle: d.vehicle || d.model, customerId: d.info && d.info.customer ? d.info.customer.id : null, lookup: d.info });
  };
  A['veh.quote'] = function () {
    var d = M.vehicles.det;
    if (!d) return;
    openDocEditor({ kind: 'quote', plate: d.plate, vehicle: d.vehicle || d.model, customerId: d.info && d.info.customer ? d.info.customer.id : null });
  };
  A['parts.receive'] = function (el) { var p = partById(el.dataset.id); if (p) openAdjust(p, true); };
  A['parts.adjust'] = function (el) { var p = partById(el.dataset.id); if (p) openAdjust(p, false); };
  A['parts.log'] = function (el) { var p = partById(el.dataset.id); if (p) openPartLog(p); };
  A['parts.edit'] = function (el) { var p = partById(el.dataset.id); if (p) openPartForm(p); };
  A['parts.delete'] = function (el) {
    var p = partById(el.dataset.id);
    if (!p) return;
    ask(T('mx_delete', 'Delete'), F('mx_confirm_delete_part', 'Delete %s from stock?', p.name), function () {
      api('parts.delete', { id: p.id }).then(function (r) { if (!r.ok) return fail(r); toast(T('mx_deleted', 'Deleted.')); loadParts(); });
    });
  };
  A['pf.save'] = function () { if (!M.busy) pfSave(); };
  A['ad.save'] = function () { if (!M.busy) adSave(); };

  // ------------------------------------------------------------------ events
  function bind(root) {
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-a]');
      if (!el || !root.contains(el)) return;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;   // handled on 'change'
      if (el.disabled) return;
      var fn = A[el.dataset.a];
      if (fn) { e.preventDefault(); fn(el); }
    });
    root.addEventListener('change', function (e) {
      var el = e.target;
      if (el.matches && el.matches('input[data-a], select[data-a]')) { var fn = A[el.dataset.a]; if (fn) fn(el); }
    });
    root.addEventListener('input', function (e) {
      var el = e.target;
      if (el.id === 'mx-q') {
        clearTimeout(M.timers.q);
        var view = M.view;
        M.timers.q = setTimeout(function () {
          if (view !== M.view) return;
          if (view === 'vehicles') { M.vehicles.q = el.value; listVehicles(); return; }
          M[view].q = el.value;
          loadList();
        }, 250);
      } else if (el.dataset && el.dataset.lf && M.ed && M.ed.type === 'doc') {
        var l = M.ed.lines[+el.dataset.li];
        if (!l) return;
        var f = el.dataset.lf;
        l[f] = f === 'description' ? el.value : (el.value === '' ? 0 : +el.value);
        renderEdTotals();
      }
    });
    root.addEventListener('keydown', function (e) {
      var t = e.target, typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
      if (typing) e.stopPropagation();
      if (e.key === 'Escape' && M.modal && !M.busy) { e.stopPropagation(); closeModal(); return; }
      if (e.key !== 'Enter') return;
      if (t.id === 'mx-newtask') {
        var v = t.value.replace(/\s+/g, ' ').trim(), j = M.jobs.det && M.jobs.det.job;
        if (!v || !j) return;
        if (j.tasks.length >= 20) { toast(T('mx_err_limit', 'The limit has been reached.'), true); return; }
        j.tasks.push({ t: v.slice(0, 80), done: false });
        saveTasks(); detailJob();
        var n = $('mx-newtask'); if (n) n.focus();
      } else if (t.id === 'mx-q' && M.view === 'vehicles') A['veh.lookup']();
      else if (t.id === 'jf-plate') jfLookup(false);
      else if (t.id === 'nb-id') nbGo();
    });
    root.addEventListener('keyup', function (e) { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') e.stopPropagation(); });
    root.addEventListener('keypress', function (e) { if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') e.stopPropagation(); });
  }

  // ------------------------------------------------------------------ register with the desktop
  var bound = false;
  function ensureBound() { if (!bound && $('mx')) { bind($('mx')); bound = true; } }
  var root = S.registerApp({
    id: 'mechanic', icon: ICON_APP, titleKey: 'mx_app_name', titleDef: 'Mechanic', w: 1380, h: 800, html: HTML,
    onOpen: function () { ensureBound(); M.dash = null; setView(M.view, false); },
    onClose: function () { closeModal(); },
    onReset: function () { freshState(false); if ($('mx-rail')) { renderRail(); renderHead(); renderBody(); } },
    onLocale: function () { if ($('mx-rail')) { renderRail(); renderHead(); renderBody(); if (M.view === 'dash') renderDash(); } }
  });
  if (root) ensureBound();
})();
