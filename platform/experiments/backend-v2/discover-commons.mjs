// Discover candidate in-domain photographs on Wikimedia Commons (metadata only; no downloads).
// node experiments/backend-v2/discover-commons.mjs > benchmarks/backend-v2/gear-v2-candidates.json
// A descriptive User-Agent without personal details is sent, per Wikimedia API etiquette.
const queries = [
  'crashed motorcycle helmet',
  'motorcycle helmet crash damage',
  'damaged motorcycle helmet',
  'motorcycle leathers crash',
  'crashed motorcycle leathers',
  'motorcycle jacket crash damage',
  'motorcycle suit crash damage',
  'road rash motorcycle jacket',
  'motorcycle glove damage crash',
  'motorcycle boot crash damage',
  'racing leathers after crash',
  'motorcycle racing suit scuffed',
  'worn motorcycle gloves',
  'used motorcycle boots',
  'motorcycle armour protector',
  'motorcycle back protector',
  'motorcycle jacket label CE',
  'motorcycle helmet label ECE',
  'motorcycle textile jacket',
  'motorcycle trousers knee',
  'motorcycle riding jeans',
  'kevlar jeans motorcycle',
  'motorcycle gloves',
  'motorcycle boots',
  'full face motorcycle helmet',
  'motorcycle helmet scratched',
  'helmet after accident',
  'motorcycle leather suit',
  'airbag vest motorcycle',
  'knee slider worn',
];
const seen = new Map();
for (const q of queries) {
  const url =
    'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=40&gsrsearch=' +
    encodeURIComponent(q + ' filetype:bitmap') +
    '&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=1280';
  const response = await fetch(url, {
    headers: { 'User-Agent': 'gear-eval-research/0.1 (local evaluation corpus; no contact published)' },
  });
  if (!response.ok) {
    console.error('failed', q, response.status);
    continue;
  }
  const pages = Object.values((await response.json()).query?.pages ?? {});
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !/jpeg|png|webp/.test(info.mime ?? '') || info.width < 500 || info.height < 400) continue;
    const meta = info.extmetadata ?? {};
    const license = meta.LicenseShortName?.value ?? '';
    if (!/^(CC BY|CC0|Public domain|CC BY-SA)/i.test(license)) continue;
    if (!seen.has(p.pageid))
      seen.set(p.pageid, {
        pageId: p.pageid,
        title: p.title,
        queries: [q],
        width: info.width,
        height: info.height,
        thumb: info.thumburl,
        page: info.descriptionurl,
        license,
        licenseUrl: meta.LicenseUrl?.value ?? null,
        author: (meta.Artist?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 120),
        description: (meta.ImageDescription?.value ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 240),
      });
    else seen.get(p.pageid).queries.push(q);
  }
  await new Promise((r) => setTimeout(r, 400));
}
console.log(JSON.stringify([...seen.values()], null, 1));
