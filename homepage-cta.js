/*
 * Moving Music — Home page signup CTA
 * Injects a prominent "Sign up free" card above the post feed on the
 * home template, hidden when the member is signed in.
 */
(function () {
  'use strict';

  var CTA_CLASS = 'mm-home-cta';
  var STYLE_ID = 'mm-home-cta-style';
  var ACCENT = '#2A8C82';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.mm-home-cta{',
      '  display:block;',
      '  margin:0 0 2.4rem;',
      '  padding:2.4rem 2rem;',
      '  background:' + ACCENT + ';',
      '  color:#fff;',
      '  border-radius:6px;',
      '  text-align:center;',
      '}',
      'body.mm-signed-in .mm-home-cta{display:none}',
      '.mm-home-cta h3{',
      '  margin:0 0 .6rem;',
      '  color:#fff;',
      '  font-size:2.2rem;',
      '  line-height:1.2;',
      '}',
      '.mm-home-cta p{',
      '  margin:0 0 1.4rem;',
      '  color:#fff;',
      '  opacity:.95;',
      '  font-size:1.5rem;',
      '  line-height:1.4;',
      '}',
      '.mm-home-cta a.mm-home-cta-btn{',
      '  display:inline-block;',
      '  background:#fff;',
      '  color:' + ACCENT + ';',
      '  font-weight:600;',
      '  font-size:1.6rem;',
      '  padding:1.2rem 2.4rem;',
      '  border-radius:999px;',
      '  text-decoration:none;',
      '  min-width:200px;',
      '  touch-action:manipulation;',
      '  transition:transform 80ms ease,',
      '    background 80ms ease;',
      '}',
      '.mm-home-cta a.mm-home-cta-btn:hover,',
      '.mm-home-cta a.mm-home-cta-btn:active{',
      '  background:#f0f0f0;',
      '  transform:translateY(-1px);',
      '}',
      '@media(max-width:700px){',
      '  .mm-home-cta{',
      '    padding:2rem 1.4rem;',
      '    border-radius:0;',
      '    margin-left:calc(50% - 50vw);',
      '    margin-right:calc(50% - 50vw);',
      '  }',
      '  .mm-home-cta h3{font-size:1.9rem}',
      '  .mm-home-cta p{font-size:1.3rem}',
      '  .mm-home-cta a.mm-home-cta-btn{',
      '    width:calc(100% - 2.8rem);',
      '    box-sizing:border-box;',
      '    padding:1.4rem 2rem;',
      '  }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function alreadyPresent() {
    return !!document.querySelector('.' + CTA_CLASS);
  }

  function inject() {
    var body = document.body;
    if (!body) return;
    if (!body.classList.contains('home-template')) return;
    if (body.classList.contains('mm-signed-in')) return;
    if (alreadyPresent()) return;

    var feed = document.querySelector('.post-feed');
    if (!feed || !feed.parentNode) return;

    injectStyle();

    var wrap = document.createElement('div');
    wrap.className = CTA_CLASS;

    var h = document.createElement('h3');
    h.textContent = 'Join the songbook — free';

    var p = document.createElement('p');
    p.textContent =
      'Pick a tune. We send you a one-click sign-in. No password.';

    var a = document.createElement('a');
    a.className = 'mm-home-cta-btn';
    a.href = '#/portal/signup';
    a.textContent = 'Sign up free';

    wrap.appendChild(h);
    wrap.appendChild(p);
    wrap.appendChild(a);

    feed.parentNode.insertBefore(wrap, feed);
  }

  function removeIfSignedIn() {
    if (!document.body) return;
    if (!document.body.classList.contains('mm-signed-in')) return;
    var el = document.querySelector('.' + CTA_CLASS);
    if (el) el.remove();
  }

  function start() {
    inject();
    removeIfSignedIn();

    var obs = new MutationObserver(function () {
      removeIfSignedIn();
      if (
        document.body.classList.contains('home-template') &&
        !document.body.classList.contains('mm-signed-in') &&
        !alreadyPresent()
      ) {
        inject();
      }
    });
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
