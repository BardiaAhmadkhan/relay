import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { rescueAbrasion } from '../experiments/round-05/abrasion-rescue';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { PhotoInspectionSchema, type Observation } from '../packages/core/schema';
import { prepareImages } from '../server/images';
import { decide } from '../packages/core/policy';
import { validateFindings } from '../packages/vision/validation';
const protocol = JSON.parse(
  await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
);
const candidateSource = await fs.readFile('experiments/round-05/abrasion-rescue.ts');
const out = 'benchmarks/round-05/hard-case-results.json';
await fs.writeFile(out, '{}', { flag: 'wx' });
let extracted: z.infer<typeof PhotoInspectionSchema> | null = null;
let calls: any[] = [];
let phase = 'baseline';
const fetcher: typeof fetch = async (url, init) => {
  const start = performance.now();
  const response = await fetch(url, init);
  if (String(url).endsWith('/api/chat')) {
    const payload = JSON.parse(String(init?.body));
    const raw = await response.clone().json();
    const stage =
      phase === 'rescue' ? 'rescue' : payload.format.properties.supported ? 'verify' : 'extract';
    calls.push({
      stage,
      elapsedMs: performance.now() - start,
      promptTokens: raw.prompt_eval_count,
      outputTokens: raw.eval_count,
      doneReason: raw.done_reason,
    });
    if (stage === 'extract')
      extracted = PhotoInspectionSchema.parse(JSON.parse(raw.message.content));
  }
  return response;
};
const engine = await createLocalInspectionAdapter(undefined, undefined, fetcher);
const rows: any[] = [];
// Interleave source groups to avoid putting all variants of one item in a row.
const cases = [...protocol.cases].sort(
  (a, b) => a.variant.localeCompare(b.variant) || a.sourceId.localeCompare(b.sourceId),
);
for (const c of cases) {
  const bytes = await fs.readFile(c.inputFile);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.inputSha256);
  const prepared = await prepareImages([
    { id: 'photo', view: 'front', base64: bytes.toString('base64') },
  ]);
  engine.clearCache();
  phase = 'baseline';
  extracted = null;
  calls = [];
  const baseline = await engine.analyze(prepared.images);
  assert(extracted);
  const raw = structuredClone(extracted);
  const before = structuredClone(baseline);
  phase = 'rescue';
  const start = performance.now();
  const rescue = await rescueAbrasion({
    verified: baseline.inspection!.photos[0]!,
    extracted: raw,
    jpeg: prepared.images[0]!.jpeg,
    model: 'qwen3.5:4b',
    url: 'http://127.0.0.1:11435',
    fetcher,
    signal: AbortSignal.timeout(10000),
  });
  const addedMs = performance.now() - start;
  const candidate: Observation = structuredClone(baseline);
  candidate.inspection!.photos[0] = { ...rescue.photo, imageId: 'photo' };
  if (rescue.state === 'abrasion-recovered') {
    const zones = new Set(['shoulder', 'elbow', 'forearm', 'upper_arm', 'back', 'chest']);
    candidate.concerns = rescue.photo.findings.map((f) => ({
      kind: f.kind,
      area: zones.has(f.zone) ? 'protective' : 'unknown',
      imageId: 'photo',
    }));
    candidate.durationMs += addedMs;
    candidate.usage = {
      inputTokens: (candidate.usage?.inputTokens ?? 0) + rescue.usage.inputTokens,
      outputTokens: (candidate.usage?.outputTokens ?? 0) + rescue.usage.outputTokens,
    };
  }
  validateFindings(candidate, new Set(['photo']));
  const decisions = {
    baseline: decide({ disclosures: [], photos: prepared.photos, observation: baseline }),
    candidate: decide({ disclosures: [], photos: prepared.photos, observation: candidate }),
  };
  const originalFindings = baseline.inspection!.photos[0]!.findings;
  const candidateFindings = candidate.inspection!.photos[0]!.findings;
  const gates = {
    preservedExisting:
      !originalFindings.length || JSON.stringify(before) === JSON.stringify(candidate),
    noNewControlFlag:
      c.expectedDamage !== false || !!originalFindings.length || !candidateFindings.length,
    identity:
      baseline.category === candidate.category &&
      baseline.multipleItems === candidate.multipleItems &&
      JSON.stringify(baseline.attributes) === JSON.stringify(candidate.attributes),
    authority:
      rescue.state !== 'abrasion-recovered' ||
      (candidateFindings.every((f) => f.kind === 'abrasion' && f.clarity === 'possible') &&
        candidate.inspection!.photos[0]!.crashPattern === 'unclear'),
    noOffer:
      !decisions.candidate.offerRecommended && !decisions.candidate.protectivePerformanceCertified,
  };
  rows.push({
    id: c.id,
    sourceId: c.sourceId,
    group: c.group,
    variant: c.variant,
    expectedDamage: c.expectedDamage,
    width: c.width,
    height: c.height,
    inputSha256: c.inputSha256,
    baseline,
    candidate,
    extracted: raw,
    rescueState: rescue.state,
    addedMs,
    calls,
    gates,
    decisions,
  });
  console.log(
    JSON.stringify({
      id: c.id,
      damage: c.expectedDamage,
      base: originalFindings.length,
      candidate: candidateFindings.length,
      rescue: rescue.state,
      addedMs: Math.round(addedMs),
      gates,
    }),
  );
  await fs.writeFile(
    out,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        protocol,
        candidateSha256: createHash('sha256').update(candidateSource).digest('hex'),
        model: engine.model,
        boundary:
          'Actual original model stages run once, then one optional rescue. Baseline and candidate share the recorded original stages to isolate the change; no fake inference or image-hash answers.',
        rows,
      },
      null,
      2,
    ),
  );
}
engine.clearCache();
