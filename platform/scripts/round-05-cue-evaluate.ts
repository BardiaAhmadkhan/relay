import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { recoverAbrasionCue } from '../experiments/round-05/abrasion-cue';
import { prepareImages } from '../server/images';
import { decide } from '../packages/core/policy';
import { validateFindings } from '../packages/vision/validation';
import type { Observation } from '../packages/core/schema';
const base = JSON.parse(await fs.readFile('benchmarks/round-05/hard-case-results.json', 'utf8'));
assert.equal(base.rows.length, 106);
const source = await fs.readFile('experiments/round-05/abrasion-cue.ts');
const protocol = {
  at: new Date().toISOString(),
  target: base.protocol.target,
  candidate: 'low-detail-cue-1',
  change:
    'One optional abrasion-only call on enlarged input after an empty low-resolution baseline. Existing findings, category/material/identity remain untouched. Recovered clue is possible, mechanism unclear. No model weights or live app changes.',
  baselineSha256: createHash('sha256')
    .update(await fs.readFile('benchmarks/round-05/hard-case-results.json'))
    .digest('hex'),
  candidateSha256: createHash('sha256').update(source).digest('hex'),
  gate: {
    ...base.protocol.gate,
    latency:
      'One extra request maximum per empty low-resolution photo. 2500ms transport deadline, baseline preserved on error. Observed p95 overhead <=2600ms including rendering.',
  },
  boundary:
    'Original primary/verifier observations are the preserved actual run. Only the optional new call is executed in this run. Compare semantics on the same baseline; latency is original stage time plus measured addedMs. Still an exposed development set, not general accuracy.',
};
await fs.writeFile('experiments/round-05/cue-protocol.json', JSON.stringify(protocol, null, 2), {
  flag: 'wx',
});
const out = 'benchmarks/round-05/cue-results.json';
await fs.writeFile(out, '{}', { flag: 'wx' });
const rows: any[] = [];
for (const b of base.rows) {
  const c = base.protocol.cases.find((c: any) => c.id === b.id);
  const bytes = await fs.readFile(c.inputFile);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.inputSha256);
  const prepared = await prepareImages([
    { id: 'photo', view: 'front', base64: bytes.toString('base64') },
  ]);
  const calls: any[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const start = performance.now();
    const row: any = { elapsedMs: 0 };
    calls.push(row);
    try {
      const response = await fetch(url, init);
      const raw = await response.clone().json();
      Object.assign(row, {
        elapsedMs: performance.now() - start,
        promptTokens: raw.prompt_eval_count,
        outputTokens: raw.eval_count,
        raw,
      });
      return response;
    } catch (e) {
      Object.assign(row, {
        elapsedMs: performance.now() - start,
        error: e instanceof Error ? e.name : 'unknown',
      });
      throw e;
    }
  };
  const baseline: Observation = b.baseline;
  const start = performance.now();
  const rescued = await recoverAbrasionCue({
    verified: baseline.inspection!.photos[0]!,
    jpeg: prepared.images[0]!.jpeg,
    model: 'qwen3.5:4b',
    url: 'http://127.0.0.1:11435',
    fetcher,
  });
  const addedMs = performance.now() - start;
  const candidate: Observation = structuredClone(baseline);
  candidate.inspection!.photos[0] = { ...rescued.photo, imageId: 'photo' };
  if (rescued.state === 'abrasion-recovered') {
    const zones = new Set(['shoulder', 'elbow', 'forearm', 'upper_arm', 'back', 'chest']);
    candidate.concerns = rescued.photo.findings.map((f) => ({
      kind: f.kind,
      area: zones.has(f.zone) ? 'protective' : 'unknown',
      imageId: 'photo',
    }));
  }
  validateFindings(candidate, new Set(['photo']));
  const originalFindings = baseline.inspection!.photos[0]!.findings,
    findings = candidate.inspection!.photos[0]!.findings;
  const decision = decide({ disclosures: [], photos: prepared.photos, observation: candidate });
  const gates = {
    preservedExisting:
      !originalFindings.length || JSON.stringify(baseline) === JSON.stringify(candidate),
    noNewControlFlag: b.expectedDamage !== false || !!originalFindings.length || !findings.length,
    identity:
      baseline.category === candidate.category &&
      JSON.stringify(baseline.attributes) === JSON.stringify(candidate.attributes) &&
      baseline.multipleItems === candidate.multipleItems,
    authority:
      rescued.state !== 'abrasion-recovered' ||
      (findings.every((f) => f.kind === 'abrasion' && f.clarity === 'possible') &&
        candidate.inspection!.photos[0]!.crashPattern === 'unclear'),
    noOffer: !decision.offerRecommended && !decision.protectivePerformanceCertified,
    boundedCalls: calls.length <= 1,
  };
  rows.push({
    id: b.id,
    sourceId: b.sourceId,
    group: b.group,
    variant: b.variant,
    expectedDamage: b.expectedDamage,
    baseline,
    candidate,
    decision,
    state: rescued.state,
    addedMs,
    calls,
    gates,
  });
  console.log(
    JSON.stringify({
      id: b.id,
      expected: b.expectedDamage,
      baseline: originalFindings.length,
      candidate: findings.length,
      state: rescued.state,
      addedMs: Math.round(addedMs),
      gates,
    }),
  );
  await fs.writeFile(out, JSON.stringify({ protocol, rows }, null, 2));
}
