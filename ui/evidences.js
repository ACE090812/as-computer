// Evidences apps: each of evidences' own tools (Citizens, Fingerprint, DNA, Firearms Registry,
// Ballistics, Wiretap) gets its OWN desktop icon/window here, instead of the whole evidences laptop
// (with its own internal desktop/taskbar) being nested inside one window. This talks to a dedicated
// 'standalone' build of evidences' laptop UI (html/dui/laptop/dist/standalone.html?app=<id>) that
// renders just one app with no screensaver/login/desktop wrapper — see evidences' own
// src/standalone.tsx for that half of this.
(function () {
  if (window.__evidencesAppsRegistered) return;
  window.__evidencesAppsRegistered = true;

  // id -> { titleKey, titleDef, icon (svg) }
  // NOTE: 'citizens' was removed on purpose — its data (name/DOB/gender/vehicles/etc, all backed by
  // the same real citizenid since evidences' config.citizens.synced = true) is now shown on the
  // computer's own MDT app under People, along with the biometric/firearms sections this app used
  // to show. See ui/mdt.js's renderPersonDetail() and server/mdt.lua's getCitizen().
  var APPS = {
    fingerprint: {
      titleKey: 'ui_app_fingerprint', titleDef: 'Fingerprint',
      icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-4 0-7 3-7 7v3c0 3 1 5.5 3 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 6.5c-2.5 0-4.5 2-4.5 4.5v2.5c0 2.5.8 4.5 2.2 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 10a2.5 2.5 0 012.5 2.5c0 3-1 5-3 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M16.5 8c1 1.2 1.5 2.7 1.5 4.5 0 3-1 5.5-2.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    },
    dna: {
      titleKey: 'ui_app_dna', titleDef: 'DNA',
      icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 3c0 6 10 6 10 12s-10 6-10 12M17 3c0 6-10 6-10 12s10 6 10 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 7h8M7.5 12h9M7.5 15h9M8 20h8" stroke="currentColor" stroke-width="1.3"/></svg>'
    },
    firearms_registry: {
      titleKey: 'ui_app_firearms_registry', titleDef: 'Firearms Registry',
      icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 15h11l3-3h4v3h-2l-2 3H8l-2 2H3v-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 15v-4h4v4" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    },
    ballistics: {
      titleKey: 'ui_app_ballistics', titleDef: 'Ballistics',
      icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
    },
    wiretap: {
      titleKey: 'ui_app_wiretap', titleDef: 'Wiretap',
      icon: '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 10a8 8 0 0016 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M12 14v6M9 20h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="9" y="3" width="6" height="9" rx="3" stroke="currentColor" stroke-width="1.5"/></svg>'
    }
  };

  function boot() {
    if (!window.LSOS || typeof window.LSOS.registerApp !== 'function') { setTimeout(boot, 30); return; }

    var frames = {};   // id -> iframe element
    var ready = {};    // id -> bool
    var pending = {};  // id -> queued payload

    function seApi(action, body) {
      return fetch('https://' + (window.GetParentResourceName ? window.GetParentResourceName() : 'as-computer') + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); }).catch(function () { return undefined; });
    }

    function sendFocus(id, extraArgs) {
      var frame = frames[id];
      if (!frame || !frame.contentWindow) return;
      seApi('evidencesApi', { name: 'focus' }).then(function (r) {
        if (!r || !r.ok || !r.data) { pending[id] = null; return; }
        var payload = Object.assign({ action: 'focus' }, r.data);
        if (ready[id]) {
          frame.contentWindow.postMessage(payload, '*');
          if (extraArgs) frame.contentWindow.postMessage({ action: 'openArgs', args: extraArgs }, '*');
        } else {
          pending[id] = payload;
        }
      });
    }

    window.addEventListener('message', function (e) {
      var id = null;
      for (var k in frames) { if (frames[k] && e.source === frames[k].contentWindow) { id = k; break; } }
      if (!id) return;
      var data = e.data || {};

      // The standalone page posts this itself once it has mounted — much more reliable than the
      // iframe's own 'load' event, which can fire before we've attached a listener (or otherwise
      // race), leaving the page stuck on its "waiting for focus" black screen forever.
      if (data.action === 'standaloneReady') {
        ready[id] = true;
        if (pending[id]) { frames[id].contentWindow.postMessage(pending[id], '*'); pending[id] = null; }
        else sendFocus(id);
        return;
      }

      // A sibling app cross-linking (e.g. "view this citizen's firearms" from the Citizens app) asks
      // us, the host, to open (or focus) the target app's own window and hand it the initial args.
      if (data.action === 'openApp' && APPS[data.id]) {
        openEvidencesApp(data.id, data.args);
      } else if (data.action === 'closeSelf') {
        var w = document.getElementById('win-' + id);
        var btn = w && w.querySelector('[data-wb="close"]');
        if (btn) btn.click();
      }
    });

    function openEvidencesApp(id, args) {
      // ui/app.js doesn't expose its internal openApp/openWin, so we reuse the same desktop-icon
      // double-click path a player would use — this also brings it to front if already open.
      if (!APPS[id]) return;
      var el = document.querySelector('[data-app="' + id + '"]');
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      setTimeout(function () { sendFocus(id, args); }, 60);
    }

    // Exposed so OTHER as-computer apps (currently: MDT's People section, see ui/mdt.js) can open
    // one of evidences' own apps with initial args, the same way evidences' apps already do it
    // amongst themselves via postMessage — MDT isn't inside an evidences iframe, so it needs a
    // plain function to call instead of a message to send.
    window.__openEvidencesApp = openEvidencesApp;

    Object.keys(APPS).forEach(function (id) {
      var def = APPS[id];
      window.LSOS.registerApp({
        id: id,
        icon: def.icon,
        titleKey: def.titleKey, titleDef: def.titleDef,
        w: 1360, h: 820,
        // IMPORTANT: registerApp() (ui/app.js) sets this `html` as innerHTML IMMEDIATELY, when the
        // resource/page boots — not lazily when the window is actually opened. With 6 real apps that
        // used to mean 6 concurrent eager `<iframe src="nui://evidences/...">` loads (each a full
        // React bundle) firing at once on every as-computer restart, before anything was even
        // clicked — almost certainly what was crashing the game client. Fix: only an empty
        // placeholder container goes in here; the iframe itself is created in onOpen and fully
        // removed (not just src-reset) in onClose, so nothing loads until a player opens the app.
        html: '<div id="evidences-holder-' + id + '" style="width:100%;height:100%;background:#15181c"></div>',
        onOpen: function () {
          // registerApp/openWin call onOpen/onClose with no arguments — the window's container
          // element has to be looked up by id (registerApp names it 'win-' + the app id) rather
          // than received as a parameter.
          var holder = document.getElementById('evidences-holder-' + id);
          if (!holder) return;
          if (!frames[id]) {
            var f = document.createElement('iframe');
            f.id = 'evidences-frame-' + id;
            f.src = 'nui://evidences/html/dui/laptop/dist/standalone.html?app=' + id;
            f.style.cssText = 'width:100%;height:100%;border:0;background:#15181c';
            f.setAttribute('allow', 'clipboard-read; clipboard-write');
            holder.appendChild(f);
            frames[id] = f;
          }
          ready[id] = false; pending[id] = null;
          // Readiness comes from the page's own 'standaloneReady' message (see the listener above),
          // not the iframe's 'load' event — nothing to do here until that arrives.
        },
        onClose: function () {
          // Fully remove the iframe (not just reset its src) so a closed app costs nothing — same
          // as if it had never been opened — instead of sitting there loaded in the background.
          var holder = document.getElementById('evidences-holder-' + id);
          if (holder) holder.innerHTML = '';
          frames[id] = null; ready[id] = false; pending[id] = null;
        }
      });
    });
  }

  boot();
})();
