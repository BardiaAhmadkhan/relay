// Claude, 2026-11-20. Compares the two D-007 label sheets once BOTH are in, then opens the key.
// Prints agreement per field, every disagreement with its original id and group, and what the
// agreed labels say about each group (for example, clean-in-band photos both labellers call damaged).
// Usage (from the repo root): node research/analysis/compare_labels.cjs
const fs = require('fs');

const dir = 'collab/labelling/round-1';
const read = (name) => {
  const text = fs.readFileSync(`${dir}/${name}.csv`, 'utf8').trim().split(/\r?\n/);
  const head = text[0].split(',');
  const rows = new Map();
  for (const line of text.slice(1)) {
    const cells = line.split(',');
    // Values are compared case-insensitively; the rid keeps its case to match the key.
    const row = Object.fromEntries(
      head.map((h, i) => [h, h === 'rid' ? (cells[i] ?? '').trim() : (cells[i] ?? '').trim().toLowerCase()]),
    );
    rows.set(row.rid, row);
  }
  return rows;
};
for (const name of ['claude', 'astra'])
  if (!fs.existsSync(`${dir}/${name}.csv`)) throw new Error(`${name}.csv is not in yet; the key stays closed.`);
const a = read('claude');
const b = read('astra');
const key = JSON.parse(fs.readFileSync('.cache/collab-labelling/round-1/key.json', 'utf8'));
const rids = Object.keys(key).sort();
const missing = rids.filter((r) => !a.has(r) || !b.has(r));
if (missing.length) throw new Error('Rows missing from a sheet: ' + missing.join(' '));

const fields = ['structural_damage', 'abrasion_beyond_wear', 'repair', 'ordinary_wear_only', 'item_count'];
console.log('Agreement per field:');
for (const f of fields) {
  const same = rids.filter((r) => a.get(r)[f] === b.get(r)[f]).length;
  console.log(`  ${f.padEnd(22)} ${same}/${rids.length}`);
}

console.log('\nDisagreements (claude | astra):');
for (const r of rids) {
  const diff = fields.filter((f) => a.get(r)[f] !== b.get(r)[f]);
  if (!diff.length) continue;
  const k = key[r];
  console.log(`  ${r} ${k.id} [${k.group}] ` + diff.map((f) => `${f}: ${a.get(r)[f]} | ${b.get(r)[f]}`).join('; '));
  console.log(`      notes: ${a.get(r).note || '-'} | ${b.get(r).note || '-'}`);
}

const harm = (row) => ['structural_damage', 'abrasion_beyond_wear', 'repair'].some((f) => row[f] === 'yes');
const bothHarm = (r) => harm(a.get(r)) && harm(b.get(r));
const bothWearOnly = (r) => a.get(r).ordinary_wear_only === 'yes' && b.get(r).ordinary_wear_only === 'yes';
console.log('\nAgreed reading per group:');
const groups = [...new Set(Object.values(key).map((k) => k.group))];
for (const g of groups) {
  const list = rids.filter((r) => key[r].group === g);
  const harmIds = list.filter(bothHarm).map((r) => key[r].id);
  console.log(`  ${g.padEnd(20)} n=${list.length}  both see damage, abrasion or repair: ${harmIds.length}` +
    `  both say ordinary wear only: ${list.filter(bothWearOnly).length}` + (harmIds.length ? `  [${harmIds.join(' ')}]` : ''));
}
const expert = rids.filter((r) => fields.slice(0, 4).some((f) => a.get(r)[f] !== b.get(r)[f] || (a.get(r)[f] === 'unsure' && b.get(r)[f] === 'unsure')));
console.log(`\nShop-expert list (any disagreement or shared "unsure" on condition): ${expert.length}`);
console.log('  ' + expert.map((r) => `${r}=${key[r].id}`).join(' '));
