// Claude, 2026-11-20. Builds the D-012 API test manifests from open-licensed photos only.
// design: the 223 set (quality-audit-01, licence recorded) photos that matter for R1 and R2:
//         every review-band photo, every boots/gloves/multi-gear photo, and every damaged photo (R1 stress test).
// e19:    every E19 held-out photo that R2 or R1 would route, plus count controls: all photos whose model category
//         is boots or gloves, and all several-item photos, so the API's count answers can be checked broadly.
// Usage (from the repo root): node research/analysis/make_fallback_sets.cjs
const fs = require('fs');
const jl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

const thr = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json', 'utf8'));
const findBand = (o) => (o && typeof o === 'object' ? ('clear' in o && 'block' in o ? o : Object.values(o).map(findBand).find(Boolean)) : null);
const band = findBand(thr);
const zone = (s) => (s < band.clear ? 'clear' : s < band.block ? 'review' : 'block');

// ---- design set (223) ----
const qa = JSON.parse(fs.readFileSync('datasets/quality-audit-01/labels.json', 'utf8'));
const meta = new Map(qa.cases.map((c) => [c.id, c]));
const b1 = jl('benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1600.jsonl').filter((r) => r.condition === 'visible_defect' || r.condition === 'no_visible_defect');
const design = [];
for (const r of b1) {
  const m = meta.get(r.id);
  if (!m?.license || !m.file || !fs.existsSync(m.file)) continue;
  const damage = Math.max(r.probes.break.p.yes, r.probes.slide.p.yes);
  const z = zone(damage);
  const pairish = /boots|gloves|multi_gear/.test(r.subject);
  const damaged = r.condition === 'visible_defect';
  if (z !== 'review' && !pairish && !damaged) continue;
  design.push({ id: r.id, file: m.file, license: m.license, subject: r.subject, damaged, zone: z, damage: +damage.toFixed(4), why: [z === 'review' && 'R1', pairish && 'count', damaged && 'stress'].filter(Boolean) });
}
fs.writeFileSync('research/analysis/fallback-design.json', JSON.stringify({ built: new Date().toISOString(), band, items: design }, null, 1) + '\n');
const c = (f) => design.filter(f).length;
console.log(`design: ${design.length} photos (R1 review band ${c((d) => d.why.includes('R1'))}, count ${c((d) => d.why.includes('count'))}, damaged ${c((d) => d.damaged)})`);

// ---- E19 test set ----
const labels = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8'));
const byId = new Map(labels.cases.map((x) => [x.id, x]));
const audit = new Map();
for (const line of fs.readFileSync('datasets/realworld-v3/audit.txt', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([a-z]{2}-\d{3})\s+(clean|damaged|ambiguous)\s/);
  if (m) audit.set(m[1], m[2]);
}
const counts = new Map(jl('collab/baseline/v35-pairs/4b/rows.jsonl').map((r) => [r.id, r.count]));
const e19 = jl('benchmarks/backend-v2/realworld--v3.jsonl').filter((r) => !byId.get(r.id)?.seenInCalibration);
const items = [];
for (const r of e19) {
  const L = byId.get(r.id);
  if (!L?.license || !L.file || !fs.existsSync(L.file)) continue;
  const cat = String(r.answers?.category ?? '').split(':')[0];
  const pairCat = cat === 'boots' || cat === 'gloves';
  const sole = (code) => (r.reasons || []).length === 1 && r.reasons[0] === code;
  const r2 = sole('multiple_items') && pairCat && r.singleItem != null && r.singleItem < 0.5;
  const passes = r.singleItem == null || r.singleItem >= 0.5;
  const r1 = r.band === 'review' && (passes || r2);
  const r3 = sole('not_recognised_as_gear') || sole('category_unclear');
  const count = counts.get(r.id) ?? 'unrated';
  const control = pairCat || count === 'several' || count === 'pair';
  if (!r1 && !r2 && !r3 && !control) continue;
  items.push({ id: r.id, file: L.file, license: L.license, framing: r.framing, cond: audit.get(r.id) ?? r.condition, count, cat, single: r.singleItem, zone: r.band, outcome: r.outcome, reasons: r.reasons, routed: { r1, r2, r3 } });
}
fs.writeFileSync('research/analysis/fallback-e19.json', JSON.stringify({ built: new Date().toISOString(), items }, null, 1) + '\n');
const d = (f) => items.filter(f).length;
console.log(`e19: ${items.length} photos (R1 ${d((x) => x.routed.r1)}, R2 ${d((x) => x.routed.r2)}, R3 ${d((x) => x.routed.r3)}, controls only ${d((x) => !x.routed.r1 && !x.routed.r2 && !x.routed.r3)})`);
console.log('e19 licences missing for', e19.filter((r) => !byId.get(r.id)?.license).length, 'held-out photos (never sent)');
