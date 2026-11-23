import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = process.cwd(),
  logDir = path.join(root, 'benchmarks/commands');
await fs.mkdir(logDir, { recursive: true });
const commands = [
  { id: 'typecheck', command: 'npm', args: ['run', 'typecheck'], cwd: root },
  { id: 'format', command: 'npm', args: ['run', 'format:check'], cwd: root },
  { id: 'expo-doctor', command: 'npx', args: ['expo-doctor'], cwd: path.join(root, 'app') },
  { id: 'documentation', command: 'npm', args: ['run', 'check:docs'], cwd: root },
];
const commandResults = [];
for (const task of commands) {
  const binary = task.command + (process.platform === 'win32' ? '.cmd' : '');
  const result = spawnSync(binary, task.args, {
    cwd: task.cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 10_000_000,
  });
  await fs.writeFile(
    path.join(logDir, task.id + '.txt'),
    (result.stdout ?? '') + (result.stderr ?? ''),
  );
  commandResults.push({
    id: task.id,
    exitCode: result.status,
    log: 'benchmarks/commands/' + task.id + '.txt',
  });
  if (result.status !== 0) throw new Error(task.id + ' failed; inspect its saved log');
}
const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const unit = await read('benchmarks/unit-results.json'),
  ui = await read('benchmarks/ui-results.json'),
  adapter = await read('benchmarks/vision-adapter-checks.json'),
  metadata = await read('app/dist/metadata.json'),
  audit = await read('benchmarks/dependency-audit-final.json');
if (
  !unit.success ||
  unit.numFailedTests ||
  ui.stats.unexpected ||
  ui.stats.flaky ||
  adapter.passed !== adapter.total
)
  throw new Error('A verification artifact contains a failure');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [];
async function walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.expo'].includes(entry.name)) continue;
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(full)) sourceFiles.push(full);
  }
}
for (const folder of ['app', 'packages', 'server', 'scripts', 'tests']) await walk(folder);
sourceFiles.push(
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.ts',
  'playwright.config.ts',
);
const sources = [];
for (const file of sourceFiles.sort())
  sources.push({ path: file.replaceAll('\\', '/'), sha256: hash(await fs.readFile(file)) });
const bundles = [];
for (const [platform, info] of Object.entries(metadata.fileMetadata)) {
  const file = path.join('app/dist', info.bundle),
    bytes = await fs.readFile(file);
  bundles.push({
    platform,
    path: file.replaceAll('\\', '/'),
    bytes: bytes.length,
    sha256: hash(bytes),
  });
}
const accessibility = [];
for (const screen of ['home', 'result']) {
  const data = await read('output/playwright/accessibility-' + screen + '.json');
  accessibility.push({ screen, violations: data.violations.length });
}
const result = {
  schemaVersion: '1.0',
  recordedAt: new Date().toISOString(),
  environment: {
    node: process.version,
    platform: os.platform(),
    architecture: os.arch(),
    cpu: os.cpus()[0]?.model,
  },
  sourceTreeSha256: hash(JSON.stringify(sources)),
  sources,
  commands: commandResults,
  unitTests: { passed: unit.numPassedTests, failed: unit.numFailedTests },
  browser: {
    passed: ui.stats.expected,
    failed: ui.stats.unexpected,
    flaky: ui.stats.flaky,
    baseURL: ui.config?.projects?.[0]?.use?.baseURL ?? 'See Playwright configuration/report',
    recordedStart: ui.stats.startTime,
  },
  localAdapterChecks: { passed: adapter.passed, total: adapter.total },
  accessibility,
  bundles,
  dependencyAudit: audit.metadata.vulnerabilities,
  limits: {
    physicalIosExecuted: false,
    physicalAndroidExecuted: false,
    livePaidVisionExecuted: false,
    conditionAccuracyEstablished: false,
    competitionReusePermission: false,
    published: false,
  },
  notes: [
    'Native bundle export is not native device execution.',
    'Browser local inference uses synthetic non-gear fixtures; cloud routes are explicitly mocked in consent tests.',
    'Two upstream Expo-tooling advisories remain; see dependency review.',
  ],
};
await fs.writeFile('benchmarks/verification.json', JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      sourceTreeSha256: result.sourceTreeSha256,
      unitTests: result.unitTests,
      browser: result.browser,
      localAdapterChecks: result.localAdapterChecks,
      accessibility,
      bundles: bundles.map((b) => ({ platform: b.platform, bytes: b.bytes })),
      dependencyAudit: result.dependencyAudit,
    },
    null,
    2,
  ),
);
