import fs from 'node:fs/promises';
import { createLocalInspectionAdapter } from '../packages/vision/inspection';
import { createApp } from '../server/app';
import { SCHEMA_VERSION } from '../packages/core/schema';
const protocol = JSON.parse(
  await fs.readFile('experiments/round-03/condition-protocol.json', 'utf8'),
);
const report = process.env.RELAY_PROBE_REPORT ?? 'condition-first-run';
await fs.writeFile('benchmarks/round-03/' + report + '.json', '{}', { flag: 'wx' });
const adapter = await createLocalInspectionAdapter(process.env.RELAY_PROBE_MODEL);
const app = createApp({ adapter });
const rows = [];
for (const c of protocol.cases) {
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    assessmentId: c.id,
    disclosures: [],
    corrections: [],
    images: [
      { id: 'photo', view: 'front', base64: (await fs.readFile(c.file)).toString('base64') },
    ],
    consent: {
      processImages: true,
      externalProvider: false,
      expectedProvider: adapter.id,
      expectedModel: adapter.model,
    },
  };
  const start = performance.now();
  const response = await app.inject({ method: 'POST', url: '/assess', payload });
  const body = response.json();
  const row = {
    ...c,
    status: response.statusCode,
    elapsedMs: performance.now() - start,
    requestBytes: Buffer.byteLength(JSON.stringify(payload)),
    body,
  };
  rows.push(row);
  console.log(
    JSON.stringify({
      id: c.id,
      status: row.status,
      ms: Math.round(row.elapsedMs),
      title: body.decision?.title,
      findings: body.observation?.inspection?.photos[0],
      error: body.error,
    }),
  );
  await fs.writeFile(
    'benchmarks/round-03/' + report + '.json',
    JSON.stringify({ at: new Date().toISOString(), model: adapter.model, protocol, rows }, null, 2),
  );
}
await app.close();
