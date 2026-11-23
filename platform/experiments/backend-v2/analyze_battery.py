"""Score a probe battery: per-question ranking quality, combinations, three-band routing, category.

Usage: py -3 experiments/backend-v2/analyze_battery.py <battery.jsonl> [--low 0.1 --high 0.6] [--json out.json]
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
pd.set_option('display.width', 240); pd.set_option('display.max_columns', 40); pd.set_option('display.max_rows', 200)


def arg(name, default):
    return float(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def auc(y, s):
    return round(float(roc_auc_score(y, s)), 4) if len(set(y)) == 2 else float('nan')


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))


def main():
    path = sys.argv[1]
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    ok = [r for r in rows if 'error' not in r]
    df = pd.DataFrame([{**{k: r[k] for k in ('id', 'corpus', 'domain', 'group', 'condition', 'subject', 'totalMs')},
                        **{n: (p['p'].get('yes') if 'yes' in p['p'] else None) for n, p in r['probes'].items()},
                        **{n + '_answer': p['answer'] for n, p in r['probes'].items()},
                        **{n + '_p': p['p'] for n, p in r['probes'].items() if 'yes' not in p['p']},
                        'tokens': sum(p['promptTokens'] for p in r['probes'].values())} for r in ok])
    print('rows', len(df), 'errors', len(rows) - len(ok))
    df['gearDomain'] = df.domain.isin(['garments_and_gear', 'hardware'])
    yn = [c for c in ('break', 'slide', 'repair', 'wear', 'gear') if c in df]
    if 'break' in df and 'slide' in df:
        df['damage_max'] = df[['break', 'slide']].max(axis=1)
        df['damage_or'] = 1 - (1 - df['break']) * (1 - df['slide'])
        if 'repair' in df:
            df['exclusion_max'] = df[['break', 'slide', 'repair']].max(axis=1)
    sc = df[df.condition.isin(['visible_defect', 'no_visible_defect'])]
    out = []
    for name, part in (('ALL', sc), ('gear+hardware', sc[sc.gearDomain]), ('fabric', sc[sc.domain == 'fabric_closeup']), ('leather', sc[sc.domain == 'leather_closeup'])):
        y = (part.condition == 'visible_defect').astype(int).values
        out.append({'slice': name, 'pos': int(y.sum()), 'neg': int((1 - y).sum()),
                    **{c: auc(y, part[c].values) for c in yn + [c for c in ('damage_max', 'damage_or', 'exclusion_max') if c in part]}})
    print('\n== ranking quality (AUC) of each question against the visible-defect label ==')
    print(pd.DataFrame(out).to_string(index=False))

    low, high = arg('--low', 0.1), arg('--high', 0.6)
    key = 'damage_max' if 'damage_max' in df else yn[0]
    print(f'\n== three-band routing on "{key}": clear < {low} <= review < {high} <= block ==')
    for name, part in (('ALL', sc), ('gear+hardware', sc[sc.gearDomain])):
        pos = part[part.condition == 'visible_defect'][key].values; neg = part[part.condition == 'no_visible_defect'][key].values
        for label, v in (('damaged', pos), ('clean', neg)):
            c = int((v < low).sum()); r = int(((v >= low) & (v < high)).sum()); b = int((v >= high).sum())
            print(f'  [{name}] {label:8s} n={len(v):3d}  clear {c:3d} ({c/len(v):.0%})  review {r:3d} ({r/len(v):.0%})  block {b:3d} ({b/len(v):.0%})')
        miss = int((pos < low).sum()); lo, hi = wilson(miss, len(pos))
        fb = int((neg >= high).sum()); flo, fhi = wilson(fb, len(neg))
        print(f'  [{name}] damaged wrongly cleared: {miss}/{len(pos)} (95% CI {lo:.0%}-{hi:.0%});  clean wrongly blocked: {fb}/{len(neg)} (95% CI {flo:.0%}-{fhi:.0%})')
    print('\n== threshold sweep on', key, '==')
    for name, part in (('ALL', sc), ('gear+hardware', sc[sc.gearDomain])):
        pos = part[part.condition == 'visible_defect'][key].values; neg = part[part.condition == 'no_visible_defect'][key].values
        for t in (0.03, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 0.9):
            print(f'  [{name}] t={t:<5} recall {(pos>=t).sum()}/{len(pos)}  false alerts {(neg>=t).sum()}/{len(neg)}')
    g = sc[sc.gearDomain]
    print('\n== in-domain damaged items, every score ==')
    print(g[g.condition == 'visible_defect'][['id'] + yn + ['category_answer', 'material_answer']].round(2).to_string(index=False))
    print('\n== in-domain clean items with damage_max >= low ==')
    print(g[(g.condition == 'no_visible_defect') & (g[key] >= low)][['id'] + yn].round(2).to_string(index=False))
    amb = df[df.condition == 'ambiguous']
    print(f'\n== ambiguous (unscored, n={len(amb)}): median wear {amb.wear.median():.2f}, median {key} {amb[key].median():.2f}; >=high: {(amb[key]>=high).sum()}, review band: {((amb[key]>=low)&(amb[key]<high)).sum()}, clear: {(amb[key]<low).sum()}')
    # Category head against the coarse 'subject' field recorded with the labels.
    expect = {'boots': {'e'}, 'gloves': {'d'}, 'helmet': {'f'}, 'garment': {'a', 'b', 'c'}, 'fabric_sample': {'h'}, 'leather_sample': {'h'},
              'material_sample': {'h'}, 'hardware': {'h'}, 'scene': {'h'}, 'thermal_image': {'h'}, 'collage': {'h', 'a'}, 'multi_gear': {'h'}}
    cat = df[df.subject.isin(expect.keys())]
    if len(cat):
        cat = cat.assign(correct=[a in expect[s] for a, s in zip(cat.category_answer, cat.subject)])
        print('\n== category head vs recorded subject ==')
        print(cat.groupby('subject').correct.agg(['sum', 'count']).to_string())
        print('overall', int(cat.correct.sum()), '/', len(cat))
    print(f'\n== cost: median total {df.totalMs.median():.0f} ms for {len(yn)+2} questions; summed prompt tokens median {df.tokens.median():.0f} ==')
    if '--json' in sys.argv:
        json.dump({'auc': out, 'low': low, 'high': high}, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1)
    df.to_json(os.path.splitext(path)[0] + '--scores.json', orient='records')


if __name__ == '__main__':
    main()
