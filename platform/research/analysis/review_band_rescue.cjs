// Claude, 2026-11-20. Read-only, in-sample check of a "review-band rescue" on the 223 labelled photos:
// v3.1's 1600 px damage band (max(break, slide) against packages/core/v2/thresholds.json), plus the
// contrastive `mark` question at 512 px from battery b3. A photo in the review band would be cleared
// only if mark's damage share (abrasion + broken, over the four judgeable options) is at or below t.
// Usage (from the repo root): node research/analysis/review_band_rescue.cjs
const fs = require('fs');

const jl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const b1 = jl('benchmarks/backend-v2/battery--b1--qwen3.5-4b--e1600.jsonl');
const b3 = new Map(jl('benchmarks/backend-v2/battery--b3--qwen3.5-4b--e512.jsonl').map((r) => [r.id, r]));
const thr = JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json', 'utf8'));
const find = (o) => (o && typeof o === 'object' ? ('clear' in o && 'block' in o ? o : Object.values(o).map(find).find(Boolean)) : null);
const band = find(thr);
console.log('v3.1 damage band (thresholds.json):', band.clear, band.block);

const rows = b1
  .filter((r) => r.condition === 'visible_defect' || r.condition === 'no_visible_defect')
  .map((r) => {
    const m = b3.get(r.id)?.probes?.mark?.p;
    const damage = Math.max(r.probes.break.p.yes, r.probes.slide.p.yes);
    const judged = m ? m.a + m.b + m.c + m.d : null;
    return {
      id: r.id,
      subject: r.subject,
      damaged: r.condition === 'visible_defect',
      damage,
      zone: damage < band.clear ? 'clear' : damage < band.block ? 'review' : 'block',
      markDamage: m ? (m.c + m.d) / judged : null,
      markUnsure: m ? m.e : null,
    };
  });
const n = (f) => rows.filter(f).length;
console.log(`photos ${rows.length} (damaged ${n((r) => r.damaged)}, clean ${n((r) => !r.damaged)}), missing mark ${n((r) => r.markDamage == null)}`);
for (const z of ['clear', 'review', 'block'])
  console.log(`  ${z.padEnd(6)} damaged ${n((r) => r.damaged && r.zone === z)}  clean ${n((r) => !r.damaged && r.zone === z)}`);

const inReview = rows.filter((r) => r.zone === 'review' && r.markDamage != null);
const dmg = inReview.filter((r) => r.damaged).map((r) => r.markDamage).sort((a, b) => a - b);
const cln = inReview.filter((r) => !r.damaged).map((r) => r.markDamage).sort((a, b) => a - b);
console.log('\nmark damage share in the review band');
console.log('  damaged:', dmg.map((v) => v.toFixed(3)).join(' '));
console.log('  clean:  ', cln.map((v) => v.toFixed(3)).join(' '));
console.log('\nrescue at t (clear a review-band photo if mark damage share <= t):');
for (const t of [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]) {
  const c = cln.filter((v) => v <= t).length;
  const d = dmg.filter((v) => v <= t).length;
  console.log(`  t=${t.toFixed(2)}  clean rescued ${c}/${cln.length}  damaged rescued ${d}/${dmg.length}`);
}
const lowestDamaged = dmg[0];
console.log(`\nlowest damaged share in band: ${lowestDamaged?.toFixed(3)}; clean below it: ${cln.filter((v) => v < lowestDamaged).length}/${cln.length}`);
