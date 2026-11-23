import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { prepareImages } from '../server/images';
import { rescueAbrasion } from '../experiments/round-05/abrasion-rescue';
import { decide } from '../packages/core/policy';
import type { Observation } from '../packages/core/schema';
const d = JSON.parse(await fs.readFile('benchmarks/round-05/cue-256-results.json', 'utf8'));
const hard = JSON.parse(await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'));
const protocol = {
  at: new Date().toISOString(),
  candidate: 'cue256-verified1024-1',
  target: hard.target,
  factor:
    'Add the unchanged high-resolution physical-damage verifier only to positive outputs of the low-cost 256-token abrasion cue. The cue and verifier are existing measured components; no prompt or weight changes.',
  inputs: {
    cueResults: 'benchmarks/round-05/cue-256-results.json',
    cueSha256: createHash('sha256')
      .update(await fs.readFile('benchmarks/round-05/cue-256-results.json'))
      .digest('hex'),
    verifierSha256: createHash('sha256')
      .update(await fs.readFile('experiments/round-05/abrasion-rescue.ts'))
      .digest('hex'),
  },
  budget:
    '2500ms combined optional work per photo, 2600ms observed allowance including scheduler noise. Original findings and metadata remain unchanged. At most two extra calls; second only after a positive cue.',
  gates: hard.gate,
  limits:
    'Measured cue results from the preceding run are reused; measured new verification time is added. A fresh end-to-end repeat is mandatory before activation. Correlated development variants, not general accuracy.',
};
await fs.writeFile(
  'experiments/round-05/verified-cue-protocol.json',
  JSON.stringify(protocol, null, 2),
  { flag: 'wx' },
);
const out = 'benchmarks/round-05/verified-cue-results.json';
await fs.writeFile(out, '{}', { flag: 'wx' });
const rows: any[] = [];
for (const previous of d.rows) {
  const baseline: Observation = previous.baseline;
  let candidate = structuredClone(baseline);
  let state = previous.state;
  let extraMs = 0;
  const verifyCalls: any[] = [];
  if (previous.state === 'abrasion-recovered') {
    const c = hard.cases.find((c: any) => c.id === previous.id);
    const bytes = await fs.readFile(c.inputFile);
    const prepared = await prepareImages([
      { id: 'photo', view: 'front', base64: bytes.toString('base64') },
    ]);
    const remaining = Math.max(1, Math.floor(2500 - previous.addedMs));
    const deadline = AbortSignal.timeout(remaining);
    const fetcher: typeof fetch = async (url, init) => {
      const started = performance.now();
      const row: any = {};
      verifyCalls.push(row);
      try {
        const response = await fetch(url, init);
        row.raw = await response.clone().json();
        row.elapsedMs = performance.now() - started;
        return response;
      } catch (e) {
        row.elapsedMs = performance.now() - started;
        row.error = e instanceof Error ? e.name : 'unknown';
        throw e;
      }
    };
    const started = performance.now();
    try {
      const checked = await rescueAbrasion({
        verified: baseline.inspection!.photos[0]!,
        extracted: previous.candidate.inspection.photos[0],
        jpeg: prepared.images[0]!.jpeg,
        model: 'qwen3.5:4b',
        url: 'http://127.0.0.1:11435',
        fetcher,
        signal: deadline,
      });
      state = checked.state;
      if (checked.state === 'abrasion-recovered') {
        candidate.inspection!.photos[0] = { ...checked.photo, imageId: 'photo' };
        const zones = new Set(['shoulder', 'elbow', 'forearm', 'upper_arm', 'back', 'chest']);
        candidate.concerns = checked.photo.findings.map((f) => ({
          kind: f.kind,
          area: zones.has(f.zone) ? 'protective' : 'unknown',
          imageId: 'photo',
        }));
      }
    } catch {
      state = 'combined-budget-exhausted';
    }
    extraMs = performance.now() - started;
  }
  const before = baseline.inspection!.photos[0]!.findings,
    after = candidate.inspection!.photos[0]!.findings;
  const gates = {
    preservedExisting: !before.length || JSON.stringify(baseline) === JSON.stringify(candidate),
    noNewControlFlag: previous.expectedDamage !== false || !!before.length || !after.length,
    identity:
      baseline.category === candidate.category &&
      JSON.stringify(baseline.attributes) === JSON.stringify(candidate.attributes) &&
      baseline.multipleItems === candidate.multipleItems,
    authority:
      state !== 'abrasion-recovered' ||
      (after.every((f) => f.kind === 'abrasion' && f.clarity === 'possible') &&
        candidate.inspection!.photos[0]!.crashPattern === 'unclear'),
    boundedCalls: previous.calls.length + verifyCalls.length <= 2,
  };
  rows.push({
    ...previous,
    candidate,
    state,
    addedMs: previous.addedMs + extraMs,
    verifyCalls,
    gates,
  });
  if (previous.state === 'abrasion-recovered')
    console.log(
      JSON.stringify({
        id: previous.id,
        expected: previous.expectedDamage,
        before: before.length,
        after: after.length,
        state,
        totalMs: Math.round(previous.addedMs + extraMs),
        gates,
      }),
    );
  await fs.writeFile(out, JSON.stringify({ protocol, rows }, null, 2));
}
