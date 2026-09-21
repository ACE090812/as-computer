/* Mail app for Los Santos OS. It shows the same mailboxes as the phone's Mail app (sd-phone): the accounts the
   character is signed into, their folders and messages. Nothing is stored by this app itself.
   Registers itself with LSOS.registerApp (see the end of app.js). Every call goes through the 'mailApi' NUI callback
   (client/mail.lua), which checks the job and then asks sd-phone; this file only draws. */
(function () {
  'use strict';
  var S = window.LSOS;
  if (!S || S.isDui) return;

  var esc = S.esc;
  function T(key, def) { return S.t(key, def); }
  function F(key, def) {
    var a = Array.prototype.slice.call(arguments, 2), i = 0;
    return T(key, def).replace(/%s/g, function () { return a[i++]; });
  }
  function $(id) { return document.getElementById(id); }

  var ICON_APP = '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5.4" fill="#0f6cbd"/><rect x="5" y="7.2" width="14" height="9.6" rx="1.6" fill="#fff"/><path d="M5.6 8.2l6.4 4.8 6.4-4.8" fill="none" stroke="#0f6cbd" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var FOLDER_ICONS = {
    inbox: '<path d="M4 13l2-7h12l2 7v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
    flagged: '<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>',
    drafts: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 13h8M8 16h5"/>',
    sent: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    spam: '<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
    bin: '<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>'
  };
  var FOLDERS = [
    { id: 'inbox', key: 'ml_inbox', def: 'Inbox' },
    { id: 'flagged', key: 'ml_flagged', def: 'Flagged' },
    { id: 'drafts', key: 'ml_drafts', def: 'Drafts' },
    { id: 'sent', key: 'ml_sent', def: 'Sent' },
    { id: 'spam', key: 'ml_spam', def: 'Spam' },
    { id: 'bin', key: 'ml_bin', def: 'Bin' }
  ];
  function ficon(k) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + FOLDER_ICONS[k] + '</svg>';
  }

  // ------------------------------------------------------------------ server calls
  function api(name, data) {
    return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/mailApi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: name, data: data || {} })
    }).then(function (r) { return r.json(); }).then(function (r) { return r && typeof r === 'object' ? r : { ok: false, reason: 'error' }; })
      .catch(function () { return { ok: false, reason: 'network' }; });
  }

  var ERR = {
    not_authorised: ['ml_err_not_authorised', 'You cannot use Mail from this computer.'],
    unavailable: ['ml_err_unavailable', 'Mail is not available right now.'],
    invalid: ['ml_err_invalid', 'Check the details and try again.'],
    network: ['ml_err_network', 'Could not reach the mail server.'],
    error: ['ml_err_error', 'Something went wrong. Try again.']
  };
  function errText(res) {
    if (res && res.message) return String(res.message);
    var e = ERR[res && res.reason] || ERR.error;
    return T(e[0], e[1]);
  }

  // ------------------------------------------------------------------ state
  var M;
  function fresh() {
    M = { load: 'idle', accounts: [], messages: [], acct: null, folder: 'inbox', sel: null, q: '',
          compose: null, signin: null, busy: false, timer: null, seq: 0 };
  }
  fresh();

  function toast(msg, bad) {
    var el = $('ml-toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'ml-toast on' + (bad ? ' bad' : '');
    clearTimeout(M.timer);
    M.timer = setTimeout(function () { el.className = 'ml-toast'; }, 3600);
  }

  // ------------------------------------------------------------------ helpers
  function cmpDate(a, b) { return a < b ? 1 : (a > b ? -1 : 0); }
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
    return isNaN(d.getTime()) ? null : d;
  }
  function loc() { return T('ui_date_locale', 'en-GB'); }
  function shortDate(s) {
    var d = parseDate(s); if (!d) return '';
    var n = new Date();
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
    var o = { day: 'numeric', month: 'short' };
    if (d.getFullYear() !== n.getFullYear()) o.year = 'numeric';
    return d.toLocaleDateString(loc(), o);
  }
  function longDate(s) {
    var d = parseDate(s); if (!d) return '';
    return d.toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) + ' ' +
           d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
  }
  function who(p) {
    p = p || {};
    return p.name && p.name !== p.email ? p.name : (p.email || '');
  }
  function acctOf(email) {
    for (var i = 0; i < M.accounts.length; i++) if (M.accounts[i].email === email) return M.accounts[i];
    return null;
  }
  function mine() {
    return M.messages.filter(function (m) { return m.accountId === M.acct; });
  }
  function inFolder(m, f) {
    if (f === 'flagged') return m.flagged && m.folder !== 'bin';
    return m.folder === f;
  }
  function visible() {
    var q = M.q.trim().toLowerCase();
    return mine().filter(function (m) {
      if (!inFolder(m, M.folder)) return false;
      if (!q) return true;
      var hay = [m.subject, m.body, m.from && m.from.name, m.from && m.from.email, (m.to || []).join(' ')].join('\n').toLowerCase();
      return hay.indexOf(q) !== -1;
    }).sort(function (a, b) { return cmpDate(a.sentAt, b.sentAt); });
  }
  function counts() {
    var c = { inbox: 0, flagged: 0, drafts: 0, sent: 0, spam: 0, bin: 0 };
    mine().forEach(function (m) {
      if (m.folder === 'inbox' && !m.read) c.inbox++;
      if (m.folder === 'drafts') c.drafts++;
    });
    return c;
  }
  function find(id) {
    for (var i = 0; i < M.messages.length; i++) if (M.messages[i].id === id && M.messages[i].accountId === M.acct) return M.messages[i];
    return null;
  }
  function parseAddresses(text) {
    var out = [], seen = {};
    String(text || '').split(/[\s,;]+/).forEach(function (a) {
      a = a.trim().toLowerCase();
      if (a && !seen[a]) { seen[a] = true; out.push(a); }
    });
    return out;
  }

  // ------------------------------------------------------------------ loading
  function load(keepView) {
    var my = ++M.seq;
    if (!keepView) { M.load = 'loading'; render(); }
    return api('list').then(function (res) {
      if (my !== M.seq) return;
      if (!res || !res.ok || !res.data) {
        M.load = 'error'; M.err = errText(res); render(); return;
      }
      M.accounts = res.data.accounts || [];
      M.messages = res.data.messages || [];
      if (!acctOf(M.acct)) M.acct = M.accounts[0] ? M.accounts[0].email : null;
      if (M.sel && !find(M.sel)) M.sel = null;
      M.load = 'ok';
      if (!M.accounts.length && !M.signin) M.signin = { email: '', err: '', first: true };
      render();
    });
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    if (!$('ml')) return;
    renderRail();
    renderHead();
    renderBody();
  }

  function renderRail() {
    var c = counts();
    var h = FOLDERS.map(function (f) {
      var n = f.id === 'inbox' ? c.inbox : (f.id === 'drafts' ? c.drafts : 0);
      return '<button class="ml-nav' + (M.folder === f.id && !M.compose && !M.signin ? ' on' : '') + '" data-a="folder" data-f="' + f.id + '">' + ficon(f.id) +
        '<span class="nl">' + esc(T(f.key, f.def)) + '</span>' + (n ? '<span class="bd' + (f.id === 'inbox' ? '' : ' soft') + '">' + n + '</span>' : '') + '</button>';
    }).join('');
    $('ml-folders').innerHTML = h;
    var a = M.accounts;
    var sel = '';
    if (a.length) {
      sel = '<label class="ml-lbl">' + esc(T('ml_account', 'Account')) + '</label><select id="ml-acct-sel" data-a="acct">' +
        a.map(function (x) {
          return '<option value="' + esc(x.email) + '"' + (x.email === M.acct ? ' selected' : '') + '>' + esc(x.name && x.name !== x.email ? x.name + ' — ' + x.email : x.email) + '</option>';
        }).join('') + '</select>';
    }
    $('ml-acct').innerHTML = sel;
    var foot = '';
    if (M.load === 'ok') {
      foot = '<button class="ml-link" data-a="addacct">' + esc(T('ml_add_account', 'Sign in to another account')) + '</button>';
      if (a.length) foot += '<button class="ml-link" data-a="signout">' + esc(T('ml_sign_out', 'Sign out of this account')) + '</button>';
    }
    $('ml-foot').innerHTML = foot;
  }

  function renderHead() {
    var f = FOLDERS.filter(function (x) { return x.id === M.folder; })[0];
    var title = M.signin ? T('ml_sign_in_title', 'Sign in') : (M.compose ? T('ml_new_mail', 'New mail') : T(f.key, f.def));
    var tools = '';
    if (M.load === 'ok' && !M.signin && !M.compose) {
      tools = '<div class="ml-search"><input id="ml-q" type="text" autocomplete="off" maxlength="60" placeholder="' + esc(T('ml_search', 'Search mail')) + '" value="' + esc(M.q) + '"></div>' +
        '<button class="ml-btn" data-a="refresh">' + esc(T('ml_refresh', 'Refresh')) + '</button>';
    }
    $('ml-head').innerHTML = '<div class="ml-title">' + esc(title) + '</div><div class="ml-tools">' + tools + '</div>';
    var b = document.querySelector('#ml [data-a="compose"]');
    if (b) b.disabled = !(M.load === 'ok' && M.accounts.length);
  }

  function renderBody() {
    var b = $('ml-body');
    if (M.load === 'loading' || M.load === 'idle') { b.innerHTML = '<div class="ml-empty">' + esc(T('ml_loading', 'Loading your mail…')) + '</div>'; return; }
    if (M.load === 'error') {
      b.innerHTML = '<div class="ml-empty"><p>' + esc(M.err || T('ml_err_error', 'Something went wrong. Try again.')) + '</p><button class="ml-btn primary" data-a="retry">' + esc(T('ml_retry', 'Try again')) + '</button></div>';
      return;
    }
    if (M.signin) { renderSignin(b); return; }
    if (M.compose) { renderCompose(b); return; }
    renderMail(b);
  }

  function renderSignin(b) {
    var s = M.signin;
    b.innerHTML = '<div class="ml-form ml-narrow">' +
      (s.first ? '<p class="ml-help">' + esc(T('ml_no_accounts', 'This character is not signed into any mail account. Sign in with the address and password you use in the Mail app on your phone. New addresses are created on the phone.')) + '</p>'
               : '<p class="ml-help">' + esc(T('ml_sign_in_help', 'Sign in with an address and password from the Mail app on your phone.')) + '</p>') +
      '<label>' + esc(T('ml_email', 'Email address')) + '<input id="ml-si-email" type="text" autocomplete="off" spellcheck="false" maxlength="64" value="' + esc(s.email) + '"></label>' +
      '<label>' + esc(T('ml_password', 'Password')) + '<input id="ml-si-pass" type="password" autocomplete="off" maxlength="64"></label>' +
      '<div class="ml-err" id="ml-si-err">' + esc(s.err || '') + '</div>' +
      '<div class="ml-row"><button class="ml-btn primary" data-a="dosignin"' + (M.busy ? ' disabled' : '') + '>' + esc(T('ml_sign_in', 'Sign in')) + '</button>' +
      (M.accounts.length ? '<button class="ml-btn" data-a="cancelsignin">' + esc(T('ml_cancel', 'Cancel')) + '</button>' : '') + '</div></div>';
    var el = $('ml-si-email'); if (el) el.focus();
  }

  function renderMail(b) {
    var list = visible();
    var rows = list.map(function (m) {
      var other = (M.folder === 'sent' || M.folder === 'drafts') ? (m.to || []).join(', ') || T('ml_no_recipient', '(no recipient)') : who(m.from);
      var att = m.attachments && m.attachments.length ? '<span class="ml-clip" title="' + esc(T('ml_attachments', 'Attachments')) + '">📎</span>' : '';
      return '<div class="ml-row-item' + (m.id === M.sel ? ' on' : '') + (m.read ? '' : ' unread') + '" data-a="pick" data-id="' + esc(m.id) + '">' +
        '<div class="ml-r1"><span class="ml-from">' + esc(other) + '</span>' + (m.flagged ? '<span class="ml-flag">⚑</span>' : '') + att + '<span class="ml-date">' + esc(shortDate(m.sentAt)) + '</span></div>' +
        '<div class="ml-subj">' + esc(m.subject || T('ml_no_subject', '(no subject)')) + '</div>' +
        '<div class="ml-snip">' + esc(String(m.body || '').replace(/\s+/g, ' ').slice(0, 110)) + '</div></div>';
    }).join('');
    if (!rows) rows = '<div class="ml-empty small">' + esc(M.q ? T('ml_no_match', 'No mail matches your search.') : T('ml_empty_folder', 'Nothing here.')) + '</div>';
    b.innerHTML = '<div class="ml-split"><div class="ml-list" id="ml-list">' + rows + '</div><div class="ml-det" id="ml-det"></div></div>';
    renderDetail();
  }

  function attachmentsHtml(m) {
    var a = m.attachments || [];
    if (!a.length) return '';
    return '<div class="ml-atts"><div class="ml-lbl">' + esc(T('ml_attachments', 'Attachments')) + '</div>' + a.map(function (x) {
      if (x.kind === 'photo' && /^https:\/\//i.test(x.url || '')) return '<a class="ml-photo"><img src="' + esc(x.url) + '" alt=""></a>';
      if (x.kind === 'note') return '<div class="ml-att"><b>' + esc(x.title || T('ml_note', 'Note')) + '</b><div class="ml-note">' + esc(x.body || '') + '</div></div>';
      var label = x.kind === 'audio' ? T('ml_voice', 'Voice memo') : (x.kind === 'document' ? T('ml_document', 'Document') : T('ml_file', 'File'));
      return '<div class="ml-att"><b>' + esc(x.name || label) + '</b> <span class="ml-sub">' + esc(label) + ' — ' + esc(T('ml_open_on_phone', 'open it on your phone')) + '</span></div>';
    }).join('') + '</div>';
  }

  function renderDetail() {
    var d = $('ml-det'); if (!d) return;
    var m = M.sel ? find(M.sel) : null;
    if (!m) { d.innerHTML = '<div class="ml-empty small">' + esc(T('ml_pick', 'Select a message to read it.')) + '</div>'; return; }
    var btns = [];
    if (m.folder === 'drafts') {
      btns.push('<button class="ml-btn primary" data-a="editdraft">' + esc(T('ml_edit_draft', 'Edit')) + '</button>');
    } else {
      btns.push('<button class="ml-btn primary" data-a="reply">' + esc(T('ml_reply', 'Reply')) + '</button>');
      btns.push('<button class="ml-btn" data-a="replyall">' + esc(T('ml_reply_all', 'Reply all')) + '</button>');
      btns.push('<button class="ml-btn" data-a="forward">' + esc(T('ml_forward', 'Forward')) + '</button>');
    }
    btns.push('<button class="ml-btn" data-a="flag">' + esc(m.flagged ? T('ml_unflag', 'Remove flag') : T('ml_flag', 'Flag')) + '</button>');
    if (m.folder === 'inbox') btns.push('<button class="ml-btn" data-a="tospam">' + esc(T('ml_mark_spam', 'Mark as spam')) + '</button>');
    if (m.folder === 'spam' || m.folder === 'bin') btns.push('<button class="ml-btn" data-a="toinbox">' + esc(m.folder === 'spam' ? T('ml_not_spam', 'Not spam') : T('ml_restore', 'Restore')) + '</button>');
    btns.push('<button class="ml-btn danger" data-a="delete">' + esc(m.folder === 'bin' ? T('ml_delete_forever', 'Delete forever') : T('ml_delete', 'Delete')) + '</button>');
    d.innerHTML = '<div class="ml-msg"><h2>' + esc(m.subject || T('ml_no_subject', '(no subject)')) + '</h2>' +
      '<div class="ml-meta"><div><b>' + esc(who(m.from)) + '</b> <span class="ml-sub">&lt;' + esc((m.from && m.from.email) || '') + '&gt;</span></div>' +
      '<div class="ml-sub">' + esc(T('ml_to', 'To')) + ': ' + esc((m.to || []).join(', ') || '—') + '</div>' +
      '<div class="ml-sub">' + esc(longDate(m.sentAt)) + '</div></div>' +
      '<div class="ml-tb">' + btns.join('') + '</div>' +
      '<div class="ml-text">' + esc(m.body || '').replace(/\n/g, '<br>') + '</div>' + attachmentsHtml(m) + '</div>';
  }

  function renderCompose(b) {
    var c = M.compose;
    var from = M.accounts.length > 1
      ? '<label>' + esc(T('ml_from', 'From')) + '<select id="ml-c-from">' + M.accounts.map(function (x) {
          return '<option value="' + esc(x.email) + '"' + (x.email === c.from ? ' selected' : '') + '>' + esc(x.email) + '</option>';
        }).join('') + '</select></label>'
      : '<div class="ml-sub">' + esc(T('ml_from', 'From')) + ': ' + esc(c.from) + '</div>';
    b.innerHTML = '<div class="ml-form ml-compose">' + from +
      '<label>' + esc(T('ml_to', 'To')) + '<input id="ml-c-to" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(T('ml_to_ph', 'name@vinecloud.com, another@vinecloud.com')) + '" value="' + esc(c.to) + '"></label>' +
      '<label>' + esc(T('ml_subject', 'Subject')) + '<input id="ml-c-subj" type="text" autocomplete="off" maxlength="200" value="' + esc(c.subject) + '"></label>' +
      '<label class="grow">' + esc(T('ml_message', 'Message')) + '<textarea id="ml-c-body" maxlength="10000">' + esc(c.body) + '</textarea></label>' +
      '<div class="ml-err" id="ml-c-err">' + esc(c.err || '') + '</div>' +
      '<div class="ml-row"><button class="ml-btn primary" data-a="send"' + (M.busy ? ' disabled' : '') + '>' + esc(T('ml_send', 'Send')) + '</button>' +
      '<button class="ml-btn" data-a="savedraft"' + (M.busy ? ' disabled' : '') + '>' + esc(T('ml_save_draft', 'Save draft')) + '</button>' +
      '<button class="ml-btn danger" data-a="discard">' + esc(T('ml_discard', 'Discard')) + '</button></div></div>';
    var el = $(c.to ? 'ml-c-body' : 'ml-c-to'); if (el) el.focus();
  }

  // ------------------------------------------------------------------ actions
  function readCompose() {
    var c = M.compose; if (!c) return;
    var g = function (id) { var e = $(id); return e ? e.value : null; };
    var f = g('ml-c-from'); if (f !== null) c.from = f;
    var v;
    if ((v = g('ml-c-to')) !== null) c.to = v;
    if ((v = g('ml-c-subj')) !== null) c.subject = v;
    if ((v = g('ml-c-body')) !== null) c.body = v;
  }

  function openCompose(o) {
    M.signin = null;
    M.compose = Object.assign({ from: M.acct, to: '', subject: '', body: '', draftId: null, err: '' }, o || {});
    render();
  }
  function quoted(m) {
    var head = F('ml_wrote', 'On %s, %s wrote:', longDate(m.sentAt), who(m.from));
    return '\n\n' + head + '\n' + String(m.body || '').split('\n').map(function (l) { return '> ' + l; }).join('\n');
  }
  function withPrefix(prefix, s) {
    s = String(s || '');
    return s.toLowerCase().indexOf(prefix.toLowerCase()) === 0 ? s : prefix + s;
  }

  function markRead(m) {
    if (m.read || m.folder !== 'inbox') return;
    m.read = true;
    api('markRead', { accountEmail: m.accountId, messageId: m.id }).then(function (r) { if (!r.ok) load(true); });
  }

  function pick(id) {
    M.sel = id;
    var m = find(id);
    if (m) markRead(m);
    render();
  }

  function mutate(name, payload, after) {
    return api(name, payload).then(function (r) {
      if (!r.ok) { toast(errText(r), true); return load(true); }
      if (after) after();
      render();
    });
  }

  function doSend() {
    readCompose();
    var c = M.compose, to = parseAddresses(c.to);
    if (!to.length || to.some(function (a) { return a.indexOf('@') < 1; })) { c.err = T('ml_err_recipient', 'Add at least one valid email address.'); render(); return; }
    if (!c.subject.trim() && !c.body.trim()) { c.err = T('ml_err_empty', 'Write a subject or a message first.'); render(); return; }
    M.busy = true; c.err = ''; render();
    api('send', { fromEmail: c.from, to: to, subject: c.subject, body: c.body }).then(function (r) {
      M.busy = false;
      if (!r.ok) { c.err = errText(r); render(); return; }
      var done = function () { M.compose = null; M.folder = 'sent'; M.sel = null; toast(T('ml_sent_ok', 'Mail sent.')); load(true); };
      if (c.draftId) api('discardDraft', { accountEmail: c.from, messageId: c.draftId }).then(done); else done();
    });
  }

  function doSaveDraft() {
    readCompose();
    var c = M.compose;
    M.busy = true; c.err = ''; render();
    api('saveDraft', { fromEmail: c.from, to: parseAddresses(c.to), subject: c.subject, body: c.body }).then(function (r) {
      M.busy = false;
      if (!r.ok) { c.err = errText(r); render(); return; }
      var done = function () { M.compose = null; M.folder = 'drafts'; M.sel = null; toast(T('ml_draft_saved', 'Draft saved.')); load(true); };
      if (c.draftId) api('discardDraft', { accountEmail: c.from, messageId: c.draftId }).then(done); else done();
    });
  }

  function doSignin() {
    var s = M.signin;
    var email = ($('ml-si-email') || {}).value || '', pass = ($('ml-si-pass') || {}).value || '';
    s.email = email;
    if (!email.trim() || !pass) { s.err = T('ml_err_credentials', 'Enter your email address and password.'); render(); return; }
    M.busy = true; s.err = ''; render();
    api('signIn', { email: email.trim().toLowerCase(), password: pass }).then(function (r) {
      M.busy = false;
      if (!r.ok) { s.err = errText(r); render(); return; }
      M.signin = null;
      if (r.data && r.data.account) M.acct = r.data.account.email;
      toast(T('ml_signed_in', 'Signed in.'));
      load(true);
    });
  }

  function doSignout() {
    var a = acctOf(M.acct); if (!a) return;
    S.confirmDlg(T('ml_sign_out', 'Sign out of this account'), F('ml_sign_out_ask', 'Sign out of %s? It will also be signed out on this character’s phone.', a.email), function () {
      api('signOut', { email: a.email }).then(function (r) {
        if (!r.ok) { toast(errText(r), true); return; }
        M.acct = null; M.sel = null;
        load(true);
      });
    });
  }

  function onAction(el, ev) {
    var a = el.dataset.a, m = M.sel ? find(M.sel) : null;
    switch (a) {
      case 'folder': readCompose(); M.compose = null; M.signin = null; M.folder = el.dataset.f; M.sel = null; render(); break;
      case 'compose': if (M.accounts.length) openCompose({}); break;
      case 'refresh': case 'retry': load(a === 'refresh'); break;
      case 'pick': pick(el.dataset.id); break;
      case 'addacct': M.compose = null; M.signin = { email: '', err: '', first: false }; render(); break;
      case 'cancelsignin': M.signin = null; render(); break;
      case 'dosignin': doSignin(); break;
      case 'signout': doSignout(); break;
      case 'send': doSend(); break;
      case 'savedraft': doSaveDraft(); break;
      case 'discard': M.compose = null; render(); break;
      case 'reply': if (m) openCompose({ to: (m.from && m.from.email) || '', subject: withPrefix('Re: ', m.subject), body: quoted(m) }); break;
      case 'replyall': if (m) {
        var me = M.acct, all = [(m.from && m.from.email) || ''].concat(m.to || []).filter(function (x) { return x && x !== me; });
        var seen = {}; all = all.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
        openCompose({ to: all.join(', '), subject: withPrefix('Re: ', m.subject), body: quoted(m) });
      } break;
      case 'forward': if (m) openCompose({ subject: withPrefix('Fwd: ', m.subject), body: '\n\n' + F('ml_forwarded', '---------- Forwarded message ----------\nFrom: %s\nDate: %s\nSubject: %s', who(m.from), longDate(m.sentAt), m.subject || '') + '\n\n' + (m.body || '') }); break;
      case 'editdraft': if (m) openCompose({ from: m.accountId, to: (m.to || []).join(', '), subject: m.subject, body: m.body, draftId: m.id }); break;
      case 'flag': if (m) { m.flagged = !m.flagged; mutate('toggleFlag', { accountEmail: m.accountId, messageId: m.id }); render(); } break;
      case 'tospam': if (m) { m.folder = 'spam'; M.sel = null; mutate('move', { accountEmail: m.accountId, messageId: m.id, folder: 'spam' }); render(); } break;
      case 'toinbox': if (m) { m.folder = 'inbox'; M.sel = null; mutate('move', { accountEmail: m.accountId, messageId: m.id, folder: 'inbox' }); render(); } break;
      case 'delete': if (m) {
        var id = m.id, acc = m.accountId;
        if (m.folder === 'bin') {
          S.confirmDlg(T('ml_delete_forever', 'Delete forever'), T('ml_delete_ask', 'Delete this message for good?'), function () {
            M.messages = M.messages.filter(function (x) { return !(x.id === id && x.accountId === acc); }); M.sel = null;
            mutate('moveToBin', { accountEmail: acc, messageId: id }); render();
          });
        } else {
          m.folder = 'bin'; m.flagged = false; M.sel = null;
          mutate('moveToBin', { accountEmail: acc, messageId: id }); render();
        }
      } break;
    }
  }

  var bound = false;
  function bind(root) {
    root.addEventListener('click', function (e) {
      var el = e.target.closest('[data-a]');
      if (!el || !root.contains(el) || el.tagName === 'SELECT') return;
      onAction(el, e);
    });
    root.addEventListener('change', function (e) {
      var el = e.target;
      if (el && el.id === 'ml-acct-sel') { readCompose(); M.acct = el.value; M.sel = null; M.compose = null; render(); }
    });
    root.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'ml-q') {
        M.q = e.target.value;
        var b = $('ml-body'); if (b && !M.compose && !M.signin) { renderMail(b); }
      }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && (e.target.id === 'ml-si-pass' || e.target.id === 'ml-si-email') && M.signin) { e.preventDefault(); doSignin(); }
    });
  }
  function ensureBound() { if (!bound && $('ml')) { bind($('ml')); bound = true; } }

  // live: sd-phone told the client that mail arrived while the computer is open
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.action !== 'mailReceived' || !d.message || !$('ml') || M.load !== 'ok') return;
    var m = d.message;
    for (var i = 0; i < M.messages.length; i++) if (M.messages[i].id === m.id) return;
    M.messages.push(m);
    if (m.accountId === M.acct) toast(F('ml_new_from', 'New mail from %s', who(m.from)));
    if (!M.compose && !M.signin) render(); else renderRail();
  });

  var HTML = '<div class="ml" id="ml">' +
    '<div class="ml-rail"><div class="ml-brand"><span class="ml-logo">' + ICON_APP + '</span><span>' + esc(T('ml_app_name', 'Mail')) + '</span></div>' +
    '<button class="ml-btn primary ml-compose-btn" data-a="compose">' + esc(T('ml_new_mail', 'New mail')) + '</button>' +
    '<div class="ml-acct" id="ml-acct"></div><div id="ml-folders"></div><div class="ml-foot" id="ml-foot"></div></div>' +
    '<div class="ml-main"><div class="ml-head" id="ml-head"></div><div class="ml-body" id="ml-body"></div></div>' +
    '<div class="ml-toast" id="ml-toast"></div></div>';

  var root = S.registerApp({
    id: 'mail', icon: ICON_APP, titleKey: 'ml_app_name', titleDef: 'Mail', w: 1240, h: 760, html: HTML,
    onOpen: function () { ensureBound(); fresh(); render(); load(false); },
    onClose: function () { M.seq++; },
    onReset: function () { fresh(); if ($('ml')) render(); },
    onLocale: function () { if ($('ml')) { var a = document.querySelector('#ml .ml-compose-btn'); if (a) a.textContent = T('ml_new_mail', 'New mail'); var n = document.querySelector('#ml .ml-brand span:last-child'); if (n) n.textContent = T('ml_app_name', 'Mail'); render(); } }
  });
  if (root) ensureBound();
})();
