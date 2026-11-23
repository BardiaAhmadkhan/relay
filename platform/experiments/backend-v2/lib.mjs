// Shared helpers for the backend-v2 experiments. Local inference only; no cloud calls.
// Every runner writes an append-only JSONL under benchmarks/backend-v2/ and never
// overwrites an earlier evidence file (pass a new --tag for a new run).
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const OUT = path.join(ROOT, 'benchmarks', 'backend-v2');
export const OLLAMA = process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11435';

/** Separate labelled sets, each returned ON ITS OWN so the frozen reference runs never change. */
const EXTRA_CORPORA = {
  // Real gear from Openverse (2026-11-17).
  openverse: { labels: 'datasets/gear-v2-openverse/labels.json', name: 'openverse-2026-11-17' },
  // E18 needle-in-a-haystack mosaics (2026-11-18).
  needle: { labels: 'datasets/needle-v3/labels.json', name: 'needle-2026-11-18' },
  // Real-world gear test set (2026-11-18).
  realworld: { labels: 'datasets/realworld-v3/labels.json', name: 'realworld-2026-11-18' },
};

/** Union of the frozen labelled corpora plus the three local-only user photographs.
 * A `corpus` name from EXTRA_CORPORA returns only that set. */
export async function loadCases(corpus) {
  const read = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));
  if (corpus && EXTRA_CORPORA[corpus])
    return (await read(EXTRA_CORPORA[corpus].labels)).cases.map((c) => ({
      id: c.id,
      file: c.file,
      corpus: EXTRA_CORPORA[corpus].name,
      domain: c.domain,
      group: c.group,
      condition: c.condition,
      expectedKinds: c.expectedKinds ?? [],
      subject: c.subject,
      view: c.view,
      publisherBoxes: null,
      publisherClass: null,
      grid: c.grid ?? null,
      defectShare: c.defectShare ?? null,
    }));
  if (corpus !== undefined && corpus !== 'reference') throw new Error('unknown corpus ' + corpus);
  const audit = (await read('datasets/quality-audit-01/labels.json')).cases.map((c) => ({
    ...c,
    corpus: 'audit-01',
  }));
  const cycle = (await read('datasets/quality-cycle-02/labels.json')).cases.map((c) => ({
    ...c,
    corpus: 'cycle-02',
  }));
  const holdout = (await read('datasets/quality-cycle-02/final-holdout-labels.json')).cases.map(
    (c) => ({ ...c, corpus: 'cycle-02-final' }),
  );
  const user = ['sample-01.webp', 'sample-02.jpg', 'sample-03.jpg']
    .map((name, i) => ({
      id: 'user-0' + (i + 1),
      file: 'assets/fixtures/round-03/' + name,
      domain: 'garments_and_gear',
      group: 'user-0' + (i + 1),
      condition: 'visible_defect',
      expectedKinds: ['tear', 'abrasion'],
      subject: 'garment',
      view: 'front',
      corpus: 'user-private',
    }))
    .filter((c) => fsSync.existsSync(path.join(ROOT, c.file)));
  return [...audit, ...cycle, ...holdout, ...user].map((c) => ({
    id: c.id,
    file: c.file,
    corpus: c.corpus,
    domain: c.domain,
    group: c.group ?? c.id,
    condition: c.condition,
    expectedKinds: c.expectedKinds ?? [],
    subject: c.subject ?? null,
    view: c.view ?? null,
    publisherBoxes: c.publisherBoxes ?? null,
    publisherClass: c.publisherClass ?? null,
  }));
}

/** Same normalisation the service applies before inference (server/images.ts), with a selectable edge. */
export async function prepare(file, maxEdge = 1600, degrade = {}) {
  const bytes = await fs.readFile(path.join(ROOT, file));
  let pipeline = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'error' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' });
  // Controlled degradations for the capture-gate and stability experiments only.
  if (degrade.blur) pipeline = pipeline.blur(Number(degrade.blur));
  if (degrade.brightness) pipeline = pipeline.modulate({ brightness: Number(degrade.brightness) });
  const out = await pipeline
    .jpeg({ quality: Number(degrade.quality ?? 84), mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return {
    jpeg: out.data,
    width: out.info.width,
    height: out.info.height,
    sha256: createHash('sha256').update(out.data).digest('hex'),
  };
}

/** Focus measures on a fixed 512 px luminance grid, so values are comparable across photographs.
 * lapVar: variance of the 4-neighbour Laplacian (the existing packages/core/quality.ts measure, but on
 * a larger, fixed grid). tenengrad: mean squared Sobel gradient magnitude. */
export async function sharpness(jpeg) {
  const { data, info } = await sharp(jpeg)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: false, kernel: 'linear' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width,
    h = info.height;
  let lapSum = 0,
    lapSq = 0,
    ten = 0,
    count = 0,
    mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      const gx =
        data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1];
      const gy =
        data[i + w - 1] + 2 * data[i + w] + data[i + w + 1] - data[i - w - 1] - 2 * data[i - w] - data[i - w + 1];
      lapSum += lap;
      lapSq += lap * lap;
      ten += gx * gx + gy * gy;
      count++;
    }
  return {
    lapVar: +(lapSq / count - (lapSum / count) ** 2).toFixed(2),
    tenengrad: +(ten / count).toFixed(1),
    brightness: +mean.toFixed(1),
  };
}

export async function chat(body, timeoutMs = 120_000) {
  const started = performance.now();
  const response = await fetch(OLLAMA + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({ stream: false, think: false, keep_alive: '30m', ...body }),
  });
  const json = await response.json();
  if (!response.ok || json.error) throw new Error('runtime_' + response.status + ':' + json.error);
  return { json, ms: performance.now() - started };
}

/** Probability mass on each answer word at the first generated token, case/space-insensitive. */
export function answerMass(logprobs, words) {
  const first = logprobs?.[0]?.top_logprobs ?? [];
  const mass = Object.fromEntries(words.map((w) => [w, 0]));
  for (const entry of first) {
    const token = entry.token.trim().toLowerCase();
    if (token in mass) mass[token] += Math.exp(entry.logprob);
  }
  const total = Object.values(mass).reduce((a, b) => a + b, 0);
  return { mass, total, normalized: Object.fromEntries(words.map((w) => [w, total ? mass[w] / total : 0])) };
}

export async function appendJsonl(file, row) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(row) + '\n');
}

export async function done(file) {
  if (!fsSync.existsSync(file)) return new Set();
  const text = await fs.readFile(file, 'utf8');
  return new Set(
    text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((row) => !row.error)
      .map((row) => row.id),
  );
}

export function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      // A bare flag followed by another flag is boolean. Fixed 2026-11-17: the earlier form consumed the
      // next flag as the value, so `--overlay --tag gear` and `--scored --tag repeat` lost their tag
      // (the repeat run would have resumed into the e1024 file and scored nothing).
      const next = process.argv[i + 1];
      out[k] = v ?? (next !== undefined && !next.startsWith('--') ? process.argv[++i] : true);
    }
  }
  return out;
}
