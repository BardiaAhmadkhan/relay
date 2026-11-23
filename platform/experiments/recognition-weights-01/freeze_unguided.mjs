import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.argv[2]),
  source = path.resolve(process.argv[3]),
  semantic = path.resolve(process.argv[4]);
const p = JSON.parse(fs.readFileSync(path.join(out, 'proposal-list.json'))),
  meta = JSON.parse(fs.readFileSync(path.join(source, 'sources.json'))).members;
const incoming = fs.readFileSync(new URL('unguided-protocol.json', import.meta.url)),
  sha = (b) => createHash('sha256').update(b).digest('hex');
if (sha(incoming) !== p.protocolSha) throw Error('Changed proposal protocol');
const control = JSON.parse(incoming);
const base = JSON.parse(fs.readFileSync(path.join(semantic, 'protocol.json')));
const runtime = {
  ...control,
  studyType: 'unguided',
  arms: { base: 1 },
  parameters: base.parameters,
  salt: 'relay-region-end-to-end-01',
};
const proto = JSON.stringify(runtime, null, 2) + '\n';
fs.writeFileSync(path.join(out, 'protocol.json'), proto, { flag: 'wx' });
const weights = JSON.parse(fs.readFileSync(path.join(semantic, 'weight-manifest.json')));
weights.arms = { base: weights.arms.base };
fs.writeFileSync(path.join(out, 'weight-manifest.json'), JSON.stringify(weights, null, 2) + '\n', {
  flag: 'wx',
});
const sharp = createRequire(path.resolve('package.json'))('sharp');
const { prepareImages } = await import(pathToFileURL(path.resolve('server/images.ts')).href);
const orig = JSON.parse(fs.readFileSync(path.join(source, 'cases.json'))).cases;
const cases = [],
  folder = path.join(out, 'normalized');
fs.mkdirSync(folder);
for (const row of p.rows) {
  const m = meta.find((m) => m.item === row.item),
    bytes = fs.readFileSync(path.join(source, 'raw', m.id + '.jpg'));
  if (sha(bytes) !== m.sourceSha256) throw Error('Source drift');
  const oriented = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = oriented.info;
  const [x, y, bw, bh] = row.box,
    side = Math.min(w, h, Math.max(64, Math.ceil(3 * Math.max(w * bw, h * bh))));
  for (const mode of ['whole', 'oracle', 'proposed', 'centered']) {
    const id = m.id + '-' + mode;
    let jpeg,
      geometry = null,
      containsMarkCenter = null;
    if (mode === 'whole' || mode === 'oracle') {
      const o = orig.find(
        (c) => c.item === m.item && c.mode === (mode === 'whole' ? 'whole' : 'region'),
      );
      jpeg = fs.readFileSync(path.join(source, 'normalized', o.id + '.jpg'));
      if (sha(jpeg) !== o.normalizedSha256) throw Error('Reference rendition drift');
      if (mode === 'oracle') geometry = o.nativeCrop;
    } else {
      const cx = mode === 'centered' ? 0.5 : x,
        cy = mode === 'centered' ? 0.5 : y;
      const left = Math.max(0, Math.min(w - side, Math.round(cx * w - side / 2))),
        top = Math.max(0, Math.min(h - side, Math.round(cy * h - side / 2)));
      const chip = await sharp(oriented.data)
        .extract({ left, top, width: side, height: side })
        .resize(512, 512, { kernel: 'lanczos3' })
        .png()
        .toBuffer();
      jpeg = (await prepareImages([{ id, view: 'detail', base64: chip.toString('base64') }], 1600))
        .images[0].jpeg;
      geometry = { left, top, side };
      const [mx, my] = m.box;
      containsMarkCenter =
        left <= mx * w && mx * w <= left + side && top <= my * h && my * h <= top + side;
    }
    fs.writeFileSync(path.join(folder, id + '.jpg'), jpeg, { flag: 'wx' });
    cases.push({
      id,
      item: m.item,
      class: m.class,
      mode,
      view: mode === 'whole' ? 'front' : 'detail',
      cohort: 'unaided_region',
      group: m.date,
      sourceSha256: m.sourceSha256,
      normalizedSha256: sha(jpeg),
      geometry,
      containsMarkCenter,
    });
  }
}
cases.sort((a, b) => sha(runtime.salt + a.id).localeCompare(sha(runtime.salt + b.id)));
fs.writeFileSync(
  path.join(out, 'cases.json'),
  JSON.stringify({ protocolSha256: sha(Buffer.from(proto)), cases }, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(cases.length, 'frozen views');
