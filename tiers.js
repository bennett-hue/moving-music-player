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

  var VERSION = '0.1.0';
  var SYNC_URL = 'https://mmp-sync.bennett-727.workers.dev';

  // Must stay in sync with picker.js and gate.js.
  var ROUTES = [
    'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
    'maine', 'shaker', 'love', 'gathering'
  ];
  var ALWAYS_FREE = ['courage'];

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

  function rewriteCard(cardEl, member) {
    var slug = routeSlugFromCard(cardEl);
    if (!slug) return;
    var hint = cardEl.querySelector('.tier-hint');
    if (!hint) return;

    // Songs of Courage and any always-free route: no label at all.
    if (ALWAYS_FREE.indexOf(slug) !== -1) {
      hint.style.display = 'none';
      return;
    }

    var isPickerRoute = ROUTES.indexOf(slug) !== -1;

    // Anonymous visitor: leave HTML label as-is (prompts signup).
    if (!member || !member.uuid) return;

    // Paid or legacy-free: full access to everything.
    if (isPaid(member) || isLegacy(member)) {
      hint.style.display = 'none';
      return;
    }

    // Free member with a picked route.
    if (isPickerRoute) {
      var picked = memberRoute(member);
      if (picked === slug) {
        hint.style.display = 'none';   // this is their route
        return;
      }
      // Different route than theirs: offer the Full Songbook upgrade.
      var a = hint.querySelector('a');
      if (a) {
        a.textContent = 'Join Full Songbook';
        a.setAttribute(
          'href',
          'https://movingmusic.works/#/portal/signup/paid'
        );
      } else {
        hint.textContent = 'Join Full Songbook';
      }
      return;
    }

    // Non-picker, non-courage route (shouldn't exist under new
    // design, but leave label untouched if encountered).
  }

  function rewriteAll(member) {
    var cards = document.querySelectorAll('.route');
    for (var i = 0; i < cards.length; i++) {
      rewriteCard(cards[i], member);
    }
  }

  function start() {
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
