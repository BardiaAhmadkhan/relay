import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'assets', 'fixtures');
const definitions = [
  {
    id: 'leather-jacket',
    title: 'Customised Lewis Leathers Rockers.JPG',
    author: 'Timken Bearing',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    group: 'lewis-jacket-01',
    category: 'motorcycle_jacket',
    scoreCategory: true,
    notes: 'Source-described category only. Condition and crash history unknown.',
  },
  {
    id: 'armour-jacket',
    title: 'Herobiker motocross jacket DSCF2203.jpg',
    author: 'Mary Mark Ockerbloom / Science History Institute',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    group: 'herobiker-jacket-01',
    category: 'motorcycle_jacket',
    scoreCategory: true,
    notes:
      'Mannequin/display context. Credit Science History Institute. No protective performance ground truth.',
  },
  {
    id: 'gloves-back',
    title: 'Dainese racing gloves.jpg',
    author: 'lmnop88a (D Lee)',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    group: 'dainese-gloves-01',
    category: 'gloves',
    scoreCategory: true,
    notes: 'Same glove pair as gloves-palm; not an independent item.',
  },
  {
    id: 'gloves-palm',
    title: 'Dainese racing glove palms.jpg',
    author: 'lmnop88a (D Lee)',
    license: 'CC BY 2.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/2.0/',
    group: 'dainese-gloves-01',
    category: 'gloves',
    scoreCategory: true,
    notes: 'Same glove pair as gloves-back; not an independent item.',
  },
  {
    id: 'racing-boot',
    title: 'Motorcycle racing boot.jpeg',
    author: 'Caederus',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    group: 'sidi-boot-01',
    category: 'boots',
    scoreCategory: true,
    notes: 'Source-described category only; no condition conclusion.',
  },
  {
    id: 'mixed-gear',
    title: 'MotoEqipments HelmetBootsJacketAndGloves.jpg',
    author: 'サフィル',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    group: 'mixed-gear-01',
    category: 'multiple',
    scoreCategory: true,
    notes: 'Multiple distinct gear items. Abstention/mixed-item control.',
  },
  {
    id: 'crashed-shoulder',
    title: 'CrashedMotorcyclingRacingShoulderPanel.jpg',
    author: 'Thermos',
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    group: 'crashed-panel-01',
    category: 'unknown',
    scoreCategory: false,
    notes:
      'Partial protective shoulder panel. Crash history from uploader caption, not independently physically verified and not a blind visual label.',
    suppliedHistory: { crash: 'yes', source: 'uploader description' },
  },
  {
    id: 'backpack-label',
    title: 'Cordura - Ticket.JPG',
    author: 'MAx 92; contrast edit A7N8X',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    group: 'backpack-label-01',
    category: 'other',
    scoreCategory: false,
    preferThumbnail: true,
    notes:
      'Source describes a backpack material label. OCR/negative-domain control, not motorcycle certification.',
  },
] as const;
const hash = (buffer: Uint8Array, algorithm = 'sha256') =>
  createHash(algorithm).update(buffer).digest('hex');
function textValue(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&')
        .trim()
    : '';
}
async function main() {
  await fs.mkdir(path.join(output, 'originals'), { recursive: true });
  const manifestPath = path.join(output, 'manifest.json');
  if (!process.argv.includes('--refresh')) {
    try {
      const previous = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (previous.fixtures.length === definitions.length) {
        for (const fixture of previous.fixtures) {
          if (hash(await fs.readFile(path.join(root, fixture.file))) !== fixture.sha256)
            throw new Error('Fixture hash mismatch: ' + fixture.id);
          if (
            hash(await fs.readFile(path.join(root, fixture.original.file))) !==
            fixture.original.sha256
          )
            throw new Error('Original hash mismatch: ' + fixture.id);
        }
        console.log(
          'Existing licensed fixture manifest and all image hashes verified. Use --refresh for explicit source refresh.',
        );
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [key, value] of Object.entries({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo|revisions',
    iiprop: 'url|extmetadata|size|sha1',
    iiurlwidth: '960',
    rvprop: 'ids',
    titles: definitions.map((x) => 'File:' + x.title).join('|'),
  }))
    api.searchParams.set(key, value);
  const response = await fetch(api, {
    headers: { 'User-Agent': 'GearRecognitionLab/0.1 (small licensed-image evaluation)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Commons metadata HTTP ' + response.status);
  const metadata = (await response.json()) as {
    query?: {
      pages: Array<{
        title: string;
        revisions?: Array<{ revid: number }>;
        imageinfo?: Array<{
          url: string;
          thumburl?: string;
          thumbwidth?: number;
          thumbheight?: number;
          sha1: string;
          size: number;
          width: number;
          height: number;
          extmetadata: Record<string, { value: unknown }>;
        }>;
      }>;
    };
  };
  if (!metadata.query?.pages) throw new Error('Missing Commons metadata');
  const fixtures = [];
  for (const definition of definitions) {
    const page = metadata.query.pages.find((page) => page.title === 'File:' + definition.title);
    const info = page?.imageinfo?.[0];
    if (!info || !page) throw new Error('Missing source image ' + definition.id);
    const permission =
      String(info.extmetadata.Permission?.value ?? '') +
      ' ' +
      String(info.extmetadata.LicenseUrl?.value ?? '');
    const licenseKey = definition.licenseUrl.replace(/^https?:/, '').replace(/\/$/, '');
    if (!permission.replaceAll('&amp;', '&').includes(licenseKey))
      throw new Error('Chosen license not present in source metadata: ' + definition.id);
    const thumbnail = 'preferThumbnail' in definition && definition.preferThumbnail;
    const imageUrl = new URL(thumbnail && info.thumburl ? info.thumburl : info.url);
    if (thumbnail && !info.thumburl) throw new Error('Requested thumbnail metadata unavailable');
    if (
      imageUrl.protocol !== 'https:' ||
      !['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(imageUrl.hostname)
    )
      throw new Error('Unexpected source host');
    imageUrl.search = '';
    const originalFile = 'assets/fixtures/originals/' + definition.id + '.jpg';
    let bytes: Uint8Array | undefined;
    try {
      const existing = await fs.readFile(path.join(root, originalFile));
      if (!thumbnail && hash(existing, 'sha1') === info.sha1) bytes = existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!bytes) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await delay(1500);
        const imageResponse = await fetch(imageUrl, {
          headers: {
            'User-Agent':
              'GearRecognitionLab/0.1 (small licensed-image evaluation; Windows Node.js)',
          },
          signal: AbortSignal.timeout(30000),
        });
        if (imageResponse.ok) {
          bytes = new Uint8Array(await imageResponse.arrayBuffer());
          break;
        }
        if (imageResponse.status !== 429 && imageResponse.status < 500)
          throw new Error('Fixture ' + definition.id + ' HTTP ' + imageResponse.status);
        const retryAfter = Number(imageResponse.headers.get('retry-after'));
        if (retryAfter > 30)
          throw new Error(
            'Source requests a longer retry delay (' +
              retryAfter +
              's); stop instead of retrying early: ' +
              definition.id,
          );
        await delay(Math.max(3000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0));
      }
    }
    if (!bytes) throw new Error('Fixture download exhausted bounded retries: ' + definition.id);
    if (bytes.length > 30_000_000 || (!thumbnail && bytes.length !== info.size))
      throw new Error('Fixture size mismatch');
    if (!thumbnail && hash(bytes, 'sha1') !== info.sha1)
      throw new Error('Fixture source SHA1 mismatch');
    await fs.writeFile(path.join(root, originalFile), bytes);
    const derivative = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .jpeg({ quality: 88 })
      .toBuffer();
    const file = 'assets/fixtures/' + definition.id + '.jpg';
    await fs.writeFile(path.join(root, file), derivative);
    const dimensions = await sharp(derivative).metadata();
    fixtures.push({
      ...definition,
      file,
      sha256: hash(derivative),
      bytes: derivative.length,
      width: dimensions.width,
      height: dimensions.height,
      sourceUrl:
        'https://commons.wikimedia.org/wiki/File:' +
        encodeURIComponent(definition.title.replaceAll(' ', '_')),
      sourceRevision: page.revisions?.[0]?.revid ?? null,
      downloadedFrom: imageUrl.toString(),
      sourceRetrievedAt: new Date().toISOString(),
      licenseEvidence: {
        shortName: textValue(info.extmetadata.LicenseShortName?.value),
        url: textValue(info.extmetadata.LicenseUrl?.value),
        artist: textValue(info.extmetadata.Artist?.value),
      },
      transformation:
        'EXIF orientation applied; sRGB JPEG quality 88; longest edge at most 960px; metadata stripped; no upscaling. Adapted images retain chosen source license.',
      original: {
        file: originalFile,
        representation: thumbnail
          ? 'Commons 960px thumbnail, not uploader original'
          : 'uploader original',
        sha256: hash(bytes),
        sha1: hash(bytes, 'sha1'),
        sourceSha1Verified: !thumbnail,
        bytes: bytes.length,
        width: thumbnail ? info.thumbwidth : info.width,
        height: thumbnail ? info.thumbheight : info.height,
      },
      sourceOriginal: {
        downloaded: !thumbnail,
        url: info.url,
        sha1: info.sha1,
        bytes: info.size,
        width: info.width,
        height: info.height,
      },
      retrievalNote: thumbnail
        ? 'Original returned HTTP 429 with a 600-second retry; server explicitly suggested standard thumbnails. The allowed 960px thumbnail was used and independently hashed.'
        : 'Downloaded original and verified against source metadata SHA1.',
    });
    console.log(definition.id + ': ' + bytes.length + ' -> ' + derivative.length + ' bytes');
  }
  const manifest = {
    schemaVersion: '1.0',
    createdAt: new Date().toISOString(),
    purpose:
      'Small public convenience corpus for pretrained inference smoke evaluation, not training or safety validation.',
    conditionGroundTruth:
      'Unavailable. Only crashed-shoulder has source-caption crash history recorded separately.',
    fixtures,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  const attribution = [
    '# Fixture attribution and reuse',
    '',
    'These images are licensed individually. The application source license does not replace their licenses. Downloaded source bytes and resized derivatives are retained. Seven sources are verified uploader originals; backpack-label uses the clearly identified Commons 960px thumbnail after the original was rate-limited. Authors do not endorse this application.',
    '',
    ...fixtures.flatMap((f) => [
      '## ' + f.id,
      '',
      f.title +
        ' — ' +
        f.author +
        '. [' +
        f.license +
        '](' +
        f.licenseUrl +
        '). [Source](' +
        f.sourceUrl +
        '). Source page revision: ' +
        f.sourceRevision +
        '.',
      '',
      f.transformation,
      '',
      f.notes,
      '',
    ]),
  ].join('\n');
  await fs.writeFile(path.join(output, 'ATTRIBUTION.md'), attribution);
  console.log(
    'Wrote ' +
      fixtures.length +
      ' fixtures; ' +
      new Set(fixtures.map((f) => f.group)).size +
      ' item groups.',
  );
}
await main();
