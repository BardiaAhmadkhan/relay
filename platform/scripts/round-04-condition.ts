import fs from 'node:fs/promises';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { createApp } from '../server/app';
import { SCHEMA_VERSION } from '../packages/core/schema';
const folder = 'benchmarks/round-04';
await fs.mkdir(folder, { recursive: true });
const protocol = JSON.parse(
  await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'),
);
const variants = ['reference', 'jpeg35', 'dim70', 'small320'] as const;
const plan = {
  frozenAt: new Date().toISOString(),
  purpose:
    'Paired input-quality stress test of the retained local reference. These are dependent variants, not new independent cases.',
  cases: protocol.cases,
  variants,
  gate: 'Any lost known damage finding fails preservation. No visible damage never authorizes an offer. Low quality should request a better photograph. False concerns on visual controls reported separately. No prompt changes within the run.',
};
await fs.writeFile(folder + '/quality-protocol.json', JSON.stringify(plan, null, 2), {
  flag: 'wx',
});
const adapter = await createLocalInspectionAdapter();
const app = createApp({ adapter });
const rows = [];
for (const c of protocol.cases) {
  const input = await fs.readFile(c.file);
  if (createHash('sha256').update(input).digest('hex') !== c.sha256) throw Error('Fixture changed');
  for (const variant of variants) {
    let p = sharp(input).rotate().flatten({ background: '#fff' });
    if (variant === 'dim70') p = p.modulate({ brightness: 0.7 });
    if (variant === 'small320')
      p = p.resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true });
    const bytes =
      variant === 'reference'
        ? input
        : await p.jpeg({ quality: variant === 'jpeg35' ? 35 : 88 }).toBuffer();
    const started = performance.now();
    const response = await app.inject({
      method: 'POST',
      url: '/assess',
      payload: {
        schemaVersion: SCHEMA_VERSION,
        assessmentId: c.id + '-' + variant,
        disclosures: [],
        corrections: [],
        images: [{ id: 'photo', view: 'front', base64: bytes.toString('base64') }],
        consent: {
          processImages: true,
          externalProvider: false,
          expectedProvider: adapter.id,
          expectedModel: adapter.model,
        },
      },
    });
    const body = response.json();
    const photo = body.observation?.inspection?.photos[0];
    rows.push({
      id: c.id,
      group: c.group,
      expectedDamage: c.expectedDamage,
      variant,
      status: response.statusCode,
      elapsedMs: performance.now() - started,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      body,
    });
    console.log(
      JSON.stringify({
        id: c.id,
        variant,
        status: response.statusCode,
        ms: Math.round(performance.now() - started),
        findings: photo?.findings.length,
        crashPattern: photo?.crashPattern,
        title: body.decision?.title,
        error: body.error,
      }),
    );
    await fs.writeFile(
      folder + '/quality-results.json',
      JSON.stringify({ plan, model: adapter.model, rows }, null, 2),
    );
  }
}
await app.close();
