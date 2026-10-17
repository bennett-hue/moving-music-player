/*
 * Moving Music — Route Picker
 *
 * Free members pick ONE route to unlock. The chosen route is stored on
 * the Ghost member record as a label of the form "route-<slug>" via the
 * mmp-sync worker.
 *
 * Appears when:
 *   - member is signed in
 *   - member has no "route-*" label and no "legacy-free" label
 *   - current session hasn't dismissed the picker yet
 *
 * Also triggered explicitly by:
 *   - URL hash "#pick-route"
 *   - Any element with [data-mm-pick-route] (click handler attaches)
 *
 * Legacy-free members (grandfathered) are treated as a wildcard and
 * never see this picker.
 *
 * Security model (v1): same UUID-in-URL trust as the player playlist
 * route. Member UUID is server-side except to the signed-in user, so
 * knowing it is proof enough to write that member's own route label.
 *
 * v0.1.0 — Oct 2026
 */
(function () {
  'use strict';

  var VERSION = '0.1.0';
  var SYNC_URL = 'https://mmp-sync.bennett-727.workers.dev';
  var STORAGE_SKIPPED = 'mm-picker-skipped-this-session';
  var ACCENT = '#2A8C82';
  var STYLE_ID = 'mm-picker-style';
  var MODAL_ID = 'mm-picker-modal';

  // Routes offered in the picker. Keep order deliberate — most common
  // first, more specific later. Each route has a slug (matches the
  // Ghost tag slug exactly) and a short, Bennett-voice description.
  var ROUTES = [
    {
      slug: 'rowing',
      name: 'Rowing',
      desc: 'Songs for pulling together. Oar, line, tide.'
    },
    {
      slug: 'sea-shanties',
      name: 'Sea Shanties',
      desc: 'Shanties for the sea and the long haul.'
    },
    {
      slug: 'walking',
      name: 'Walking',
      desc: 'Songs with the pace of your feet.'
    },
    {
      slug: 'farm',
      name: 'Farm',
      desc: 'Songs for garden, harvest, field work.'
    },
    {
      slug: 'woods',
      name: 'Woods',
      desc: 'Songs for the ax, the saw, the stacked logs.'
    },
    {
      slug: 'maine',
      name: 'Maine',
      desc: 'Songs rooted in the Maine coast and woods.'
    },
    {
      slug: 'shaker',
      name: 'Shaker',
      desc: 'Shaker songs for simple work and gathering.'
    },
    {
      slug: 'love',
      name: 'Love',
      desc: 'Songs for the heart. Waltzes, laments, affection.'
    },
    {
      slug: 'gathering',
      name: 'Gathering',
      desc: 'Songs for coming together. Table, hearth, circle.'
    }
  ];

  // ------------------------------------------------------------
  // Member state
  // ------------------------------------------------------------

  var memberCache = null;
  var memberFetched = false;

  function fetchMember() {
    if (memberFetched) return Promise.resolve(memberCache);
    memberFetched = true;
    return fetch('/members/api/member/', {
      credentials: 'same-origin'
    }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (d) {
      memberCache = d || null;
      return memberCache;
    }).catch(function () {
      memberCache = null;
      return null;
    });
  }

  function labelSlugs(member) {
    if (!member || !member.labels) return [];
    return member.labels.map(function (l) {
      return (l && l.slug) ? l.slug : '';
    });
  }

  function hasAnyRouteLabel(member) {
    var slugs = labelSlugs(member);
    for (var i = 0; i < slugs.length; i++) {
      if (slugs[i].indexOf('route-') === 0) return true;
    }
    return false;
  }

  function hasLegacyLabel(member) {
    return labelSlugs(member).indexOf('legacy-free') !== -1;
  }

  function sessionSkipped() {
    try {
      return sessionStorage.getItem(STORAGE_SKIPPED) === '1';
    } catch (e) {
      return false;
    }
  }

  function markSkipped() {
    try {
      sessionStorage.setItem(STORAGE_SKIPPED, '1');
    } catch (e) {
      /* noop */
    }
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + MODAL_ID + '{',
      '  position:fixed;',
      '  inset:0;',
      '  background:rgba(0,0,0,.55);',
      '  z-index:99999;',
      '  display:flex;',
      '  align-items:center;',
      '  justify-content:center;',
      '  padding:2rem;',
      '  overflow-y:auto;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-card{',
      '  background:#fff;',
      '  border-radius:8px;',
      '  max-width:720px;',
      '  width:100%;',
      '  padding:2.4rem;',
      '  box-shadow:0 20px 60px rgba(0,0,0,.3);',
      '  position:relative;',
      '}',
      '#' + MODAL_ID + ' h2{',
      '  margin:0 0 .6rem;',
      '  font-size:2.4rem;',
      '  line-height:1.2;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-sub{',
      '  margin:0 0 1.8rem;',
      '  font-size:1.5rem;',
      '  line-height:1.4;',
      '  color:#555;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-grid{',
      '  display:grid;',
      '  grid-template-columns:repeat(3,1fr);',
      '  gap:1rem;',
      '  margin:0 0 1.6rem;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt{',
      '  background:#f6f6f6;',
      '  border:2px solid transparent;',
      '  border-radius:6px;',
      '  padding:1.2rem 1rem;',
      '  text-align:left;',
      '  cursor:pointer;',
      '  font:inherit;',
      '  touch-action:manipulation;',
      '  transition:border-color 80ms ease,',
      '    background 80ms ease;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt:hover,',
      '#' + MODAL_ID + ' .mm-picker-opt:focus{',
      '  border-color:' + ACCENT + ';',
      '  background:#eef7f5;',
      '  outline:none;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt[aria-selected="true"]{',
      '  border-color:' + ACCENT + ';',
      '  background:#eef7f5;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt-name{',
      '  display:block;',
      '  font-weight:600;',
      '  font-size:1.5rem;',
      '  margin-bottom:.3rem;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt-desc{',
      '  display:block;',
      '  font-size:1.25rem;',
      '  line-height:1.35;',
      '  color:#666;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-actions{',
      '  display:flex;',
      '  gap:1rem;',
      '  justify-content:flex-end;',
      '  align-items:center;',
      '  flex-wrap:wrap;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-skip{',
      '  background:none;',
      '  border:0;',
      '  color:#777;',
      '  font-size:1.3rem;',
      '  cursor:pointer;',
      '  text-decoration:underline;',
      '  padding:.6rem;',
      '  touch-action:manipulation;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-confirm{',
      '  background:' + ACCENT + ';',
      '  color:#fff;',
      '  border:0;',
      '  border-radius:999px;',
      '  padding:1rem 2.2rem;',
      '  font-size:1.5rem;',
      '  font-weight:600;',
      '  cursor:pointer;',
      '  touch-action:manipulation;',
      '  min-width:160px;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-confirm:disabled{',
      '  opacity:.45;',
      '  cursor:not-allowed;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-err{',
      '  margin:1rem 0 0;',
      '  font-size:1.3rem;',
      '  color:#b23;',
      '  min-height:1.3rem;',
      '}',
      '@media(max-width:620px){',
      '  #' + MODAL_ID + ' .mm-picker-grid{',
      '    grid-template-columns:1fr 1fr;',
      '  }',
      '  #' + MODAL_ID + ' .mm-picker-card{',
      '    padding:1.6rem;',
      '  }',
      '  #' + MODAL_ID + ' h2{font-size:2rem}',
      '}',
      '@media(max-width:420px){',
      '  #' + MODAL_ID + ' .mm-picker-grid{',
      '    grid-template-columns:1fr;',
      '  }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------
  // Modal construction
  // ------------------------------------------------------------

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    injectStyle();

    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'mm-picker-title');

    var card = document.createElement('div');
    card.className = 'mm-picker-card';

    var h = document.createElement('h2');
    h.id = 'mm-picker-title';
    h.textContent = 'Pick your free route';

    var sub = document.createElement('p');
    sub.className = 'mm-picker-sub';
    sub.textContent =
      'Your free account unlocks one route. ' +
      'You can change it later in your account settings. ' +
      'Full Songbook members unlock all routes.';

    var grid = document.createElement('div');
    grid.className = 'mm-picker-grid';

    var selected = null;

    ROUTES.forEach(function (r) {
      var btn = document.createElement('button');
      btn.className = 'mm-picker-opt';
      btn.type = 'button';
      btn.setAttribute('data-slug', r.slug);
      btn.setAttribute('aria-selected', 'false');

      var n = document.createElement('span');
      n.className = 'mm-picker-opt-name';
      n.textContent = r.name;

      var d = document.createElement('span');
      d.className = 'mm-picker-opt-desc';
      d.textContent = r.desc;

      btn.appendChild(n);
      btn.appendChild(d);

      btn.addEventListener('click', function () {
        selected = r.slug;
        var all = grid.querySelectorAll('.mm-picker-opt');
        for (var i = 0; i < all.length; i++) {
          all[i].setAttribute('aria-selected', 'false');
        }
        btn.setAttribute('aria-selected', 'true');
        confirmBtn.disabled = false;
      });

      grid.appendChild(btn);
    });

    var actions = document.createElement('div');
    actions.className = 'mm-picker-actions';

    var skipBtn = document.createElement('button');
    skipBtn.className = 'mm-picker-skip';
    skipBtn.type = 'button';
    skipBtn.textContent = 'Skip for now';
    skipBtn.addEventListener('click', function () {
      markSkipped();
      close();
    });

    var confirmBtn = document.createElement('button');
    confirmBtn.className = 'mm-picker-confirm';
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Unlock this route';
    confirmBtn.disabled = true;
    confirmBtn.addEventListener('click', function () {
      if (!selected) return;
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving...';
      saveRoute(selected).then(function (ok) {
        if (ok) {
          close();
          // Reload so server-side rendering reflects the new label.
          window.location.reload();
        } else {
          confirmBtn.disabled = false;
          confirmBtn.textContent = 'Unlock this route';
          errBox.textContent =
            'Could not save your pick. Try again?';
        }
      });
    });

    actions.appendChild(skipBtn);
    actions.appendChild(confirmBtn);

    var errBox = document.createElement('p');
    errBox.className = 'mm-picker-err';

    card.appendChild(h);
    card.appendChild(sub);
    card.appendChild(grid);
    card.appendChild(actions);
    card.appendChild(errBox);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function close() {
    var el = document.getElementById(MODAL_ID);
    if (el) el.remove();
  }

  // ------------------------------------------------------------
  // Save route via worker
  // ------------------------------------------------------------

  function saveRoute(slug) {
    return fetchMember().then(function (m) {
      if (!m || !m.uuid) return false;
      return fetch(SYNC_URL + '/pick-route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uuid: m.uuid,
          route: slug
        })
      }).then(function (r) {
        return r.ok;
      }).catch(function () {
        return false;
      });
    });
  }

  // ------------------------------------------------------------
  // Trigger logic
  // ------------------------------------------------------------

  function shouldAutoOpen(member) {
    if (!member || !member.uuid) return false;
    if (member.status === 'paid') return false;
    if (hasLegacyLabel(member)) return false;
    if (hasAnyRouteLabel(member)) return false;
    if (sessionSkipped()) return false;
    return true;
  }

  function openIfNeeded() {
    fetchMember().then(function (m) {
      if (shouldAutoOpen(m)) buildModal();
    });
  }

  function openByHash() {
    if (window.location.hash === '#pick-route') {
      buildModal();
      // Clear hash so refresh doesn't re-trigger forever.
      history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
    }
  }

  function attachExplicitTriggers() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      // Walk up a few levels in case click lands on nested text.
      for (var i = 0; i < 4 && t && t !== document.body; i++) {
        if (t.getAttribute &&
            t.getAttribute('data-mm-pick-route') !== null) {
          e.preventDefault();
          buildModal();
          return;
        }
        t = t.parentNode;
      }
    });
  }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------

  function start() {
    attachExplicitTriggers();
    openByHash();
    openIfNeeded();
    window.addEventListener('hashchange', openByHash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Expose version for debugging.
  window.MM_PICKER_VERSION = VERSION;
})();
