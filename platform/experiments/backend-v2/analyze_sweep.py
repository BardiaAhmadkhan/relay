"""Compare several battery runs (image size, model size, blur, recompression) on the exclusion questions.

Usage: py -3 experiments/backend-v2/analyze_sweep.py --ref <reference.jsonl> <run.jsonl> [<run.jsonl> ...]
The reference supplies the paired comparison: score movement and band changes per image.
Bands: clear < 0.1 <= review < 0.7 <= block, on damage = max(break, slide).
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

pd.set_option('display.width', 260); pd.set_option('display.max_columns', 40)
LOW, HIGH = 0.1, 0.7


def load(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    ok = [r for r in rows if 'error' not in r]
    df = pd.DataFrame([{'id': r['id'], 'domain': r['domain'], 'condition': r['condition'], 'totalMs': r['totalMs'],
                        'brk': r['probes']['break']['p']['yes'], 'slide': r['probes']['slide']['p']['yes'],
                        'tokens': r['probes']['break']['promptTokens'], 'ms': r['probes']['break']['ms'],
                        'lapVar': (r.get('focus') or {}).get('lapVar'), 'tenengrad': (r.get('focus') or {}).get('tenengrad'),
                        'bytes': r.get('bytes')} for r in ok])
    df['damage'] = df[['brk', 'slide']].max(axis=1)
    df['gear'] = df.domain.isin(['garments_and_gear', 'hardware'])
    return df[df.condition.isin(['visible_defect', 'no_visible_defect'])], len(rows) - len(ok)


def auc(part, col):
    y = (part.condition == 'visible_defect').astype(int).values
    return round(float(roc_auc_score(y, part[col].values)), 4) if len(set(y)) == 2 else float('nan')


def band(v):
    return np.where(v < LOW, 0, np.where(v < HIGH, 1, 2))


def main():
    args = sys.argv[1:]
    ref = None
    if '--ref' in args:
        i = args.index('--ref'); ref, _ = load(args[i + 1]); del args[i:i + 2]
    out = []
    for path in args:
        df, errors = load(path)
        g = df[df.gear]
        pos, neg = df[df.condition == 'visible_defect'], df[df.condition == 'no_visible_defect']
        gp, gn = g[g.condition == 'visible_defect'], g[g.condition == 'no_visible_defect']
        row = {'run': os.path.basename(path).replace('battery--b1--', '').replace('.jsonl', ''), 'n': len(df), 'err': errors,
               'auc_break': auc(df, 'brk'), 'auc_slide': auc(df, 'slide'), 'auc_damage': auc(df, 'damage'), 'gear_auc_damage': auc(g, 'damage'),
               'cleared_damaged': f'{(pos.damage < LOW).sum()}/{len(pos)}', 'blocked_damaged': f'{(pos.damage >= HIGH).sum()}/{len(pos)}',
               'cleared_clean': f'{(neg.damage < LOW).sum()}/{len(neg)}', 'blocked_clean': f'{(neg.damage >= HIGH).sum()}/{len(neg)}',
               'gear_cleared_damaged': f'{(gp.damage < LOW).sum()}/{len(gp)}', 'gear_cleared_clean': f'{(gn.damage < LOW).sum()}/{len(gn)}',
               'tok_med': int(df.tokens.median()), 'ms_med': int(df.ms.median()),
               'lapVar_med': None if df.lapVar.isna().all() else round(float(df.lapVar.median()), 1),
               'kb_med': None if df.bytes.isna().all() else int(df.bytes.median() / 1024)}
        if ref is not None:
            m = df.merge(ref[['id', 'damage']], on='id', suffixes=('', '_ref'))
            delta = (m.damage - m.damage_ref).abs()
            flips = band(m.damage.values) != band(m.damage_ref.values)
            worse = ((m.condition == 'visible_defect') & (band(m.damage.values) < band(m.damage_ref.values))).sum()
            row.update({'paired': len(m), 'mean_abs_delta': round(float(delta.mean()), 4), 'p95_abs_delta': round(float(delta.quantile(.95)), 3),
                        'band_changes': int(flips.sum()), 'damaged_moved_down': int(worse)})
        out.append(row)
    print(pd.DataFrame(out).T.to_string())
    if '--json' in sys.argv:
        pass


if __name__ == '__main__':
    main()
