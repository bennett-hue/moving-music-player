#!/usr/bin/env python3
"""Make every song inside a picker route readable by the member who
picked that route.

Ghost strips `paid` content on the server before the page reaches the
browser, so gate.js can never open a `paid` post. For "pick a route,
get its songs" to be true, every post carrying one of the nine route
tags must be `members` visibility; gate.js then decides which members
see it. Posts with no route tag are left alone (they stay paid-only,
the Full Songbook's exclusive catalog), and public posts are left
alone too.

Rule applied by this script, nothing else:
    visibility == paid  AND  has a route tag  ->  members

Dry run by default. Prints the plan, changes nothing.

    GHOST_ADMIN_KEY='<id>:<secret>' python3 scripts/mm_route_visibility.py
    GHOST_ADMIN_KEY='<id>:<secret>' python3 scripts/mm_route_visibility.py --apply

The Admin API key is the one the mmp-sync worker uses (Ghost Admin,
Settings, Integrations, the custom integration). Before applying, the
script writes a backup JSON of every post it is about to change next
to itself, so the change can be reversed post by post.
"""
import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request

GHOST = 'https://moving-music.ghost.io'
ROUTES = [
    'rowing', 'sea-shanties', 'walking', 'farm', 'woods',
    'maine', 'shaker', 'love', 'gathering',
]


def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def admin_jwt(admin_key):
    kid, secret_hex = admin_key.strip().split(':', 1)
    header = {'alg': 'HS256', 'typ': 'JWT', 'kid': kid}
    now = int(time.time())
    payload = {'iat': now, 'exp': now + 300, 'aud': '/admin/'}
    signing = (b64url(json.dumps(header, separators=(',', ':')).encode())
               + '.' + b64url(json.dumps(payload, separators=(',', ':')).encode()))
    sig = hmac.new(bytes.fromhex(secret_hex), signing.encode(), hashlib.sha256).digest()
    return signing + '.' + b64url(sig)


def call(method, path, token, body=None):
    data = None
    headers = {'Authorization': 'Ghost ' + token, 'Accept-Version': 'v5.0'}
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(GHOST + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit('{} {} failed: {} {}'.format(method, path, e.code, e.read().decode(errors='replace')[:500]))


def fetch_posts(token):
    posts = []
    page = 1
    while True:
        d = call('GET', '/ghost/api/admin/posts/?limit=100&page={}&include=tags'
                 '&fields=id,slug,title,visibility,status,updated_at'
                 '&filter=status:published'.format(page), token)
        posts.extend(d['posts'])
        pages = d.get('meta', {}).get('pagination', {}).get('pages', 1)
        if page >= pages:
            return posts
        page += 1


def plan(posts):
    rows = []
    for p in posts:
        tags = [t['slug'] for t in p.get('tags', [])]
        routes = [t for t in tags if t in ROUTES]
        if p['visibility'] == 'paid' and routes:
            kind = 'original' if 'originals' in tags else 'traditional'
            rows.append({'id': p['id'], 'slug': p['slug'], 'title': p['title'],
                         'from': p['visibility'], 'to': 'members', 'kind': kind,
                         'routes': routes, 'updated_at': p['updated_at']})
    rows.sort(key=lambda r: (r['kind'], r['title'].lower()))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='write the changes to Ghost')
    args = ap.parse_args()

    key = os.environ.get('GHOST_ADMIN_KEY', '').strip()
    if ':' not in key:
        sys.exit('Set GHOST_ADMIN_KEY to the Admin API key (<id>:<secret>).')
    token = admin_jwt(key)

    posts = fetch_posts(token)
    rows = plan(posts)
    print('published posts: {}'.format(len(posts)))
    print('paid posts carrying a route tag, to become members: {}'.format(len(rows)))
    for r in rows:
        print('  {:11} {:<40} {}'.format(r['kind'], r['title'][:40], ', '.join(r['routes'])))
    untouched = [p for p in posts if p['visibility'] == 'paid'
                 and not any(t['slug'] in ROUTES for t in p.get('tags', []))]
    print('paid posts with no route tag, left paid: {}'.format(len(untouched)))
    for p in untouched:
        print('  {}'.format(p['title']))

    if not args.apply:
        print('\nDry run. Re-run with --apply to change visibility.')
        return
    if not rows:
        print('\nNothing to change.')
        return

    stamp = time.strftime('%Y%m%d-%H%M%S')
    backup = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'mm_route_visibility_backup_{}.json'.format(stamp))
    with open(backup, 'w') as f:
        json.dump(rows, f, indent=2)
    print('\nbackup written: {}'.format(backup))

    for r in rows:
        token = admin_jwt(key)  # fresh token; the first one expires after 5 min
        d = call('PUT', '/ghost/api/admin/posts/{}/'.format(r['id']), token,
                 {'posts': [{'visibility': 'members', 'updated_at': r['updated_at']}]})
        got = d['posts'][0]['visibility']
        print('  {:<40} {} -> {}'.format(r['title'][:40], r['from'], got))
        if got != 'members':
            sys.exit('visibility did not change on {}; stopping.'.format(r['slug']))
    print('\ndone: {} posts now members'.format(len(rows)))


if __name__ == '__main__':
    main()
