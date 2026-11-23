// Convert an experiment battery run into the production score-record format (PhotoScores per line) and a
// labels file, so the production calibration tool can be exercised on real measurements.
// node experiments/backend-v2/to-scores.mjs <battery.jsonl> <out-prefix> [scorerId] [batteryVersion]
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [, , input, prefix, scorerId = 'local_logprob', batteryVersion = 'b1'] = process.argv;
const rows = (await fs.readFile(input, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => !r.error);
const rename = { break: 'broken', slide: 'road_contact', repair: 'repair', gear: 'gear' };
const scores = [],
  labels = [];
for (const r of rows) {
  const answers = {};
  for (const [name, key] of Object.entries(rename))
    if (r.probes[name]) answers[key] = { type: 'yesno', p: r.probes[name].p.yes };
  scores.push({
    photoId: r.id,
    // The experiment did not keep the prepared image hash; a stable stand-in keeps the record valid.
    sha256: createHash('sha256').update(r.id).digest('hex'),
    view: 'detail',
    batteryVersion,
    scorer: { id: scorerId, model: r.model },
    answers,
    usage: {
      inputTokens: Object.values(r.probes).reduce((n, p) => n + (p.promptTokens ?? 0), 0),
      ms: r.totalMs,
    },
    scoredAt: '2026-11-16T00:00:00.000Z',
  });
  labels.push({
    photoId: r.id,
    damaged: r.condition === 'visible_defect' ? 'yes' : r.condition === 'no_visible_defect' ? 'no' : 'unsure',
    domain: ['garments_and_gear', 'hardware'].includes(r.domain) ? 'gear' : r.domain,
  });
}
await fs.writeFile(prefix + '.scores.jsonl', scores.map((s) => JSON.stringify(s)).join('\n') + '\n');
await fs.writeFile(prefix + '.labels.json', JSON.stringify(labels, null, 1) + '\n');
console.log(scores.length + ' score records, ' + labels.length + ' labels');
