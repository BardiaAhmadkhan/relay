"""Training-free exemplar memory: leave-one-GROUP-out kNN on frozen image embeddings, plus zero-shot text scores.

Usage: py -3 experiments/backend-v2/analyze_embed.py benchmarks/backend-v2/embed--siglip.json [probe.jsonl]

No weights are fitted. For each image, every image sharing its source group is removed from the
memory, then the score is the similarity-weighted share of 'visible_defect' among its k nearest
labelled neighbours. This mirrors what could be done on event day with the organisers' labelled set.
"""
import json, sys, os
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score

pd.set_option('display.width', 220)


def auc(y, s):
    return round(float(roc_auc_score(y, s)), 4) if len(set(y)) == 2 else float('nan')


def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    df = pd.DataFrame(data['rows'])
    E = np.array(df.embedding.tolist(), dtype=np.float32)
    L = np.array(df.logits.tolist(), dtype=np.float32)
    df['zeroshot'] = L[:, :3].max(1) - L[:, 3:].max(1)
    labelled = df.condition.isin(['visible_defect', 'no_visible_defect']).values
    y = (df.condition == 'visible_defect').values.astype(int)
    S = E @ E.T
    for k in (3, 5, 9):
        scores = np.full(len(df), np.nan)
        for i in range(len(df)):
            mask = labelled & (df.group.values != df.group.values[i])
            idx = np.where(mask)[0]
            order = idx[np.argsort(-S[i, idx])[:k]]
            w = np.clip(S[i, order], 0, None)
            scores[i] = float((w * y[order]).sum() / max(w.sum(), 1e-9))
        df[f'knn{k}'] = scores
    df['gear'] = df.domain.isin(['garments_and_gear', 'hardware'])
    sc = df[labelled]
    rows = []
    for name, part in (('ALL', sc), ('gear+hardware', sc[sc.gear]), ('fabric', sc[sc.domain == 'fabric_closeup']), ('leather', sc[sc.domain == 'leather_closeup'])):
        yy = (part.condition == 'visible_defect').astype(int).values
        rows.append({'slice': name, 'pos': int(yy.sum()), 'neg': int((1 - yy).sum()), 'zeroshot_auc': auc(yy, part.zeroshot.values),
                     **{f'knn{k}_auc': auc(yy, part[f'knn{k}'].values) for k in (3, 5, 9)}})
    print(pd.DataFrame(rows).to_string(index=False))
    print('encode ms median', df.ms.median())
    # Within-domain-excluded variant: memory restricted to OTHER domains, to expose the fabric shortcut.
    scores = np.full(len(df), np.nan)
    for i in range(len(df)):
        mask = labelled & (df.domain.values != df.domain.values[i])
        idx = np.where(mask)[0]
        order = idx[np.argsort(-S[i, idx])[:5]]
        w = np.clip(S[i, order], 0, None)
        scores[i] = float((w * y[order]).sum() / max(w.sum(), 1e-9))
    df['knn5_crossdomain'] = scores
    sc = df[labelled]
    for name, part in (('gear+hardware', sc[sc.gear]), ('fabric', sc[sc.domain == 'fabric_closeup'])):
        yy = (part.condition == 'visible_defect').astype(int).values
        print(f'cross-domain memory only [{name}]: knn5 auc', auc(yy, part.knn5_crossdomain.values))
    if len(sys.argv) > 2:
        probe = pd.DataFrame([json.loads(l) for l in open(sys.argv[2], encoding='utf-8')])
        probe['probe'] = probe['p'].apply(lambda p: p['yes'])
        m = sc.merge(probe[['id', 'probe']], on='id')
        for name, part in (('ALL', m), ('gear+hardware', m[m.gear])):
            yy = (part.condition == 'visible_defect').astype(int).values
            fused = 0.7 * part.probe.values + 0.3 * part.knn5.values
            print(f'[{name}] probe auc {auc(yy, part.probe.values)}  knn5 auc {auc(yy, part.knn5.values)}  fused(0.7/0.3) auc {auc(yy, fused)}  max-fusion auc {auc(yy, np.maximum(part.probe.values, part.knn5.values))}')
    df.drop(columns=['embedding', 'logits']).to_json(os.path.splitext(sys.argv[1])[0] + '--scores.json', orient='records')


if __name__ == '__main__':
    main()
