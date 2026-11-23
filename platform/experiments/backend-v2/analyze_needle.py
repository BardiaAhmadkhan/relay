"""E18. Small damage in a large frame: is it still caught at 512 px, at 1600 px, and by the v3 cascade?

Usage: py -3 experiments/backend-v2/analyze_needle.py <needle run at 512 px> <needle run at 1600 px>

Mosaics from datasets/needle-v3 (make-mosaics.mjs): one damaged fabric tile among clean tiles of the same
fabric, or all clean tiles, in 3x3, 4x4 and 6x6 grids. Bands are the shipped ones: the v3 first stage at
512 px (clear 0.139, block 0.552, thresholds.cascade512.json) and the policy at 1600 px (clear 0.145,
block 0.646, thresholds.json). The cascade takes the 512 px band unless it is review, then the 1600 px band.
"""
import json, sys
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

S1 = (0.139, 0.552)
POLICY = (0.145, 0.646)


def load(path):
    out = {}
    for line in open(path, encoding='utf-8'):
        if line.strip():
            r = json.loads(line)
            if 'error' not in r:
                out[r['id']] = max(r['probes']['break']['p']['yes'], r['probes']['slide']['p']['yes'])
    return out


def band(s, b):
    return 'clear' if s < b[0] else 'review' if s < b[1] else 'block'


def main():
    labels = {c['id']: c for c in json.load(open('datasets/needle-v3/labels.json', encoding='utf-8'))['cases']}
    s512, s1600 = load(sys.argv[1]), load(sys.argv[2])
    rows = []
    for i, c in labels.items():
        if i not in s512 or i not in s1600:
            continue
        b5, b16 = band(s512[i], S1), band(s1600[i], POLICY)
        rows.append({'id': i, 'grid': c['grid'], 'damaged': c['condition'] == 'visible_defect', 'share': c['defectShare'],
                     'd512': s512[i], 'd1600': s1600[i], 'b512': b5, 'b1600': b16, 'cascade': b16 if b5 == 'review' else b5})
    df = pd.DataFrame(rows)
    print(f'mosaics scored at both sizes: {len(df)} ({df.damaged.sum()} damaged, {(~df.damaged).sum()} clean)')
    def counts(part, col):
        return '/'.join(str((part[col] == b).sum()) for b in ('clear', 'review', 'block'))
    print('\nclear/review/block counts per grid')
    print('grid  set        n   512 px        1600 px       cascade       AUC 512  AUC 1600')
    for g, part in df.groupby('grid'):
        y = part.damaged.astype(int)
        a5 = roc_auc_score(y, part.d512) if y.nunique() == 2 else float('nan')
        a16 = roc_auc_score(y, part.d1600) if y.nunique() == 2 else float('nan')
        for name, sub in (('damaged', part[part.damaged]), ('clean', part[~part.damaged])):
            print(f'{g}x{g}   {name:8s} {len(sub):3d}   {counts(sub, "b512"):12s}  {counts(sub, "b1600"):12s}  {counts(sub, "cascade"):12s}'
                  + (f'  {a5:7.3f}  {a16:8.3f}' if name == 'damaged' else ''))
    dmg = df[df.damaged].copy()
    dmg['bin'] = pd.cut(dmg.share, [0, 0.0005, 0.002, 0.01, 1], labels=['<0.05%', '0.05-0.2%', '0.2-1%', '>1%'])
    print('\ndamaged mosaics by the share of the frame the defect covers: cleared at 512 / 1600 / cascade, of n')
    for b, sub in dmg.groupby('bin', observed=True):
        print(f'  {b:10s} n={len(sub):3d}   cleared {int((sub.b512 == "clear").sum())} / {int((sub.b1600 == "clear").sum())} / {int((sub.cascade == "clear").sum())}'
              f'   blocked {int((sub.b512 == "block").sum())} / {int((sub.b1600 == "block").sum())} / {int((sub.cascade == "block").sum())}')
    worse = dmg[(dmg.cascade == 'clear') & (dmg.b1600 != 'clear')]
    better = dmg[(dmg.cascade != 'clear') & (dmg.b1600 == 'clear')]
    print(f'\ncascade clears a damaged mosaic that 1600 px alone would not: {len(worse)}  {worse.id.tolist()}')
    print(f'cascade catches a damaged mosaic that 1600 px alone would clear: {len(better)}  {better.id.tolist()}')
    print(f'clean mosaics wrongly blocked: 512 {int((df[~df.damaged].b512 == "block").sum())}, 1600 {int((df[~df.damaged].b1600 == "block").sum())}, cascade {int((df[~df.damaged].cascade == "block").sum())}')


if __name__ == '__main__':
    main()
