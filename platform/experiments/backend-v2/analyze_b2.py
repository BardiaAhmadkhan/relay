"""Battery b2 on the gear photographs: wording robustness, extra production questions, zone questions.

Usage: py -3 experiments/backend-v2/analyze_b2.py <b2.jsonl> <b1-reference.jsonl>
"""
import json, sys
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

pd.set_option('display.width', 240); pd.set_option('display.max_rows', 200)
LOW, HIGH = 0.145, 0.646  # the fitted local thresholds (packages/core/v2/thresholds.json)


def auc(y, s):
    return round(float(roc_auc_score(y, s)), 4) if len(set(y)) == 2 else float('nan')


def main():
    b2 = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
    b2 = [r for r in b2 if 'error' not in r]
    b1 = {r['id']: r for r in (json.loads(l) for l in open(sys.argv[2], encoding='utf-8') if l.strip()) if 'error' not in r}
    rows = []
    for r in b2:
        p = r['probes']; ref = b1[r['id']]['probes']
        level = p['wear_level']['p']
        rows.append({'id': r['id'], 'condition': r['condition'], 'subject': r.get('subject'), 'ms': r['totalMs'],
                     'break_p': p['break_p']['p']['yes'], 'slide_p': p['slide_p']['p']['yes'],
                     'break': ref['break']['p']['yes'], 'slide': ref['slide']['p']['yes'],
                     'usable': p['usable']['p']['yes'], 'single': p['single_item']['p']['yes'],
                     'wear': sum(i * level[k] for i, k in enumerate('abcd')), 'wear_yesno': ref['wear']['p']['yes'],
                     **{z: p['zone_' + z]['p']['yes'] for z in ('shoulder', 'elbow', 'back', 'chest', 'edge')},
                     'category': b1[r['id']]['probes']['category']['answer']})
    df = pd.DataFrame(rows)
    df['damage'] = df[['break', 'slide']].max(axis=1); df['damage_p'] = df[['break_p', 'slide_p']].max(axis=1)
    sc = df[df.condition.isin(['visible_defect', 'no_visible_defect'])]
    y = (sc.condition == 'visible_defect').astype(int).values
    print(f'rows {len(df)}; scored {len(sc)} ({y.sum()} damaged, {(1-y).sum()} clean); median ms for 10 questions {df.ms.median():.0f}')
    print('\n== wording robustness (gear photographs) ==')
    for a, b in (('break', 'break_p'), ('slide', 'slide_p'), ('damage', 'damage_p')):
        print(f'  {a:7s} measured wording AUC {auc(y, sc[a].values)} | paraphrase AUC {auc(y, sc[b].values)} | correlation {np.corrcoef(sc[a], sc[b])[0,1]:.3f}')
    pos, neg = sc[sc.condition == 'visible_defect'], sc[sc.condition == 'no_visible_defect']
    for name, col in (('measured wording', 'damage'), ('paraphrase', 'damage_p')):
        print(f'  {name}: damaged cleared {(pos[col] < LOW).sum()}/{len(pos)}, blocked {(pos[col] >= HIGH).sum()}/{len(pos)}; clean cleared {(neg[col] < LOW).sum()}/{len(neg)}, blocked {(neg[col] >= HIGH).sum()}/{len(neg)}')
    band = lambda v: np.where(v < LOW, 0, np.where(v < HIGH, 1, 2))
    print(f'  band agreement between the two wordings: {(band(sc.damage.values) == band(sc.damage_p.values)).mean():.0%} of {len(sc)}')
    print('\n== usable ==')
    print(f'  share >= 0.5: {(df.usable >= 0.5).mean():.0%}; below 0.5: {df[df.usable < 0.5].id.tolist()}')
    print('\n== single_item by recorded subject (share >= 0.5) ==')
    print(df.groupby('subject').single.agg(n='count', share_single=lambda v: round(float((v >= 0.5).mean()), 2), median='median').round(2).to_string())
    print('\n== wear level (0 new .. 3 heavy) by reference label ==')
    print(df.groupby('condition').wear.agg(['count', 'median', 'mean']).round(2).to_string())
    print(f'  correlation with the yes/no wear question: {np.corrcoef(df.wear, df.wear_yesno)[0,1]:.3f}')
    grade = pd.cut(df.wear, [-1, 0.5, 1.5, 2.5, 9], labels=list('ABCD'))
    print('  grade by reference label:'); print(pd.crosstab(df.condition, grade).to_string())
    print('\n== zone questions on jackets (category answer a) with damage >= clear ==')
    cols = ['id', 'condition', 'damage', 'shoulder', 'elbow', 'back', 'chest', 'edge']
    flagged = df[(df.category == 'a') & (df.damage >= LOW)]
    print(flagged[cols].round(2).to_string(index=False))
    clean_j = df[(df.category == 'a') & (df.damage < LOW)]
    print(f'\n  jackets below the clear threshold: n={len(clean_j)}; any protective zone >= 0.5 in {(clean_j[["shoulder","elbow","back","chest"]].max(axis=1) >= 0.5).sum()}')


if __name__ == '__main__':
    main()
