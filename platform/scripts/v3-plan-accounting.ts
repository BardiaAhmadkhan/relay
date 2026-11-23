// How many model calls does the v3 question plan save on real score distributions?
//
//   npx tsx scripts/v3-plan-accounting.ts
//
// Replays packages/vision/v2/plan.ts over the recorded answers of the 223 labelled photographs (battery
// b1 at 1600 px: `slide` is road_contact, `break` is broken, plus repair and the category letter, the
// only answers the plan branches on) and counts the questions asked, against what the v2 service asks:
// the whole garment battery (9 questions) plus the zone questions of the photograph's category when
// damage or a repair reaches its clear threshold. Every photograph is counted twice: as a front view
// and as a close-up, because the corpus does not say which a real intake would make of it.
import fs from 'node:fs';
import path from 'node:path';
import type { PhotoView } from '../packages/core/schema';
import { ThresholdsSchema, type Answer2 } from '../packages/core/v2/schema';
import { GARMENT_QUESTIONS, ZONE_QUESTIONS } from '../packages/vision/v2/battery';
import { nextKeys } from '../packages/vision/v2/plan';

const root = path.resolve(import.meta.dirname, '..');
const thresholds = ThresholdsSchema.parse(
  JSON.parse(fs.readFileSync(path.join(root, 'packages/core/v2/thresholds.json'), 'utf8')),
);
const bands = thresholds.perScorer.local_logprob!;
const letters: Record<string, string> = {
  a: 'jacket',
  b: 'trousers',
  c: 'suit',
  d: 'gloves',
  e: 'boots',
  f: 'helmet',
  g: 'armour',
  h: 'other',
};
const rows = fs
  .readFileSync(
    path.join(root, 'benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1600.jsonl'),
    'utf8',
  )
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => !r.error && ['visible_defect', 'no_visible_defect'].includes(r.condition));
const yn = (p: number): Answer2 => ({ type: 'yesno', p });
type Tally = { photos: number; v2: number; plan: number };
const tally: Record<string, Tally> = {};
for (const r of rows) {
  const category = letters[r.probes.category.answer] ?? 'other';
  const known: Record<string, Answer2> = {
    road_contact: yn(r.probes.slide.p.yes),
    broken: yn(r.probes.break.p.yes),
    repair: yn(r.probes.repair.p.yes),
    // Answers the plan never branches on: any value gives the same count.
    usable: yn(0.9),
    gear: yn(0.9),
    single_item: yn(0.9),
    category: { type: 'choice', choice: category, probabilities: { [category]: 1 } },
    wear: { type: 'level', score: 1, probabilities: [0, 1, 0, 0] },
  };
  for (const z of ZONE_QUESTIONS[category] ?? []) known[z.key] = yn(0.1);
  const damage = Math.max(r.probes.break.p.yes, r.probes.slide.p.yes);
  const zonesV2 =
    damage >= bands.damage.clear || r.probes.repair.p.yes >= bands.repair.clear
      ? (ZONE_QUESTIONS[category] ?? []).length
      : 0;
  for (const view of ['front', 'detail'] as PhotoView[]) {
    const answers: Record<string, Answer2> = {};
    let asked = 0;
    for (let i = 0; i < 8; i++) {
      const keys = nextKeys(view, answers, bands);
      if (!keys.length) break;
      for (const k of keys) answers[k] = known[k]!;
      asked += keys.length;
    }
    const key = view + ' / ' + (r.condition === 'visible_defect' ? 'damaged' : 'clean');
    const t = (tally[key] ??= { photos: 0, v2: 0, plan: 0 });
    t.photos++;
    t.v2 += GARMENT_QUESTIONS.length + zonesV2;
    t.plan += asked;
  }
}
console.log(
  'questions per photograph (model calls for the local scorer), 223 labelled photographs',
);
console.log('view / label           photographs   v2 service   v3 plan   saved');
for (const [k, t] of Object.entries(tally).sort())
  console.log(
    k.padEnd(22) +
      String(t.photos).padStart(12) +
      (t.v2 / t.photos).toFixed(2).padStart(13) +
      (t.plan / t.photos).toFixed(2).padStart(10) +
      ((100 * (1 - t.plan / t.v2)).toFixed(1) + '%').padStart(9),
  );
console.log('label photographs: v2 asks 3 questions, the plan 2 (33.3% saved).');
