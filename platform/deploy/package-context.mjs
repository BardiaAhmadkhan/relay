/** Build an uploadable Docker context from production import paths. Contains only
 * the files used by the backend, its exact public dependency lock and build recipe. */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(process.argv[2] || path.join(root, 'artifacts/relay-v3.5-host'));
await mkdir(destination, { recursive: true });
const entries = [
  'server/index-v2.ts',
  'server/gpu-worker.ts',
  'scripts/v35-budget.ts',
  'deploy/serve.mjs',
];
const result = await build({
  absWorkingDir: root,
  entryPoints: entries,
  outdir: 'bundle',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  metafile: true,
  write: false,
  logLevel: 'silent',
});
const permitted =
  /^(?:(?:server|packages\/core(?:\/v2)?|packages\/vision\/v2)\/[\w.-]+\.(?:ts|json)|scripts\/v35-budget\.ts|deploy\/serve\.mjs)$/;
// esbuild disambiguates JSON that is imported both with and without import attributes.
const sources = Object.keys(result.metafile.inputs).map((p) =>
  p.replaceAll('\\', '/').replace(/(\.json) with \{ type: 'json' \}$/, '$1'),
);
if (!sources.every((p) => permitted.test(p)))
  throw Error('An import falls outside the public server context.');
const files = [
  ...new Set([
    ...sources,
    'Dockerfile',
    '.dockerignore',
    'deploy/package.json',
    'deploy/package-lock.json',
    'deploy/billing.mjs',
  ]),
].sort();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const records = await Promise.all(
  files.map(async (file) => {
    const bytes = await readFile(path.join(root, file));
    return { file, bytes: bytes.length, sha256: sha(bytes) };
  }),
);
const staging = await mkdtemp(path.join(tmpdir(), 'relay-context-'));
const archive = path.join(destination, 'relay-v3.5-backend.tar.gz');
try {
  const list = path.join(staging, 'paths.txt');
  await writeFile(list, files.join('\n') + '\n');
  execFileSync('tar', ['-czf', archive, '-C', root, '-T', list], { windowsHide: true });
  const contents = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', windowsHide: true })
    .trim()
    .split(/\r?\n/)
    .sort();
  if (JSON.stringify(contents) !== JSON.stringify(files))
    throw Error('Archive differs from the allowed production sources.');
  const packed = await readFile(archive);
  await writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(
      {
        release: '3.5',
        fileCount: records.length,
        archiveBytes: packed.length,
        archiveSha256: sha(packed),
        files: records,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ files: records.length, bytes: packed.length, sha256: sha(packed) }));
} finally {
  await rm(path.join(staging, 'paths.txt'), { force: true });
  await rm(staging, { recursive: true });
}
