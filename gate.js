/*
 * Moving Music — Route Gate
 *
 * On a single-post page, decides whether the signed-in free member can
 * see the content based on their chosen route label and the post's
 * route tags.
 *
 *   paid member                     → show content
 *   legacy-free label (grandfather) → show content
 *   anonymous visitor               → Ghost's server-side paywall
 *                                     handles this; we do nothing
 *   free member, route-X label and
 *     post tagged with X            → show content
 *   free member, route-X label but
 *     post NOT tagged with X        → hide content, show upgrade card
 *   free member, no route label     → hide content, show "pick a route"
 *                                     card (picker opens on CTA)
 *
 * Reads body class list for `.post-template` and `.tag-<slug>` entries.
 * Reads the signed-in member via /members/api/member/.
 *
 * v0.1.0 — Oct 2026
 */
(function () {
  'use strict';

  var VERSION = '0.1.1';
  var ACCENT = '#2A8C82';
  var SYNC_URL = 'https://mmp-sync.bennett-727.workers.dev';
  var STYLE_ID = 'mm-gate-style';
  var CARD_CLASS = 'mm-gate-card';

  // Routes that a free member can unlock via the picker. Must stay in
  // sync with picker.js ROUTES and the worker ALLOWED_ROUTES.
  var ROUTES = [
    'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
    'maine', 'shaker', 'love', 'gathering'
  ];

  // Human names for routes (for upgrade card copy).
  var ROUTE_NAMES = {
    rowing: 'Rowing',
    'sea-shanties': 'Sea Shanties',
    walking: 'Walking',
    farm: 'Farm',
    woods: 'Woods',
    maine: 'Maine',
    shaker: 'Shaker',
    love: 'Love',
    gathering: 'Gathering'
  };

  // ------------------------------------------------------------
  // Page type detection
  // ------------------------------------------------------------

  function isPostPage() {
    return !!(document.body &&
      document.body.classList.contains('post-template'));
  }

  function postRouteTags() {
    if (!document.body) return [];
    var out = [];
    var classes = document.body.classList;
    for (var i = 0; i < classes.length; i++) {
      var c = classes[i];
      if (c.indexOf('tag-') !== 0) continue;
      var slug = c.substring(4);
      if (ROUTES.indexOf(slug) !== -1) out.push(slug);
    }
    return out;
  }

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
      // /members/api/member/ doesn't include labels — proxy via worker.
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

  function labelSlugs(member) {
    if (!member || !member.labels) return [];
    return member.labels.map(function (l) {
      return (l && l.slug) ? l.slug : '';
    });
  }

  function memberRoute(member) {
    var slugs = labelSlugs(member);
    for (var i = 0; i < slugs.length; i++) {
      if (slugs[i].indexOf('route-') === 0) {
        return slugs[i].substring(6);
      }
    }
    return null;
  }

  // Full access: Ghost status "paid" or "comped" (owner-granted
  // complimentary), or a live subscription. Keep in sync with
  // picker.js and tiers.js.
  function isPaid(member) {
    if (!member) return false;
    if (member.status === 'paid' || member.status === 'comped') {
      return true;
    }
    var subs = member.subscriptions || [];
    for (var i = 0; i < subs.length; i++) {
      var st = subs[i] && subs[i].status;
      if (st === 'active' || st === 'trialing') return true;
    }
    return false;
  }

  function isLegacy(member) {
    return labelSlugs(member).indexOf('legacy-free') !== -1;
  }

  // ------------------------------------------------------------
  // Styles + card
  // ------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.' + CARD_CLASS + '{',
      '  margin:2.4rem auto;',
      '  max-width:720px;',
      '  padding:2rem;',
      '  background:#f6f6f6;',
      '  border-radius:8px;',
      '  text-align:center;',
      '  font-size:1.5rem;',
      '  line-height:1.5;',
      '}',
      '.' + CARD_CLASS + ' h3{',
      '  margin:0 0 .8rem;',
      '  font-size:1.9rem;',
      '  line-height:1.2;',
      '}',
      '.' + CARD_CLASS + ' p{',
      '  margin:0 0 1.4rem;',
      '  color:#444;',
      '}',
      '.' + CARD_CLASS + ' .mm-gate-btn{',
      '  display:inline-block;',
      '  background:' + ACCENT + ';',
      '  color:#fff;',
      '  font-weight:600;',
      '  padding:1rem 2rem;',
      '  border-radius:999px;',
      '  text-decoration:none;',
      '  margin:0 .4rem;',
      '  touch-action:manipulation;',
      '}',
      '.' + CARD_CLASS + ' .mm-gate-btn.alt{',
      '  background:#fff;',
      '  color:' + ACCENT + ';',
      '  border:2px solid ' + ACCENT + ';',
      '  padding:.8rem 2rem;',
      '}',
      '.' + CARD_CLASS + ' .mm-gate-note{',
      '  display:block;',
      '  font-size:1.2rem;',
      '  color:#666;',
      '  margin-top:1rem;',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function contentContainer() {
    // Prefer the article content area; fall back to .post-content.
    return document.querySelector('.gh-content') ||
      document.querySelector('.post-content') ||
      document.querySelector('article .post');
  }

  function buildUpgradeCard(opts) {
    injectStyle();
    var w = document.createElement('div');
    w.className = CARD_CLASS;

    var h = document.createElement('h3');
    h.textContent = opts.title;
    w.appendChild(h);

    if (opts.body) {
      var p = document.createElement('p');
      p.textContent = opts.body;
      w.appendChild(p);
    }

    opts.buttons.forEach(function (b) {
      var a = document.createElement('a');
      a.className = 'mm-gate-btn' + (b.alt ? ' alt' : '');
      a.href = b.href;
      a.textContent = b.label;
      if (b.onClick) {
        a.addEventListener('click', b.onClick);
      }
      w.appendChild(a);
    });

    if (opts.note) {
      var n = document.createElement('span');
      n.className = 'mm-gate-note';
      n.textContent = opts.note;
      w.appendChild(n);
    }

    return w;
  }

  function replaceContent(card) {
    var c = contentContainer();
    if (!c) return;
    // Keep the first heading / meta if we can locate the article
    // header, hide the body content, then insert the card.
    c.innerHTML = '';
    c.appendChild(card);
  }

  // ------------------------------------------------------------
  // Gate decision
  // ------------------------------------------------------------

  function decide(member) {
    if (!isPostPage()) return;
    if (!member || !member.uuid) return;  // anonymous: Ghost handles
    if (isPaid(member)) return;           // paid: full access
    if (isLegacy(member)) return;         // grandfathered: full access

    var postTags = postRouteTags();
    if (postTags.length === 0) return;    // not a route-gated post

    var picked = memberRoute(member);

    if (picked && postTags.indexOf(picked) !== -1) {
      return;                              // match: full access
    }

    // No match: either they picked a different route or none yet.
    if (picked) {
      var pickedName = ROUTE_NAMES[picked] || picked;
      var thisName = ROUTE_NAMES[postTags[0]] || postTags[0];
      var card = buildUpgradeCard({
        title: 'This song is in ' + thisName + '.',
        body: 'You chose ' + pickedName +
          '. Join the Full Songbook for all of it.',
        buttons: [
          {
            label: 'Join the Full Songbook',
            href: '#/portal/signup/paid'
          },
          {
            label: 'Change my route',
            alt: true,
            href: '#pick-route'
          }
        ]
      });
      replaceContent(card);
    } else {
      // Free member who hasn't picked yet.
      var pcard = buildUpgradeCard({
        title: 'Pick your free route',
        body: '',
        buttons: [
          {
            label: 'Pick a route',
            href: '#pick-route'
          }
        ]
      });
      replaceContent(pcard);
    }
  }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------

  function start() {
    if (!isPostPage()) return;
    fetchMember().then(decide);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  window.MM_GATE_VERSION = VERSION;
})();
