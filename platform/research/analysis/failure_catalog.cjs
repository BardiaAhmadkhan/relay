// Claude, 2026-11-20. D-012 failure catalogue and routing simulation (CPU only, recorded answers).
// E19 (held-out, with datasets/realworld-v3/audit.txt applied) and the 223-photo calibration set.
// Routing uses only v3.1's own uncertainty zones; nothing here is fitted.
// Usage (from the repo root): node research/analysis/failure_catalog.cjs
const fs = require('fs');

const jl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const thr = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json', 'utf8'));
const findBand = (o) => (o && typeof o === 'object' ? ('clear' in o && 'block' in o ? o : Object.values(o).map(findBand).find(Boolean)) : null);
const band = findBand(thr);
const zone = (s) => (s < band.clear ? 'clear' : s < band.block ? 'review' : 'block');
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : '-');
const count = (arr, f) => {
  const m = new Map();
  for (const r of arr) m.set(f(r), (m.get(f(r)) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' | ');
};

// ---------- E19 ----------
const labels = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8'));
const byId = new Map(labels.cases.map((c) => [c.id, c]));
const audit = new Map();
for (const line of fs.readFileSync('datasets/realworld-v3/audit.txt', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([a-z]{2}-\d{3})\s+(clean|damaged|ambiguous)\s/);
  if (m) audit.set(m[1], m[2]);
}
const counts = new Map(jl('collab/baseline/v35-pairs/4b/rows.jsonl').map((r) => [r.id, r.count]));
const e19 = jl('benchmarks/backend-v2/realworld--v3.jsonl')
  .filter((r) => !byId.get(r.id)?.seenInCalibration)
  .map((r) => {
    const cat = String(r.answers?.category ?? '');
    const [catName, catP] = cat.split(':');
    return {
      id: r.id,
      framing: r.framing,
      raw: r.condition,
      cond: audit.get(r.id) ?? r.condition,
      count: counts.get(r.id) ?? 'unrated',
      damage: r.damage,
      zone: r.band,
      single: r.singleItem,
      gear: r.gear,
      cat: catName,
      catP: catP ? Number(catP) : null,
      outcome: r.outcome,
      reasons: r.reasons || [],
    };
  });
const intake = e19.filter((r) => ['item', 'worn', 'detail'].includes(r.framing));
console.log(`E19 held-out ${e19.length}; intake framings ${intake.length}; audited conditions: ${count(e19, (r) => r.cond)}`);

console.log('\n== E19 damage signal, intake framings (audited labels)');
for (const c of ['clean', 'damaged', 'ambiguous']) {
  const s = intake.filter((r) => r.cond === c);
  console.log(`  ${c.padEnd(9)} n=${s.length}  zone: ${count(s, (r) => r.zone)}`);
}
const dmg = e19.filter((r) => r.cond === 'damaged');
console.log(`  all framings, damaged n=${dmg.length}: ${dmg.map((r) => `${r.id}:${r.zone}/${r.outcome}`).join(' ')}`);

console.log('\n== E19 one-item check where an item count is known (all framings)');
for (const c of ['one', 'pair', 'several']) {
  const s = e19.filter((r) => r.count === c && r.single != null);
  const pass = s.filter((r) => r.single >= 0.5).length;
  console.log(`  ${c.padEnd(8)} n=${s.length} pass ${pass} (${pct(pass, s.length)})`);
}
const gearLow = intake.filter((r) => r.gear != null && r.gear < 0.5);
console.log(`\n== E19 intake photos with gear < 0.5: ${gearLow.length}/${intake.length}; category conf < 0.6: ${intake.filter((r) => r.catP != null && r.catP < 0.6).length}/${intake.length}`);

// Routing simulation (v3.1 uncertainty zones only)
const pairCat = (r) => /^(boots|gloves)$/.test(r.cat || '');
const r2 = (r) => r.single != null && r.single < 0.5 && pairCat(r);
const passesCount = (r) => r.single == null || r.single >= 0.5;
const r1 = (r) => r.zone === 'review' && (passesCount(r) || r2(r));
const routed = e19.filter((r) => r1(r) || r2(r));
console.log(`\n== E19 routing (all ${e19.length} held-out photos): R1 ${e19.filter(r1).length}, R2 ${e19.filter(r2).length}, either ${routed.length} (${pct(routed.length, e19.length)})`);
console.log('  routed by framing:', count(routed, (r) => r.framing));
console.log('  routed by audited condition:', count(routed, (r) => r.cond));
console.log('  routed by count label:', count(routed, (r) => r.count));
// Where the engine is wrong and routing catches it, versus overlap
const frictionClean = intake.filter((r) => r.cond === 'clean' && r.zone === 'review');
console.log(`  clean intake photos in the review band: ${frictionClean.length}; of these routed: ${frictionClean.filter((r) => r1(r) || r2(r)).length}`);
const pairsFail = e19.filter((r) => r.count === 'pair' && r.single != null && r.single < 0.5);
console.log(`  pairs failing the one-item check: ${pairsFail.length}; routed by R2: ${pairsFail.filter(r2).length} [${pairsFail.map((r) => r.id + ':' + r.cat).join(' ')}]`);
const severalRouted = e19.filter((r) => r.count === 'several' && r2(r));
console.log(`  several-item photos routed by R2 (API must say several): ${severalRouted.length} [${severalRouted.map((r) => r.id).join(' ')}]`);
const dmgRouted = e19.filter((r) => r.cond === 'damaged' && (r1(r) || r2(r)));
console.log(`  damaged photos routed (API must not clear): ${dmgRouted.length} [${dmgRouted.map((r) => r.id + ':' + r.zone).join(' ')}]`);
fs.writeFileSync('research/analysis/e19-routed.json', JSON.stringify(routed.map((r) => ({ id: r.id, r1: r1(r), r2: r2(r), cond: r.cond, count: r.count, framing: r.framing, zone: r.zone, damage: r.damage, single: r.single, cat: r.cat })), null, 1) + '\n');

// ---------- 223 calibration set ----------
const b1 = jl('benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1600.jsonl').filter((r) => r.condition === 'visible_defect' || r.condition === 'no_visible_defect');
const qa = JSON.parse(fs.readFileSync('datasets/quality-audit-01/labels.json', 'utf8'));
const lic = new Map(qa.cases.map((c) => [c.id, c.license]));
const cal = b1.map((r) => ({
  id: r.id,
  subject: r.subject,
  damaged: r.condition === 'visible_defect',
  damage: Math.max(r.probes.break.p.yes, r.probes.slide.p.yes),
  license: lic.get(r.id) ?? null,
}));
cal.forEach((r) => (r.zone = zone(r.damage)));
console.log(`\n== 223 set (b1 at 1600 px, v3.1 band ${band.clear}/${band.block})`);
for (const z of ['clear', 'review', 'block'])
  console.log(`  ${z.padEnd(6)} damaged ${cal.filter((r) => r.damaged && r.zone === z).length}  clean ${cal.filter((r) => !r.damaged && r.zone === z).length}`);
const calRouted = cal.filter((r) => r.zone === 'review');
console.log(`  R1 routed ${calRouted.length}/${cal.length} (${pct(calRouted.length, cal.length)}); open licence known for ${calRouted.filter((r) => r.license).length}; by subject: ${count(calRouted, (r) => r.subject)}`);
console.log(`  missed damage in clear band (not routable): ${cal.filter((r) => r.damaged && r.zone === 'clear').map((r) => r.id + ':' + r.damage.toFixed(3)).join(' ')}`);
fs.writeFileSync('research/analysis/cal-routed.json', JSON.stringify(calRouted, null, 1) + '\n');
