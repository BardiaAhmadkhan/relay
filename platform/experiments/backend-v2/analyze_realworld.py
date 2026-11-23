"""E19. The v3.1 engine on real-world gear photographs: what a rider and a shop would see.

Usage: py -3 experiments/backend-v2/analyze_realworld.py [labels.json] [realworld--v3.jsonl] [more labels.json ...]

Joins the blind labels (datasets/realworld-v3/labels.json, label-realworld.mjs) with the records written by
scripts/v3-realworld.ts. Every count is printed with its denominator. The held-out set excludes photographs
that are also in a calibration corpus (`seenInCalibration`); those are reported separately as a control.

What is measured, per labelled framing (item, several items, worn, scene, detail, label):
- the damage band under the shipped thresholds (clear / review / block) against the label;
- the one-photograph outcome a rider would get with a clean reported history (decide2, shipped rule order);
- the category answer against the labelled subject;
- the gates: gear and single_item;
- retake hints (feedback codes), time and input tokens per photograph.
Then the disagreements to audit at full size.
"""
import json
import sys
from collections import Counter, defaultdict

import numpy as np

labels_paths = [a for a in sys.argv[1:] if a.endswith('.json')] or ['datasets/realworld-v3/labels.json']
records_path = next((a for a in sys.argv[1:] if a.endswith('.jsonl')), 'benchmarks/backend-v2/realworld--v3.jsonl')

cases = {}
for p in labels_paths:
    for c in json.load(open(p, encoding='utf-8'))['cases']:
        cases[c['id']] = c
records = {}
for line in open(records_path, encoding='utf-8'):
    if line.strip():
        r = json.loads(line)
        records[r['id']] = r
# Labels changed after scoring by the full-size audit (datasets/realworld-v3/audit.txt). The blind labels
# are reported first; the audited ones second.
audit = {}
try:
    for line in open('datasets/realworld-v3/audit.txt', encoding='utf-8'):
        if line.strip() and not line.startswith('#'):
            cid, cond, *why = line.split()
            audit[cid] = (cond, ' '.join(why))
except FileNotFoundError:
    pass

# Expected category for the labelled subject. Vests are not one of the policy's kinds; garment (Openverse)
# covers jackets and trousers, so neither is scored for category.
EXPECTED = {'jacket': 'jacket', 'trousers': 'trousers', 'suit': 'suit', 'gloves': 'gloves', 'boots': 'boots',
            'helmet': 'helmet', 'armour': 'armour'}
FRAMINGS = ['item', 'several_items', 'worn', 'scene', 'detail', 'label']


def pct(n, d):
    return f'{n}/{d} ({100 * n / d:.0f}%)' if d else f'{n}/0'


def section(title):
    print()
    print(title)
    print('-' * len(title))


rows = []
for cid, c in cases.items():
    r = records.get(cid)
    rows.append((c, r))
scored = [(c, r) for c, r in rows if r and 'error' not in r]
errors = [(c, r) for c, r in rows if r and 'error' in r]
missing = [c['id'] for c, r in rows if not r]
held = [(c, r) for c, r in scored if not c.get('seenInCalibration')]
seen = [(c, r) for c, r in scored if c.get('seenInCalibration')]

print('E19 real-world test: v3.1 engine (qwen3.5:4b, plan, cascade on close-ups, 1600 px working size)')
print(f'labels: {", ".join(labels_paths)}')
print(f'records: {records_path}')
print(f'cases {len(cases)}, scored {len(scored)}, service errors {len(errors)}, not yet scored {len(missing)}')
print(f'held out {len(held)} ({Counter(c["source"] for c, _ in held)}), seen in calibration {len(seen)}')
if errors:
    print('errors:', Counter(r['error'] for _, r in errors))

def audited(subset):
    """The same rows with the audit's condition where it changed one."""
    out = []
    for c, r in subset:
        if c['id'] in audit:
            c = {**c, 'condition': audit[c['id']][0]}
        out.append((c, r))
    return out


def key_numbers(subset, title):
    section(title)
    garment = [(c, r) for c, r in subset if r['view'] != 'label']
    dam = [r for c, r in garment if c['condition'] == 'damaged']
    b = Counter(r['band'] for r in dam)
    print(f'damaged photographs: block {pct(b["block"], len(dam))}, review {pct(b["review"], len(dam))}, '
          f'cleared {pct(b["clear"], len(dam))}')
    for f in ['item', 'detail']:
        cl = [r for c, r in garment if c['condition'] == 'clean' and c['framing'] == f]
        b = Counter(r['band'] for r in cl)
        print(f'clean {f:7}: damage clear {pct(b["clear"], len(cl))}, review {pct(b["review"], len(cl))}, '
              f'block {pct(b["block"], len(cl))}')
    sc = [r for c, r in subset if c['framing'] == 'scene']
    o = Counter(r['outcome'] for r in sc)
    print(f'scenes: retake {pct(o["retake"], len(sc))}, review {pct(o["review"], len(sc))}, '
          f'no offer {pct(o["no_offer"], len(sc))}, offer {pct(o["offer"], len(sc))}')
    worn = [r for c, r in subset if c['framing'] == 'worn']
    o = Counter(r['outcome'] for r in worn)
    print(f'worn: ' + ', '.join(f'{k} {pct(v, len(worn))}' for k, v in o.most_common()))
    offers = [(c, r) for c, r in subset if r['outcome'] == 'offer']
    bad = [c['id'] for c, r in offers if c['condition'] != 'clean' or c['framing'] in ('scene', 'several_items')]
    print(f'offers: {len(offers)}; on a photograph not labelled clean, or of a scene or several items: {bad or "none"}')


key_numbers(held, 'Key numbers, blind labels (held out)')
if audit:
    key_numbers(audited(held), f'Key numbers after the full-size audit ({len(audit)} labels changed, audit.txt)')

section('Time and input tokens per photograph (held out)')
by_view = defaultdict(list)
for c, r in held:
    by_view[r['view']].append(r)
print(f'{"view":8} {"n":>4} {"median ms":>10} {"p90 ms":>8} {"median tokens":>14} {"median questions":>17}')
for v in ['front', 'back', 'detail', 'label']:
    rs = by_view.get(v, [])
    if not rs:
        continue
    ms = np.array([x['ms'] for x in rs])
    tok = np.array([x['tokens'] for x in rs])
    q = np.array([x['questions'] for x in rs])
    print(f'{v:8} {len(rs):4d} {np.median(ms):10.0f} {np.percentile(ms, 90):8.0f} {np.median(tok):14.0f} {np.median(q):17.0f}')
allms = np.array([r['ms'] for _, r in held])
print(f'all held out: median {np.median(allms):.0f} ms, total {allms.sum() / 1000:.0f} s for {len(held)} photographs')


def band_table(subset, title):
    section(title)
    print(f'{"framing":14} {"condition":10} {"n":>4}  {"clear":>12} {"review":>12} {"block":>12}')
    for f in FRAMINGS:
        for cond in ['clean', 'damaged', 'ambiguous']:
            rs = [r for c, r in subset if c['framing'] == f and c['condition'] == cond and r['view'] != 'label']
            if not rs:
                continue
            b = Counter(r['band'] for r in rs)
            n = len(rs)
            print(f'{f:14} {cond:10} {n:4d}  {pct(b["clear"], n):>12} {pct(b["review"], n):>12} {pct(b["block"], n):>12}')


band_table(held, 'Damage band against the label (held out; labels excluded)')


def outcome_table(subset, title):
    section(title)
    print(f'{"framing":14} {"condition":10} {"n":>4}  outcomes (reason codes)')
    for f in FRAMINGS:
        for cond in ['clean', 'damaged', 'ambiguous']:
            rs = [r for c, r in subset if c['framing'] == f and c['condition'] == cond]
            if not rs:
                continue
            o = Counter(r['outcome'] for r in rs)
            reasons = Counter(code for r in rs for code in r['reasons'][:1])
            print(f'{f:14} {cond:10} {len(rs):4d}  ' + ', '.join(f'{k} {v}' for k, v in o.most_common())
                  + '   [' + ', '.join(f'{k} {v}' for k, v in reasons.most_common(6)) + ']')


outcome_table(held, 'One-photograph outcome with a clean reported history (held out)')

section('Category answer against the labelled subject (held out; item, worn and detail framings)')
conf = defaultdict(Counter)
for c, r in held:
    if c['subject'] in EXPECTED and c['framing'] in ('item', 'worn', 'detail'):
        conf[c['subject']][r['category'] or 'none'] += 1
total = right = 0
for subj, cnt in sorted(conf.items()):
    n = sum(cnt.values())
    ok = cnt[EXPECTED[subj]]
    total += n
    right += ok
    print(f'{subj:9} {pct(ok, n):>12}   ' + ', '.join(f'{k} {v}' for k, v in cnt.most_common()))
print(f'overall {pct(right, total)}')

section('Gates on front and back photographs (held out): share below 0.5')
print(f'{"framing":14} {"n":>4} {"gear < 0.5":>14} {"single_item < 0.5":>18}')
for f in FRAMINGS:
    rs = [r for c, r in held if c['framing'] == f and r['view'] in ('front', 'back')]
    if not rs:
        continue
    g = [r['gear'] for r in rs if r['gear'] is not None]
    s = [r['singleItem'] for r in rs if r['singleItem'] is not None]
    print(f'{f:14} {len(rs):4d} {pct(sum(x < 0.5 for x in g), len(g)):>14} {pct(sum(x < 0.5 for x in s), len(s)):>18}')
print('by subject, item framing only:')
for subj in sorted({c['subject'] for c, _ in held}):
    rs = [r for c, r in held if c['subject'] == subj and c['framing'] == 'item' and r['view'] in ('front', 'back')]
    if not rs:
        continue
    g = [r['gear'] for r in rs if r['gear'] is not None]
    print(f'  {subj:9} n={len(rs):3d} gear<0.5 {pct(sum(x < 0.5 for x in g), len(g))}')

section('The "one item" gate: share of front and back photographs that pass (single_item >= t), held out')
print('The shipped threshold, 0.5, was never fitted (a placeholder in scripts/v2-calibrate.ts). A photograph')
print('of one item on its own should pass; scenes and several items should not; worn is off-instruction.')
by_f = {f: [r['singleItem'] for c, r in held if c['framing'] == f and r['view'] in ('front', 'back')
            and r['singleItem'] is not None] for f in ['item', 'several_items', 'worn', 'scene']}
print(f'{"t":>5} ' + ' '.join(f'{f:>16}' for f in by_f))
for t in [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55]:
    print(f'{t:5.2f} ' + ' '.join(f'{pct(sum(x >= t for x in v), len(v)):>16}' for v in by_f.values()))
items, others = by_f['item'], by_f['several_items'] + by_f['scene']
if items and others:
    auc = np.mean([(i > o) + 0.5 * (i == o) for i in items for o in others])
    print(f'AUC, one item against scenes and several items: {auc:.3f} ({len(items)} against {len(others)})')

section('Retake hints (feedback codes) by framing (held out)')
for f in FRAMINGS:
    rs = [r for c, r in held if c['framing'] == f]
    if not rs:
        continue
    fb = Counter(code for r in rs for code in r['feedback'])
    none = sum(1 for r in rs if not r['feedback'])
    print(f'{f:14} n={len(rs):3d} no hint {pct(none, len(rs)):>12}  ' + ', '.join(f'{k} {v}' for k, v in fb.most_common()))

section('Label photographs')
for c, r in scored:
    if r['view'] == 'label':
        print(c['id'], 'label_legible', r['labelLegible'], 'outcome', r['outcome'], r['reasons'], r['feedback'])

if seen:
    band_table(seen, 'Control: photographs seen in calibration (damage band)')
    outcome_table(seen, 'Control: photographs seen in calibration (outcome)')

section('To audit at full size (held out)')
flags = []
for c, r in held:
    why = []
    if c['condition'] == 'clean' and r['band'] == 'block' and r['view'] != 'label':
        why.append('clean but damage block')
    if c['condition'] == 'clean' and r['band'] == 'review' and r['view'] != 'label':
        why.append('clean but damage review')
    if c['condition'] == 'damaged' and r['band'] == 'clear':
        why.append('damaged but cleared')
    if c['framing'] == 'scene' and r['outcome'] == 'offer':
        why.append('scene reached an offer')
    if c['framing'] == 'item' and 'multiple_items' in r['reasons']:
        why.append('single item called several')
    if c['subject'] in EXPECTED and c['framing'] in ('item', 'detail') and r['category'] != EXPECTED[c['subject']]:
        why.append(f'category {r["category"]} for {c["subject"]}')
    if why:
        flags.append((c, r, why))
for c, r, why in flags:
    a = r['answers']
    print(f'{c["id"]:8} {c["condition"]:9} {c["subject"]:8} {c["framing"]:13} {r["view"]:6} band {r["band"]:6} '
          f'road {a.get("road_contact")} broken {a.get("broken")} repair {a.get("repair")} -> {r["outcome"]} '
          f'{r["reasons"][:2]} | {"; ".join(why)} | {c["visualBasis"][:60]}')
print(f'{len(flags)} photographs flagged')
