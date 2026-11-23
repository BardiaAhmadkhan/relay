"""E7. Would a TRAINED small specialist, or a LEARNED combiner, beat the prompted questions with today's data?

Measurement only (the owner asked on 2026-11-17 whether small trained specialists would be better).
Nothing here ships: the challenge brief puts model training out of scope and AGENTS.md forbids it in
the product. Every model below is fitted inside grouped cross-validation, so whole source groups are
held out together, exactly like scripts/v2-crossval.ts.

Usage: py -3 experiments/backend-v2/analyze_specialists.py \
          benchmarks/backend-v2/embed--siglip.json benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1600.jsonl

Compared on the same 223 labelled photographs (113 damaged, 110 clean):
  A  prompted damage question, no fitting:         max(break, slide) from battery b1
  B  trained small specialist:                     logistic regression on frozen SigLIP image embeddings
  C  learned combiner of the prompted answers:     logistic regression on logit(break, slide, repair, wear)
  D  learned combiner plus the trained specialist: C's inputs plus B's out-of-fold score
"""
import json, sys
import numpy as np, pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

REPEATS = 20


def logit(p):
    p = np.clip(np.asarray(p, dtype=float), 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def main():
    emb = json.load(open(sys.argv[1], encoding='utf-8'))
    battery = {r['id']: r for r in (json.loads(l) for l in open(sys.argv[2], encoding='utf-8') if l.strip()) if 'error' not in r}
    rows = []
    for r in emb['rows']:
        if r['condition'] not in ('visible_defect', 'no_visible_defect') or r['id'] not in battery:
            continue
        p = battery[r['id']]['probes']
        rows.append({'id': r['id'], 'group': r['group'], 'gear': r['domain'] in ('garments_and_gear', 'hardware'),
                     'y': int(r['condition'] == 'visible_defect'), 'emb': r['embedding'],
                     'break': p['break']['p']['yes'], 'slide': p['slide']['p']['yes'],
                     'repair': p['repair']['p']['yes'], 'wear': p['wear']['p']['yes']})
    df = pd.DataFrame(rows)
    X_emb = np.array(df.emb.tolist())
    X_vlm = np.column_stack([logit(df[c]) for c in ('break', 'slide', 'repair', 'wear')])
    y, groups, gear = df.y.values, df.group.values, df.gear.values
    prompted = df[['break', 'slide']].max(axis=1).values
    print(f'photographs {len(df)} ({y.sum()} damaged, {(1 - y).sum()} clean; gear {gear.sum()}: {y[gear].sum()} damaged); groups {len(set(groups))}; embedding dim {X_emb.shape[1]}')

    def auc(score, mask=None):
        m = np.ones(len(y), bool) if mask is None else mask
        return roc_auc_score(y[m], score[m]) if len(set(y[m])) == 2 else float('nan')

    results = {k: [] for k in ('B', 'C', 'D')}
    gear_results = {k: [] for k in ('B', 'C', 'D')}
    for r in range(REPEATS):
        cv = StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=r)
        oof = {k: np.zeros(len(y)) for k in results}
        for train, test in cv.split(X_emb, y, groups):
            probe = make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=5000))
            probe.fit(X_emb[train], y[train])
            oof['B'][test] = probe.predict_proba(X_emb[test])[:, 1]
            comb = LogisticRegression(C=1.0, max_iter=5000).fit(X_vlm[train], y[train])
            oof['C'][test] = comb.predict_proba(X_vlm[test])[:, 1]
            # D needs the probe's score on the fitting side without leakage: an inner grouped split.
            inner = StratifiedGroupKFold(n_splits=4, shuffle=True, random_state=100 + r)
            inner_score = np.zeros(len(train))
            for itr, ite in inner.split(X_emb[train], y[train], groups[train]):
                ip = make_pipeline(StandardScaler(), LogisticRegression(C=0.05, max_iter=5000))
                ip.fit(X_emb[train][itr], y[train][itr])
                inner_score[ite] = ip.predict_proba(X_emb[train][ite])[:, 1]
            both = LogisticRegression(C=1.0, max_iter=5000).fit(
                np.column_stack([X_vlm[train], logit(inner_score)]), y[train])
            oof['D'][test] = both.predict_proba(np.column_stack([X_vlm[test], logit(oof['B'][test])]))[:, 1]
        for k in results:
            results[k].append(auc(oof[k]))
            gear_results[k].append(auc(oof[k], gear))

    print('\n== ranking quality (AUC), out of fold, grouped 5-fold x %d ==' % REPEATS)
    print(f'  A prompted max(break, slide), no fitting      all {auc(prompted):.4f}   gear {auc(prompted, gear):.4f}')
    names = {'B': 'trained specialist on SigLIP embeddings ', 'C': 'learned combiner of prompted answers     ',
             'D': 'learned combiner + trained specialist    '}
    for k, name in names.items():
        a, g = np.array(results[k]), np.array(gear_results[k])
        print(f'  {k} {name}  all {a.mean():.4f} ({a.min():.4f}-{a.max():.4f})   gear {np.nanmean(g):.4f} ({np.nanmin(g):.4f}-{np.nanmax(g):.4f})')
    print('\nReading: B is what a small trained specialist reaches with today\'s labelled photographs. C and D test whether a')
    print('fitted combination beats the fixed max() rule. Only 15 damaged gear photographs exist, so gear figures are fragile.')


if __name__ == '__main__':
    main()
