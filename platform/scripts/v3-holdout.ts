// v3 held-out check: thresholds fitted on the whole 223-photograph corpus, applied unchanged to the
// separate Openverse gear set (datasets/gear-v2-openverse: real gear from other photographers, assistant
// labels made before scoring). No threshold sees these photographs.
//
//   npx tsx scripts/v3-holdout.ts [--keep 0.98] [--wrongBlock 0.01]
import fs from 'node:fs';
import path from 'node:path';
import { auc, fitBand, type LabelledScore } from '../packages/core/v2/calibration';
import { bandCounts } from '../packages/core/v2/crossval';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[++i] ?? 'true');
}
const keep = Number(args.get('keep') ?? 0.98),
  wrongBlock = Number(args.get('wrongBlock') ?? 0.01);
const root = path.resolve(import.meta.dirname, '..');
const B = (f: string) => path.join(root, 'benchmarks', 'backend-v2', f);
type Row = {
  id: string;
  condition: string;
  probes: Record<string, { p: Record<string, number>; ms: number }>;
};
const load = (f: string) =>
  new Map<string, Row>(
    fs
      .readFileSync(B(f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((r: Row & { error?: string }) => !r.error)
      .map((r: Row) => [r.id, r]),
  );
const scorers: Record<string, { corpus: string; holdout: string }> = {
  '4b@1600': {
    corpus: 'battery--b1--qwen3.5-4b--e1600.jsonl',
    holdout: 'battery--b1--qwen3.5-4b--e1600--corpus-openverse-break+slide.jsonl',
  },
  '4b@512': {
    corpus: 'battery--b1--qwen3.5-4b--e512--break+slide.jsonl',
    holdout: 'battery--b1--qwen3.5-4b--e512--corpus-openverse-break+slide.jsonl',
  },
  '2b@1600': {
    corpus: 'battery--b1--qwen3.5-2b--e1600--break+slide.jsonl',
    holdout: 'battery--b1--qwen3.5-2b--e1600--corpus-openverse-break+slide.jsonl',
  },
  '0.8b@1600': {
    corpus: 'battery--b1--qwen3.5-0.8b--e1600--break+slide.jsonl',
    holdout: 'battery--b1--qwen3.5-0.8b--e1600--corpus-openverse-break+slide.jsonl',
  },
};
const data = Object.fromEntries(
  Object.entries(scorers).map(([k, v]) => [
    k,
    { corpus: load(v.corpus), holdout: load(v.holdout) },
  ]),
);
const dmg = (r: Row | undefined) =>
  r ? Math.max(r.probes.break!.p.yes!, r.probes.slide!.p.yes!) : null;
const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const ens = (a: number | null, b: number | null) =>
  a === null || b === null ? null : 1 / (1 + Math.exp(-(logit(a) + logit(b)) / 2));
type Candidate = { name: string; score: (set: 'corpus' | 'holdout', id: string) => number | null };
const candidates: Candidate[] = [
  ...Object.keys(scorers).map((k) => ({
    name: k,
    score: (set: 'corpus' | 'holdout', id: string) => dmg(data[k]![set].get(id)),
  })),
  {
    name: '2b@1600 + 0.8b@1600',
    score: (set, id) =>
      ens(dmg(data['2b@1600']![set].get(id)), dmg(data['0.8b@1600']![set].get(id))),
  },
  {
    name: '2b@1600 + 4b@1600',
    score: (set, id) => ens(dmg(data['2b@1600']![set].get(id)), dmg(data['4b@1600']![set].get(id))),
  },
];
const corpusIds = [...data['4b@512']!.corpus.values()]
  .filter((r) => ['visible_defect', 'no_visible_defect'].includes(r.condition))
  .map((r) => r.id);
const holdoutRows = [...data['4b@1600']!.holdout.values()].filter((r) =>
  ['visible_defect', 'no_visible_defect'].includes(r.condition),
);
const ex = (c: Candidate, set: 'corpus' | 'holdout', ids: string[], cond: Map<string, string>) =>
  ids
    .map((id) => ({ id, damaged: cond.get(id) === 'visible_defect', score: c.score(set, id) }))
    .filter((e): e is LabelledScore => e.score !== null);
const corpusCond = new Map([...data['4b@512']!.corpus.values()].map((r) => [r.id, r.condition]));
const holdCond = new Map(holdoutRows.map((r) => [r.id, r.condition]));
const out: string[] = [
  `fit on ${corpusIds.length} corpus photographs; held out: ${holdoutRows.length} Openverse gear photographs (${holdoutRows.filter((r) => r.condition === 'visible_defect').length} damaged); keep ${keep}, wrongBlock ${wrongBlock}`,
  'candidate               clear  block  | held-out AUC | damaged: cleared review blocked | clean: cleared review blocked',
];
const detail: string[] = [];
for (const c of candidates) {
  const train = ex(c, 'corpus', corpusIds, corpusCond);
  const band = fitBand(train, { keep, wrongBlock });
  const test = ex(c, 'holdout', [...holdCond.keys()], holdCond);
  const k = bandCounts(test, band);
  out.push(
    c.name.padEnd(22) +
      band.clear.toFixed(3).padStart(7) +
      band.block.toFixed(3).padStart(7) +
      '  |   ' +
      auc(test).toFixed(3) +
      '      |        ' +
      `${k.damagedCleared}/${k.damaged}`.padStart(5) +
      String(k.damagedReview).padStart(7) +
      String(k.damagedBlocked).padStart(8) +
      ' |       ' +
      `${k.cleanCleared}/${k.clean}`.padStart(6) +
      String(k.cleanReview).padStart(7) +
      String(k.cleanBlocked).padStart(8),
  );
  detail.push(
    c.name +
      ': ' +
      test.map((e) => e.id + (e.damaged ? '*' : '') + '=' + e.score.toFixed(3)).join(' '),
  );
}
// The cascade: 4b@512 decides outside its own band, otherwise 4b@1600.
{
  const cheap = candidates.find((c) => c.name === '4b@512')!,
    dear = candidates.find((c) => c.name === '4b@1600')!;
  const bCheap = fitBand(ex(cheap, 'corpus', corpusIds, corpusCond), { keep, wrongBlock }),
    bDear = fitBand(ex(dear, 'corpus', corpusIds, corpusCond), { keep, wrongBlock });
  const counts = { dC: 0, dR: 0, dB: 0, cC: 0, cR: 0, cB: 0, escalated: 0, n: 0 };
  for (const [id, cond] of holdCond) {
    const s1 = cheap.score('holdout', id)!,
      s2 = dear.score('holdout', id)!;
    let band = s1 < bCheap.clear ? 0 : s1 < bCheap.block ? 1 : 2;
    if (band === 1) {
      counts.escalated++;
      band = s2 < bDear.clear ? 0 : s2 < bDear.block ? 1 : 2;
    }
    counts.n++;
    const d = cond === 'visible_defect';
    if (d) counts[band === 0 ? 'dC' : band === 1 ? 'dR' : 'dB']++;
    else counts[band === 0 ? 'cC' : band === 1 ? 'cR' : 'cB']++;
  }
  out.push(
    '4b@512 -> 4b@1600      (cascade; escalated ' +
      counts.escalated +
      ' of ' +
      counts.n +
      ')           |        ' +
      `${counts.dC}/${counts.dC + counts.dR + counts.dB}`.padStart(5) +
      String(counts.dR).padStart(7) +
      String(counts.dB).padStart(8) +
      ' |       ' +
      `${counts.cC}/${counts.cC + counts.cR + counts.cB}`.padStart(6) +
      String(counts.cR).padStart(7) +
      String(counts.cB).padStart(8),
  );
}
console.log(out.join('\n') + '\n\nscores on the held-out set (* = damaged):\n' + detail.join('\n'));
