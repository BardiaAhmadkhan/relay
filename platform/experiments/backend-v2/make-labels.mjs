// Write the labelled corpus in the production label format (scripts/v2-calibrate.ts), with the source
// group and subject kept, so cross-validation can hold out whole sources instead of single photographs.
// node experiments/backend-v2/make-labels.mjs [out=benchmarks/backend-v2/labels--corpus-261.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, loadCases } from './lib.mjs';

const out = process.argv[2] ?? path.join(OUT, 'labels--corpus-261.json');
const cases = await loadCases();
const labels = cases.map((c) => ({
  photoId: c.id,
  damaged:
    c.condition === 'visible_defect' ? 'yes' : c.condition === 'no_visible_defect' ? 'no' : 'unsure',
  // Same convention as calib--gear-2--qwen3.5-4b--e1600.labels.json: garments and hardware are "gear".
  domain: ['garments_and_gear', 'hardware'].includes(c.domain) ? 'gear' : c.domain,
  group: c.group,
  subject: c.subject,
  corpus: c.corpus,
  file: c.file,
}));
await fs.writeFile(out, JSON.stringify(labels, null, 1) + '\n');
const count = (f) => labels.filter(f).length;
console.log(
  JSON.stringify({
    out,
    labels: labels.length,
    damaged: count((l) => l.damaged === 'yes'),
    clean: count((l) => l.damaged === 'no'),
    unsure: count((l) => l.damaged === 'unsure'),
    groups: new Set(labels.map((l) => l.group)).size,
  }),
);
