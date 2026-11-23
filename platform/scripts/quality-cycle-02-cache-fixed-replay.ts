import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app';
import { LocalInspectionAdapter } from '../packages/vision/inspection';
import { AnalysisResponseSchema, SCHEMA_VERSION } from '../packages/core/schema';
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const lines = async (p: string) =>
  (await fs.readFile(p, 'utf8'))
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s));
const sha = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const protocol = await read('benchmarks/quality-cycle-02/current-http-audit-protocol.json');
const captured = (await lines('benchmarks/quality-cycle-02/canary-final-calls.jsonl')).filter(
  (c) => c.at >= protocol.at,
);
captured.push(
  ...(await read('benchmarks/quality-cycle-02/selected-program-replay-calls.json')).repairCalls.map(
    (c: any) => ({ ...c, stage: 'index-repair' }),
  ),
);
const labels = (await read('datasets/quality-audit-01/labels.json')).cases;
const previous = await lines('benchmarks/quality-cycle-02/current-http-audit.jsonl');
const mismatches: any[] = [],
  repairCalls: any[] = [],
  used: any[] = [];
let current = '';
const fetcher: typeof fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body)),
    hash = sha(String(init?.body));
  const recorded = captured.find((c) => c.requestHash === hash);
  if (recorded) {
    used.push({ id: current, requestHash: hash, stage: recorded.stage });
    if (recorded.status === null) throw Error(recorded.error);
    return new Response(JSON.stringify(recorded.raw), { status: recorded.status });
  }
  if (!body.format?.properties?.verdicts) {
    mismatches.push({ id: current, hash, format: body.format });
    throw Error('Unrecorded request ' + current);
  }
  throw new Error('Final cache verification permits recorded responses only: ' + current);
  const started = performance.now();
  try {
    const response = await fetch(url, init),
      raw = await response.clone().json();
    repairCalls.push({
      id: current,
      requestHash: hash,
      status: response.status,
      durationMs: performance.now() - started,
      raw,
    });
    return response;
  } catch (e: any) {
    repairCalls.push({
      id: current,
      requestHash: hash,
      durationMs: performance.now() - started,
      error: e.message,
    });
    throw e;
  }
};
const adapter = new LocalInspectionAdapter(
  'qwen3.5:4b',
  'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',
  'http://127.0.0.1:11435',
  fetcher,
);
const app = createApp({ adapter }),
  out = 'benchmarks/quality-cycle-02/cache-fixed-program-replay.jsonl';
await fs.writeFile(out, '', { flag: 'wx' });
await fs.writeFile(
  out.replace('.jsonl', '-protocol.json'),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      scope:
        'Latest program executed through real Fastify routes with exact recorded model responses from the current HTTP audit. All model responses including the earlier corrective review are recorded; no new inference is permitted. This is NOT another 194-image live inference or HTTP timing measurement.',
      model: adapter.model,
      sources: await Promise.all(
        [
          'packages/vision/inspection.ts',
          'packages/vision/focused-tear.ts',
          'packages/vision/evidence-contract.ts',
          'packages/vision/review-repair.ts',
          'packages/vision/cache-policy.ts',
          'server/app.ts',
          'scripts/quality-cycle-02-cache-fixed-replay.ts',
        ].map(async (path) => ({ path, sha256: sha(await fs.readFile(path)) })),
      ),
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
try {
  for (const [i, old] of previous.entries()) {
    current = old.id;
    adapter.clearCache();
    await app.inject({ method: 'DELETE', url: '/session' });
    const c = labels.find((c: any) => c.id === current),
      bytes = await fs.readFile(c.file);
    assert.equal(sha(bytes), c.sha256);
    const startUsed = used.length,
      startRepair = repairCalls.length;
    const response = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: {
        schemaVersion: SCHEMA_VERSION,
        assessmentId: 'selected-' + c.id,
        disclosures: [],
        corrections: [],
        images: [{ id: 'photo', view: c.view, base64: bytes.toString('base64') }],
        consent: { processImages: true, externalProvider: false },
      },
    });
    const raw = response.json();
    let result: any = null,
      error: string | undefined;
    if (response.statusCode === 200) {
      result = AnalysisResponseSchema.parse(raw);
      assert.equal(result.decision.offerRecommended, false);
      assert.equal(result.decision.protectivePerformanceCertified, false);
    } else error = JSON.stringify(raw);
    const photo = result?.observation?.inspection?.photos[0] ?? null,
      baseline = old.baselinePhoto ?? null;
    const r = {
      id: c.id,
      condition: c.condition,
      domain: c.domain,
      baselinePhoto: baseline,
      baselineFlag: !!baseline?.findings.length,
      baselineError: old.error,
      candidatePhoto: photo,
      candidateFlag: !!photo?.findings.length,
      error,
      status: response.statusCode,
      changedSinceHttp: JSON.stringify(photo) !== JSON.stringify(old.candidatePhoto ?? null),
      recordedCalls: used.slice(startUsed),
      liveRepairCalls: repairCalls.slice(startRepair),
      result,
    };
    if (c.condition === 'visible_defect' && old.baselineFlag)
      assert(r.candidateFlag, 'Lost positive alert ' + c.id);
    if (c.condition === 'no_visible_defect' && !old.baselineFlag)
      assert(!r.candidateFlag, 'New negative flag ' + c.id);
    await fs.appendFile(out, JSON.stringify(r) + '\n');
    if (r.changedSinceHttp || r.error || (i + 1) % 25 === 0)
      console.log(
        JSON.stringify({
          i: i + 1,
          id: c.id,
          status: r.status,
          changed: r.changedSinceHttp,
          repair: r.liveRepairCalls.length,
          error,
        }),
      );
  }
  assert.equal(mismatches.length, 0, 'Unexpected requests');
} finally {
  adapter.clearCache();
  await app.close();
  await fs.writeFile(
    out.replace('.jsonl', '-calls.json'),
    JSON.stringify({ mismatches, repairCalls, used }, null, 2) + '\n',
    { flag: 'wx' },
  );
}
