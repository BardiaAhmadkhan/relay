import fs from 'node:fs';
import path from 'node:path';
import { authentic } from '../../server/v4/seal';
const mode = process.argv[2],
  key = process.env.RELAY_SIGNING_KEY;
if (!mode || !/^[a-z0-9-]{1,48}$/.test(mode) || !key)
  throw Error('Provide a lowercase rehearsal ID and local signing key.');
const parent = path.resolve('.local/inspection'),
  source = path.join(parent, 'items');
const dest = path.join(parent, 'v4-private-rehearsals', mode, 'items');
if (fs.existsSync(dest)) throw Error('Use a new rehearsal ID; existing records stay intact.');
fs.mkdirSync(source, { recursive: true });
fs.mkdirSync(dest, { recursive: true });
for (const id of fs
  .readdirSync(source)
  .filter((n) => /^[A-Za-z0-9_-]{1,80}$/.test(n) && fs.existsSync(path.join(source,n,'inspection.json')))
  .sort()) {
  const from = path.join(source, id),
    to = path.join(dest, id),
    receipt = JSON.parse(fs.readFileSync(path.join(from, 'inspection.json'), 'utf8'));
  if (!authentic(receipt, 'inspection', key)) throw Error('Invalid source receipt.');
  fs.mkdirSync(to);
  for (const f of [
    'input.json',
    'inspection.json',
    'foundation.json',
    'clearly-labelled-scenarios.json',
    'economics.json',
    'run.json',
  ])
    fs.copyFileSync(path.join(from, f), path.join(to, f));
  fs.cpSync(path.join(from, 'photos'), path.join(to, 'photos'), { recursive: true });
  const display = path.join(from, 'zone-display.json');
  if (fs.existsSync(display)) fs.copyFileSync(display, path.join(to, 'zone-display.json'));
  const regions = path.join(from, 'regions');
  if (fs.existsSync(regions)) fs.cpSync(regions, path.join(to, 'regions'), { recursive: true });
}
console.log(
  'Private rehearsal data: ' +
    dest +
    ' (' +
    fs.readdirSync(dest).length +
    ' signed inspection records).',
);
