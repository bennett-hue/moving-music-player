#!/usr/bin/env python3
"""Build the three Worksong Atlas pages for Ghost from the data in atlas-map.html.

The map file is the single source of truth. Its `var D = [...]` array holds one
object per tradition:

    n  name                 p  place (as shown)        g  group for List By Place
    c  category code        la/lo  coordinates         r  region slugs
    d  delivery slugs       u  use (activity) slugs    s  one-line description
    v  videos: [{t: label, u: url, d: delivery slug}]

Delivery slugs: at-work, shared, concert, or "" (unknown).

Usage:
    python3 scripts/build_atlas_pages.py            # writes ghost/*.card.html
    python3 scripts/build_atlas_pages.py --check    # validate the data only

Outputs (paste each file into the HTML card of the matching Ghost page):
    ghost/atlas-regions.card.html   -> https://movingmusic.works/atlas-regions/
    ghost/atlas-uses.card.html      -> https://movingmusic.works/atlas-uses/
    ghost/atlas.card.html           -> https://movingmusic.works/atlas/
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAP = os.path.join(ROOT, 'atlas-map.html')
OUT = os.path.join(ROOT, 'ghost')

SITE = 'https://movingmusic.works'
MAP_WORKER_URL = 'https://mmp-sync.bennett-727.workers.dev/atlas-map.html'

DELIVERY_LABEL = {'at-work': 'People at work', 'shared': 'People sharing songs', 'concert': 'People in Concert'}
DELIVERY_COLOR = {'at-work': '#2A8C82', 'shared': '#a67c52', 'concert': '#7b6d9a'}
DELIVERY_HELP = {
    'at-work': 'the song is sung while the work happens, on camera',
    'shared': 'a field recording, demonstration, or documentary, away from the work itself',
    'concert': 'a staged performance for an audience',
}
DELIVERY_ORDER = ['at-work', 'shared', 'concert', '']

# Order here is the order of groups on List By Activity.
USE_LABEL = [
    ('hauling', 'Hauling and heaving'),
    ('rowing', 'Rowing and paddling'),
    ('pounding', 'Pounding and hammering'),
    ('carrying', 'Carrying and shouldering'),
    ('walking', 'Walking and marching'),
    ('solo-pacing', 'Solo pacing'),
    ('signaling', 'Signaling'),
    ('animal-directed', 'Animal-directed'),
    ('communal-work-party', 'Communal work party'),
    ('devotional', 'Devotional and ritual'),
]
USE_LABEL_D = dict(USE_LABEL)

REGION_LABEL = {
    'british-isles': 'British Isles', 'nordic': 'Nordic', 'europe': 'Europe',
    'caucasus': 'Eastern Europe/Caucasus', 'mena': 'Middle East / N. Africa',
    'sub-saharan-africa': 'Sub-Saharan Africa', 'south-asia': 'South Asia',
    'east-asia': 'East Asia', 'oceania': 'Oceania', 'americas': 'Americas',
}


# ---------- data ----------

def load_entries():
    src = open(MAP, encoding='utf-8').read()
    ds = src.index('var D = [')
    de = src.index('\n];', ds) + 2
    arr = src[ds + len('var D = '):de]
    arr = re.sub(r'([{,]\s*)([a-z]{1,2}):', r'\1"\2":', arr)
    return json.loads(arr)


def slugify(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def validate(entries):
    problems = []
    seen = set()
    for e in entries:
        slug = slugify(e['n'])
        if slug in seen:
            problems.append('duplicate slug: ' + slug)
        seen.add(slug)
        for k in ('n', 'p', 'c', 'la', 'lo', 'd', 'u', 'r', 'v'):
            if k not in e:
                problems.append('%s: missing field %s' % (e['n'], k))
        if not e.get('g'):
            problems.append('%s: missing group (g) for List By Place' % e['n'])
        if not e.get('s'):
            problems.append('%s: missing description (s)' % e['n'])
        for u in e.get('u', []):
            if u not in USE_LABEL_D:
                problems.append('%s: unknown use %s' % (e['n'], u))
        for r in e.get('r', []):
            if r not in REGION_LABEL:
                problems.append('%s: unknown region %s' % (e['n'], r))
        vd = []
        for v in e.get('v', []):
            if v.get('d') not in DELIVERY_ORDER:
                problems.append('%s: unknown delivery %r on %s' % (e['n'], v.get('d'), v.get('u')))
            if v.get('d') and v['d'] not in vd:
                vd.append(v['d'])
        if e.get('d') != vd:
            problems.append('%s: d=%s but videos say %s' % (e['n'], e.get('d'), vd))
        dash = [k for k in ('n', 'p', 's') if '—' in str(e.get(k, '')) or '--' in str(e.get(k, ''))]
        if dash:
            problems.append('%s: em dash or double hyphen in %s' % (e['n'], dash))
        for v in e.get('v', []):
            if '—' in v.get('t', '') or '--' in v.get('t', ''):
                problems.append('%s: em dash in video label %s' % (e['n'], v['t']))
    return problems


def entries_json(entries):
    out = {}
    for e in entries:
        out[slugify(e['n'])] = {
            'name': e['n'], 'place': e['p'], 'group': e.get('g', ''), 'summary': e.get('s', ''),
            'delivery': e['d'], 'use': e['u'], 'region': e['r'],
            'videos': [{'label': v['t'], 'url': v['u'], 'delivery': v['d']} for v in e['v']],
        }
    return out


# ---------- markup ----------

def esc(s):
    return html.escape(s, quote=True)


def page_css(page_slug):
    return ('<style>body.page-%(p)s .site-content{padding-top:24px!important}'
            'body.page-%(p)s .single-header{margin-bottom:20px!important;padding-bottom:0!important}'
            'body.page-%(p)s .single-title{margin-bottom:0!important;font-size:24px!important;line-height:1.15!important;text-align:center!important}'
            'body.page-%(p)s .single-content{padding-top:0!important;margin-top:12px!important}</style>\n' % {'p': page_slug})


SHARED_CSS = """<style>
  .atlas-page { font-family: system-ui, -apple-system, sans-serif; color: #222; line-height: 1.5; max-width: 900px; margin: 0 auto; }
  .atlas-page .atlas-intro { color: #555; font-size: 17px; margin-bottom: 14px; }
  .atlas-page .toc { background: #f0ede4; padding: 14px 20px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; line-height: 2; }
  .atlas-page .toc a { color: #2A8C82; text-decoration: none; }
  .atlas-page .legend { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-bottom: 16px; font-size: 13px; color: #555; }
  .atlas-page .legend .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 999px; margin-right: 5px; vertical-align: middle; }
  .atlas-page .legend .legend-help { color: #888; }
  .atlas-page .atlas-list { display: grid; grid-template-columns: 220px 1fr; gap: 8px 16px; align-items: baseline; font-size: 14px; line-height: 1.5; }
  .atlas-page .atlas-list > .nation[data-was-first="1"]:not(:first-child), .atlas-page .atlas-list > .nation[data-was-first="1"]:not(:first-child) + .entry,
  .atlas-page .atlas-list > .movement[data-was-first="1"]:not(:first-child), .atlas-page .atlas-list > .movement[data-was-first="1"]:not(:first-child) + .entry { border-top: 1px solid #e2ded4; padding-top: 8px; margin-top: 4px; }
  .atlas-page .atlas-list .nation, .atlas-page .atlas-list .movement { font-weight: 700; color: #1a1a1a; }
  .atlas-page .atlas-list .entry-sep { color: #bbb; margin: 0 6px; }
  .atlas-page .atlas-list .entry-summary { display: block; color: #666; font-size: 12.5px; line-height: 1.4; margin-top: 1px; }

  .wm-popup-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 9999; display: none; align-items: flex-start; justify-content: center; padding: 40px 16px 20px; overflow-y: auto; -webkit-overflow-scrolling: touch; }
  .wm-popup-modal.show { display: flex; }
  .wm-popup-content { background: #fff; border-radius: 6px; padding: 22px 26px 18px; max-width: 480px; width: 100%; max-height: calc(100vh - 60px); max-height: calc(100dvh - 60px); overflow-y: auto; -webkit-overflow-scrolling: touch; font-family: Georgia, serif; font-size: 14px; line-height: 1.5; position: relative; box-shadow: 0 8px 30px rgba(0,0,0,0.3); box-sizing: border-box; }
  .wm-popup-content .wm-close { position: absolute; top: 8px; right: 10px; background: none; border: 0; font-size: 24px; line-height: 1; cursor: pointer; color: #999; padding: 4px 8px; }
  .wm-popup-content .wm-close:hover { color: #333; }
  .wm-popup-content strong { font-size: 17px; color: #1a1a1a; }
  .wm-popup-content .wm-place { color: #666; font-size: 12px; }
  .wm-popup-content .wm-summary { color: #333; font-size: 13.5px; margin-top: 6px; }
  .wm-popup-content iframe.wm-embed { width: 100%; aspect-ratio: 16/9; border: 0; margin-top: 8px; border-radius: 4px; display: block; }
  .wm-popup-content .vid-item { margin-top: 4px; }
  .wm-popup-content a.vid-swap { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; color: #2A8C82; font-weight: 700; }
  .wm-popup-content a.vid-swap svg.mm-play { width: 11px; height: 11px; fill: currentColor; opacity: 0.55; flex-shrink: 0; }
  .wm-popup-content a.vid-swap[data-current="1"] { color: #444; }
  .wm-popup-content a.vid-swap[data-current="1"] svg.mm-play { fill: #2A8C82; opacity: 1; }
  .wm-popup-content a.vid-ext { color: #2A8C82; }
  .wm-popup-content .popup-badge { display: inline-block; padding: 1px 6px; margin-left: 4px; border-radius: 999px; font-size: 9px; font-weight: 700; color: #fff; text-transform: none; vertical-align: baseline; }
  .wm-popup-content .send-to-player { display: inline-flex; gap: 4px; margin-left: 6px; vertical-align: baseline; }
  .wm-popup-content .send-to-player button { font: inherit; font-size: 10px; padding: 1px 6px; border: 1px solid #d0d0d0; background: #f8f6f0; color: #444; border-radius: 4px; cursor: pointer; line-height: 1.4; }
  .wm-popup-content .send-to-player button:hover { background: #2A8C82; color: #fff; border-color: #2A8C82; }
  .wm-popup-content .send-to-player button.playnow { background: #2A8C82; color: #fff; border-color: #2A8C82; }
  .wm-popup-content .send-to-player button.playnow:hover { background: #1f6b63; border-color: #1f6b63; }
  .atlas-page .popup-trigger { background: none; border: 0; padding: 0; font: inherit; color: #1a1a1a; font-weight: 700; cursor: pointer; text-decoration: underline; text-decoration-color: #2A8C82; text-underline-offset: 2px; text-align: left; }
  .atlas-page .popup-trigger:hover { color: #2A8C82; }
  .atlas-page .entry-place-link { color: #777; font-size: 12px; margin-left: 4px; text-decoration: none; border-bottom: 1px dotted #bbb; }
  .atlas-page .entry-place-link:hover { color: #2A8C82; border-bottom-color: #2A8C82; }
  .atlas-page .filter-pill { background: #f0ede4; color: #666; border: 0; padding: 1px 7px; margin-left: 4px; font-size: 11px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: opacity 0.15s; }
  .atlas-page .filter-pill:hover { background: #e2ded4; }
  .atlas-page .filter-pill.delivery-pill { color: #fff; }
  .atlas-page .filter-pill.delivery-pill.at-work { background: #2A8C82; }
  .atlas-page .filter-pill.delivery-pill.shared { background: #a67c52; }
  .atlas-page .filter-pill.delivery-pill.concert { background: #7b6d9a; }
  .atlas-page .filter-pill.is-active { box-shadow: 0 0 0 2px #2A8C82; }
  .atlas-search-wrap { margin: 0 0 12px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .atlas-search-wrap input { flex: 1 1 300px; padding: 8px 12px; font-size: 14px; border: 1px solid #d8d4cc; border-radius: 6px; font-family: inherit; background: #fff; }
  .atlas-search-wrap input:focus { outline: none; border-color: #2A8C82; }
  .atlas-search-wrap .hint { color: #999; font-size: 12px; font-style: italic; }
  .atlas-filter-indicator { display: none; margin: 0 0 16px; padding: 8px 14px; background: #fff8e1; border: 1px solid #e6d97a; border-radius: 6px; font-size: 13px; }
  .atlas-filter-indicator.active { display: block; }
  .atlas-filter-indicator .active-tag { display: inline-block; background: #fff; border: 1px solid #d0c05a; border-radius: 999px; padding: 2px 10px; margin: 0 4px 2px 0; font-size: 12px; cursor: pointer; }
  .atlas-filter-indicator .active-tag:hover { background: #ffefc4; }
  .atlas-filter-indicator .active-tag .x { color: #888; margin-left: 4px; }
  .atlas-filter-indicator button.clear-filter { margin-left: 8px; background: none; border: 1px solid #999; border-radius: 4px; padding: 2px 10px; cursor: pointer; font-size: 12px; font-family: inherit; }
  .atlas-filter-indicator button.clear-filter:hover { background: #eee; }
  .atlas-filter-indicator .no-results { color: #a06060; font-weight: 600; margin-top: 6px; display: none; }
  .atlas-filter-indicator.no-results-active .no-results { display: block; }

  @media (max-width: 640px) { .atlas-page .atlas-list { grid-template-columns: 1fr; gap: 4px; } .atlas-page .atlas-list .nation, .atlas-page .atlas-list .movement { margin-top: 8px; } .wm-popup-modal { padding: 16px 8px; } .wm-popup-content { padding: 20px 16px 14px; max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); } }
</style>"""

TOPNAV_CSS = """<style>
  .atlas-topnav { max-width: 1200px; margin: 12px auto 0; padding: 10px 12px; font-family: system-ui, -apple-system, sans-serif; font-size: 14px; border-bottom: 1px solid #e2ded4; text-align: center; }
  .atlas-topnav a { color: #2A8C82; margin: 0 12px; text-decoration: none; border-bottom: 1px solid transparent; }
  .atlas-topnav a:hover { border-bottom-color: #2A8C82; }
  .atlas-topnav a.current { color: #444; font-weight: 700; pointer-events: none; }
</style>"""


def topnav(current):
    items = [('map', SITE + '/atlas/', 'Map'), ('regions', SITE + '/atlas-regions/', 'List By Place'), ('uses', SITE + '/atlas-uses/', 'List By Activity')]
    out = []
    for key, href, label in items:
        if key == current:
            out.append('<a class="current" href="#">%s</a>' % label)
        else:
            out.append('<a href="%s">%s</a>' % (href, label))
    return TOPNAV_CSS + '<div class="atlas-topnav">' + ''.join(out) + '</div>'


def legend():
    parts = []
    for slug in ('at-work', 'shared', 'concert'):
        parts.append('<span title="%s"><span class="swatch" style="background:%s"></span>%s <span class="legend-help">(%s)</span></span>' % (
            esc(DELIVERY_HELP[slug]), DELIVERY_COLOR[slug], DELIVERY_LABEL[slug], esc(DELIVERY_HELP[slug])))
    return '<div class="legend">\n  ' + '\n  '.join(parts) + '\n</div>'


def pill(tag_type, slug, label, extra_class=''):
    cls = 'filter-pill' + (' ' + extra_class if extra_class else '')
    return '<button class="%s" data-tag-type="%s" data-tag-slug="%s">%s</button>' % (cls, tag_type, slug, esc(label))


def entry_row(e, pills):
    slug = slugify(e['n'])
    summary = ('<span class="entry-summary">%s</span>' % esc(e['s'])) if e.get('s') else ''
    return ('<div class="entry"><button class="popup-trigger" data-id="%s">%s</button>'
            '<a class="entry-place-link" href="%s/atlas/#tradition=%s" title="See on the map">(%s)</a>'
            '<span class="entry-sep">·</span>%s%s</div>' % (slug, esc(e['n']), SITE, slug, esc(e['p']), ''.join(pills), summary))


def group_header(cls, label, first):
    gid = slugify(label)
    if first:
        return '<div class="%s" id="%s" data-group="%s" data-original-label="%s" data-was-first="1">%s</div>' % (cls, gid, esc(label), esc(label), esc(label))
    return '<div class="%s" data-group="%s" data-original-label="%s"></div>' % (cls, esc(label), esc(label))


def search_block():
    return ('<div class="atlas-search-wrap"><input id="atlas-search" type="search" placeholder="Search traditions, places, or kinds of work…" autocomplete="off">'
            '<span class="hint">Click a pill to filter · shift-click to combine</span></div>\n'
            '<div id="atlas-filter-indicator" class="atlas-filter-indicator"></div>')


MODAL = '<div id="wm-popup-modal" class="wm-popup-modal">\n  <div class="wm-popup-content"></div>\n</div>'


def page_script(entries):
    data = json.dumps(entries_json(entries), ensure_ascii=False)
    # keep the JSON safe inside a <script> element
    data = data.replace('</', '<\\/')
    labels = json.dumps({
        'DELIVERY_LABEL': DELIVERY_LABEL, 'DELIVERY_COLOR': DELIVERY_COLOR,
        'USE_LABEL': dict(USE_LABEL), 'REGION_LABEL': REGION_LABEL,
    }, ensure_ascii=False)
    return '<script>window.ATLAS_ENTRIES = %s;\nwindow.ATLAS_LABELS = %s;\n%s</script>' % (data, labels, PAGE_JS)


PAGE_JS = r"""
(function(){
  var ENTRIES = window.ATLAS_ENTRIES || {};
  var L = window.ATLAS_LABELS || {};
  var DELIVERY_LABEL = L.DELIVERY_LABEL || {};
  var DELIVERY_COLOR = L.DELIVERY_COLOR || {};
  var USE_LABEL = L.USE_LABEL || {};
  var REGION_LABEL = L.REGION_LABEL || {};
  function labelFor(type, slug){
    if (type === 'delivery') return DELIVERY_LABEL[slug] || slug;
    if (type === 'use') return USE_LABEL[slug] || slug;
    if (type === 'region') return REGION_LABEL[slug] || slug;
    return slug;
  }
  var ACTIVE = { delivery: new Set(), use: new Set(), region: new Set() };
  var SEARCH = '';
  function yt(u){
    if (!u) return null;
    var m = u.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
    if (!m) return null;
    var t = u.match(/[?&](?:t|start)=(\d+)/);
    return 'https://www.youtube-nocookie.com/embed/' + m[1] + (t ? '?start=' + t[1] : '');
  }
  function esc(s){ var d=document.createElement('div'); d.textContent=(s==null?'':String(s)); return d.innerHTML; }
  function ytId(u){
    if (!u) return null;
    var m = u.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }
  function ytStartSec(u){
    if (!u) return 0;
    var t = u.match(/[?&](?:t|start)=(\d+)/);
    return t ? parseInt(t[1], 10) : 0;
  }
  function getModal(){
    var modal = document.getElementById('wm-popup-modal');
    // Escape any transformed or overflow-clipped ancestor so the fixed modal fills the viewport.
    if (modal && modal.parentNode !== document.body) document.body.appendChild(modal);
    return modal;
  }
  function openPopup(id){
    var e = ENTRIES[id];
    if (!e) return;
    var PLAY = '<svg class="mm-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    var vids = (e.videos||[]).map(function(x, i){
      var d0 = (typeof x.delivery === 'string') ? x.delivery : ((x.delivery && x.delivery.length) ? x.delivery[0] : '');
      var badge = d0 ? '<span class="popup-badge" style="background:'+DELIVERY_COLOR[d0]+'">'+DELIVERY_LABEL[d0]+'</span>' : '';
      var emb = yt(x.url);
      var vid = ytId(x.url);
      var vst = ytStartSec(x.url);
      var cur = (i === 0 && emb) ? ' data-current="1"' : '';
      var attr = emb ? ' data-embed="'+emb+'"' : '';
      var transport = '';
      if (vid) {
        transport = '<span class="send-to-player">'
          + '<button class="playnow send-play" data-vid="'+vid+'" data-vst="'+vst+'" data-label="'+esc(x.label)+'" data-src="'+esc(x.url)+'" title="Play in transport bar">Play in bar</button>'
          + '<button class="send-queue" data-vid="'+vid+'" data-vst="'+vst+'" data-label="'+esc(x.label)+'" data-src="'+esc(x.url)+'" title="Add to queue">+ Queue</button>'
          + '</span>';
      }
      var cls = emb ? 'vid-swap' : 'vid-ext';
      var ext = emb ? '' : ' <span style="color:#999;font-size:11px">(opens elsewhere)</span>';
      return '<div class="vid-item"><a href="'+esc(x.url)+'" target="_blank" rel="noopener" class="'+cls+'"'+attr+cur+'>'+(emb?PLAY:'')+esc(x.label)+'</a>'+ext+badge+transport+'</div>';
    }).join('');
    if (!vids) vids = '<div style="color:#999;margin-top:8px">(seeking video or recording)</div>';
    var embedHtml = '';
    if (e.videos && e.videos.length){
      var first = yt(e.videos[0].url);
      if (first) embedHtml = '<iframe class="wm-embed" src="'+first+'" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>';
    }
    var summary = e.summary ? '<div class="wm-summary">'+esc(e.summary)+'</div>' : '';
    var modal = getModal();
    if (!modal) return;
    modal.querySelector('.wm-popup-content').innerHTML = '<button class="wm-close" aria-label="Close">×</button><strong>'+esc(e.name)+'</strong><br><span class="wm-place">'+esc(e.place)+'</span>'+summary+embedHtml+vids;
    modal.classList.add('show');
    modal.scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }
  function sendToPlayer(btn, action){
    var opts = {
      videoId: btn.dataset.vid,
      label: btn.dataset.label,
      startSec: parseInt(btn.dataset.vst||'0', 10) || 0,
      sourceUrl: btn.dataset.src,
    };
    if (window.MMP && typeof window.MMP[action === 'play' ? 'playYouTubeNow' : 'addYouTubeToQueue'] === 'function') {
      window.MMP[action === 'play' ? 'playYouTubeNow' : 'addYouTubeToQueue'](opts);
    } else {
      try { window.parent.postMessage({source:'mmp-atlas', action:action, videoId:opts.videoId, label:opts.label, startSec:opts.startSec, sourceUrl:opts.sourceUrl}, '*'); } catch(e){}
    }
    if (action === 'play') closePopup();
  }
  function closePopup(){
    var modal = document.getElementById('wm-popup-modal');
    if (!modal) return;
    var content = modal.querySelector('.wm-popup-content');
    if (content) content.innerHTML = '';
    modal.classList.remove('show');
    document.body.style.overflow = '';
  }
  function toggleFilter(type, slug, additive){
    var s = ACTIVE[type]; if (!s) return;
    if (additive){
      if (s.has(slug)) s.delete(slug); else s.add(slug);
    } else {
      if (s.size === 1 && s.has(slug)) s.clear();
      else { s.clear(); s.add(slug); }
    }
    applyFilters(); syncHash();
  }
  function applyFilters(){
    var q = SEARCH.toLowerCase().trim();
    var visibleCount = 0;
    var entries = document.querySelectorAll('.atlas-list > .entry');
    entries.forEach(function(entryEl){
      var trg = entryEl.querySelector('.popup-trigger');
      var e = trg ? ENTRIES[trg.dataset.id] : null;
      var match = !!e;
      if (match && q){
        var hay = ((e.name||'') + ' ' + (e.place||'') + ' ' + (e.group||'') + ' ' + (e.summary||'')).toLowerCase();
        if (hay.indexOf(q) < 0) match = false;
      }
      if (match){
        ['delivery','use','region'].forEach(function(t){
          if (!match) return;
          var s = ACTIVE[t]; if (!s || s.size === 0) return;
          var tags = e[t] || [];
          var hit = tags.some(function(x){ return s.has(x); });
          if (!hit) match = false;
        });
      }
      entryEl.style.display = match ? '' : 'none';
      var prev = entryEl.previousElementSibling;
      if (prev) prev.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });
    reflowGroupLabels();
    updatePillsState();
    renderFilterIndicator(visibleCount);
  }
  function updatePillsState(){
    document.querySelectorAll('.filter-pill').forEach(function(p){
      var t = p.dataset.tagType, s = p.dataset.tagSlug;
      var active = ACTIVE[t] && ACTIVE[t].has(s);
      p.classList.toggle('is-active', !!active);
    });
  }
  function reflowGroupLabels(){
    var visible = Array.prototype.filter.call(document.querySelectorAll('.atlas-list > .entry'), function(el){ return el.style.display !== 'none'; });
    var seen = null;
    visible.forEach(function(entryEl){
      var groupEl = entryEl.previousElementSibling;
      if (!groupEl) return;
      var g = groupEl.dataset.group;
      if (g !== seen){
        groupEl.style.display = '';
        groupEl.textContent = groupEl.dataset.originalLabel || g;
        seen = g;
      } else {
        groupEl.style.display = '';
        groupEl.textContent = '';
      }
    });
  }
  function renderFilterIndicator(visibleCount){
    var ind = document.getElementById('atlas-filter-indicator');
    if (!ind) return;
    var parts = [];
    ['delivery','use','region'].forEach(function(t){
      ACTIVE[t].forEach(function(s){
        parts.push('<span class="active-tag" data-type="'+t+'" data-slug="'+s+'">'+esc(labelFor(t, s))+'<span class="x">×</span></span>');
      });
    });
    if (SEARCH) parts.push('<span class="active-tag" data-search="1">"'+esc(SEARCH)+'"<span class="x">×</span></span>');
    var noResults = (parts.length > 0 && visibleCount === 0);
    if (parts.length === 0){
      ind.classList.remove('active','no-results-active'); ind.innerHTML = ''; return;
    }
    ind.classList.add('active');
    ind.classList.toggle('no-results-active', noResults);
    ind.innerHTML = 'Filtering by: ' + parts.join(' ') + ' <button class="clear-filter">clear all</button><div class="no-results">No entries match this combination.</div>';
  }
  function syncHash(){
    var parts = [];
    ['delivery','use','region'].forEach(function(t){
      if (ACTIVE[t].size) parts.push(t + '=' + Array.from(ACTIVE[t]).join(','));
    });
    if (SEARCH) parts.push('q=' + encodeURIComponent(SEARCH));
    var newUrl = location.pathname + (parts.length ? '#' + parts.join('&') : '');
    try { history.replaceState(null, '', newUrl); } catch(e){}
  }
  function readHash(){
    var h = location.hash.replace(/^#/, '');
    if (!h) return false;
    var applied = false;
    h.split('&').forEach(function(pair){
      var eq = pair.indexOf('=');
      if (eq < 0) return;
      var k = pair.substring(0, eq);
      var v = pair.substring(eq+1);
      if (k === 'delivery' || k === 'use' || k === 'region'){
        v.split(',').forEach(function(s){ if (s) ACTIVE[k].add(s); });
        applied = true;
      } else if (k === 'q'){
        SEARCH = decodeURIComponent(v);
        var box = document.getElementById('atlas-search');
        if (box) box.value = SEARCH;
        applied = true;
      }
    });
    return applied;
  }
  document.addEventListener('click', function(ev){
    var trg = ev.target.closest('.popup-trigger');
    if (trg){ ev.preventDefault(); openPopup(trg.dataset.id); return; }
    var close = ev.target.closest('.wm-close');
    if (close){ closePopup(); return; }
    var modal = document.getElementById('wm-popup-modal');
    if (modal && ev.target === modal){ closePopup(); return; }
    var sendPlay = ev.target.closest('.wm-popup-content button.send-play');
    if (sendPlay){ ev.preventDefault(); sendToPlayer(sendPlay, 'play'); return; }
    var sendQ = ev.target.closest('.wm-popup-content button.send-queue');
    if (sendQ){ ev.preventDefault(); sendToPlayer(sendQ, 'queue'); return; }
    var swap = ev.target.closest('.wm-popup-content a.vid-swap');
    if (swap && swap.dataset.embed){
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      ev.preventDefault();
      var iframe = modal.querySelector('iframe.wm-embed');
      if (iframe){
        iframe.src = swap.dataset.embed;
        modal.querySelectorAll('a.vid-swap').forEach(function(a){ a.removeAttribute('data-current'); });
        swap.setAttribute('data-current','1');
      }
      return;
    }
    var activeTag = ev.target.closest('.active-tag');
    if (activeTag){
      if (activeTag.dataset.search === '1'){
        SEARCH = ''; var box = document.getElementById('atlas-search'); if (box) box.value = '';
      } else {
        ACTIVE[activeTag.dataset.type].delete(activeTag.dataset.slug);
      }
      applyFilters(); syncHash(); return;
    }
    var clr = ev.target.closest('.clear-filter');
    if (clr){
      ['delivery','use','region'].forEach(function(t){ ACTIVE[t].clear(); });
      SEARCH = ''; var box2 = document.getElementById('atlas-search'); if (box2) box2.value = '';
      applyFilters(); syncHash(); return;
    }
    var pill = ev.target.closest('.filter-pill');
    if (pill){
      var additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
      toggleFilter(pill.dataset.tagType, pill.dataset.tagSlug, additive);
      return;
    }
  });
  document.addEventListener('keydown', function(ev){
    if (ev.key === 'Escape'){
      var modal = document.getElementById('wm-popup-modal');
      if (modal && modal.classList.contains('show')) closePopup();
    }
  });
  var searchBox = document.getElementById('atlas-search');
  if (searchBox){
    searchBox.addEventListener('input', function(){
      SEARCH = this.value;
      applyFilters(); syncHash();
    });
  }
  if (readHash()) applyFilters();
})();
"""


def build_regions(entries):
    groups = {}
    for e in entries:
        groups.setdefault(e['g'], []).append(e)
    labels = sorted(groups.keys(), key=lambda s: s.lower())
    toc = ' · '.join('<a href="#%s">%s</a>' % (slugify(g), esc(g)) for g in labels)
    rows = []
    for g in labels:
        for i, e in enumerate(groups[g]):
            rows.append(group_header('nation', g, i == 0))
            pills = [pill('use', u, USE_LABEL_D[u]) for u in e['u']]
            rows.append(entry_row(e, pills))
    intro = ('A living atlas of singing-while-working traditions around the world, grouped by place. '
             'Click a tradition name for a short description and videos. Click a place to jump to it on the map. Click any pill to filter. '
             'Pill colors show what each video captures:')
    return (page_css('atlas-regions') + SHARED_CSS + '<div class="atlas-page">' + topnav('regions')
            + '<p class="atlas-intro">' + intro + '</p>' + legend()
            + '<div class="toc"><strong>Jump to:</strong> ' + toc + '</div>' + search_block()
            + '<div class="atlas-list">' + ''.join(rows) + '</div>' + MODAL + page_script(entries) + '</div>')


def build_uses(entries):
    rows = []
    toc = []
    for slug, label in USE_LABEL:
        members = [e for e in entries if slug in e['u']]
        if not members:
            continue
        toc.append('<a href="#%s">%s</a>' % (slugify(label), esc(label)))
        for i, e in enumerate(members):
            rows.append(group_header('movement', label, i == 0))
            pills = [pill('delivery', d, DELIVERY_LABEL[d], 'delivery-pill ' + d) for d in e['d'] if d]
            pills += [pill('region', r, REGION_LABEL[r]) for r in e['r']]
            rows.append(entry_row(e, pills))
    intro = ('A living atlas of singing-while-working traditions around the world, grouped by the movement or coordinated labor the song accompanies. '
             'A tradition with several uses appears under each one. Click a tradition name for a short description and videos. Click a place to jump to it on the map. Click any pill to filter. '
             'Pill colors show what each video captures:')
    return (page_css('atlas-uses') + SHARED_CSS + '<div class="atlas-page">' + topnav('uses')
            + '<p class="atlas-intro">' + intro + '</p>' + legend()
            + '<div class="toc"><strong>Jump to:</strong> ' + ' · '.join(toc) + '</div>' + search_block()
            + '<div class="atlas-list">' + ''.join(rows) + '</div>' + MODAL + page_script(entries) + '</div>')


MAP_CARD = """<style>
  /* Fix Ghost Source theme spacing: tight header, no huge gap */
  body.page-atlas .site-content,
  body.page-template.page-atlas .site-content { padding-top: 24px !important; }
  body.page-atlas .single-header, body.page-atlas .gh-canvas .single-header { margin-bottom: 20px !important; padding-bottom: 0 !important; }
  body.page-atlas .single-title { margin-bottom: 0 !important; font-size: 24px !important; line-height: 1.15 !important; text-align: center !important; }
  body.page-atlas .single-content { padding-top: 0 !important; margin-top: 12px !important; }
  .atlas-embed-wrap {
    width: 100vw;
    position: relative;
    left: 50%;
    right: 50%;
    margin-left: -50vw;
    margin-right: -50vw;
    padding: 0 20px;
    box-sizing: border-box;
  }
  .atlas-embed-wrap iframe {
    width: 100%;
    max-width: 1400px;
    display: block;
    margin: 0 auto;
    height: 88vh;
    min-height: 700px;
    border: 1px solid #d8d4cc;
    border-radius: 6px;
  }
  .atlas-embed-note {
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 12px;
    color: #999;
    padding: 8px 0 24px;
    text-align: center;
  }
</style>
<div class="atlas-embed-wrap">
  <iframe id="atlas-iframe" data-src="MAP_WORKER_URL" title="Worksong Atlas: Map" loading="lazy" allow="fullscreen"></iframe>
  <p class="atlas-embed-note">Interactive map. Click any dot for a short description and video citations.</p>
</div>
<script data-mark="atlas-iframe-forward">(function(){var i=document.getElementById("atlas-iframe");if(!i)return;var s=i.getAttribute("data-src");if(location.hash){var sep=s.indexOf("?")>-1?"&":"?";s+=sep+"state="+encodeURIComponent(location.hash.substring(1));}i.setAttribute("src",s);})();</script>"""


def build_map_card():
    return MAP_CARD.replace('MAP_WORKER_URL', MAP_WORKER_URL)


def main():
    entries = load_entries()
    problems = validate(entries)
    if problems:
        print('Data problems (%d):' % len(problems))
        for p in problems:
            print('  -', p)
        if '--check' in sys.argv or any('unknown' in p or 'duplicate' in p or 'missing field' in p for p in problems):
            sys.exit(1)
    if '--check' in sys.argv:
        print('OK: %d entries, %d videos' % (len(entries), sum(len(e['v']) for e in entries)))
        return
    os.makedirs(OUT, exist_ok=True)
    outputs = {
        'atlas-regions.card.html': build_regions(entries),
        'atlas-uses.card.html': build_uses(entries),
        'atlas.card.html': build_map_card(),
    }
    for name, body in outputs.items():
        path = os.path.join(OUT, name)
        open(path, 'w', encoding='utf-8').write(body + '\n')
        print('wrote %s (%d bytes)' % (os.path.relpath(path, ROOT), len(body.encode('utf-8'))))
    print('%d entries, %d videos, %d with no video' % (
        len(entries), sum(len(e['v']) for e in entries), sum(1 for e in entries if not e['v'])))


if __name__ == '__main__':
    main()
