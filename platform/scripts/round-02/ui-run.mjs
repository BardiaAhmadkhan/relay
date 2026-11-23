import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const root = process.cwd(),
  label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label))
  throw new Error('Provide a unique lowercase run label, e.g. after-fix.');
const output = path.join(root, 'benchmarks/round-02/experience');
await fs.mkdir(output, { recursive: true });
const resultFile = path.join(output, label + '-results.json');
try {
  await fs.access(resultFile);
  throw new Error('Run label already exists; choose a new label to preserve prior evidence.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const baseURL = process.env.RELAY_UI_URL ?? 'http://localhost:4173';
const sha = (data) => createHash('sha256').update(data).digest('hex');
async function fingerprint() {
  const http = await fetch(baseURL, { signal: AbortSignal.timeout(6000) });
  if (!http.ok) throw new Error('Static preview unavailable: ' + http.status);
  const html = await http.text();
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)/g)].map((m) => m[1]);
  const bundles = [];
  for (const source of scripts) {
    const url = new URL(source, baseURL);
    if (url.origin !== new URL(baseURL).origin) continue;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('Bundle unavailable: ' + source);
    const bytes = Buffer.from(await r.arrayBuffer());
    bundles.push({ source, sha256: sha(bytes), bytes: bytes.length });
  }
  const files = {};
  for (const name of [
    'app/src/api.ts',
    'app/src/useRelay.ts',
    'app/App.tsx',
    'packages/core/schema.ts',
    'packages/core/policy.ts',
    'tests/round-02-mobile.spec.ts',
  ])
    files[name] = sha(await fs.readFile(path.join(root, name)));
  const healthResponse = await fetch('http://127.0.0.1:8787/health', {
    signal: AbortSignal.timeout(6000),
  });
  return {
    baseURL,
    htmlSha256: sha(html),
    bundles,
    sourceHashes: files,
    localHealth: { status: healthResponse.status, body: await healthResponse.json() },
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  };
}
const before = await fingerprint();
const start = performance.now();
const child = spawn(
  process.execPath,
  [
    'node_modules/@playwright/test/cli.js',
    'test',
    '--config',
    'experiments/round-02/experience/playwright.config.ts',
  ],
  { cwd: root, env: { ...process.env, RELAY_ROUND02_RUN: label }, stdio: 'inherit', shell: false },
);
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => resolve(code ?? 1));
});
const after = await fingerprint();
const metadata = {
  schemaVersion: '1.0',
  clientResearchDate: '2026-10-26',
  run: label,
  baselineCommit: 'e3a6f58',
  elapsedMs: performance.now() - start,
  exitCode,
  before,
  after,
  bundleUnchanged: JSON.stringify(before.bundles) === JSON.stringify(after.bundles),
  limits: [
    'Deterministic route faults do not call external providers.',
    'Synthetic images are not gear-recognition accuracy evidence.',
    'Static Chromium browser only; no native device claim.',
  ],
};
await fs.writeFile(
  path.join(output, label + '-environment.json'),
  JSON.stringify(metadata, null, 2),
);
process.exitCode = exitCode === 0 && metadata.bundleUnchanged ? 0 : exitCode || 1;
