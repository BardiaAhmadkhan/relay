import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { analyzePixels, MAX_QUALITY_PREVIEW_PIXELS } from '../packages/core/quality';
import { analyzePixels as baselineAnalyzePixels } from '../scripts/round-02/quality-baseline';
import { frozenServer, scaleMetrics } from '../scripts/round-02/quality-metrics';

const root = resolve(import.meta.dirname, '..');
const fixtureIds = [
  'leather-jacket',
  'armour-jacket',
  'gloves-back',
  'gloves-palm',
  'racing-boot',
  'mixed-gear',
  'crashed-shoulder',
  'backpack-label',
];
function rgba(width: number, height: number, alpha = 255): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      bytes[i] = (x * 17 + y * 3) % 256;
      bytes[i + 1] = (x * 11 + y * 23) % 256;
      bytes[i + 2] = (x * 7 + y * 13) % 256;
      bytes[i + 3] = alpha;
    }
  return bytes;
}

describe('round-02 quality input contract', () => {
  it.each([
    ['plain number array', Array(64).fill(255)],
    ['16-bit elements', new Uint16Array(64)],
    ['floating elements', new Float32Array(64)],
    ['object with byte length', { length: 64 }],
    ['null input', null],
  ])('rejects %s instead of treating it as an RGBA byte buffer', (_label, value) => {
    expect(() => analyzePixels(value as Uint8Array, 4, 4)).toThrow('Invalid pixel buffer');
  });

  it.each([
    ['fractional preview width', 3.5, 4, 480, 480, 56],
    ['fractional preview height', 4, 3.5, 480, 480, 56],
    ['nonfinite original width', 4, 4, Number.NaN, 480, 64],
    ['zero original width', 4, 4, 0, 480, 64],
    ['negative original height', 4, 4, 480, -1, 64],
    ['fractional original width', 4, 4, 480.5, 480, 64],
    ['unsafe integer original width', 4, 4, Number.MAX_SAFE_INTEGER + 1, 480, 64],
  ] as const)(
    'rejects %s before returning nonfinite or invalid quality',
    (_label, width, height, originalWidth, originalHeight, length) => {
      expect(() =>
        analyzePixels(new Uint8Array(length), width, height, originalWidth, originalHeight),
      ).toThrow('Invalid pixel buffer');
    },
  );

  it('bounds the preview luminance allocation independently of the source dimensions', () => {
    expect(MAX_QUALITY_PREVIEW_PIXELS).toBe(1_048_576);
    const width = 1025,
      height = 1024;
    expect(() => analyzePixels(new Uint8Array(width * height * 4), width, height)).toThrow(
      'Invalid pixel buffer',
    );
    expect(() => analyzePixels(rgba(192, 144), 192, 144, 6000, 4000)).not.toThrow();
  });

  it('makes fully invisible RGB irrelevant and composites it onto white', () => {
    const hiddenPattern = rgba(48, 32, 0);
    const hiddenBlack = new Uint8Array(hiddenPattern.length);
    const white = new Uint8Array(hiddenPattern.length).fill(255);
    const a = analyzePixels(hiddenBlack, 48, 32, 480, 480);
    const b = analyzePixels(hiddenPattern, 48, 32, 480, 480);
    const c = analyzePixels(white, 48, 32, 480, 480);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.warnings).toEqual(['bright', 'soft']);
    expect(baselineAnalyzePixels(hiddenPattern, 48, 32, 480, 480).brightness).not.toBe(
      a.brightness,
    );
  });

  it('composites partial alpha consistently with an independent white-matte reference to byte rounding precision', async () => {
    const pixels = rgba(48, 32, 128);
    const composite = await sharp(pixels, { raw: { width: 48, height: 32, channels: 4 } })
      .flatten({ background: '#ffffff' })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = analyzePixels(pixels, 48, 32, 480, 480);
    const reference = baselineAnalyzePixels(composite, 48, 32, 480, 480);
    expect(Math.abs(actual.brightness - reference.brightness)).toBeLessThan(1);
    expect(actual.warnings).toEqual(reference.warnings);
  });

  it('accepts clamped 8-bit RGBA data without changing opaque arithmetic', () => {
    const source = rgba(32, 32);
    expect(analyzePixels(new Uint8ClampedArray(source), 32, 32, 480, 480)).toEqual(
      baselineAnalyzePixels(source, 32, 32, 480, 480),
    );
  });

  it.each([0, 32, 64, 128, 224, 255])(
    'preserves opaque constant-luminance statistics at value %s',
    (value) => {
      const source = new Uint8Array(32 * 32 * 4).fill(value);
      for (let i = 3; i < source.length; i += 4) source[i] = 255;
      expect(analyzePixels(source, 32, 32, 480, 480)).toEqual(
        baselineAnalyzePixels(source, 32, 32, 480, 480),
      );
    },
  );

  it.each(fixtureIds)(
    'preserves every baseline quality field for opaque fixture %s',
    async (id) => {
      const source = await readFile(resolve(root, 'assets/fixtures/' + id + '.jpg'));
      const frozen = await frozenServer(source);
      const p = frozen.raw192;
      expect(
        analyzePixels(
          p.data,
          p.width,
          p.height,
          frozen.measurement.quality.width,
          frozen.measurement.quality.height,
        ),
      ).toEqual(frozen.measurement.quality);
    },
  );
});

describe('round-02 experiment integrity and metric interpretation', () => {
  it('retains the frozen group split and all 192 variants without evaluation threshold fitting', async () => {
    const dir = resolve(root, 'benchmarks/round-02/quality');
    const protocolText = await readFile(
      resolve(root, 'experiments/round-02/quality/preregistration.json'),
      'utf8',
    );
    const expectedHash = (
      await readFile(resolve(root, 'experiments/round-02/quality/preregistration.sha256'), 'utf8')
    ).trim();
    expect(createHash('sha256').update(protocolText).digest('hex')).toBe(expectedHash);
    const protocol = JSON.parse(protocolText);
    const summary = JSON.parse(await readFile(resolve(dir, 'summary.json'), 'utf8'));
    const calibration = JSON.parse(await readFile(resolve(dir, 'thresholds.json'), 'utf8'));
    expect(summary.counts).toMatchObject({
      images: 8,
      independentItemGroups: 7,
      variants: 192,
      pipelineMeasurements: 576,
    });
    expect(
      new Set(
        protocol.developmentGroups.filter((group: string) =>
          protocol.evaluationGroups.includes(group),
        ),
      ).size,
    ).toBe(0);
    expect(
      calibration.developmentFixtureIds.every(
        (id: string) =>
          protocol.fixtures.find((f: { id: string }) => f.id === id).split === 'development',
      ),
    ).toBe(true);
    const rows: Array<{ fixtureId: string; transform: { id: string } }> = [];
    for (const run of summary.rawRuns) {
      const raw = await readFile(resolve(root, run.file), 'utf8');
      expect(createHash('sha256').update(raw).digest('hex')).toBe(run.sha256);
      rows.push(
        ...raw
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line)),
      );
    }
    expect(rows).toHaveLength(192);
    expect(new Set(rows.map((row) => row.fixtureId + '|' + row.transform.id)).size).toBe(192);
    expect(
      summary.productionBaselineAgreement.every(
        (value: { sameQuality: boolean; sameEncodedJpeg: boolean }) =>
          value.sameQuality && value.sameEncodedJpeg,
      ),
    ).toBe(true);
  });

  it('retains contrast sensitivity as a known property of the raw operator rather than calling it safety confidence', () => {
    const source = rgba(48, 32);
    for (let i = 0; i < source.length; i += 4) {
      source[i] = Math.floor(source[i]! / 2) * 2;
      source[i + 1] = Math.floor(source[i + 1]! / 2) * 2;
      source[i + 2] = Math.floor(source[i + 2]! / 2) * 2;
    }
    const dim = new Uint8Array(source);
    for (let i = 0; i < dim.length; i += 4) {
      dim[i] = source[i]! / 2;
      dim[i + 1] = source[i + 1]! / 2;
      dim[i + 2] = source[i + 2]! / 2;
    }
    const a = scaleMetrics({ data: source, width: 48, height: 32 });
    const b = scaleMetrics({ data: dim, width: 48, height: 32 });
    expect(b.laplacian / a.laplacian).toBeCloseTo(0.25, 10);
    expect(Math.abs(b.normalizedLaplacian / a.normalizedLaplacian - 1)).toBeLessThan(0.01);
    expect(a).not.toHaveProperty('confidence');
    expect(a).not.toHaveProperty('protectivePerformance');
  });
});
