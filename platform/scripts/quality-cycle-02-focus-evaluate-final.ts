import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareImages } from '../server/images';
import { LocalInspectionAdapter } from '../packages/vision/inspection';
import { LocalInspectionAdapter as OriginalAdapter } from '../experiments/quality-cycle-02/original-inspection';
import {
  recoverFocusedTear,
  contextualFocusFetch,
} from '../experiments/quality-cycle-02/focused-tear-context';
import { normalizeEvidenceClaims } from '../packages/vision/evidence-contract';
import { PhotoInspectionSchema } from '../packages/core/schema';
const set = process.argv[2] ?? '';
assert(['audit', 'hard', 'fresh', 'final'].includes(set));
const run = process.argv[3] ?? 'focus-' + set;
assert(/^[a-z0-9-]+$/.test(run));
const digest = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const url = 'http://127.0.0.1:11435';
const child = new LocalInspectionAdapter('qwen3.5:4b', digest, url);
const original = new OriginalAdapter('qwen3.5:4b', digest, url);
let cases: any[] = [];
if (set === 'audit') {
  const labels = JSON.parse(
      await fs.readFile('datasets/quality-audit-01/labels.json', 'utf8'),
    ).cases,
    old = JSON.parse(
      await fs.readFile('benchmarks/quality-audit-01/evaluation-full.json', 'utf8'),
    ).rows;
  const reviews = JSON.parse(
    await fs.readFile('benchmarks/quality-audit-01/summary.json', 'utf8'),
  ).correspondenceReview;
  cases = labels.map((c: any) => ({
    ...c,
    baseline: old.find((r: any) => r.id === c.id)?.result.observation?.inspection?.photos[0],
    matched: reviews.find((r: any) => r.id === c.id)?.correspondence === 'matched',
  }));
} else if (set === 'hard') {
  const p = JSON.parse(
      await fs.readFile('experiments/round-05/hard-case-protocol.json', 'utf8'),
    ).cases,
    old = JSON.parse(await fs.readFile('benchmarks/round-05/cue-light-results.json', 'utf8')).rows;
  cases = p.map((c: any) => ({
    ...c,
    file: c.inputFile,
    sha256: c.inputSha256,
    view: 'front',
    condition:
      c.expectedDamage === true
        ? 'visible_defect'
        : c.expectedDamage === false
          ? 'no_visible_defect'
          : 'ambiguous',
    baseline: old.find((r: any) => r.id === c.id)?.candidate?.inspection?.photos[0],
    matched: c.expectedDamage === true,
  }));
} else
  cases = JSON.parse(
    await fs.readFile(
      set === 'final'
        ? 'datasets/quality-cycle-02/final-holdout-labels.json'
        : 'datasets/quality-cycle-02/labels.json',
      'utf8',
    ),
  ).cases;
const selected = process.argv[4]?.split(',');
if (selected) cases = cases.filter((c) => selected.includes(c.id));
const path = 'benchmarks/quality-cycle-02/' + run + '.jsonl';
await fs.writeFile(path, '', { flag: 'wx' });
const startedAt = new Date().toISOString();
await fs.writeFile(
  path.replace('.jsonl', '-protocol.json'),
  JSON.stringify(
    {
      startedAt,
      set,
      cases: cases.length,
      mode:
        set === 'fresh' || set === 'final'
          ? 'New actual baseline inference plus isolated candidate recovery'
          : 'Frozen actual baseline outputs plus live candidate recovery',
      model: 'qwen3.5:4b',
      digest,
      sourceHashes: await Promise.all(
        [
          'experiments/quality-cycle-02/focused-tear-context.ts',
          'packages/vision/evidence-contract.ts',
          'scripts/quality-cycle-02-focus-evaluate-final.ts',
        ].map(async (path) => ({
          path,
          sha256: createHash('sha256')
            .update(await fs.readFile(path))
            .digest('hex'),
        })),
      ),
      gate: 'No recovery on any visually negative image; no lost or altered previously matched positive evidence; every new recovery inspected for correspondence. Ambiguous images separate. Operational fallback preserves baseline. Fresh labels frozen before this run.',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
for (const [i, c] of cases.entries()) {
  const bytes = await fs.readFile(c.file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), c.sha256);
  const prepared = await prepareImages([
    { id: 'photo', view: c.view, base64: bytes.toString('base64') },
  ]);
  const start = performance.now();
  let row: any;
  try {
    let baseline = c.baseline;
    let baselineMs: number | null = null;
    if (set === 'fresh' || set === 'final') {
      original.clearCache();
      const before = performance.now();
      const observation = await original.analyze(prepared.images, AbortSignal.timeout(60000));
      baselineMs = performance.now() - before;
      baseline = observation.inspection!.photos[0];
    }
    if (!baseline) {
      row = {
        id: c.id,
        condition: c.condition,
        skipped: 'No original visual result',
        ms: performance.now() - start,
      };
    } else {
      child.clearCache();
      const { imageId: _imageId, ...photoFields } = baseline;
      const base = PhotoInspectionSchema.parse(photoFields);
      const recovered = await recoverFocusedTear({
        photo: base,
        jpeg: prepared.images[0]!.jpeg,
        view: c.view,
        model: 'qwen3.5:4b',
        url,
        fetcher: fetch,
        inspect: async (jpeg, signal) => {
          const scoped = new LocalInspectionAdapter(
            'qwen3.5:4b',
            digest,
            url,
            contextualFocusFetch(fetch, prepared.images[0]!.jpeg),
          );
          try {
            const r = await scoped.analyze(
              [{ id: 'focused-detail', view: 'detail', jpeg }],
              signal,
            );
            return {
              photo: r.inspection!.photos[0]!,
              usage: r.usage ?? { inputTokens: 0, outputTokens: 0 },
            };
          } finally {
            scoped.clearCache();
          }
        },
      });
      const claimOnly = normalizeEvidenceClaims(base),
        candidate = normalizeEvidenceClaims(recovered.photo);
      const changed = JSON.stringify(candidate) !== JSON.stringify(base),
        recovery = recovered.photo !== base;
      row = {
        id: c.id,
        condition: c.condition,
        priorSource: c.priorSource ?? false,
        baseline: base,
        claimOnly,
        candidate,
        recovery,
        changed,
        matchedPreserved: c.matched ? JSON.stringify(candidate) === JSON.stringify(base) : null,
        attempted: recovered.attempted,
        trace: recovered.trace,
        focusMs: recovered.durationMs,
        baselineMs,
        ms: performance.now() - start,
        usage: recovered.usage,
      };
    }
  } catch (e: any) {
    row = { id: c.id, error: e.message, ms: performance.now() - start };
  }
  await fs.appendFile(path, JSON.stringify(row) + '\n');
  if (row.attempted || row.changed || row.error || i % 25 === 0)
    console.log(
      JSON.stringify({
        i: i + 1,
        n: cases.length,
        id: c.id,
        condition: c.condition,
        recovery: row.recovery,
        attempted: row.attempted,
        trace: row.trace,
        ms: Math.round(row.ms),
        error: row.error,
      }),
    );
}
original.clearCache();
child.clearCache();
