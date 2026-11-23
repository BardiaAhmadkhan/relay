/** An actual two-assessment client workflow for the Friday public rehearsal. No optional OpenAI attachment.
 * The front is an attributed photograph with a recorded possible road-contact cue. The added detail
 * is a repeatable closer view of those same pixels. The accompanying back and label are controls. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { assess, scorePhoto, serviceBase, serviceHealthV2 } from '../app/src/api-v2.ts';
const c = {
    url: serviceBase(process.env.RELAY_PILOT_URL ?? ''),
    token: process.env.RELAY_PILOT_TOKEN ?? '',
  },
  run = process.env.RELAY_PILOT_ID;
if (!run || !/^[a-zA-Z0-9_-]{1,45}$/.test(run)) throw Error('Provide a stable pilot ID.');
if (!c.token && !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(c.url))
  throw Error('A public pilot requires the Relay access token.');
const signal = AbortSignal.timeout(300000);
assert.equal((await serviceHealthV2(c, signal))?.engineRelease, '3.5');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const attr = read('datasets/quality-cycle-02/attribution.json').images.find(
    (x) => x.id === 'commons-043',
  ),
  back = read('datasets/realworld-v3/labels.json').cases.find((x) => x.id === 'cm-107');
const load = (x) => {
  assert(/^CC BY(?:-SA)? [\d.]+/.test(x.license));
  const b = fs.readFileSync(x.file);
  assert.equal(createHash('sha256').update(b).digest('hex'), x.sha256);
  return b;
};
const front = load(attr),
  cleanBack = load(back),
  label = fs.readFileSync('assets/fixtures/backpack-label.jpg');
const assessmentId = run + '-detail',
  photos = [],
  signedScores = [],
  views = [];
const disclosures = ['crash', 'protective_damage', 'protective_repair'].map((question) => ({
  id: question,
  question,
  answer: 'no',
  recordedAt: '2026-11-20T00:00:00.000Z',
}));
const inspect = async (view, bytes) => {
  const t = performance.now(),
    v = await scorePhoto(
      c,
      { assessmentId, photoId: view, view, base64: bytes.toString('base64') },
      signal,
    );
  photos.push(v.photo);
  signedScores.push(v.signed);
  views.push({
    view,
    ms: Math.round(performance.now() - t),
    normalized: v.photo.sha256,
    heads: Object.keys(v.signed.scores.answers),
  });
  return v;
};
for (const [v, image] of Object.entries({ front, back: cleanBack, label })) await inspect(v, image);
const decide = (n) =>
  assess(c, { assessmentId, disclosures, photos, signedScores, closeUpsRequested: n }, signal);
const before = await decide(0);
assert.equal(
  before.decision.requestPhoto?.view,
  'detail',
  'The same overview evidence must first request the close-up.',
);
const meta = await sharp(front).metadata(),
  width = Math.floor(meta.width * 0.65),
  height = Math.floor(meta.height * 0.65);
const close = await sharp(front)
  .extract({
    width,
    height,
    left: Math.floor((meta.width - width) / 2),
    top: Math.floor((meta.height - height) / 2),
  })
  .jpeg({ quality: 90 })
  .toBuffer();
const d = await inspect('detail', close);
assert(d.signed.scores.answers.road_contact_low);
const final = await decide(1);
assert.notEqual(
  final.decision.requestPhoto?.view,
  'detail',
  'The workflow may not ask for a second recursive close-up.',
);
const card = (d) => ({
  outcome: d.outcome,
  grade: d.grade,
  category: d.category,
  reasons: d.reasons.map((r) => ({ code: r.code, text: r.text, photoId: r.photoId })),
  nextAction: d.nextAction,
  requestPhoto: d.requestPhoto,
});
const result = {
  id: run,
  origin: c.url,
  source: {
    title: attr.source,
    author: attr.author,
    license: attr.license,
    licenseUrl: attr.licenseUrl,
    detailTransform: 'central 65% crop of source, JPEG90, no marker',
  },
  views,
  before: card(before.decision),
  after: card(final.decision),
  routedOpenAIRequests: 0,
};
if (process.env.RELAY_DETAIL_REFERENCE) {
  const baseline = read(process.env.RELAY_DETAIL_REFERENCE);
  assert.deepEqual(result.before, baseline.before);
  assert.deepEqual(result.after, baseline.after);
  assert.deepEqual(
    result.views.map((q) => q.normalized),
    baseline.views.map((q) => q.normalized),
  );
}
console.log(JSON.stringify(result, null, 2));
