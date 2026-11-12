#!/usr/bin/env python3
"""File videos from the movingmusicTV inbox into tv/finds.json.

The Send button puts a bare video on the TV within a minute (link plus Bennett's
note). This script is how Claude files it properly: place, coordinates, Atlas
tradition, uses, what the video shows, credit. Once filed on main, the filed copy
replaces the inbox copy on the TV and the Atlas.

Usage:
    python3 scripts/tv_intake.py pull
        List inbox videos that are not filed yet (JSON, one per line).
    python3 scripts/tv_intake.py add --url URL [--label ...] [--by ...] [--place ...]
            [--la N --lo N] [--tradition SLUG] [--uses a,b] [--shows at-work|shared|concert]
            [--orient v|h] [--note ...] [--added YYYY-MM-DD] [--from ...] [--check field,field]
        Add a find, or update the fields you pass on an existing one.
    python3 scripts/tv_intake.py hide --id ID --why "reason"
        Take a video off the TV and the Atlas, Atlas videos included.

After add or hide: python3 scripts/build_tv.py --check, then commit and push to main.
"""
import argparse
import datetime
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_tv as tv  # noqa: E402

PLATFORM_OF = {'yt': 'youtube', 'ig': 'instagram', 'fb': 'facebook', 'tt': 'tiktok', 'file': 'file'}


def load():
    with open(tv.FINDS, encoding='utf-8') as f:
        return json.load(f)


def save(doc):
    slugs = {tv.atlas.slugify(e['n']) for e in tv.atlas.load_entries()}
    problems = tv.validate_finds(doc.get('finds', []), slugs)
    if problems:
        print('Not saved. Problems:')
        for p in problems:
            print('  -', p)
        sys.exit(1)
    with open(tv.FINDS, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write('\n')


def cmd_pull(args):
    with urllib.request.urlopen(tv.TV_LIVE_URL, timeout=20) as r:
        live = json.load(r)
    filed = {f['id'] for f in load().get('finds', [])}
    waiting = [f for f in live.get('finds', []) if f.get('inbox') and f.get('id') not in filed]
    for f in waiting:
        print(json.dumps(f, ensure_ascii=False))
    print('%d waiting in the inbox' % len(waiting), file=sys.stderr)


def cmd_add(args):
    pv = tv.parse_video(args.url)
    if not pv:
        sys.exit('Not a YouTube, Instagram, Facebook, TikTok, or video-file link: %s' % args.url)
    args.url = tv.canonical(args.url, pv)
    pv = tv.parse_video(args.url)
    fid = tv.item_id(pv)
    doc = load()
    finds = doc.setdefault('finds', [])
    hit = next((f for f in finds if f['id'] == fid), None)
    given = {
        'label': args.label, 'by': args.by, 'place': args.place, 'la': args.la, 'lo': args.lo,
        'tradition': args.tradition, 'uses': args.uses.split(',') if args.uses else None,
        'shows': args.shows, 'orient': args.orient, 'note': args.note, 'added': args.added,
        'from': getattr(args, 'from'),
        'check': [c for c in args.check.split(',') if c] if args.check is not None else None,
    }
    if hit:
        for k, v in given.items():
            if v is not None:
                hit[k] = v
        print('updated', fid)
    else:
        f = {
            'id': fid, 'platform': PLATFORM_OF[pv['p']], 'url': args.url, 'by': args.by or '',
            'label': args.label or '', 'place': args.place or '', 'la': args.la, 'lo': args.lo,
            'tradition': args.tradition or '', 'uses': given['uses'] or [], 'shows': args.shows or '',
            'orient': args.orient or pv['o'], 'added': args.added or datetime.date.today().isoformat(),
            'from': getattr(args, 'from') or 'Send button', 'note': args.note or '',
            'check': given['check'] if given['check'] is not None else [],
        }
        if not f['label']:
            sys.exit('A new find needs --label (one line: what the video shows).')
        finds.append(f)
        print('added', fid)
    save(doc)


def cmd_hide(args):
    doc = load()
    hide = doc.setdefault('hide', [])
    if any(h.get('id') == args.id for h in hide):
        print('already hidden', args.id)
        return
    hide.append({'id': args.id, 'why': args.why, 'checked': datetime.date.today().isoformat()})
    save(doc)
    print('hidden', args.id)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('pull')
    a = sub.add_parser('add')
    a.add_argument('--url', required=True)
    for name in ('label', 'by', 'place', 'tradition', 'uses', 'shows', 'note', 'added', 'from', 'check'):
        a.add_argument('--' + name)
    a.add_argument('--la', type=float)
    a.add_argument('--lo', type=float)
    a.add_argument('--orient', choices=('v', 'h'))
    h = sub.add_parser('hide')
    h.add_argument('--id', required=True)
    h.add_argument('--why', required=True)
    args = ap.parse_args()
    {'pull': cmd_pull, 'add': cmd_add, 'hide': cmd_hide}[args.cmd](args)


if __name__ == '__main__':
    main()
