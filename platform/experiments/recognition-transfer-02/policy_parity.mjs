// Replay the original policy function and current function on identical inputs. Only the
// numeric scores are real; the history and coverage contexts below are deliberately controlled.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [previous, out] = process.argv.slice(2);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const get = (s) => import(pathToFileURL(path.resolve(s)).href);
const { decide2: now } = await get('packages/core/v2/policy.ts');
const { Questions } = await get('packages/core/schema.ts');
const require = createRequire(path.resolve('package.json'));
const compiler = require('esbuild');
const source = fs.readFileSync(previous, 'utf8');
const js = compiler.transformSync(source, { loader: 'ts', format: 'cjs', target: 'node20' }).code;
const oldModule = { exports: {} };
new Function('module', 'require', js)(oldModule, (m) => {
  if (m === '../schema') return { Questions };
  throw Error('Unexpected reference import ' + m);
});
const old = oldModule.exports.decide2;
const thresholds = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json'));
const config = JSON.parse(fs.readFileSync('packages/core/v2/policy.config.json'));
const inputFile = 'benchmarks/backend-v2/calib--gear-2--qwen3.5-4b--e1600.scores.jsonl';
const rows = fs.readFileSync(inputFile, 'utf8').trim().split('\n').map(JSON.parse);
const quality = { width: 1600, height: 1000, brightness: 100, sharpness: 0.1, warnings: [] };
const rec = (score) => ({ id: score.photoId, view: score.view, sha256: score.sha256, quality });
const time = '2026-11-18T13:00:00.000Z';
const histories = [
  [],
  ...['no', 'unknown'].map((answer) =>
    Questions.map((question, i) => ({ id: 'd' + i, question, answer, recordedAt: time })),
  ),
  ...Questions.map((positive) =>
    Questions.map((question, i) => ({
      id: 'd' + i,
      question,
      answer: question === positive ? 'yes' : 'no',
      recordedAt: time,
    })),
  ),
];
const anchors = ['front', 'back', 'label'].map((view, i) => ({
  photoId: 'context' + i,
  sha256: hash('context' + i),
  view,
  batteryVersion: 'gear-2',
  scorer: { id: 'local_logprob', model: 'context' },
  scoredAt: time,
  usage: { ms: 0, inputTokens: 0 },
  answers: {
    ...Object.fromEntries(
      ['broken', 'repair', 'road_contact', 'usable', 'gear', 'single_item', 'label_legible'].map(
        (k) => [k, { type: 'yesno', p: ['broken', 'repair', 'road_contact'].includes(k) ? 0 : 1 }],
      ),
    ),
    category: { type: 'choice', choice: 'jacket', probabilities: { jacket: 1 } },
    wear: { type: 'level', score: 0, probabilities: [1, 0, 0, 0] },
  },
}));
const outcomes = {};
let count = 0;
for (const row of rows)
  for (const disclosures of histories)
    for (const closeUpsRequested of [0, 1])
      for (const coverage of [[], anchors]) {
        const scores = [...coverage, row],
          request = {
            photos: scores.map(rec),
            scores,
            disclosures,
            closeUpsRequested,
            config,
            thresholds,
          };
        const before = old(request),
          after = now(request);
        assert.deepEqual(after, before);
        outcomes[after.outcome] = (outcomes[after.outcome] || 0) + 1;
        count++;
      }
const result = {
  referencePolicySha256: hash(fs.readFileSync(previous)),
  currentPolicySha256: hash(fs.readFileSync('packages/core/v2/policy.ts')),
  rawScoresSha256: hash(fs.readFileSync(inputFile)),
  actual4BScoreRecords: rows.length,
  controlledContexts: count / rows.length,
  totalComparisons: count,
  entireDecisionMismatches: 0,
  outcomes,
  limitations:
    'The archived calibration rows identify the tag, not the runtime digest. This tests ordinary policy parity with historical thresholds; the separate service smoke verifies the pinned running digest.',
};
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
