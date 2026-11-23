// Claude, 2026-11-20. Scores the D-012 design-set API runs against the pre-registered model-choice rule.
// Usage (from the repo root): node research/analysis/score_fallback_design.cjs gpt-6.1-terra gpt-6.2-sol
const fs = require('fs');
const jl = (p) => fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const design = new Map(JSON.parse(fs.readFileSync('research/analysis/fallback-design.json', 'utf8')).items.map((x) => [x.id, x]));
const countLabels = JSON.parse(fs.readFileSync('research/analysis/design-count-labels.json', 'utf8')).labels;
const PRICE = { 'gpt-6.1-terra': [1, 5], 'gpt-6.2-sol': [2, 10] }; // USD per 1M input/output tokens (OpenAI models page)
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const confidentClear = (l) => l.ordinary_wear_only === 'yes' && l.structural_damage === 'no' && l.abrasion_beyond_wear === 'no' && l.repair === 'no';
const seesHarm = (l) => ['structural_damage', 'abrasion_beyond_wear', 'repair'].some((k) => l[k] === 'yes');

for (const model of process.argv.slice(2)) {
  const file = `research/analysis/fallback-results/design--${model}.jsonl`;
  if (!fs.existsSync(file)) { console.log(model, 'no results'); continue; }
  const rows = jl(file).filter((r) => r.rep === 0);
  const ok = rows.filter((r) => r.ok);
  const by = new Map(ok.map((r) => [r.id, r]));
  const items = [...design.values()].filter((d) => by.has(d.id));
  const dmg = items.filter((d) => d.damaged), cln = items.filter((d) => !d.damaged);
  const dmgClear = dmg.filter((d) => confidentClear(by.get(d.id).labels));
  const dmgReview = dmg.filter((d) => d.zone === 'review');
  const clnReview = cln.filter((d) => d.zone === 'review');
  console.log(`\n== ${model}: ${ok.length}/${rows.length} ok; latency median ${Math.round(q(ok.map((r) => r.ms), 0.5))} ms, p95 ${Math.round(q(ok.map((r) => r.ms), 0.95))} ms`);
  const tin = ok.reduce((n, r) => n + (r.usage?.in || 0), 0), tout = ok.reduce((n, r) => n + (r.usage?.out || 0), 0);
  const [pi, po] = PRICE[model] || [NaN, NaN];
  console.log(`  tokens in ${tin} out ${tout}; est cost $${((tin * pi + tout * po) / 1e6).toFixed(3)} (~$${((tin * pi + tout * po) / 1e6 / ok.length).toFixed(4)} per call)`);
  console.log(`  1) damaged photos confidently cleared: ${dmgClear.length}/${dmg.length} [${dmgClear.map((d) => d.id + ':' + d.zone).join(' ')}]`);
  console.log(`     of which in the review band: ${dmgClear.filter((d) => d.zone === 'review').length}/${dmgReview.length}`);
  console.log(`     damaged photos where it sees damage, abrasion or repair: ${dmg.filter((d) => seesHarm(by.get(d.id).labels)).length}/${dmg.length}`);
  console.log(`     review-band damaged detail: ${dmgReview.map((d) => d.id + '=' + JSON.stringify(by.get(d.id).labels)).join(' | ')}`);
  console.log(`  clean review-band photos confidently cleared (R1 benefit): ${clnReview.filter((d) => confidentClear(by.get(d.id).labels)).length}/${clnReview.length}; seen as harm: ${clnReview.filter((d) => seesHarm(by.get(d.id).labels)).length}`);
  let right = 0, scored = 0;
  const detail = [];
  for (const [id, truth] of Object.entries(countLabels)) {
    if (truth === 'unsure' || !by.has(id)) continue;
    scored++;
    const got = by.get(id).labels.item_count;
    if (got === truth) right++;
    else detail.push(`${id}: ${got} (truth ${truth})`);
  }
  console.log(`  2) count correct on design count photos: ${right}/${scored}${detail.length ? ' | wrong: ' + detail.join('; ') : ''}`);
  console.log(`  3) failed or unparsed calls: ${rows.length - ok.length}`);
  console.log(`  "unsure" rate on ordinary_wear_only: ${ok.filter((r) => r.labels.ordinary_wear_only === 'unsure').length}/${ok.length}`);
}
