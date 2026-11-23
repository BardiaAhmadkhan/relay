/** Compare fresh scoring with the archived full-precision 44 without asking any model. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { referenceBaseline } from './astra_hardware_comparison.mjs';
import { decide2 } from '../../packages/core/v2/policy.ts';
const read = (p) => JSON.parse(fs.readFileSync(p)),
  lines = (p) => fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).map(JSON.parse),
  hash = (s) => createHash('sha256').update(s).digest('hex');
const base = 'collab/baseline/v31-as-restored',
  dir = 'collab/baseline/v35-activation/hosting';
const equalDecision = (a, b) => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};
const previous = lines(base + '/restored-model-44-full-precision.jsonl'),
  fresh = new Map(
    lines(dir + '/reference-original/local.jsonl')
      .filter((x) => x.cohort === 'field44')
      .map((x) => [x.id, x]),
  );
const witness = new Map(
  lines(base + '/policy/whole-decisions.jsonl')
    .filter((x) => x.suite === 'index-view-with-controlled-companions')
    .map((x) => [x.id, x.decision]),
);
const T = read('packages/core/v2/thresholds.json'),
  cfg = read('packages/core/v2/policy.config.json'),
  model = 'qwen3.5:4b@d8b0f5e9760c',
  stamp = '2026-11-20T00:00:00.000Z';
T.perScorer.local_logprob.models = [model, model + ' cascade'];
const quality = { width: 1600, height: 1000, brightness: 120, sharpness: 0.1, warnings: [] };
function fixed(view) {
  const id = 'control-' + view;
  return {
    photoId: id,
    view,
    sha256: hash(id),
    batteryVersion: 'gear-2',
    scorer: { id: 'local_logprob', model },
    scoredAt: stamp,
    usage: { inputTokens: 0, ms: 0 },
    answers:
      view === 'label'
        ? { label_legible: { type: 'yesno', p: 1 }, label_ce: { type: 'yesno', p: 0.2 } }
        : {
            ...Object.fromEntries(
              ['usable', 'gear', 'single_item', 'broken', 'road_contact', 'repair'].map((k, i) => [
                k,
                { type: 'yesno', p: i < 3 ? 1 : 0 },
              ]),
            ),
            category: { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } },
            wear: { type: 'level', score: 0, probabilities: [1, 0, 0, 0] },
          },
  };
}
const back = fixed('back'),
  label = fixed('label'),
  questions = ['crash', 'protective_damage', 'protective_repair'];
const withoutNumericReasonScores = (d) => ({
  ...d,
  reasons: d.reasons.map((r) => ({ ...r, score: r.score === null ? null : 'measured' })),
});
const rec = (s) => ({ id: s.photoId, view: s.view, sha256: s.sha256, quality }),
  stats = {},
  choices = [],
  missing = [],
  flips = [],
  nonidentical = [];
let n = 0;
for (const p of previous) {
  const r = fresh.get(p.item);
  assert(r && r.archivedInputMatch && r.normalized === p.record.sha256);
  let different = false;
  for (const k of new Set([...Object.keys(p.scores.answers), ...Object.keys(r.answers)])) {
    const a = p.scores.answers[k],
      b = r.answers[k];
    if (!a || !b || a.type !== b.type) {
      missing.push([p.item, k]);
      different = true;
      continue;
    }
    let max;
    if (a.type === 'yesno') max = Math.abs(a.p - b.p);
    else {
      const entries = Object.keys(a.probabilities);
      max = Math.max(
        ...entries.map((key) => Math.abs(a.probabilities[key] - (b.probabilities[key] ?? 0))),
      );
      if (a.type === 'choice' && a.choice !== b.choice) choices.push([p.item, k]);
      if (a.type === 'level') different ||= a.score !== b.score;
    }
    (stats[k] ??= []).push({ id: p.item, delta: max });
    different ||= max !== 0;
  }
  if (different) nonidentical.push(p.item);
  for (const h of ['negative', 'unknown', 'missing', ...questions])
    for (const closeUpsRequested of [0, 1]) {
      const disclosures =
        h === 'missing'
          ? []
          : questions.map((question, i) => ({
              id: 'd' + i,
              question,
              recordedAt: stamp,
              answer:
                h === 'negative'
                  ? 'no'
                  : h === 'unknown'
                    ? 'unknown'
                    : h === question
                      ? 'yes'
                      : 'no',
            }));
      const input = {
        photos: [p.record, rec(back), rec(label)],
        scores: [p.scores, back, label],
        disclosures,
        closeUpsRequested,
        thresholds: T,
        config: cfg,
      };
      const id = p.item + '/' + h + '/' + closeUpsRequested,
        prev = witness.get(id);
      assert.deepEqual(decide2(input), prev);
      const cur = decide2({ ...input, scores: [{ ...p.scores, answers: r.answers }, back, label] });
      if (JSON.stringify(cur) !== JSON.stringify(prev))
        flips.push({
          id,
          before: prev.outcome,
          after: cur.outcome,
          operativeChange: !equalDecision(
            withoutNumericReasonScores(prev),
            withoutNumericReasonScores(cur),
          ),
          reasonChanges: [prev.reasons.map((x) => x.code), cur.reasons.map((x) => x.code)],
        });
      n++;
    }
}
const perHead = Object.fromEntries(
  Object.entries(stats).map(([k, values]) => {
    values.sort((a, b) => a.delta - b.delta);
    return [
      k,
      {
        n: values.length,
        p95: values[Math.ceil(values.length * 0.95) - 1].delta,
        max: values.at(-1),
      },
    ];
  }),
);
const comparableBaseline = referenceBaseline(previous, [...fresh.values()]);
for (const [k, v] of Object.entries(perHead)) {
  assert.equal(v.p95, comparableBaseline.perHead[k].p95);
  assert.equal(v.max.delta, comparableBaseline.perHead[k].max);
}
const result = {
  comparableBaseline,
  photos: previous.length,
  identicalWorkingJPEGs: previous.length,
  nonidenticalPhotoHeads: nonidentical,
  changedHeadChoices: choices,
  changedHeadPresence: missing,
  perHead,
  wholeDecisionContexts: n,
  literalPayloadDifferences: flips.length,
  operationalDecisionFlips: flips.filter((r) => r.operativeChange).length,
  outcomeFlips: flips.filter((r) => r.before !== r.after).length,
  changedWholeDecisions: flips,
  scope:
    'Archived V3.1 full-precision heads versus fresh V3.5 local 4B on the same source and normalized pixels, evaluated in the original frozen 44 x 12 policy witness contexts. Distinct from the identical-input 7,148-decision software replay and future cloud qualification.',
};
fs.writeFileSync(dir + '/archived-44-local-drift.json', JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify({
    n,
    nonidentical: nonidentical.length,
    flips: flips.length,
    choices: choices.length,
  }),
);
