import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.argv[2]);
const sharp = createRequire(path.resolve('package.json'))('sharp');
const { prepareImages } = await import(pathToFileURL(path.resolve('server/images.ts')).href);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceBytes = fs.readFileSync(path.join(out, 'sources.json'));
const src = JSON.parse(sourceBytes),
  protocol = fs.readFileSync(path.join(out, 'protocol.json'));
if (src.protocolSha !== hash(protocol)) throw Error('Protocol mismatch');
const cases = [];
fs.mkdirSync(path.join(out, 'normalized'));
for (const m of src.members) {
  const bytes = fs.readFileSync(path.join(out, 'raw', m.id + '.jpg'));
  if (hash(bytes) !== m.sourceSha256) throw Error('Changed source');
  const oriented = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = oriented.info;
  const [x, y, bw, bh] = m.box,
    side = Math.min(w, h, Math.max(64, Math.ceil(3 * Math.max(w * bw, h * bh))));
  const top = Math.max(0, Math.min(h - side, Math.round(y * h - side / 2)));
  const sign = parseInt(hash(m.item).slice(0, 2), 16) % 2 === 0 ? 1 : -1;
  for (const [mode, offset] of [
    ['centre', 0],
    ['shift', (sign * side) / 4],
  ]) {
    const left = Math.max(0, Math.min(w - side, Math.round(x * w + offset - side / 2)));
    const chip = await sharp(oriented.data)
      .extract({ left, top, width: side, height: side })
      .resize(512, 512, { kernel: 'lanczos3' })
      .png()
      .toBuffer();
    const id = m.id + '-' + mode;
    const jpeg = (
      await prepareImages([{ id, view: 'detail', base64: chip.toString('base64') }], 1600)
    ).images[0].jpeg;
    fs.writeFileSync(path.join(out, 'normalized', id + '.jpg'), jpeg, { flag: 'wx' });
    cases.push({
      id,
      item: m.item,
      class: m.class,
      partition: m.partition,
      cohort: 'wargon_region',
      mode,
      view: 'detail',
      nativeCrop: { left, top, side },
      parentDimensions: [w, h],
      normalizedSha256: hash(jpeg),
    });
  }
}
const spec = JSON.parse(protocol);
cases.sort((a, b) => hash(spec.salt + '/' + a.id).localeCompare(hash(spec.salt + '/' + b.id)));
fs.writeFileSync(
  path.join(out, 'cases.json'),
  JSON.stringify(
    { protocolSha256: hash(protocol), sourcesSha256: hash(sourceBytes), cases },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(cases.length + ' normalized cases');
