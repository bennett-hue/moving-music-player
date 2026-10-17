/*
 * Moving Music — Tier Labels
 *
 * Rewrites the `.tier-hint` labels on route cards (Chart Your Course
 * page, and anywhere else `.route` cards appear) to reflect the current
 * viewer's access state.
 *
 * Rules
 *   anonymous visitor         keep whatever label is in the HTML
 *                             (prompts them to sign up or subscribe)
 *   paid member               hide every tier-hint; they have it all
 *   legacy-free member        same as paid for display purposes
 *   free member w/ route X    hide tier-hint on route X; on other
 *                             picker routes replace with
 *                             "Join Full Songbook"
 *   Songs of Courage          always no label (open to anonymous)
 *
 * Member labels fetched via the mmp-sync worker (Ghost's
 * /members/api/member/ doesn't expose them).
 *
 * v0.1.0 — Oct 2026
 */
(function () {
  'use strict';

  var VERSION = '0.2.0';
  var SYNC_URL = 'https://mmp-sync.bennett-727.workers.dev';
  var STYLE_ID = 'mm-tiers-style';
  var DIM_CLASS = 'mm-tier-dim';

  // Must stay in sync with picker.js and gate.js.
  var ROUTES = [
    'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
    'maine', 'shaker', 'love', 'gathering'
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
      if (r.status === 204 || !r.ok) return null;
      return r.json();
    }).then(function (d) {
      if (!d || !d.uuid) {
        memberCache = d || null;
        return memberCache;
      }
      return fetch(SYNC_URL + '/member/' + d.uuid).then(function (r) {
        if (!r.ok) return { labels: [] };
        return r.json();
      }).then(function (lx) {
        d.labels = (lx && lx.labels) || [];
        memberCache = d;
        return memberCache;
      }).catch(function () {
        d.labels = [];
        memberCache = d;
        return memberCache;
      });
    }).catch(function () {
      return null;
    });
  }

  function labelSlugs(m) {
    if (!m || !m.labels) return [];
    return m.labels.map(function (l) {
      return (l && l.slug) ? l.slug : '';
    });
  }

  function memberRoute(m) {
    var ls = labelSlugs(m);
    for (var i = 0; i < ls.length; i++) {
      if (ls[i].indexOf('route-') === 0) {
        return ls[i].substring(6);
      }
    }
    return null;
  }

  function isPaid(m) { return !!(m && m.status === 'paid'); }
  function isLegacy(m) {
    return labelSlugs(m).indexOf('legacy-free') !== -1;
  }

  // ------------------------------------------------------------
  // Route card parsing
  // ------------------------------------------------------------

  function routeSlugFromCard(cardEl) {
    var a = cardEl.querySelector('a[href*="/tag/"]');
    if (!a) return null;
    var m = /\/tag\/([^\/\?#]+)/.exec(a.getAttribute('href') || '');
    return m ? m[1] : null;
  }

  function hasAccess(slug, labelText, member) {
    // Public to everyone: the HTML label says "No account needed".
    if (/no account needed/i.test(labelText || '')) return true;
    // Signed-in paid or legacy-free: full access to everything.
    if (member) {
      if (isPaid(member)) return true;
      if (isLegacy(member)) return true;
      if (ROUTES.indexOf(slug) !== -1) {
        var picked = memberRoute(member);
        if (picked === slug) return true;
      }
    }
    return false;
  }

  function rewriteCard(cardEl, member) {
    var slug = routeSlugFromCard(cardEl);
    if (!slug) return;
    var hint = cardEl.querySelector('.tier-hint');

    // Normalize stale "Free with email signup" wording — under the
    // picker design that tier no longer exists. Keep the link, swap
    // the text to the unified "Full access with membership" prompt.
    if (hint) {
      var link = hint.querySelector('a');
      var current = (link ? link.textContent : hint.textContent) || '';
      if (/free with email signup/i.test(current)) {
        if (link) {
          link.textContent = 'Full access with membership';
        } else {
          hint.textContent = 'Full access with membership';
        }
      }
    }

    var labelText = hint ? hint.textContent : '';
    if (hasAccess(slug, labelText, member)) {
      cardEl.classList.remove(DIM_CLASS);
    } else {
      cardEl.classList.add(DIM_CLASS);
    }
  }

  function rewriteAll(member) {
    var cards = document.querySelectorAll('.route');
    for (var i = 0; i < cards.length; i++) {
      rewriteCard(cards[i], member);
    }
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.route.' + DIM_CLASS + '{',
      '  opacity:0.45;',
      '  transition:opacity 160ms ease;',
      '}',
      '.route.' + DIM_CLASS + ':hover{',
      '  opacity:0.75;',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function start() {
    injectStyle();
    fetchMember().then(function (m) {
      rewriteAll(m);
      // Re-run after a short delay in case the page content loads
      // asynchronously (details/summary toggles, etc.).
      setTimeout(function () { rewriteAll(m); }, 500);
      setTimeout(function () { rewriteAll(m); }, 1500);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.MM_TIERS_VERSION = VERSION;
})();
