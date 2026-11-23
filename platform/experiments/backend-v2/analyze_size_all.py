"""E16. Can EVERY question run at 512 px, not only the damage questions?

Usage: py -3 experiments/backend-v2/analyze_size_all.py <b1 at 1600 px> <b1 at 512 px>

Compares the full battery b1 (break, slide, repair, wear, gear, category, material) on all 261
photographs at the two sizes:
  - ranking quality where a reference exists: damage questions and repair against the damage label,
    `gear` against the recorded domain (garments and hardware are gear; material close-ups are not);
  - the category letter: agreement between the sizes, and agreement with the recorded subject;
  - how far each score moves (Spearman rank correlation, mean absolute change, decisions at 0.5).
"""
import json, sys
import numpy as np, pandas as pd
from sklearn.metrics import roc_auc_score
from scipy.stats import spearmanr

SUBJECT_TO_LETTER = {'boots': 'e', 'gloves': 'd', 'helmet': 'f', 'fabric_sample': 'h', 'leather_sample': 'h', 'material_sample': 'h'}


def load(path):
    rows = [json.loads(l) for l in open(path, encoding='utf-8') if l.strip()]
    return {r['id']: r for r in rows if 'error' not in r}


def main():
    ref, small = load(sys.argv[1]), load(sys.argv[2])
    ids = sorted(set(ref) & set(small))
    print(f'photographs in both runs: {len(ids)}')
    yesno = ['break', 'slide', 'repair', 'wear', 'gear']
    df = pd.DataFrame([{'id': i, 'condition': ref[i]['condition'], 'domain': ref[i]['domain'], 'subject': ref[i].get('subject'),
                        **{f'{q}_1600': ref[i]['probes'][q]['p']['yes'] for q in yesno},
                        **{f'{q}_512': small[i]['probes'][q]['p']['yes'] for q in yesno},
                        'cat_1600': ref[i]['probes']['category']['answer'], 'cat_512': small[i]['probes']['category']['answer'],
                        'mat_1600': ref[i]['probes']['material']['answer'], 'mat_512': small[i]['probes']['material']['answer'],
                        'ms_1600': sum(p['ms'] for p in ref[i]['probes'].values()), 'ms_512': sum(p['ms'] for p in small[i]['probes'].values()),
                        'tok_1600': ref[i]['probes']['gear']['promptTokens'], 'tok_512': small[i]['probes']['gear']['promptTokens']}
                       for i in ids])
    scored = df[df.condition.isin(['visible_defect', 'no_visible_defect'])]
    y = (scored.condition == 'visible_defect').astype(int)
    gear_y = df.domain.isin(['garments_and_gear', 'hardware']).astype(int)
    print('\n== per question: ranking quality, rank agreement and movement between sizes ==')
    print('question  reference                 AUC 1600  AUC 512  | Spearman  mean |change|  same side of 0.5')
    for q in yesno:
        if q == 'gear':
            ref_name, a1, a2 = 'gear vs recorded domain', roc_auc_score(gear_y, df[f'{q}_1600']), roc_auc_score(gear_y, df[f'{q}_512'])
        else:
            ref_name, a1, a2 = 'damage label', roc_auc_score(y, scored[f'{q}_1600']), roc_auc_score(y, scored[f'{q}_512'])
        rho = spearmanr(df[f'{q}_1600'], df[f'{q}_512']).correlation
        moved = (df[f'{q}_1600'] - df[f'{q}_512']).abs().mean()
        same = ((df[f'{q}_1600'] >= 0.5) == (df[f'{q}_512'] >= 0.5)).mean()
        print(f'{q:8s}  {ref_name:24s}  {a1:8.3f}  {a2:7.3f}  |  {rho:7.3f}  {moved:12.3f}  {same:12.1%}')
    print('\n== category letter ==')
    agree = (df.cat_1600 == df.cat_512).mean()
    print(f'  same letter at both sizes: {agree:.1%} of {len(df)}')
    known = df[df.subject.isin(SUBJECT_TO_LETTER)]
    for size in ('1600', '512'):
        hit = (known[f'cat_{size}'] == known.subject.map(SUBJECT_TO_LETTER)).mean()
        print(f'  matches the recorded subject (boots, gloves, helmet, material close-ups; n={len(known)}): {size} px {hit:.1%}')
    garments = df[df.subject == 'garment']
    print(f'  garment photographs answered as a garment letter (a, b, c): 1600 px {garments.cat_1600.isin(list("abc")).mean():.1%}, 512 px {garments.cat_512.isin(list("abc")).mean():.1%} (n={len(garments)})')
    print(f'  material letter, same at both sizes: {(df.mat_1600 == df.mat_512).mean():.1%} (the rules never read it)')
    print('\n== cost ==')
    print(f'  median ms for all 7 questions: 1600 px {df.ms_1600.median():.0f}, 512 px {df.ms_512.median():.0f} ({df.ms_512.median() / df.ms_1600.median():.0%})')
    print(f'  median prompt tokens per question: 1600 px {df.tok_1600.median():.0f}, 512 px {df.tok_512.median():.0f}')


if __name__ == '__main__':
    main()
