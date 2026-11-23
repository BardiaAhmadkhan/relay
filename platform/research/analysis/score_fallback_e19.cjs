// Claude, 2026-11-20. Scores the pre-registered D-012 test on E19 (gpt-6.2-sol only).
// R2 is judged by its pre-registered acceptance; R1 and R3 are reported, not shipped.
// Usage (from the repo root): node research/analysis/score_fallback_e19.cjs
const fs = require('fs');
const jl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const set = JSON.parse(fs.readFileSync('research/analysis/fallback-e19.json', 'utf8')).items;
const api = new Map(jl('research/analysis/fallback-results/e19--gpt-6.2-sol.jsonl').filter((r) => r.rep === 0 && r.ok).map((r) => [r.id, r]));
const replay = new Map(JSON.parse(fs.readFileSync('research/analysis/r2-replay-output.json', 'utf8')).results.map((r) => [r.id, r]));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const passCount = (l) => l.item_count === 'one' || l.item_count === 'matched_pair';
const confidentClear = (l) => l.ordinary_wear_only === 'yes' && l.structural_damage === 'no' && l.abrasion_beyond_wear === 'no' && l.repair === 'no';
const seesHarm = (l) => ['structural_damage', 'abrasion_beyond_wear', 'repair'].some((k) => l[k] === 'yes');
const rank = { offer: 3, review: 2, retake: 1, no_offer: 0 };

console.log(`E19 test: ${set.length} photos, ${api.size} API answers; latency median ${Math.round(q([...api.values()].map((r) => r.ms), 0.5))} ms, p95 ${Math.round(q([...api.values()].map((r) => r.ms), 0.95))} ms`);
const missing = set.filter((x) => !api.has(x.id)).map((x) => x.id);
if (missing.length) console.log('MISSING API answers:', missing.join(' '));

// ---------- R2 (pre-registered acceptance) ----------
console.log('\n== R2 (pairs), routed photos');
const r2 = set.filter((x) => x.routed.r2);
let fails = [];
let pairGains = 0;
for (const x of r2) {
  const a = api.get(x.id)?.labels, rp = replay.get(x.id);
  const passed = !!a && passCount(a);
  const before = rp.before.outcome, after = passed ? rp.countPass.outcome : before;
  const afterReasons = passed ? rp.countPass.reasons : rp.before.reasons;
  const severalOrScene = x.count === 'several' || x.framing === 'scene' || x.framing === 'several_items';
  if (severalOrScene && passed) fails.push(`${x.id}: several/scene passed`);
  if (x.count === 'pair' && passed) pairGains++;
  if (x.count === 'one' && rank[after] < rank[before]) fails.push(`${x.id}: single got worse ${before}->${after}`);
  if (x.cond === 'damaged' && after === 'offer') fails.push(`${x.id}: damaged reached offer`);
  console.log(`  ${x.id.padEnd(7)} count=${x.count.padEnd(8)} framing=${x.framing.padEnd(13)} api=${a ? a.item_count : 'none'} -> ${before} [${rp.before.reasons.join(',')}] => ${after} [${afterReasons.join(',')}]`);
}
if (pairGains < 1) fails.push('no net pair gain');
console.log(`  pairs gained: ${pairGains}; acceptance: ${fails.length ? 'FAIL: ' + fails.join('; ') : 'PASS'}`);

// ---------- count controls (robustness; not routed in production unless R2) ----------
const scored = set.filter((x) => ['one', 'pair', 'several'].includes(x.count) && api.has(x.id));
const map = { one: 'one', pair: 'matched_pair', several: 'several' };
const right = scored.filter((x) => api.get(x.id).labels.item_count === map[x.count]);
const wrongPass = scored.filter((x) => x.count === 'several' && passCount(api.get(x.id).labels));
console.log(`\n== Count answers on all labelled test photos: ${right.length}/${scored.length} exact; several-item photos the API would pass: ${wrongPass.length} [${wrongPass.map((x) => x.id).join(' ')}]`);
const wrong = scored.filter((x) => api.get(x.id).labels.item_count !== map[x.count]);
console.log('  mismatches: ' + wrong.map((x) => `${x.id}(${x.count}->${api.get(x.id).labels.item_count})`).join(' '));

// ---------- R1 (reported, not shipped) ----------
const r1 = set.filter((x) => x.routed.r1);
console.log(`\n== R1 (not shipped): ${r1.length} routed`);
for (const c of ['clean', 'ambiguous', 'damaged']) {
  const s = r1.filter((x) => x.cond === c && api.has(x.id));
  if (!s.length) continue;
  console.log(`  ${c.padEnd(9)} n=${s.length} confidently cleared ${s.filter((x) => confidentClear(api.get(x.id).labels)).length}; sees harm ${s.filter((x) => seesHarm(api.get(x.id).labels)).length}; unsure ${s.filter((x) => api.get(x.id).labels.ordinary_wear_only === 'unsure').length}`);
}
console.log('  ambiguous detail: ' + r1.filter((x) => x.cond === 'ambiguous').map((x) => `${x.id}:${JSON.stringify(api.get(x.id)?.labels)}`).join(' | '));

// ---------- R3 (reported, not shipped) ----------
const r3 = set.filter((x) => x.routed.r3);
console.log(`\n== R3 (not shipped): ${r3.length} routed`);
for (const x of r3) {
  const a = api.get(x.id)?.labels;
  console.log(`  ${x.id} ${x.framing} reasons=${x.reasons.join(',')} engineCat=${x.cat} -> api gear=${a?.is_motorcycle_gear} category=${a?.category}`);
}
