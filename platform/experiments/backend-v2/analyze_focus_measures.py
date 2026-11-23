"""E10b. Choose the capture-gate measure: catch harmful blur, never nag about sharp or dim photographs.

Usage: py -3 experiments/backend-v2/analyze_focus_measures.py benchmarks/backend-v2/focus-measures.jsonl \
          benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1024--break+slide.jsonl \
          benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1024--break+slide-blur3.jsonl \
          benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1024--break+slide-blur6.jsonl

For each measure and threshold: the share flagged at every degradation level, and how many of the
damaged photographs that blur pushed into the clear band (measured by the model in queue A) the gate
would have sent back. A good gate flags ~0% of sharp, dimmed and recompressed photographs.
"""
import json, sys
import numpy as np

LOW = 0.145  # the fitted clear threshold (packages/core/v2/thresholds.json)


def damage(path):
    out = {}
    for line in open(path, encoding='utf-8'):
        if line.strip():
            r = json.loads(line)
            if 'error' not in r:
                out[r['id']] = max(r['probes']['break']['p']['yes'], r['probes']['slide']['p']['yes'])
    return out


def main():
    rows = [json.loads(l) for l in open(sys.argv[1], encoding='utf-8') if l.strip()]
    base, b3, b6 = damage(sys.argv[2]), damage(sys.argv[3]), damage(sys.argv[4])
    dmg = {r['id'] for r in rows if r['condition'] == 'visible_defect'}
    newly = {'blur3': [i for i in dmg if b3.get(i, 1) < LOW <= base.get(i, 0)],
             'blur6': [i for i in dmg if b6.get(i, 1) < LOW <= base.get(i, 0)]}
    levels = ['sharp', 'blur1.5', 'blur3', 'blur6', 'dim0.55', 'q55']
    by_id = {r['id']: r for r in rows}
    print(f'{len(rows)} photographs; damaged photographs blur moved into the clear band: blur3 {len(newly["blur3"])}, blur6 {len(newly["blur6"])}')
    print('measure      threshold  ' + ' '.join(f'{l:>8s}' for l in levels) + '   stops s3  stops s6')
    for measure in ('lapVar', 'normMean', 'normVar', 'scaleRatio'):
        sharp_vals = np.array([r['levels']['sharp'][measure] for r in rows])
        # Candidate thresholds: low percentiles of the unblurred photographs, so nagging stays bounded.
        for pct in (0.5, 1, 2, 3, 5):
            t = float(np.percentile(sharp_vals, pct))
            shares = [np.mean([r['levels'][l][measure] < t for r in rows]) for l in levels]
            stops = [sum(by_id[i]['levels'][lvl][measure] < t for i in newly[lvl]) for lvl in ('blur3', 'blur6')]
            print(f'{measure:11s} {t:10.4f}  ' + ' '.join(f'{s:8.0%}' for s in shares) + f'   {stops[0]:2d}/{len(newly["blur3"])}     {stops[1]:2d}/{len(newly["blur6"])}   (= {pct}th pct of sharp)')
    # Separation summary: AUC of sharp-vs-blur3 and of dim-vs-blur3 for each measure (1.0 = perfect).
    from sklearn.metrics import roc_auc_score
    print('\nseparation (AUC, higher = the measure tells the two apart)')
    for measure in ('lapVar', 'normMean', 'normVar', 'scaleRatio'):
        def auc(a, b):
            x = [r['levels'][a][measure] for r in rows] + [r['levels'][b][measure] for r in rows]
            y = [1] * len(rows) + [0] * len(rows)
            return roc_auc_score(y, x)
        print(f'  {measure:11s} sharp vs blur3 {auc("sharp", "blur3"):.3f}   dim vs blur3 {auc("dim0.55", "blur3"):.3f}   q55 vs blur3 {auc("q55", "blur3"):.3f}   sharp vs blur1.5 {auc("sharp", "blur1.5"):.3f}')


if __name__ == '__main__':
    main()
