import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { createApp } from '../server/app';
const protocol = {
  at: new Date().toISOString(),
  target: 'Low-resolution visible abrasion misses',
  candidate: 'min-grid-1024-v1',
  change:
    'Only when longest edge <480px, shortest >=96px, aspect <=4: bilinear-style triangle enlargement to approx 1024 spatial tokens (32px grid), lossless PNG. Original evidence dimensions and hashes stay unchanged. No sharpening, generative enhancement, prompt or weight change.',
  targetArea: 1024 * 32 * 32,
  kernel: 'linear',
  gate: 'No lost damaged-image detection or sliding pattern; no newly flagged visual-negative control. Per-image added wall time <=3000ms in this probe. If it fails, do not activate it.',
  cases: [
    { id: 'sample-01', file: 'assets/fixtures/round-03/sample-01.webp', damage: true },
    { id: 'source-crash', file: 'assets/fixtures/crashed-shoulder.jpg', damage: true },
    { id: 'sample-02', file: 'assets/fixtures/round-03/sample-02.jpg', damage: true },
    { id: 'sample-03', file: 'assets/fixtures/round-03/sample-03.jpg', damage: true },
    { id: 'denim', file: 'assets/fixtures/round-02/jean-jacket.jpg', damage: false },
    { id: 'helmet', file: 'assets/fixtures/round-02/helmet-fullface.jpg', damage: false },
    { id: 'label', file: 'assets/fixtures/backpack-label.jpg', damage: false },
    { id: 'illustration', file: 'app/assets/editorial-jacket.png', damage: false },
  ].map((c) => ({ ...c, variant: 'small320' })),
  limits:
    'Exposed diagnostic/development data, not independent validation. Controls are visual review labels, not verified safety.',
};
await fs.writeFile('experiments/round-05/probe-protocol.json', JSON.stringify(protocol, null, 2), {
  flag: 'wx',
});
async function render(bytes: Uint8Array) {
  const meta = await sharp(bytes).metadata();
  const w = meta.width!,
    h = meta.height!;
  if (Math.max(w, h) >= 480 || Math.min(w, h) < 96 || Math.max(w, h) / Math.min(w, h) > 4)
    return { bytes, changed: false, width: w, height: h };
  const scale = Math.sqrt(protocol.targetArea / (w * h));
  const width = Math.ceil((w * scale) / 32) * 32,
    height = Math.ceil((h * scale) / 32) * 32;
  return {
    bytes: await sharp(bytes)
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.linear })
      .png({ compressionLevel: 1 })
      .toBuffer(),
    changed: true,
    width,
    height,
  };
}
const rows = [];
for (const c of protocol.cases) {
  const input = await sharp(c.file)
    .rotate()
    .flatten({ background: '#fff' })
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  for (const variant of ['baseline', 'candidate']) {
    const calls: any[] = [];
    let transformed: any = null;
    const fetcher: typeof fetch = async (url, init) => {
      const response = await fetch(url, init);
      if (String(url).endsWith('/api/chat')) {
        const raw = await response.clone().json();
        calls.push({
          promptTokens: raw.prompt_eval_count,
          outputTokens: raw.eval_count,
          durationMs: raw.total_duration / 1e6,
          doneReason: raw.done_reason,
        });
      }
      return response;
    };
    const engine = await createLocalInspectionAdapter(undefined, undefined, fetcher);
    const adapter = {
      id: engine.id,
      model: engine.model,
      coverage: engine.coverage,
      clearCache: () => engine.clearCache(),
      analyze: async (images: any[], signal?: AbortSignal) => {
        if (variant === 'baseline') return engine.analyze(images, signal);
        const prepared = await Promise.all(
          images.map(async (image) => {
            transformed = await render(image.jpeg);
            return { ...image, jpeg: transformed.bytes };
          }),
        );
        return engine.analyze(prepared, signal);
      },
    };
    const app = createApp({ adapter });
    const started = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: {
        schemaVersion: '1.0',
        assessmentId: c.id + '-' + variant,
        disclosures: [],
        corrections: [],
        images: [{ id: 'photo', view: 'front', base64: input.toString('base64') }],
        consent: {
          processImages: true,
          externalProvider: false,
          expectedProvider: adapter.id,
          expectedModel: adapter.model,
        },
      },
    });
    const body = response.json();
    rows.push({
      id: c.id,
      expectedDamage: c.damage,
      variant,
      status: response.statusCode,
      elapsedMs: performance.now() - started,
      inputSha256: createHash('sha256').update(input).digest('hex'),
      render: transformed
        ? { changed: transformed.changed, width: transformed.width, height: transformed.height }
        : null,
      calls,
      body,
    });
    console.log(
      JSON.stringify({
        id: c.id,
        variant,
        status: response.statusCode,
        ms: Math.round(performance.now() - started),
        finding: body.observation?.inspection?.photos[0],
        calls,
      }),
    );
    await app.close();
    await fs.writeFile(
      'benchmarks/round-05/probe-results.json',
      JSON.stringify({ protocol, rows }, null, 2),
    );
  }
}
