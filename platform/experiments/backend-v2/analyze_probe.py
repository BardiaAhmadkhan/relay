"""Score a probe run against the frozen labels and the previous pipeline's recorded flags.

Usage: py -3 experiments/backend-v2/analyze_probe.py <probe-jsonl> [more-jsonl ...] [--json out.json]

Positive = condition 'visible_defect'; negative = 'no_visible_defect'. 'ambiguous' and
'unassessable' are reported separately and never scored. Baseline flags are the SELECTED
cycle-02 profile's recorded outputs (datasets/quality-cycle-02/comparison.csv, candidateFlag).
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
pd.set_option('display.width', 220); pd.set_option('display.max_columns', 30)


def load(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    df = pd.DataFrame([r for r in rows if 'error' not in r])
    df['score'] = df['p'].apply(lambda p: p['yes'])
    return df, sum(1 for r in rows if 'error' in r)


def baseline():
    c = pd.read_csv(os.path.join(ROOT, 'datasets/quality-cycle-02/comparison.csv'))
    return c.set_index('id')['candidateFlag'].astype(bool).to_dict()


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, centre - half), min(1, centre + half))


def block(df, name, base, thresholds=(0.5,)):
    pos = df[df.condition == 'visible_defect']; neg = df[df.condition == 'no_visible_defect']
    out = {'slice': name, 'positives': len(pos), 'negatives': len(neg)}
    if len(pos) and len(neg):
        y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]; s = np.r_[pos.score.values, neg.score.values]
        out['auc'] = round(float(roc_auc_score(y, s)), 4)
    for t in thresholds:
        tp = int((pos.score >= t).sum()); fp = int((neg.score >= t).sum())
        out[f'recall@{t}'] = f'{tp}/{len(pos)}'; out[f'falseAlert@{t}'] = f'{fp}/{len(neg)}'
    bpos = [base.get(i) for i in pos.id if i in base]; bneg = [base.get(i) for i in neg.id if i in base]
    if bpos or bneg:
        out['baselineRecall(any flag)'] = f'{sum(bpos)}/{len(bpos)}'
        out['baselineFalseAlert'] = f'{sum(bneg)}/{len(bneg)}'
    return out


def main():
    paths = [a for a in sys.argv[1:] if not a.startswith('--')]
    base = baseline()
    report = {}
    for path in paths:
        df, errors = load(path)
        print('\n====', os.path.basename(path), 'rows', len(df), 'errors', errors)
        rows = [block(df, 'ALL scored', base)]
        gear = df[df.domain.isin(['garments_and_gear', 'hardware'])]
        rows.append(block(gear, 'gear + hardware (in-domain)', base))
        for d, g in df.groupby('domain'):
            rows.append(block(g, d, base))
        table = pd.DataFrame(rows).fillna('')
        print(table.to_string(index=False))
        # Operating points on the in-domain slice and overall.
        for label, part in (('ALL', df), ('gear', gear)):
            pos = part[part.condition == 'visible_defect'].score.values
            neg = part[part.condition == 'no_visible_defect'].score.values
            if not len(pos) or not len(neg):
                continue
            print(f'\n-- operating points [{label}] (pos={len(pos)}, neg={len(neg)})')
            for t in (0.05, 0.1, 0.2, 0.3, 0.5, 0.7, 0.9):
                tp = int((pos >= t).sum()); fp = int((neg >= t).sum())
                lo, hi = wilson(tp, len(pos)); flo, fhi = wilson(fp, len(neg))
                print(f'  t={t:<4}  recall {tp}/{len(pos)} ({tp/len(pos):.0%}, 95% CI {lo:.0%}-{hi:.0%})   false alerts {fp}/{len(neg)} ({fp/len(neg):.0%}, CI {flo:.0%}-{fhi:.0%})')
        amb = df[df.condition == 'ambiguous']
        print(f'\n-- ambiguous (unscored) n={len(amb)}: score>=0.5 in {(amb.score>=0.5).sum()}, median score {amb.score.median():.3f}')
        print(f'-- latency ms: median {df.ms.median():.0f}, p95 {df.ms.quantile(.95):.0f}; prompt tokens median {df.promptTokens.median():.0f}, max {df.promptTokens.max()}')
        misses = df[(df.condition == 'visible_defect') & (df.score < 0.5)].sort_values('score')
        fas = df[(df.condition == 'no_visible_defect') & (df.score >= 0.5)].sort_values('score', ascending=False)
        print('-- misses @0.5:', ', '.join(f'{r.id}({r.score:.2f})' for r in misses.itertuples()))
        print('-- false alerts @0.5:', ', '.join(f'{r.id}({r.score:.2f})' for r in fas.itertuples()))
        report[os.path.basename(path)] = {'table': rows, 'misses': misses.id.tolist(), 'falseAlerts': fas.id.tolist(),
                                          'latencyMedianMs': float(df.ms.median()), 'latencyP95Ms': float(df.ms.quantile(.95))}
    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        json.dump(report, open(out, 'w', encoding='utf-8'), indent=1)


if __name__ == '__main__':
    main()
