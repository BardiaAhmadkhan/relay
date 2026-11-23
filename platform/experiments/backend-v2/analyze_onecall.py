"""Compare the one-generation scorer (and its five-level verbal variant) with the separate-call battery.

Usage: py -3 experiments/backend-v2/analyze_onecall.py <battery.jsonl> <onecall.jsonl> [<verbal.jsonl>]
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

pd.set_option('display.width', 240)
LOW, HIGH = 0.1, 0.7


def auc(y, s):
    return round(float(roc_auc_score(y, s)), 4) if len(set(y)) == 2 else float('nan')


def battery(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    return pd.DataFrame([{'id': r['id'], 'domain': r['domain'], 'condition': r['condition'], 'subject': r.get('subject'),
                          'b_break': r['probes']['break']['p']['yes'], 'b_slide': r['probes']['slide']['p']['yes'],
                          'b_repair': r['probes']['repair']['p']['yes'], 'b_wear': r['probes']['wear']['p']['yes'],
                          'b_cat': r['probes']['category']['answer'], 'b_ms': r['totalMs']} for r in rows if 'error' not in r])


def onecall(path, prefix):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    ok = [r for r in rows if 'error' not in r]
    df = pd.DataFrame([{'id': r['id'], prefix + '_break': r['scores'].get('broken'), prefix + '_slide': r['scores'].get('road_contact'),
                        prefix + '_repair': r['scores'].get('repair'), prefix + '_wear': r['scores'].get('wear'),
                        prefix + '_item': r['answer'].get('item'), prefix + '_ms': r['ms'], prefix + '_out': r['outputTokens'],
                        prefix + '_in': r['promptTokens'], prefix + '_done': r.get('doneReason')} for r in ok])
    return df, len(rows) - len(ok)


def report(m, bcols, ocols, label):
    sc = m[m.condition.isin(['visible_defect', 'no_visible_defect'])].copy()
    sc['gear'] = sc.domain.isin(['garments_and_gear', 'hardware'])
    sc['b_damage'] = sc[bcols].max(axis=1); sc['o_damage'] = sc[ocols].max(axis=1)
    missing = sc[ocols].isna().any(axis=1).sum()
    sc = sc.dropna(subset=ocols)
    print(f'\n== {label}: scored rows {len(sc)}, rows with a missing score {missing}')
    for name, part in (('ALL', sc), ('gear+hardware', sc[sc.gear])):
        y = (part.condition == 'visible_defect').astype(int).values
        pos, neg = part[part.condition == 'visible_defect'], part[part.condition == 'no_visible_defect']
        print(f'  [{name}] AUC separate-call damage {auc(y, part.b_damage.values)} | {label} damage {auc(y, part.o_damage.values)}'
              f' | break {auc(y, part[ocols[0]].values)} slide {auc(y, part[ocols[1]].values)}')
        print(f'     {label} bands: damaged cleared {(pos.o_damage < LOW).sum()}/{len(pos)}, blocked {(pos.o_damage >= HIGH).sum()}/{len(pos)};'
              f' clean cleared {(neg.o_damage < LOW).sum()}/{len(neg)}, blocked {(neg.o_damage >= HIGH).sum()}/{len(neg)}')
    print(f'  correlation of damage scores {np.corrcoef(sc.b_damage, sc.o_damage)[0,1]:.3f}; mean abs difference {(sc.b_damage - sc.o_damage).abs().mean():.3f}')


def main():
    b = battery(sys.argv[1])
    o, errors = onecall(sys.argv[2], 'o')
    m = b.merge(o, on='id')
    print('one-call rows', len(o), 'errors', errors, '| median ms one-call', int(o.o_ms.median()), 'vs separate calls', int(b.b_ms.median()),
          '| output tokens median', int(o.o_out.median()), '| done reasons', o.o_done.value_counts().to_dict())
    report(m, ['b_break', 'b_slide'], ['o_break', 'o_slide'], 'one-call')
    expect = {'boots': {'boots'}, 'gloves': {'gloves'}, 'helmet': {'helmet'}, 'garment': {'jacket', 'trousers', 'suit'},
              'fabric_sample': {'other'}, 'leather_sample': {'other'}, 'material_sample': {'other'}, 'hardware': {'other'}}
    cat = m[m.subject.isin(expect.keys())]
    ok = sum(a in expect[s] for a, s in zip(cat.o_item, cat.subject))
    print(f'\n  one-call item field vs recorded subject: {ok}/{len(cat)}')
    if len(sys.argv) > 3:
        v, verrors = onecall(sys.argv[3], 'v')
        mv = b.merge(v, on='id')
        print('\nverbal rows', len(v), 'errors', verrors, '| median ms', int(v.v_ms.median()))
        mv = mv.rename(columns={'v_break': 'o_break', 'v_slide': 'o_slide'})
        report(mv, ['b_break', 'b_slide'], ['o_break', 'o_slide'], 'five-level verbal')
        print('  verbal answer distribution (broken):', mv.o_break.value_counts().sort_index().to_dict())


if __name__ == '__main__':
    main()
