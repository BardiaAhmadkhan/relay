import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { prepareImages } from '../../server/images';
import { analyzePixels } from '../../packages/core/quality';
import { analyzePixels as baselineAnalyzePixels } from './quality-baseline';
import { validateOpaquePixels } from './quality-metrics';

const root = resolve(import.meta.dirname, '../..'),
  out = resolve(root, 'benchmarks/round-02/quality');
const artifactDir = resolve(root, 'experiments/round-02/quality/probes');
await mkdir(artifactDir, { recursive: true });
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const report: Record<string, unknown> = {
  schemaVersion: '1.0',
  createdAt: new Date().toISOString(),
  nativeExecution: false,
  networkCalls: 0,
};
const w = 600,
  h = 480;
const base = Buffer.alloc(w * h * 4);
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    base[i] = Math.floor(x / 17) % 2 ? 195 : 55;
    base[i + 1] = Math.floor(y / 19) % 2 ? 155 : 75;
    base[i + 2] = ((x + 2 * y) % 200) + 20;
    base[i + 3] = 255;
  }
async function input(bytes: Buffer, id = 'probe') {
  return await prepareImages([{ id, view: 'front', base64: bytes.toString('base64') }]);
}
async function duplicateCode(a: Buffer, b: Buffer) {
  try {
    await prepareImages([
      { id: 'a', view: 'front', base64: a.toString('base64') },
      { id: 'b', view: 'back', base64: b.toString('base64') },
    ]);
    return 'accepted';
  } catch (error) {
    return String((error as { code?: string }).code ?? (error as Error).message);
  }
}
function orient(orientation: number) {
  const swap = orientation >= 5,
    width = swap ? h : w,
    height = swap ? w : h;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sx = x,
        sy = y;
      if (orientation === 2) sx = w - 1 - x;
      if (orientation === 3) {
        sx = w - 1 - x;
        sy = h - 1 - y;
      }
      if (orientation === 4) sy = h - 1 - y;
      if (orientation === 5) {
        sx = y;
        sy = x;
      }
      if (orientation === 6) {
        sx = y;
        sy = h - 1 - x;
      }
      if (orientation === 7) {
        sx = w - 1 - y;
        sy = h - 1 - x;
      }
      if (orientation === 8) {
        sx = w - 1 - y;
        sy = x;
      }
      base.copy(data, (y * width + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  return { data, width, height };
}
const orientationResults = [];
for (let orientation = 1; orientation <= 8; orientation++) {
  const tagged = await sharp(base, { raw: { width: w, height: h, channels: 4 } })
    .withMetadata({ orientation })
    .png()
    .toBuffer();
  const expected = orient(orientation);
  const pixels = await sharp(expected.data, {
    raw: { width: expected.width, height: expected.height, channels: 4 },
  })
    .png()
    .toBuffer();
  const actual = await input(tagged),
    canonical = await input(pixels);
  const metadata = await sharp(actual.images[0]!.jpeg).metadata();
  orientationResults.push({
    orientation,
    inputTag: (await sharp(tagged).metadata()).orientation,
    expectedWidth: expected.width,
    expectedHeight: expected.height,
    actualWidth: metadata.width,
    actualHeight: metadata.height,
    equivalentNormalizedHash: actual.photos[0]!.sha256 === canonical.photos[0]!.sha256,
    duplicateResult: await duplicateCode(tagged, pixels),
    exifRemoved: !metadata.exif,
  });
}
report.orientation = orientationResults;
const canonicalPng = await sharp(base, { raw: { width: w, height: h, channels: 4 } })
  .png()
  .toBuffer();
const recompressed = await sharp(canonicalPng).jpeg({ quality: 70 }).toBuffer();
report.duplicate = {
  exactCopy: await duplicateCode(canonicalPng, canonicalPng),
  sameSceneLossyRecompression: await duplicateCode(canonicalPng, recompressed),
  scope: 'Exact normalized hashing is not perceptual duplicate detection.',
};
const invalidInputs = [
  Buffer.from('not an image'),
  canonicalPng.subarray(0, Math.floor(canonicalPng.length / 2)),
];
report.corruptInputs = await Promise.all(
  invalidInputs.map(async (bytes, index) => {
    try {
      await input(bytes);
      return { index, bytes: bytes.length, result: 'accepted' };
    } catch (error) {
      return { index, bytes: bytes.length, result: (error as { code?: string }).code };
    }
  }),
);
const resolution = [];
for (const [width, height] of [
  [239, 480],
  [240, 480],
  [240, 479],
  [480, 240],
]) {
  const bytes = await sharp(canonicalPng).resize(width!, height!, { fit: 'fill' }).png().toBuffer();
  const result = await input(bytes);
  resolution.push({ width, height, warnings: result.photos[0]!.quality.warnings });
}
report.resolutionBoundaries = resolution;

const transparentBlack = Buffer.alloc(480 * 480 * 4);
const transparentHidden = Buffer.from(transparentBlack);
for (let i = 0; i < transparentHidden.length; i += 4) {
  transparentHidden[i] = (i / 4) % 255;
  transparentHidden[i + 1] = 255 - ((i / 4) % 255);
  transparentHidden[i + 2] = 155;
}
const transparentPng = await sharp(transparentBlack, {
  raw: { width: 480, height: 480, channels: 4 },
})
  .png()
  .toBuffer();
const hiddenPng = await sharp(transparentHidden, { raw: { width: 480, height: 480, channels: 4 } })
  .png()
  .toBuffer();
const alphaServer = await input(transparentPng),
  hiddenServer = await input(hiddenPng);
const alpha = {
  rawBlackBaseline: baselineAnalyzePixels(transparentBlack, 480, 480),
  rawHiddenBaseline: baselineAnalyzePixels(transparentHidden, 480, 480),
  rawBlackCurrent: analyzePixels(transparentBlack, 480, 480),
  serverWhiteComposite: alphaServer.photos[0]!.quality,
  serverHiddenRgbInvariant: alphaServer.photos[0]!.sha256 === hiddenServer.photos[0]!.sha256,
  candidateRequiresOpaque: false,
};
try {
  validateOpaquePixels({ data: transparentBlack, width: 480, height: 480 });
} catch {
  alpha.candidateRequiresOpaque = true;
}
report.alpha = alpha;
await writeFile(resolve(artifactDir, 'transparent-input.png'), transparentPng);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const browserResult = await page.evaluate(async (pngBase64) => {
    const image = new Image();
    image.src = 'data:image/png;base64,' + pngBase64;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('no blob'))),
        'image/jpeg',
        0.82,
      ),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const value of bytes) text += String.fromCharCode(value);
    return { jpegBase64: btoa(text), userAgent: navigator.userAgent, mimeType: blob.type };
  }, transparentPng.toString('base64'));
  const browserJpeg = Buffer.from(browserResult.jpegBase64, 'base64');
  const afterBrowser = await input(browserJpeg);
  await writeFile(resolve(artifactDir, 'browser-transparent-jpeg.jpg'), browserJpeg);
  report.browserCanvasAlpha = {
    implementation:
      'Canvas drawImage followed by toBlob(image/jpeg,0.82), matching inspected Expo web save/load primitives; not an actual Expo native runtime.',
    browserVersion: browser.version(),
    userAgent: browserResult.userAgent,
    mimeType: browserResult.mimeType,
    outputSha256: hash(browserJpeg),
    serverAfterBrowser: afterBrowser.photos[0]!.quality,
    directPngWarnings: alphaServer.photos[0]!.quality.warnings,
    warningAgreement:
      JSON.stringify(afterBrowser.photos[0]!.quality.warnings) ===
      JSON.stringify(alphaServer.photos[0]!.quality.warnings),
    installedSources: await Promise.all(
      [
        'node_modules/expo-image-manipulator/src/web/utils.web.ts',
        'node_modules/expo-image-manipulator/src/web/ImageManipulatorImageRef.web.ts',
      ].map(async (file) => ({ file, sha256: hash(await readFile(resolve(root, file))) })),
    ),
  };
} finally {
  await browser.close();
}
const malformed = [
  {
    name: 'fractional-preview-width',
    width: 3.5,
    height: 4,
    originalWidth: 480,
    originalHeight: 480,
    length: 56,
  },
  {
    name: 'nan-original-width',
    width: 4,
    height: 4,
    originalWidth: Number.NaN,
    originalHeight: 480,
    length: 64,
  },
  {
    name: 'zero-original-width',
    width: 4,
    height: 4,
    originalWidth: 0,
    originalHeight: 480,
    length: 64,
  },
];
report.rawGeometry = malformed.map((c) => {
  const pixels = new Uint8Array(c.length).fill(255);
  let result: unknown;
  try {
    const quality = analyzePixels(pixels, c.width, c.height, c.originalWidth, c.originalHeight);
    result = {
      returned: quality,
      nonfiniteFields: Object.entries(quality)
        .filter(([, v]) => typeof v === 'number' && !Number.isFinite(v))
        .map(([key]) => key),
    };
  } catch (error) {
    result = { rejected: (error as Error).message };
  }
  return { case: c.name, result };
});
report.productionFiles = Object.fromEntries(
  await Promise.all(
    ['server/images.ts', 'packages/core/quality.ts', 'app/src/session.ts'].map(async (file) => [
      file,
      hash(await readFile(resolve(root, file))),
    ]),
  ),
);
const name = 'probes.' + runId + '.json';
await writeFile(resolve(out, name), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(
  JSON.stringify(
    {
      report: 'benchmarks/round-02/quality/' + name,
      orientation: orientationResults,
      alpha: report.alpha,
      browserCanvasAlpha: report.browserCanvasAlpha,
      rawGeometry: report.rawGeometry,
    },
    null,
    2,
  ) + '\n',
);
