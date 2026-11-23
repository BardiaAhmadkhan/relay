import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { recoverAbrasionCue } from '../experiments/round-05/abrasion-cue';
import { prepareImages } from '../server/images';
import { decide } from '../packages/core/policy';
import type { Observation } from '../packages/core/schema';
const hard = JSON.parse(await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'));
const ids = [
  'sample-01--reference',
  'sample-02--reference',
  'sample-03--reference',
  'sample-01--small320',
  'source-crash--small320',
  'sample-01--small240-jpeg60',
  'sample-01--small320-dim55',
  'denim--small240-jpeg60',
  'helmet--small320-dim55',
  'biker-black--small240-jpeg60',
  'lewis-vintage--small320',
  'worn-detail-3--small240-jpeg60',
];
const protocol = {
  at: new Date().toISOString(),
  candidate: 'low-detail-cue-1',
  purpose:
    'Fresh end-to-end stability audit of the most conservative recovery candidate. Three repetitions, actual primary and verification inference each time, no photo cache reuse.',
  selection:
    'Original three strengths, recorded low-resolution misses, harder previously problematic controls and two new-source controls; includes the ambiguous newly flagged worn-detail view.',
  ids,
  repetitions: 3,
  gate: 'No lost baseline findings, no new visually negative flags, one or fewer optional calls, <=2600ms added time; first user small320 repair must repeat in all three runs. Earlier minimum-two-damaged-variants gain gate remains in force.',
  candidateSha256: createHash('sha256')
    .update(await fs.readFile('experiments/round-05/abrasion-cue.ts'))
    .digest('hex'),
};
await fs.writeFile('experiments/round-05/repeat-protocol.json', JSON.stringify(protocol, null, 2), {
  flag: 'wx',
});
const out = 'benchmarks/round-05/repeat-results.json';
await fs.writeFile(out, '{}', { flag: 'wx' });
const engine = await createLocalInspectionAdapter();
const rows: any[] = [];
for (let repeat = 0; repeat < 3; repeat++) {
  const order = [...ids.slice(repeat * 3), ...ids.slice(0, repeat * 3)];
  for (const id of order) {
    const c = hard.cases.find((c: any) => c.id === id);
    const bytes = await fs.readFile(c.inputFile);
    const prepared = await prepareImages([
      { id: 'photo-' + repeat, view: 'front', base64: bytes.toString('base64') },
    ]);
    engine.clearCache();
    const baseline = await engine.analyze(prepared.images);
    let callCount = 0;
    const fetcher: typeof fetch = async (url, init) => {
      callCount++;
      return fetch(url, init);
    };
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
    candidate.inspection!.photos[0] = { ...rescued.photo, imageId: 'photo-' + repeat };
    if (rescued.state === 'abrasion-recovered') {
      const zones = new Set(['shoulder', 'elbow', 'forearm', 'upper_arm', 'back', 'chest']);
      candidate.concerns = rescued.photo.findings.map((f) => ({
        kind: f.kind,
        area: zones.has(f.zone) ? 'protective' : 'unknown',
        imageId: 'photo-' + repeat,
      }));
    }
    const b = baseline.inspection!.photos[0]!.findings,
      n = candidate.inspection!.photos[0]!.findings;
    const decision = decide({ disclosures: [], photos: prepared.photos, observation: candidate });
    const gates = {
      preserveExisting: !b.length || JSON.stringify(baseline) === JSON.stringify(candidate),
      noNewControlFlag: c.expectedDamage !== false || !!b.length || !n.length,
      bounded: callCount <= 1 && addedMs <= 2600,
      noOffer: !decision.offerRecommended,
    };
    rows.push({
      repeat: repeat + 1,
      id,
      expectedDamage: c.expectedDamage,
      baseline,
      candidate,
      state: rescued.state,
      addedMs,
      callCount,
      gates,
      decision,
    });
    console.log(
      JSON.stringify({
        repeat: repeat + 1,
        id,
        base: b.length,
        candidate: n.length,
        state: rescued.state,
        addedMs: Math.round(addedMs),
        gates,
      }),
    );
    await fs.writeFile(out, JSON.stringify({ protocol, rows }, null, 2));
  }
}
engine.clearCache();
