/*
 * Moving Music — Songbook Picker (Nov 2026 rebuild)
 *
 * One pick per free member. Modal shown on page load for a signed-in
 * free member with no pick. On confirm, writes a "pick:<slug>" member
 * label through the mmp-sync Worker and runs gating.
 *
 * Gating replaces the old songbookGate() hide-after-3 behavior. On a
 * post, a song outside the pick (and outside free/courage/nasc) shows
 * only its first section plus a CTA. On the page of a songbook the
 * member did not pick, one CTA goes at the top of the list; songs get no
 * lock mark (Bennett, Nov 9: the mark also landed on songs open through
 * the member's own songbook).
 *
 * Load gated on window.MM_PICKER_ENABLED. Keep the flag false for
 * visitors until the switch-over; pick is final and the dozens of
 * existing free members would see the picker on their next visit.
 *
 * Internal name "pick" maps to visitor-facing "songbook".
 */
(function () {
  'use strict';

  if (!window.MM_PICKER_ENABLED) return;

  var VERSION = '1.0.0';
  var SYNC_URL = 'https://mmp-sync.bennett-727.workers.dev';
  var CONTENT_KEY = '4bb24d5f52e1f7397cb4fe24a5';
  var CONTENT_HOST = 'https://moving-music.ghost.io';

  // Visitor-facing name on left, internal slug (Ghost tag slug) on
  // right. Order matches the homepage grid.
  var PICKABLE = [
    { slug: 'walking',             name: 'Walking & Jogging' },
    { slug: 'rowing',              name: 'Rowing, Paddling & Sailing' },
    { slug: 'gathering',           name: 'Home, Gathering & Lullabies' },
    { slug: 'field-forest',        name: 'Field & Forest' },
    { slug: 'originals',           name: 'Original Worksongs, Bluegrass & Country' },
    { slug: 'dance-instrumentals', name: 'Dance & Instrumentals' }
  ];
  var PICKABLE_SLUGS = PICKABLE.map(function (p) { return p.slug; });

  // Open to every visitor regardless of pick.
  var OPEN_TAGS = ['free', 'courage', 'nasc'];

  var MODAL_ID = 'mm-picker-modal';
  var STYLE_ID = 'mm-picker-style';
  var CTA_CLASS = 'mm-picker-cta';
  var LOCK_CLASS = 'mm-picker-lock';

  function cacheKey(uuid) { return 'mm_pick_' + uuid; }

  // ------------------------------------------------------------
  // Member + pick state
  // ------------------------------------------------------------

  var memberCache = null;
  var memberFetched = false;

  function fetchMember() {
    if (memberFetched) return Promise.resolve(memberCache);
    memberFetched = true;
    return fetch('/members/api/member/', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 204 || !r.ok) return null;
        return r.json();
      })
      .then(function (d) { memberCache = d || null; return memberCache; })
      .catch(function () { memberCache = null; return null; });
  }

  function hasFullAccess(member) {
    if (!member) return false;
    if (member.paid === true) return true;
    if (member.status === 'paid' || member.status === 'comped') return true;
    var subs = member.subscriptions || [];
    for (var i = 0; i < subs.length; i++) {
      var st = subs[i] && subs[i].status;
      if (st === 'active' || st === 'trialing') return true;
    }
    return false;
  }

  function cachedPick(uuid) {
    try { return localStorage.getItem(cacheKey(uuid)) || null; }
    catch (e) { return null; }
  }

  function setCachedPick(uuid, slug) {
    try { localStorage.setItem(cacheKey(uuid), slug); }
    catch (e) { /* noop */ }
  }

  function remotePick(uuid) {
    return fetch(SYNC_URL + '/pick?uuid=' + encodeURIComponent(uuid))
      .then(function (r) {
        if (r.status === 404) return { pick: null };
        if (!r.ok) throw new Error('pick GET ' + r.status);
        return r.json();
      });
  }

  function writePick(uuid, slug) {
    return fetch(SYNC_URL + '/pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uuid: uuid, pick: slug })
    }).then(function (r) {
      return r.json().then(function (d) { return { status: r.status, body: d }; });
    });
  }

  // ------------------------------------------------------------
  // Count fetch: tag post counts from the Content API.
  // ------------------------------------------------------------

  var countsPromise = null;

  function fetchCounts() {
    if (countsPromise) return countsPromise;
    var filter = encodeURIComponent(
      'slug:[' + PICKABLE_SLUGS.join(',') + ']'
    );
    var url = CONTENT_HOST +
      '/ghost/api/content/tags/?key=' + CONTENT_KEY +
      '&filter=' + filter +
      '&include=count.posts&limit=all';
    countsPromise = fetch(url)
      .then(function (r) { return r.ok ? r.json() : { tags: [] }; })
      .then(function (d) {
        var out = {};
        (d.tags || []).forEach(function (t) {
          out[t.slug] = (t.count && t.count.posts) || 0;
        });
        return out;
      })
      .catch(function () { return {}; });
    return countsPromise;
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
      '  position:fixed;inset:0;z-index:99999;',
      '  background:rgba(35,31,27,.55);',
      '  display:flex;align-items:center;justify-content:center;',
      '  padding:2rem;overflow-y:auto;box-sizing:border-box;',
      '  font-family:"Work Sans",system-ui,sans-serif;',
      '}',
      '#' + MODAL_ID + ' *{box-sizing:border-box;}',
      '#' + MODAL_ID + ' .mm-picker-card{',
      '  background:#fbf8f2;max-width:560px;width:100%;',
      '  padding:2.2rem 2rem 1.8rem;',
      '  box-shadow:0 20px 60px rgba(35,31,27,.3);',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt{min-width:0;}',
      '#' + MODAL_ID + ' .mm-picker-eyebrow{',
      '  font-family:"EB Garamond",Garamond,serif;',
      '  font-style:italic;font-size:1rem;color:#5a5248;',
      '  margin:0 0 .35rem;',
      '}',
      '#' + MODAL_ID + ' h2{',
      '  font-family:"EB Garamond",Garamond,serif;',
      '  font-weight:500;margin:0 0 1.2rem;',
      '  font-size:1.9rem;line-height:1.15;color:#231f1b;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-grid{',
      '  display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);',
      '  gap:.6rem;margin:0 0 1rem;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt{',
      '  background:#f3ede1;border:1.5px solid #cbbfa6;',
      '  padding:.95rem 1rem;text-align:left;',
      '  cursor:pointer;font:inherit;color:#231f1b;',
      '  display:flex;align-items:baseline;justify-content:space-between;',
      '  gap:.6rem;touch-action:manipulation;',
      '  transition:border-color 120ms,background 120ms;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt:hover,',
      '#' + MODAL_ID + ' .mm-picker-opt:focus{',
      '  border-color:#231f1b;background:#fbf8f2;outline:none;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt[aria-selected="true"]{',
      '  border-color:#8a2f22;background:#fbf8f2;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt-name{',
      '  font-weight:500;font-size:1rem;line-height:1.25;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-opt-count{',
      '  font-family:"EB Garamond",Garamond,serif;',
      '  font-style:italic;font-size:.9rem;color:#5a5248;',
      '  white-space:nowrap;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-one{',
      '  margin:.2rem 0 1.2rem;font-size:.9rem;color:#5a5248;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-actions{',
      '  display:flex;justify-content:flex-end;align-items:center;',
      '  gap:1rem;flex-wrap:wrap;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-confirm{',
      '  background:#8a2f22;color:#fbf8f2;border:0;',
      '  padding:.85rem 1.8rem;font:inherit;font-weight:500;',
      '  font-size:.95rem;cursor:pointer;',
      '  touch-action:manipulation;min-width:160px;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-confirm:hover,',
      '#' + MODAL_ID + ' .mm-picker-confirm:focus{',
      '  background:#6f2419;outline:none;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-confirm:disabled{',
      '  opacity:.45;cursor:not-allowed;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-err{',
      '  margin:.9rem 0 0;color:#8a2f22;font-size:.9rem;',
      '  min-height:1.1rem;',
      '}',
      '#' + MODAL_ID + ' .mm-picker-done{',
      '  margin:1.4rem 0 .4rem;font-size:1.1rem;color:#231f1b;',
      '  font-family:"EB Garamond",Garamond,serif;',
      '}',
      '@media(max-width:600px){',
      '  #' + MODAL_ID + '{padding:1rem;}',
      '  #' + MODAL_ID + ' .mm-picker-grid{grid-template-columns:minmax(0,1fr);}',
      '  #' + MODAL_ID + ' .mm-picker-card{padding:1.6rem 1.4rem;max-width:100%;}',
      '  #' + MODAL_ID + ' h2{font-size:1.65rem;}',
      '  #' + MODAL_ID + ' .mm-picker-actions{justify-content:stretch;}',
      '  #' + MODAL_ID + ' .mm-picker-confirm{width:100%;min-width:0;}',
      '}',
      // Gating: CTA block and lock marker on tag/index pages
      '.' + CTA_CLASS + '{',
      '  background:#fbf8f2;border:1px solid #cbbfa6;',
      '  padding:1.2rem 1.4rem;margin:1.2rem 0;',
      '  font-family:"EB Garamond",Garamond,serif;',
      '  color:#231f1b;',
      '}',
      '.' + CTA_CLASS + ' .mm-picker-cta-line{',
      '  margin:0 0 .8rem;line-height:1.45;',
      '}',
      '.' + CTA_CLASS + ' .mm-picker-cta-btn{',
      '  background:#8a2f22;color:#fbf8f2;',
      '  padding:.55rem 1.1rem;text-decoration:none;',
      '  font-family:"Work Sans",system-ui,sans-serif;',
      '  font-size:.9rem;display:inline-block;',
      '}',
      '.' + CTA_CLASS + ' .mm-picker-cta-btn:hover{background:#6f2419;}',
      '.' + LOCK_CLASS + '{',
      '  display:inline-block;margin-left:.35em;',
      '  font-family:"EB Garamond",Garamond,serif;font-style:italic;',
      '  color:#8a5a47;font-size:.85em;',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------
  // Modal
  // ------------------------------------------------------------

  function nameOf(slug) {
    for (var i = 0; i < PICKABLE.length; i++) {
      if (PICKABLE[i].slug === slug) return PICKABLE[i].name;
    }
    return slug;
  }

  function openModal(onConfirmed) {
    injectStyle();
    if (document.getElementById(MODAL_ID)) return;

    var overlay = document.createElement('div');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    var card = document.createElement('div');
    card.className = 'mm-picker-card';

    var eye = document.createElement('p');
    eye.className = 'mm-picker-eyebrow';
    eye.textContent = 'Welcome aboard';

    var h = document.createElement('h2');
    h.id = 'mm-picker-title';
    h.textContent = 'Pick your free songbook';

    var grid = document.createElement('div');
    grid.className = 'mm-picker-grid';

    var selected = null;
    var optEls = [];

    PICKABLE.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm-picker-opt';
      b.setAttribute('aria-selected', 'false');
      b.dataset.slug = p.slug;

      var n = document.createElement('span');
      n.className = 'mm-picker-opt-name';
      n.textContent = p.name;

      var c = document.createElement('span');
      c.className = 'mm-picker-opt-count';
      c.textContent = '';
      c.dataset.slug = p.slug;

      b.appendChild(n);
      b.appendChild(c);

      b.addEventListener('click', function () {
        selected = p.slug;
        optEls.forEach(function (o) {
          o.setAttribute('aria-selected',
            o.dataset.slug === selected ? 'true' : 'false');
        });
        confirm.disabled = false;
      });
      grid.appendChild(b);
      optEls.push(b);
    });

    var one = document.createElement('p');
    one.className = 'mm-picker-one';
    one.textContent = 'One pick per free account.';

    var actions = document.createElement('div');
    actions.className = 'mm-picker-actions';

    var confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'mm-picker-confirm';
    confirm.textContent = 'Keep this songbook';
    confirm.disabled = true;

    var err = document.createElement('p');
    err.className = 'mm-picker-err';
    err.setAttribute('role', 'status');
    err.setAttribute('aria-live', 'polite');

    confirm.addEventListener('click', function () {
      if (!selected || !memberCache || !memberCache.uuid) return;
      confirm.disabled = true;
      err.textContent = '';
      writePick(memberCache.uuid, selected).then(function (res) {
        if (res.status === 200 || res.status === 409) {
          var slug = (res.body && res.body.pick) || selected;
          setCachedPick(memberCache.uuid, slug);
          card.innerHTML = '';
          var done = document.createElement('p');
          done.className = 'mm-picker-done';
          // Bennett's words, Nov 9.
          done.textContent = 'Okay! ' + nameOf(slug) + ' is all yours. '
            + 'Enjoy and consider supporting the project if you like the site!';
          card.appendChild(done);
          setTimeout(function () {
            overlay.remove();
            if (onConfirmed) onConfirmed(slug);
          }, 4000);
        } else {
          err.textContent = 'Could not save. Please try again.';
          confirm.disabled = false;
        }
      }).catch(function () {
        err.textContent = 'Could not save. Please try again.';
        confirm.disabled = false;
      });
    });

    actions.appendChild(confirm);

    card.appendChild(eye);
    card.appendChild(h);
    card.appendChild(grid);
    card.appendChild(one);
    card.appendChild(actions);
    card.appendChild(err);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // Fill counts asynchronously; names render first.
    fetchCounts().then(function (counts) {
      optEls.forEach(function (o) {
        var slug = o.dataset.slug;
        var n = counts[slug];
        var span = o.querySelector('.mm-picker-opt-count');
        if (span && typeof n === 'number') {
          span.textContent = n + ' ' + (n === 1 ? 'song' : 'songs');
        }
      });
    });

    // Focus the first option for keyboard users.
    if (optEls[0]) optEls[0].focus();
  }

  // ------------------------------------------------------------
  // Gating
  // ------------------------------------------------------------

  function pageTagSlugs() {
    var out = [];
    var cls = document.body && document.body.className;
    if (!cls) return out;
    cls.split(/\s+/).forEach(function (c) {
      if (c.indexOf('tag-') === 0) out.push(c.substring(4));
    });
    return out;
  }

  function pageTypeFromBody() {
    var body = document.body;
    if (!body) return 'other';
    if (body.classList.contains('post-template')) return 'post';
    if (body.classList.contains('tag-template')) return 'tag';
    return 'other';
  }

  function openForAnyone(slugs) {
    for (var i = 0; i < slugs.length; i++) {
      if (OPEN_TAGS.indexOf(slugs[i]) !== -1) return true;
    }
    return false;
  }

  function unlockedForPick(slugs, pick) {
    if (!pick) return false;
    return slugs.indexOf(pick) !== -1;
  }

  // Which pickable category is this post in? If more than one, pick
  // the first match in PICKABLE order.
  function categoryOfPost(slugs) {
    for (var i = 0; i < PICKABLE_SLUGS.length; i++) {
      if (slugs.indexOf(PICKABLE_SLUGS[i]) !== -1) return PICKABLE_SLUGS[i];
    }
    return null;
  }

  function makeCta(line) {
    var box = document.createElement('div');
    box.className = CTA_CLASS;
    // Only signed-in free members see this box, and Portal turns its
    // signup page into the account page for them, so open the plans.
    var a = document.createElement('a');
    a.className = 'mm-picker-cta-btn';
    a.href = '#/portal/account/plans';
    a.setAttribute('data-portal', 'account/plans');
    a.textContent = 'Join Bennett\u2019s Songbook';
    if (line) {
      var p = document.createElement('p');
      p.className = 'mm-picker-cta-line';
      p.textContent = line;
      box.appendChild(p);
    }
    box.appendChild(a);
    return box;
  }

  function gatePost(slugs, pick) {
    if (openForAnyone(slugs)) return;
    if (pick && unlockedForPick(slugs, pick)) return;

    injectStyle();

    // Locked: keep the opening section (everything up to the first
    // <h2>), strip any audio card from it, drop the rest, append CTA.
    var content = document.querySelector('.gh-content');
    if (!content) return;
    var children = Array.prototype.slice.call(content.children);
    var sawH2 = false;
    children.forEach(function (ch) {
      if (sawH2) { ch.remove(); return; }
      if (ch.tagName && ch.tagName.toLowerCase() === 'h2') {
        sawH2 = true;
        ch.remove();
        return;
      }
      // Audio cards on the first section go: audio files are public
      // URLs, so hiding the card is the only client-side protection.
      if (ch.classList && (ch.classList.contains('kg-audio-card')
          || ch.tagName.toLowerCase() === 'audio')) {
        ch.remove();
        return;
      }
      var inner = ch.querySelectorAll
        ? ch.querySelectorAll('.kg-audio-card, audio') : [];
      for (var a = 0; a < inner.length; a++) inner[a].remove();
    });

    var cat = categoryOfPost(slugs);
    var line;
    if (cat && pick) {
      line = 'This song is in ' + nameOf(cat) + '. Your free songbook is '
        + nameOf(pick) + '.';
    } else if (pick) {
      line = 'Your free songbook is ' + nameOf(pick) + '.';
    } else {
      line = '';
    }
    content.appendChild(makeCta(line));
  }

  function gateTagPage(slugs, pick) {
    // Only act on pickable categories the member did not choose.
    var cat = categoryOfPost(slugs);
    if (!cat) return;                       // non-pickable or open tag
    if (openForAnyone(slugs)) return;
    if (pick && cat === pick) return;

    injectStyle();

    // One CTA at the top of the list.
    var list = document.querySelector('.post-feed, .gh-feed, main .post-card')
      ? document.querySelector('.post-feed, .gh-feed')
      : null;
    if (list && !list.querySelector('.' + CTA_CLASS)) {
      var line = pick ? 'Your free songbook is ' + nameOf(pick) + '.' : '';
      list.insertBefore(makeCta(line), list.firstChild);
    }

  }

  function runGating(pick) {
    var slugs = pageTagSlugs();
    var pt = pageTypeFromBody();
    if (pt === 'post') gatePost(slugs, pick);
    else if (pt === 'tag') gateTagPage(slugs, pick);
  }

  // ------------------------------------------------------------
  // Entry
  // ------------------------------------------------------------

  function resolvePick(member) {
    if (!member || !member.uuid) return Promise.resolve(null);
    var cached = cachedPick(member.uuid);
    if (cached) return Promise.resolve(cached);
    return remotePick(member.uuid).then(function (d) {
      if (d && d.pick) setCachedPick(member.uuid, d.pick);
      return (d && d.pick) || null;
    }).catch(function () { return null; });
  }

  function start() {
    fetchMember().then(function (member) {
      if (!member || !member.uuid) return;        // logged out
      if (hasFullAccess(member)) return;          // paid or comped
      resolvePick(member).then(function (pick) {
        if (!pick) {
          openModal(function (picked) { runGating(picked); });
        } else {
          runGating(pick);
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Export for the test harness.
  window.MM_PICKER = { version: VERSION, PICKABLE: PICKABLE };
})();
