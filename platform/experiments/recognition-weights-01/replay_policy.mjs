/** Replays logged E19 single-photo diagnostics and ordinary partial-observation contract fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { decide2 } = await import(pathToFileURL(path.resolve('packages/core/v2/policy.ts')).href);
const config = JSON.parse(fs.readFileSync('packages/core/v2/policy.config.json'));
const thresholds = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json'));
const time = '2026-11-18T12:00:00.000Z';
const disclosures = ['crash', 'protective_damage', 'protective_repair'].map((question, i) => ({
  question,
  id: 'd' + i,
  answer: 'no',
  recordedAt: time,
}));
const yn = (p) => ({ type: 'yesno', p });
const level = (score) => ({ type: 'level', score, probabilities: [0, 1, 0, 0] });
const category = (choice, p) => ({ type: 'choice', choice, probabilities: { [choice]: p } });
const photo = (id, view, warnings = []) => ({
  id,
  view,
  sha256: createHash('sha256').update(id).digest('hex'),
  quality: { width: 1600, height: 1000, brightness: 120, sharpness: 0.2, warnings },
});
const record = (p, answers) => ({
  photoId: p.id,
  view: p.view,
  sha256: p.sha256,
  batteryVersion: thresholds.batteryVersion,
  scorer: { id: 'local_logprob', model: 'recorded or fixture' },
  answers,
  scoredAt: time,
  usage: { ms: 0, inputTokens: 0 },
});
const fields = (d) => ({
  outcome: d.outcome,
  grade: d.grade,
  category: d.category,
  reasons: d.reasons.map((r) => r.code),
  request: d.requestPhoto?.view ?? null,
});
const data = fs
  .readFileSync('benchmarks/backend-v2/realworld--v3.jsonl', 'utf8')
  .trim()
  .split('\n')
  .map(JSON.parse);
const replay = data.map((r) => {
  const answers = {};
  for (const [k, v] of Object.entries(r.answers)) {
    if (k === 'category') {
      const [choice, prob] = v.split(':');
      answers[k] = category(choice, Number(prob));
    } else if (k === 'wear') answers[k] = level(Number(v));
    else if (typeof v === 'number') answers[k] = yn(v);
  }
  const p = photo(r.id, r.view, r.warnings);
  const result = decide2({
    photos: [p],
    scores: [record(p, answers)],
    disclosures,
    config: { ...config, requiredViews: [r.view] },
    thresholds,
    closeUpsRequested: 0,
  });
  return {
    id: r.id,
    ...fields(result),
    historicalMatch:
      result.outcome === r.outcome &&
      result.grade === r.grade &&
      result.category === r.resolvedCategory,
  };
});
const clean = {
  usable: yn(0.95),
  road_contact: yn(0.02),
  broken: yn(0.02),
  repair: yn(0.02),
  wear: level(1),
  category: category('jacket', 0.95),
  gear: yn(0.95),
  single_item: yn(0.95),
};
const photos = ['front', 'back', 'label', 'detail'].map((v, i) => photo('p' + i, v));
const make = () => ({
  photos,
  scores: photos.map((p) =>
    record(p, structuredClone(p.view === 'label' ? { label_legible: yn(0.95) } : clean)),
  ),
  disclosures,
  thresholds,
  config,
  closeUpsRequested: 0,
});
const required = [
  ['usable', 'broken', 'road_contact', 'repair', 'gear', 'single_item', 'category', 'wear'],
  ['usable', 'broken', 'road_contact', 'repair', 'gear', 'single_item', 'category', 'wear'],
  ['label_legible'],
  ['usable', 'broken', 'road_contact', 'repair', 'wear'],
];
const fixtures = [];
for (const [i, keys] of required.entries())
  for (const key of keys)
    for (const mode of ['missing', 'unusable_type']) {
      const x = make(),
        a = x.scores[i].answers;
      if (mode === 'missing') delete a[key];
      else a[key] = a[key].type === 'level' ? yn(0.1) : level(0);
      fixtures.push({ view: photos[i].view, key, mode, ...fields(decide2(x)) });
    }
const normal = fields(decide2(make()));
fs.writeFileSync(
  process.argv[2],
  JSON.stringify({ version: config.version, normal, fixtures, replay }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    normal: normal.outcome,
    fixtureOffers: fixtures.filter((x) => x.outcome === 'offer').length,
    totalFixtures: fixtures.length,
    historicalMatches: replay.filter((x) => x.historicalMatch).length,
    rows: replay.length,
  }),
);
