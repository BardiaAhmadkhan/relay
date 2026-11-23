// Claude, 2026-11-20. Read-only breakdown of the E19 real-world run (held-out photos only):
// why clean items miss an offer, which question drives the damage band, and how pairs fare on
// the one-item check. CPU only; reads recorded answers, changes nothing.
// Usage (from the repo root): node research/analysis/e19_friction.cjs
const fs = require('fs');

const rows = fs
  .readFileSync('benchmarks/backend-v2/realworld--v3.jsonl', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const labels = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8'));
const byId = new Map(labels.cases.map((c) => [c.id, c]));
const held = rows.filter((r) => !byId.get(r.id)?.seenInCalibration);
const count = (arr, f) => {
  const m = new Map();
  for (const r of arr) m.set(f(r), (m.get(f(r)) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' | ');
};
const why = (r) => `${r.outcome} [${(r.reasons || []).join(',')}]`;
const isPair = (r) => /boot|glove/i.test(r.subject || '');

console.log('held-out rows', held.length, '|', count(held, (r) => r.condition));
const clean = held.filter((r) => r.condition === 'clean');
console.log('\nclean, all framings:', clean.length, '| outcome', count(clean, (r) => r.outcome));
for (const fr of ['item', 'worn', 'detail']) {
  const c = clean.filter((r) => r.framing === fr);
  console.log(`clean, framing ${fr} (${c.length}): band ${count(c, (r) => r.band)}\n   ${count(c, why)}`);
}

const inBand = clean.filter((r) => r.band && r.band !== 'clear');
console.log('\nclean in the review or block band:', inBand.length, '| driver',
  count(inBand, (r) => ((r.answers.road_contact ?? 0) >= (r.answers.broken ?? 0) ? 'road_contact' : 'broken')));
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))];
const cd = clean.map((r) => r.damage).filter((v) => v != null);
console.log('clean damage score p50/p75/p90/p95/max:', [0.5, 0.75, 0.9, 0.95, 1].map((p) => q(cd, p).toFixed(3)).join(' / '));
const damaged = held.filter((r) => r.condition === 'damaged');
console.log('damaged scores:', damaged.map((r) => `${r.id} ${r.damage.toFixed(3)} ${r.outcome}`).join(' | '));
console.log('\nclean photos blocked:');
for (const r of clean.filter((r) => r.outcome === 'no_offer'))
  console.log(`  ${r.id} ${r.subject} ${r.framing} road ${r.answers.road_contact} broken ${r.answers.broken} ${why(r)}`);

console.log('\nsingle_item on single-item photos (* = retake for multiple items):');
const it = held.filter((r) => r.framing === 'item' && r.singleItem != null);
const fmt = (a) => a.sort((x, y) => x.singleItem - y.singleItem)
  .map((r) => r.singleItem.toFixed(2) + ((r.reasons || []).includes('multiple_items') ? '*' : '')).join(' ');
console.log(`  pairs (${it.filter(isPair).length}): ${fmt(it.filter(isPair))}`);
console.log(`  other single items (${it.filter((r) => !isPair(r)).length}): ${fmt(it.filter((r) => !isPair(r)))}`);
const several = held.filter((r) => r.framing === 'several_items' && r.singleItem != null);
console.log(`  several-item photos (${several.length}): ${fmt(several)}`);
