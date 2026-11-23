/** Operator-run mobile API pilot. Always use the same run ID for a retry.
 * Execute from the lab checkout; the image fixtures stay out of the cloud image. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  assess,
  assessWithCount,
  scorePhoto,
  serviceHealthV2,
  serviceBase,
} from '../app/src/api-v2.ts';
const url = serviceBase(process.env.RELAY_PILOT_URL ?? ''),
  id = process.env.RELAY_PILOT_ID;
if (!id || !/^[\w-]{1,45}$/.test(id)) throw Error('Choose a short stable pilot ID.');
const c = { url, token: process.env.RELAY_PILOT_TOKEN ?? '' };
if (!c.token && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/.test(url))
  throw Error('Use a private Relay pilot access token.');
const useCount = process.argv.includes('--with-count'),
  signal = AbortSignal.timeout(5 * 60000);
const data = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8')).cases;
function source(key) {
  const r = data.find((x) => x.id === key);
  assert(/^CC BY(?:-SA)? [\d.]+$/.test(r.license));
  const b = fs.readFileSync(r.file);
  assert.equal(createHash('sha256').update(b).digest('hex'), r.sha256);
  return b.toString('base64');
}
const started = new Date().toISOString(),
  t = performance.now(),
  health = await serviceHealthV2(c, signal);
const healthMs = Math.round(performance.now() - t);
assert.equal(health?.engineRelease, '3.5');
if (useCount) assert.equal(health.processingNotice, 'terms');
const results = [];
for (const [example, expected] of [
  ['ov-066', 'offer'],
  ['ox-083', 'retake'],
]) {
  const t0 = performance.now(),
    assessmentId = id + '-' + example,
    images = {
      front: source(example),
      back: source('cm-107'),
      label: fs.readFileSync('assets/fixtures/backpack-label.jpg').toString('base64'),
    };
  const photos = [],
    signedScores = [],
    views = [];
  for (const [view, base64] of Object.entries(images)) {
    const start = performance.now();
    const r = await scorePhoto(c, { assessmentId, photoId: view, view, base64 }, signal);
    photos.push(r.photo);
    signedScores.push(r.signed);
    views.push({ view, ms: Math.round(performance.now() - start) });
  }
  const input = {
    assessmentId,
    photos,
    signedScores,
    closeUpsRequested: 0,
    disclosures: ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
      id: question,
      question,
      answer: 'no',
      recordedAt: started,
    })),
  };
  const ordinary = await assess(c, input, signal);
  let reads = 0;
  const after = useCount
    ? await assessWithCount(c, input, signal, true, async (target) => {
        assert.equal(target, 'front');
        reads++;
        return images.front;
      })
    : ordinary;
  results.push({
    example,
    views,
    ordinary: ordinary.decision.outcome,
    decision: after.decision.outcome,
    totalMs: Math.round(performance.now() - t0),
    routedFrontReads: reads,
    expected: useCount ? expected : 'retake',
    match: after.decision.outcome === (useCount ? expected : 'retake'),
  });
}
console.log(
  JSON.stringify(
    {
      started,
      ended: new Date().toISOString(),
      id,
      healthMs,
      useCount,
      results,
      completedIntakes: results.length,
      distinctPhotos: 4,
      scope:
        'Two controlled three-view intakes sharing a back and label. Actual provider-billed cost is obtained separately from deploy/billing.mjs.',
    },
    null,
    2,
  ),
);
if (!results.every((r) => r.match)) process.exitCode = 1;
