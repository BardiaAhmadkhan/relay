// Claude, 2026-11-20. Builds the D-007 blind labelling kit from E19's held-out photos.
// Scope: intake-style framings (item, worn, detail): clean photos in the review or block band,
// damaged and ambiguous photos, and a framing-matched random sample of clean photos in the clear band.
// Outputs:
//   .cache/collab-labelling/round-1/images/<rid>.jpg  anonymised copies, metadata stripped (git-ignored)
//   .cache/collab-labelling/round-1/key.json          rid -> original id and group. DO NOT OPEN until both sheets are in.
//   collab/labelling/round-1/sheet-template.csv       one row per rid, sorted by rid
// Prints counts only, never ids. Refuses to overwrite an existing kit.
// Usage (from the repo root): node research/analysis/make_label_kit.cjs
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const kitDir = '.cache/collab-labelling/round-1';
const sheetDir = 'collab/labelling/round-1';
if (fs.existsSync(path.join(kitDir, 'key.json'))) throw new Error('A kit already exists; not overwriting it.');

const rows = fs
  .readFileSync('benchmarks/backend-v2/realworld--v3.jsonl', 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const labels = JSON.parse(fs.readFileSync('datasets/realworld-v3/labels.json', 'utf8'));
const byId = new Map(labels.cases.map((c) => [c.id, c]));
const intake = new Set(['item', 'worn', 'detail']);
const pool = rows.filter((r) => !byId.get(r.id)?.seenInCalibration && intake.has(r.framing));

const groups = {
  clean_in_band: pool.filter((r) => r.condition === 'clean' && r.band && r.band !== 'clear'),
  damaged: pool.filter((r) => r.condition === 'damaged'),
  ambiguous: pool.filter((r) => r.condition === 'ambiguous'),
};
// Framing-matched sample of clean photos in the clear band, same count per framing as clean_in_band.
const clear = pool.filter((r) => r.condition === 'clean' && r.band === 'clear');
const sample = [];
for (const f of intake) {
  const need = groups.clean_in_band.filter((r) => r.framing === f).length;
  const candidates = clear.filter((r) => r.framing === f);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  sample.push(...candidates.slice(0, need));
}
groups.clean_clear_sample = sample;

(async () => {
  fs.mkdirSync(path.join(kitDir, 'images'), { recursive: true });
  fs.mkdirSync(sheetDir, { recursive: true });
  const key = {};
  const used = new Set();
  for (const [group, list] of Object.entries(groups)) {
    for (const r of list) {
      let rid;
      do rid = 'L' + crypto.randomBytes(3).toString('hex');
      while (used.has(rid));
      used.add(rid);
      const src = byId.get(r.id).file;
      await sharp(src)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toFile(path.join(kitDir, 'images', rid + '.jpg'));
      key[rid] = { id: r.id, group };
    }
  }
  fs.writeFileSync(path.join(kitDir, 'key.json'), JSON.stringify(key, null, 2) + '\n');
  const header = 'rid,structural_damage,abrasion_beyond_wear,repair,ordinary_wear_only,item_count,note';
  const lines = Object.keys(key).sort().map((rid) => `${rid},,,,,,`);
  fs.writeFileSync(path.join(sheetDir, 'sheet-template.csv'), [header, ...lines].join('\n') + '\n');
  for (const [g, list] of Object.entries(groups)) console.log(g, list.length);
  console.log('total', Object.keys(key).length);
})();
