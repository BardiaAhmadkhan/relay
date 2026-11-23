// Test the role on which the attention-only edit improved in study 2. Images were selected earlier;
// the 224 whole views and their attention-only outputs had not been scored in studies 3 or 4.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [branch, third, fourth, out] = process.argv.slice(2).map((x) => path.resolve(x));
const { prepareImages } = await import(pathToFileURL(path.resolve('server/images.ts')).href);
const hash = (b) => createHash('sha256').update(b).digest('hex');
fs.mkdirSync(out);
const spec = {
  ...JSON.parse(fs.readFileSync(path.join(branch, 'protocol.json'))),
  version: 'relay-whole-attention-role-06',
  salt: 'relay-unseen-whole-role-06',
  arms: { base: 0, attention: 0.5 },
  discovery:
    'The attention-only 2B intervention improved whole-frame AUC from 0.7295 to 0.7842 in study two, but region ranking fell. Preserve stock for all marked chips and use the learned intervention only for whole-image search. The two sets below had only marked-crop outcomes in prior studies.',
  primary:
    'Compare unchanged and attention-only 2B on the previously unscored whole views of all original items from rounds 3 and 4. No new fitting, feature selection or cutoff adjustment. Require positive whole-item ranking in each original set, pooled paired bootstrap 95% lower bound above zero (5000, seed 11807), no additional missed holes and no new spot alarms at 0.5. Stock remains the sole scored model on marked chips by construction. Whole-frame archive membership is imperfect ground truth. A pass only authorizes testing the corresponding method on 4B, never deployment.',
};
const pb = Buffer.from(JSON.stringify(spec, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'protocol.json'), pb);
const w = JSON.parse(fs.readFileSync(path.join(branch, 'weight-manifest.json')));
w.arms = { base: w.arms.base, attention: w.arms.attention };
w.protocolSha256 = hash(pb);
fs.writeFileSync(path.join(out, 'weight-manifest.json'), JSON.stringify(w, null, 2) + '\n');
fs.mkdirSync(path.join(out, 'normalized'));
const cases = [];
for (const [cohort, dir] of [
  ['third', third],
  ['fourth', fourth],
])
  for (const m of JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'))).members) {
    const bytes = fs.readFileSync(path.join(dir, 'raw', m.id + '.jpg'));
    if (hash(bytes) !== m.sourceSha256) throw Error('Source changed');
    const id = m.id + '-whole';
    const jpeg = (
      await prepareImages([{ id, view: 'front', base64: bytes.toString('base64') }], 1600)
    ).images[0].jpeg;
    fs.writeFileSync(path.join(out, 'normalized', id + '.jpg'), jpeg, { flag: 'wx' });
    cases.push({
      id,
      item: m.item,
      class: m.class,
      date: m.date,
      source: 'wargon',
      view: 'front',
      cohort: 'wargon_whole',
      transferSet: cohort,
      mode: 'whole',
      sourceSha256: m.sourceSha256,
      normalizedSha256: hash(jpeg),
    });
  }
if (cases.length !== 224 || new Set(cases.map((c) => c.item)).size !== 224)
  throw Error('Unexpected cohort');
cases.sort((a, b) => hash(spec.salt + '/' + a.id).localeCompare(hash(spec.salt + '/' + b.id)));
fs.writeFileSync(
  path.join(out, 'cases.json'),
  JSON.stringify({ protocolSha256: hash(pb), cases }, null, 2) + '\n',
);
console.log(cases.length + ' fresh whole views');
