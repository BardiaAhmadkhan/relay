"""E10. Capture gate: how much blur before detection drops, and which focus value catches it.

Usage: py -3 experiments/backend-v2/analyze_blur.py <e1024 base run> <blur run> [<blur run> ...]
        [--extra <quality run> <brightness run>]

Every run is the same 223 labelled photographs at the 1024 px working size; blur runs add a Gaussian
blur of the given sigma before JPEG encoding (lib.mjs prepare()). Focus measures are computed by the
runner on a fixed 512 px grid (lib.mjs sharpness(): variance of the Laplacian, Tenengrad).

1. Detection per blur level: AUC, three-band counts, and damaged photographs that move to a lower band.
2. Focus thresholds: for each candidate value, the share of unblurred photographs that would be asked
   for a retake (the cost: a nagging gate) and the share of photographs at the first harmful blur level
   that would be caught (the benefit).
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

LOW, HIGH = 0.145, 0.646  # the fitted local thresholds (packages/core/v2/thresholds.json)


def load(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    rows = [r for r in rows if 'error' not in r]
    df = pd.DataFrame([{'id': r['id'], 'domain': r['domain'], 'condition': r['condition'],
                        'damage': max(r['probes']['break']['p']['yes'], r['probes']['slide']['p']['yes']),
                        'lapVar': r['focus']['lapVar'], 'tenengrad': r['focus']['tenengrad'],
                        'brightness': r['focus']['brightness']} for r in rows])
    return df[df.condition.isin(['visible_defect', 'no_visible_defect'])].set_index('id')


def band(v):
    return np.where(v < LOW, 0, np.where(v < HIGH, 1, 2))


def main():
    args = sys.argv[1:]
    extra = []
    if '--extra' in args:
        i = args.index('--extra'); extra = args[i + 1:]; args = args[:i]
    base_path, runs = args[0], args[1:]
    base = load(base_path)
    print(f'base {os.path.basename(base_path)}: {len(base)} photographs; bands clear < {LOW} <= review < {HIGH} <= block')
    print('\n== detection per degradation ==')
    table = []
    for path in [base_path] + runs + extra:
        df = load(path).join(base[['damage']], rsuffix='_base', how='inner')
        y = (df.condition == 'visible_defect').astype(int).values
        dmg = df[df.condition == 'visible_defect']
        moved_down = int((band(dmg.damage.values) < band(dmg.damage_base.values)).sum())
        moved_up = int((band(dmg.damage.values) > band(dmg.damage_base.values)).sum())
        clean = df[df.condition == 'no_visible_defect']
        table.append({'run': os.path.basename(path).replace('battery--b1--', '').replace('.jsonl', ''),
                      'n': len(df), 'auc': round(roc_auc_score(y, df.damage.values), 4),
                      'damaged cleared': int((dmg.damage < LOW).sum()), 'damaged blocked': int((dmg.damage >= HIGH).sum()),
                      'clean blocked': int((clean.damage >= HIGH).sum()), 'clean cleared': int((clean.damage < LOW).sum()),
                      'damaged moved down': moved_down, 'damaged moved up': moved_up,
                      'mean |delta|': round(float((df.damage - df.damage_base).abs().mean()), 4),
                      'lapVar median': round(float(df.lapVar.median()), 1), 'tenengrad median': round(float(df.tenengrad.median()), 1)})
    print(pd.DataFrame(table).set_index('run').T.to_string())

    # Safety cost of blur is a damaged photograph moving INTO the clear band; a move from block to review
    # only costs a person's time. So the gate is judged on every level, against both.
    levels = [(os.path.basename(p).split('-blur')[-1].replace('.jsonl', ''), load(p)) for p in runs]
    print('\n== focus thresholds: share of unblurred photographs asked to retake (nag) vs share caught per blur level ==')
    for measure, candidates in (('lapVar', (20, 30, 40, 50, 60, 75, 100, 140)),
                                ('tenengrad', (800, 1200, 1600, 2000, 2500, 3200))):
        sharp_vals = base[measure].values
        head = ''.join(f'  sigma {name:>4s}' for name, _ in levels)
        print(f'  {measure:9s} threshold   nag{head}')
        for t in candidates:
            caught = ''.join(f'  {np.mean(df[measure].values < t):10.0%}' for _, df in levels)
            print(f'  {measure:9s} {t:9.0f}  {np.mean(sharp_vals < t):4.0%}{caught}')
    # Of the damaged photographs that blur pushed into the clear band, how many would the gate have stopped?
    print('\n== damaged photographs newly cleared by blur, and whether a lapVar gate stops them ==')
    for name, df in levels:
        j = df.join(base[['damage']], rsuffix='_base', how='inner')
        newly = j[(j.condition == 'visible_defect') & (j.damage < LOW) & (j.damage_base >= LOW)]
        stops = {t: int((newly.lapVar < t).sum()) for t in (30, 50, 75, 100)}
        print(f'  sigma {name}: {len(newly)} newly cleared; stopped by lapVar < 30/50/75/100: '
              + ' / '.join(str(v) for v in stops.values()))
    # Per domain, because a plain leather panel is smooth even when sharp.
    print('\n  per domain (lapVar): unblurred 5th percentile, then the median at each blur level')
    for dom, g in base.groupby('domain'):
        medians = ' '.join(f'{np.median(df[df.domain == dom].lapVar):8.1f}' if (df.domain == dom).any() else '     n/a'
                           for _, df in levels)
        print(f'    {dom:26s} {np.percentile(g.lapVar, 5):8.1f} | {medians}  (n {len(g)})')


if __name__ == '__main__':
    main()
