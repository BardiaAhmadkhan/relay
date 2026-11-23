// v3 frontier: which damage scorer gives the best safety, expert workload and compute together?
//
//   npx tsx scripts/v3-frontier.ts [--repeats 50] [--keep 0.98] [--wrongBlock 0.01] [--out <json>]
//
// Every candidate is judged by the same repeated grouped 5-fold cross-validation of the production
// threshold fit (packages/core/v2/calibration.ts fitBand, packages/core/v2/crossval.ts folds), on the
// 223 labelled photographs, using scores already recorded under benchmarks/backend-v2/:
//   single scorers   one model at one image size (E8 size sweep, E11 model sweep)
//   ensembles        the mean log-odds of two recorded scorers (costs both)
//   cascades         a cheap scorer decides when it is outside its own review band; otherwise the
//                    photograph is escalated to the expensive scorer (costs the cheap one always,
//                    the expensive one only when escalated)
//   per-question     separate clear and block thresholds for `broken` and `road_contact` instead of
//                    one band on their maximum
// Damage score = max(broken, road_contact) unless the candidate says otherwise. Cost = measured median
// milliseconds per photograph for the two damage questions on this laptop (RTX 5060 Laptop GPU).
import fs from 'node:fs';
import path from 'node:path';
import { auc, fitBand, type LabelledScore } from '../packages/core/v2/calibration';
import {
  bandCounts,
  groupFolds,
  seededRandom,
  type BandCounts,
} from '../packages/core/v2/crossval';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(a.slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
  }
}
const repeats = Number(args.get('repeats') ?? 50),
  keep = Number(args.get('keep') ?? 0.98),
  wrongBlock = Number(args.get('wrongBlock') ?? 0.01);
const root = path.resolve(import.meta.dirname, '..');
const B = (f: string) => path.join(root, 'benchmarks', 'backend-v2', f);
type Row = { id: string; probes: Record<string, { p: Record<string, number>; ms: number }> };
function load(file: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  if (!fs.existsSync(B(file))) return rows;
  for (const line of fs.readFileSync(B(file), 'utf8').split('\n').filter(Boolean)) {
    const r = JSON.parse(line);
    if (!r.error && r.probes) rows.set(r.id, r);
  }
  return rows;
}
const labels = new Map<string, { damaged: string; group: string; domain: string }>(
  JSON.parse(fs.readFileSync(B('labels--corpus-261.json'), 'utf8')).map(
    (l: { photoId: string; damaged: string; group: string; domain: string }) => [l.photoId, l],
  ),
);
const sources: Record<string, string> = {
  '4b@1600': 'battery--b1--qwen3.5-4b--e1600.jsonl',
  '4b@1024': 'battery--b1--qwen3.5-4b--e1024--break+slide.jsonl',
  '4b@768': 'battery--b1--qwen3.5-4b--e768--break+slide.jsonl',
  '4b@512': 'battery--b1--qwen3.5-4b--e512--break+slide.jsonl',
  '4b@384': 'battery--b1--qwen3.5-4b--e384--break+slide.jsonl',
  '2b@1600': 'battery--b1--qwen3.5-2b--e1600--break+slide.jsonl',
  '0.8b@1600': 'battery--b1--qwen3.5-0.8b--e1600--break+slide.jsonl',
  'gemma4@1600': 'battery--b1--gemma4-e2b--e1600--break+slide.jsonl',
};
const data = Object.fromEntries(Object.entries(sources).map(([k, f]) => [k, load(f)]));
// The photographs every compared source has, so all candidates are judged on the same set.
const ids = [...labels.keys()].filter(
  (id) =>
    labels.get(id)!.damaged !== 'unsure' &&
    Object.entries(data).every(([k, rows]) => rows.size === 0 || rows.has(id)),
);
const clampP = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? NaN;
function damage(src: string, id: string) {
  const r = data[src]!.get(id);
  return r ? Math.max(r.probes.break!.p.yes!, r.probes.slide!.p.yes!) : null;
}
function costMs(src: string) {
  return median([...data[src]!.values()].map((r) => r.probes.break!.ms + r.probes.slide!.ms));
}
type Example = LabelledScore & { group: string; domain: string };
function examples(score: (id: string) => number | null): Example[] {
  const out: Example[] = [];
  for (const id of ids) {
    const s = score(id),
      l = labels.get(id)!;
    if (s === null) continue;
    out.push({ id, damaged: l.damaged === 'yes', score: s, group: l.group, domain: l.domain });
  }
  return out;
}
const add = (a: BandCounts, b: BandCounts) => {
  for (const k of Object.keys(a) as Array<keyof BandCounts>) a[k] += b[k];
};
const zero = (): BandCounts => ({
  damaged: 0,
  clean: 0,
  damagedCleared: 0,
  damagedReview: 0,
  damagedBlocked: 0,
  cleanCleared: 0,
  cleanReview: 0,
  cleanBlocked: 0,
});
type Result = {
  name: string;
  n: number;
  auc: number;
  aucGear: number;
  cost: number;
  all: BandCounts;
  gear: BandCounts;
  note?: string;
};
/** Grouped CV where `decide` fits on the training examples and returns a function placing each test
 * example in a band (0 clear, 1 review, 2 block), plus the compute it spent on that example. */
function evaluate(
  name: string,
  ex: Example[],
  fit: (train: Example[]) => (e: Example) => { band: 0 | 1 | 2; cost: number },
): Result {
  const all = zero(),
    gear = zero();
  let spent = 0,
    counted = 0;
  for (let r = 0; r < repeats; r++) {
    const folds = groupFolds(ex, 5, seededRandom(1 + r));
    for (let f = 0; f < 5; f++) {
      const test = folds[f]!,
        train = folds.filter((_, i) => i !== f).flat();
      if (!test.length || !train.some((e) => e.damaged) || !train.some((e) => !e.damaged)) continue;
      const place = fit(train);
      for (const e of test) {
        const { band, cost } = place(e);
        spent += cost;
        counted++;
        const c = zero();
        const where = band === 0 ? 'Cleared' : band === 1 ? 'Review' : 'Blocked';
        if (e.damaged) {
          c.damaged = 1;
          c[`damaged${where}`] = 1;
        } else {
          c.clean = 1;
          c[`clean${where}`] = 1;
        }
        add(all, c);
        if (e.domain === 'gear') add(gear, c);
      }
    }
  }
  return {
    name,
    n: ex.length,
    auc: auc(ex),
    aucGear: auc(ex.filter((e) => e.domain === 'gear')),
    cost: spent / counted,
    all,
    gear,
  };
}
const bandOf = (s: number, b: { clear: number; block: number }): 0 | 1 | 2 =>
  s < b.clear ? 0 : s < b.block ? 1 : 2;
function single(name: string, score: (id: string) => number | null, cost: number) {
  return evaluate(name, examples(score), (train) => {
    const b = fitBand(train, { keep, wrongBlock });
    return (e) => ({ band: bandOf(e.score, b), cost });
  });
}
const results: Result[] = [];
const have = (k: string) => data[k]!.size > 0;
// 1. Single scorers.
for (const k of Object.keys(sources).filter(have))
  results.push(single(k, (id) => damage(k, id), costMs(k)));
// 1b. The contrastive question (battery b3, one call): P(abrasion or broken) against P(no marks or
// ordinary wear), alone and in place of or beside the two yes/no damage questions, all at 512 px.
const b3 = load('battery--b3--qwen3.5-4b--e512.jsonl');
if (b3.size && have('4b@512')) {
  const mark = (id: string) => {
    const p = b3.get(id)?.probes.mark?.p;
    if (!p) return null;
    const damaged = p.c! + p.d!,
      intact = p.a! + p.b!;
    return damaged + intact > 0 ? damaged / (damaged + intact) : null;
  };
  const markMs = median([...b3.values()].map((r) => r.probes.mark!.ms));
  const q512 = (id: string, key: string) => data['4b@512']!.get(id)?.probes[key]?.p.yes ?? null;
  const ms512 = (key: string) =>
    median([...data['4b@512']!.values()].map((r) => r.probes[key]!.ms));
  results.push(single('mark@512 (one contrastive question)', mark, markMs));
  results.push(
    single(
      'max(broken, mark)@512',
      (id) => {
        const a = q512(id, 'break'),
          b = mark(id);
        return a === null || b === null ? null : Math.max(a, b);
      },
      ms512('break') + markMs,
    ),
  );
  // The contrastive question as the cheap first stage of a cascade.
  for (const dear of ['4b@1600', '4b@512'].filter(have)) {
    const ex = examples((id) => (mark(id) === null ? null : damage(dear, id)));
    const cDear = costMs(dear);
    results.push(
      evaluate('mark@512 -> ' + dear, ex, (train) => {
        const bMark = fitBand(
            train.map((e) => ({ ...e, score: mark(e.id)! })),
            { keep, wrongBlock },
          ),
          bDear = fitBand(train, { keep, wrongBlock });
        return (e) => {
          const first = bandOf(mark(e.id)!, bMark);
          return first !== 1
            ? { band: first, cost: markMs }
            : { band: bandOf(e.score, bDear), cost: markMs + cDear };
        };
      }),
    );
  }
  // The cascade 512 -> 1600 with the contrastive question as a veto on clearing: a photograph is cleared
  // only when the cascade clears it AND the contrastive question is below its own clear threshold.
  if (have('4b@1600')) {
    const ex = examples((id) => (mark(id) === null ? null : damage('4b@1600', id)));
    const c512 = costMs('4b@512'),
      c1600 = costMs('4b@1600');
    results.push(
      evaluate('4b@512 -> 4b@1600, mark veto', ex, (train) => {
        const b512 = fitBand(
            train.map((e) => ({ ...e, score: damage('4b@512', e.id)! })),
            { keep, wrongBlock },
          ),
          b1600 = fitBand(train, { keep, wrongBlock }),
          bMark = fitBand(
            train.map((e) => ({ ...e, score: mark(e.id)! })),
            { keep, wrongBlock },
          );
        return (e) => {
          let band = bandOf(damage('4b@512', e.id)!, b512),
            cost = c512 + markMs;
          if (band === 1) {
            band = bandOf(e.score, b1600);
            cost += c1600;
          }
          if (band === 0 && bandOf(mark(e.id)!, bMark) !== 0) band = 1;
          return { band, cost };
        };
      }),
    );
  }
  results.push(
    single(
      'max(broken, road, mark)@512',
      (id) => {
        const a = damage('4b@512', id),
          b = mark(id);
        return a === null || b === null ? null : Math.max(a, b);
      },
      costMs('4b@512') + markMs,
    ),
  );
}
// 2. Ensembles: mean log-odds of two scorers.
const pairs: Array<[string, string]> = [
  ['4b@512', '4b@768'],
  ['4b@768', '4b@1024'],
  ['4b@512', '4b@1024'],
  ['2b@1600', '0.8b@1600'],
  ['2b@1600', '4b@1600'],
  ['2b@1600', '4b@768'],
];
for (const [a, b] of pairs.filter(([a, b]) => have(a) && have(b)))
  results.push(
    single(
      a + ' + ' + b,
      (id) => {
        const x = damage(a, id),
          y = damage(b, id);
        return x === null || y === null ? null : sigmoid((logit(x) + logit(y)) / 2);
      },
      costMs(a) + costMs(b),
    ),
  );
// 3. Cascades: the cheap scorer decides outside its own review band, the expensive one otherwise.
const cascades: Array<[string, string]> = [
  ['4b@512', '4b@1024'],
  ['4b@384', '4b@1024'],
  ['4b@512', '4b@1600'],
  ['0.8b@1600', '4b@1600'],
  ['2b@1600', '4b@1600'],
];
for (const [cheap, dear] of cascades.filter(([a, b]) => have(a) && have(b))) {
  const ex = examples((id) => damage(dear, id));
  const cheapScore = new Map(ids.map((id) => [id, damage(cheap, id)]));
  const cCheap = costMs(cheap),
    cDear = costMs(dear);
  results.push(
    evaluate(cheap + ' -> ' + dear, ex, (train) => {
      const bCheap = fitBand(
          train.map((e) => ({ ...e, score: cheapScore.get(e.id)! })),
          { keep, wrongBlock },
        ),
        bDear = fitBand(train, { keep, wrongBlock });
      return (e) => {
        const first = bandOf(cheapScore.get(e.id)!, bCheap);
        return first !== 1
          ? { band: first, cost: cCheap }
          : { band: bandOf(e.score, bDear), cost: cCheap + cDear };
      };
    }),
  );
}
// 4. Per-question bands for broken and road_contact (4b at 1024), fitted by grid search on the
// training folds under the same targets as fitBand.
if (have('4b@1024')) {
  const q = (id: string, key: string) => data['4b@1024']!.get(id)?.probes[key]?.p.yes ?? null;
  const ex = examples((id) => damage('4b@1024', id));
  /** 60 candidate thresholds per question: midpoints of the training scores' own quantiles. */
  const quantileGrid = (values: number[]) => {
    const v = [...values].sort((a, b) => a - b);
    return [
      ...new Set(
        Array.from({ length: 60 }, (_, i) => v[Math.floor(((i + 0.5) / 60) * v.length)]!).concat([
          0, 1.000001,
        ]),
      ),
    ].sort((a, b) => a - b);
  };
  results.push(
    evaluate('4b@1024 per-question bands', ex, (train) => {
      const dmg = train.filter((e) => e.damaged),
        cln = train.filter((e) => !e.damaged);
      const gB = quantileGrid(train.map((e) => q(e.id, 'break')!)),
        gS = quantileGrid(train.map((e) => q(e.id, 'slide')!));
      const allowBelow = Math.floor((1 - keep) * dmg.length + 1e-9),
        allowAbove = Math.floor(wrongBlock * cln.length + 1e-9);
      // Clear region: broken < c1 AND road < c2. Most clean cleared with at most allowBelow damaged.
      let bestClear = { c1: 0, c2: 0, cleared: -1 };
      for (const c1 of gB)
        for (const c2 of gS) {
          const dIn = dmg.filter((e) => q(e.id, 'break')! < c1 && q(e.id, 'slide')! < c2).length;
          if (dIn > allowBelow) continue;
          const cIn = cln.filter((e) => q(e.id, 'break')! < c1 && q(e.id, 'slide')! < c2).length;
          if (cIn > bestClear.cleared) bestClear = { c1, c2, cleared: cIn };
        }
      // Block region: broken >= b1 OR road >= b2. Most damaged blocked with at most allowAbove clean.
      let bestBlock = { b1: 1.000001, b2: 1.000001, blocked: -1 };
      for (const b1 of gB)
        for (const b2 of gS) {
          const cIn = cln.filter((e) => q(e.id, 'break')! >= b1 || q(e.id, 'slide')! >= b2).length;
          if (cIn > allowAbove) continue;
          const dIn = dmg.filter((e) => q(e.id, 'break')! >= b1 || q(e.id, 'slide')! >= b2).length;
          if (dIn > bestBlock.blocked) bestBlock = { b1, b2, blocked: dIn };
        }
      const cost = costMs('4b@1024');
      return (e) => {
        const br = q(e.id, 'break')!,
          sl = q(e.id, 'slide')!;
        const blocked = br >= bestBlock.b1 || sl >= bestBlock.b2,
          cleared = br < bestClear.c1 && sl < bestClear.c2;
        return { band: blocked ? 2 : cleared ? 0 : 1, cost };
      };
    }),
  );
}
// Report.
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1).padStart(5) : '  n/a');
const lines = [
  `photographs: ${ids.length} (the set every source covers); grouped 5-fold x ${repeats}; keep ${keep}, wrongBlock ${wrongBlock}`,
  'candidate                               cost ms  AUC    gear   | damaged: clear  review block | clean: clear review block | gear clean: clear review | gear damaged cleared',
];
for (const r of results)
  lines.push(
    r.name.padEnd(39) +
      String(Math.round(r.cost)).padStart(8) +
      '  ' +
      r.auc.toFixed(3) +
      '  ' +
      r.aucGear.toFixed(3) +
      '  |          ' +
      pct(r.all.damagedCleared, r.all.damaged) +
      ' ' +
      pct(r.all.damagedReview, r.all.damaged) +
      ' ' +
      pct(r.all.damagedBlocked, r.all.damaged) +
      ' |        ' +
      pct(r.all.cleanCleared, r.all.clean) +
      ' ' +
      pct(r.all.cleanReview, r.all.clean) +
      ' ' +
      pct(r.all.cleanBlocked, r.all.clean) +
      ' |             ' +
      pct(r.gear.cleanCleared, r.gear.clean) +
      ' ' +
      pct(r.gear.cleanReview, r.gear.clean) +
      ' |  ' +
      pct(r.gear.damagedCleared, r.gear.damaged),
  );
console.log(lines.join('\n'));
if (args.get('out'))
  fs.writeFileSync(
    args.get('out')!,
    JSON.stringify({ keep, wrongBlock, repeats, ids: ids.length, results, text: lines }, null, 1) +
      '\n',
  );
