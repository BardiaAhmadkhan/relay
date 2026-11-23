import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const out = path.resolve(process.argv[2]),
  semantic = process.argv[3] ? path.resolve(process.argv[3]) : null;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const protocolBytes = fs.readFileSync(path.join(out, 'protocol.json'));
const spec = JSON.parse(protocolBytes),
  src = JSON.parse(fs.readFileSync(path.join(out, 'sources.json'), 'utf8'));
if (src.protocolSha !== sha(protocolBytes)) throw Error('External acquisition and protocol differ');
const { prepareImages } = await import(pathToFileURL(path.resolve('server/images.ts')).href);
const sharp = createRequire(path.resolve('package.json'))('sharp');
if (semantic)
  fs.copyFileSync(
    path.join(semantic, 'weight-manifest.json'),
    path.join(out, 'weight-manifest.json'),
    fs.constants.COPYFILE_EXCL,
  );
const output = path.join(out, 'normalized');
fs.mkdirSync(output);
const cases = [];
async function emit(member, mode, input, extra = {}) {
  const id = member.id + '-' + mode,
    view = mode === 'region' ? 'detail' : (member.view ?? 'front');
  const jpeg = (await prepareImages([{ id, view, base64: input.toString('base64') }], 1600))
    .images[0].jpeg;
  fs.writeFileSync(path.join(output, id + '.jpg'), jpeg, { flag: 'wx' });
  cases.push({
    id,
    item: member.item,
    view,
    source: member.source,
    class: member.class,
    date: member.date ?? null,
    sharedDate: member.sharedDate ?? false,
    cohort: member.source + '_' + mode,
    mode,
    group: member.source === 'rise' ? member.item : member.date,
    sourceSha256: member.sourceSha256,
    normalizedSha256: sha(jpeg),
    ...extra,
  });
}
for (const m of src.members) {
  const bytes = fs.readFileSync(path.join(out, 'raw', m.id + '.jpg'));
  if (sha(bytes) !== m.sourceSha256) throw Error('Input changed ' + m.id);
  await emit(m, 'whole', bytes);
  if (m.source !== 'wargon') continue;
  const oriented = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = oriented.info;
  const [x, y, bw, bh] = m.box;
  const boxLong = Math.max(w * bw, h * bh),
    side = Math.min(w, h, Math.max(64, Math.ceil(3 * boxLong)));
  const left = Math.max(0, Math.min(w - side, Math.round(x * w - side / 2)));
  const top = Math.max(0, Math.min(h - side, Math.round(y * h - side / 2)));
  const chip = await sharp(oriented.data)
    .extract({ left, top, width: side, height: side })
    .resize(512, 512, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  await emit(m, 'region', chip, {
    nativeBoxLongPixels: boxLong,
    nativeCrop: { left, top, side },
    parentDimensions: [w, h],
  });
}
cases.sort((a, b) => sha(spec.salt + '/' + a.id).localeCompare(sha(spec.salt + '/' + b.id)));
const manifest = {
  createdUtc: new Date().toISOString(),
  protocolSha256: sha(protocolBytes),
  sourcesSha256: sha(fs.readFileSync(path.join(out, 'sources.json'))),
  cases,
};
fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
});
console.log(
  JSON.stringify({
    prepared: cases.length,
    annotatedPatchPairs: cases.filter((c) => c.source === 'wargon' && c.mode === 'region').length,
    sorterItems: new Set(cases.filter((c) => c.source === 'rise').map((c) => c.item)).size,
  }),
);
