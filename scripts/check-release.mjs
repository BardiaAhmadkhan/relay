import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, encoding = null) =>
  execFileSync('git', args, { cwd: root, encoding, maxBuffer: 32 * 1024 * 1024 });
const filesFrom = (s) => s.split('\0').filter(Boolean);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const roots = new Set([
  'src',
  'server',
  'scripts',
  'tools',
  'tests',
  'notices',
  'public',
  'docs',
  '.github',
  'platform',
]);
const top = new Set([
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.gitleaks.toml',
  'README.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'vite.config.mjs',
  'index.html',
]);
const reviewedDocuments = new Set([
  'README.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'public/workspace.json',
  'src/media-dimensions.json',
  'src/examples/media-dimensions.json',
  'docs/shop-operations.md',
  'notices/assets.json',
  'notices/platform.json',
  'notices/DM-Sans-OFL.txt',
  'notices/Barlow-Condensed-OFL.txt',
  'notices/Instrument-Serif-OFL.txt',
]);
const textTypes = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.mts',
  '.css',
  '.html',
  '.json',
  '.md',
  '.txt',
  '.svg',
]);
export function validateEntry(name, bytes, assets, inventory = {}) {
  if (name.includes('\\') || name.split('/').some((p) => p === '.' || p === '..' || !p))
    throw Error('Invalid release path: ' + name);
  const parts = name.split('/'),
    ext = path.posix.extname(name).toLowerCase();
  const verificationWorkflow = name === '.github/workflows/verify.yml';
  const platform = parts[0] === 'platform';
  const listed = platform && Object.hasOwn(inventory, name) && inventory[name];
  if (platform && !listed) throw Error('Unreviewed platform path: ' + name);
  const envTemplate = name === '.env.example' || name === 'platform/.env.example';
  if (parts.some(s => /^(?:node_modules|\.git|\.cache|\.local|\.venv|__pycache__|\.env(?:\..+)?)$/i.test(s)) && !envTemplate)
    throw Error('Private or generated path: ' + name);
  if (platform && (parts.some(s => /^(?:data|private|collab|screenshots|output|dist|\.expo)$/i.test(s)) ||
      /\.(?:gguf|safetensors|sqlite|db|p12|pem|keystore|heic|zip|docx|xlsx|pdf)$/i.test(name)))
    throw Error('Private or generated platform path: ' + name);
  if (parts[0] === '.github' && !verificationWorkflow)
    throw Error('Unreviewed GitHub configuration: ' + name);
  if (parts.length === 1 ? !top.has(name) : !roots.has(parts[0]))
    throw Error('Unreviewed directory or root file: ' + name);
  if (
    parts.some((s) =>
      /^(?:data|datasets?|fixtures?|collab|benchmarks?|screenshots?|output|dist|node_modules|\.cache|\.git|\.local|\.env(?:\..+)?)$/i.test(
        s,
      ),
    ) &&
    !envTemplate && !platform
  )
    throw Error('Private or generated path: ' + name);
  if (platform && listed.sha256) {
    if (!listed.provenance || !/\.(?:png|jpe?g|svg|webp)$/i.test(name) ||
        sha(bytes) !== listed.sha256) throw Error('Unverified platform media: ' + name);
    return;
  }
  if (assets[name]) {
    if (!/^public\/(?:media\/[\w-]+\.webp|fonts\/[\w-]+\.woff2|relay\.svg)$/.test(name))
      throw Error('Manifest contains a non-asset path: ' + name);
    if (sha(bytes) !== assets[name].sha256) throw Error('Reviewed asset hash changed: ' + name);
    return;
  }
  if (
    (['.txt', '.md', '.json'].includes(ext) || parts[0] === 'public') &&
    !reviewedDocuments.has(name) && !listed
  )
    throw Error('Unreviewed data or document: ' + name);
  if (bytes.includes(0) || (!textTypes.has(ext) && !top.has(name) && !verificationWorkflow && !listed))
    throw Error('Unapproved binary or file type: ' + name);
  if (
    name.startsWith('public/media/') ||
    name.startsWith('public/fonts/') ||
    /\.(?:svg|webp|png|jpe?g|avif|heic|gif)$/i.test(name)
  )
    throw Error('Media must have an explicit origin and reviewed digest: ' + name);
  const text = bytes.toString('utf8');
  if (envTemplate) {
    for (const line of text.split(/\r?\n/)) {
      const assignment = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (assignment && /(?:API_KEY|ACCESS_TOKEN|UPSTREAM_TOKEN|ADMIN_TOKEN|GPU_TOKEN|OPERATOR_KEY|WEB_PASSWORD|SIGNING_KEY|CLIENT_SECRET|PRIVATE_KEY)$/.test(assignment[1]) && assignment[2])
        throw Error('Configuration templates must leave credentials empty: ' + name);
    }
  }
  if ((name.startsWith('src/') || name.startsWith('platform/app/') || name === 'vite.config.mjs' || name === 'index.html') &&
      /\b(?:VITE|EXPO_PUBLIC)_[A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|ADMIN_TOKEN|SIGNING_KEY|CLIENT_SECRET|PRIVATE_KEY)\b/.test(text))
    throw Error('A server credential was declared in browser or mobile client configuration: ' + name);
  const privateMarkers = [
    [/\bRL\d{2}-\d{3}\b/i, 'private item identifier'],
    [/\b[A-Z]:[\\/](?:[a-z0-9_ .-]+[\\/])+/i, 'machine-specific private path'],
    [/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{100}/i, 'embedded image data'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key material'],
    [
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{30,}|github_pat_[A-Za-z0-9_]{26,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[A-Z0-9]{16}|shp(?:at|ca|pa|ss)_[A-Za-z0-9]{20,})\b/,
      'credential-shaped string',
    ],
    [
      /(?:^|\n)[ \t]*(?:RELAY_SIGNING_KEY|OPENAI_API_KEY|RELAY_UPSTREAM_TOKEN|RELAY_WEB_PASSWORD|RELAY_SHOPIFY_ADMIN_TOKEN)[ \t]*=[ \t]*[a-zA-Z0-9_\-]{18,}/,
      'populated server credential',
    ],
  ];
  for (const [pattern, reason] of privateMarkers) {
    if (pattern.test(text)) throw Error(reason + ' in ' + name);
  }
}
function parseManifest(bytes) {
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(manifest.assets) || !manifest.assets.length)
    throw Error('The reviewed asset manifest is empty.');
  const map = Object.create(null);
  for (const x of manifest.assets) {
    if (!x.path || !x.provenance || !/^([a-f0-9]{64})$/.test(x.sha256) || map[x.path])
      throw Error('Invalid asset manifest entry.');
    map[x.path] = x;
  }
  return map;
}
function examine(entries, read, kind) {
  const manifest = 'notices/assets.json',
    ref = entries.get(manifest);
  if (!ref) throw Error(kind + ' has no reviewed asset manifest.');
  const assets = parseManifest(read(ref, manifest));
  const inventoryName = 'notices/platform.json';
  const inventoryRef = entries.get(inventoryName);
  const inventory = Object.create(null);
  if (inventoryRef) {
    const registry = JSON.parse(read(inventoryRef, inventoryName).toString('utf8'));
    for (const name of registry.source) {
      if (inventory[name] || !name.startsWith('platform/')) throw Error('Invalid platform inventory: ' + name);
      inventory[name] = {};
    }
    for (const item of registry.media) {
      if (inventory[item.path] || !item.path.startsWith('platform/') ||
          !/^[a-f0-9]{64}$/.test(item.sha256) || !item.provenance)
        throw Error('Invalid platform media provenance.');
      inventory[item.path] = item;
    }
  }
  for (const [name, source] of entries) validateEntry(name, read(source, name), assets, inventory);
  for (const name of Object.keys(inventory))
    if (!entries.has(name)) throw Error('Platform inventory file missing from ' + kind + ': ' + name);
  for (const asset of Object.keys(assets))
    if (!entries.has(asset)) throw Error('Manifest asset missing from ' + kind + ': ' + asset);
  return { files: entries.size, assets: Object.keys(assets).length + Object.values(inventory).filter(x => x.sha256).length };
}
export function verifyRelease() {
  const cwd = filesFrom(git(['ls-files', '-c', '-o', '--exclude-standard', '-z'], 'utf8'));
  const working = new Map(cwd.map((n) => [n, n]));
  function inspectPublic(dir) {
    for (const child of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const n = dir + '/' + child.name;
      if (child.isDirectory()) inspectPublic(n);
      else if (!working.has(n)) throw Error('Untracked or ignored file in static assets: ' + n);
    }
  }
  inspectPublic('public');
  const current = examine(
    working,
    (n) => {
      const f = path.join(root, n);
      if (fs.lstatSync(f).isSymbolicLink()) throw Error('Links cannot be release assets: ' + n);
      return fs.readFileSync(f);
    },
    'worktree',
  );
  const index = new Map();
  for (const row of filesFrom(git(['ls-files', '--stage', '-z'], 'utf8'))) {
    const [meta, n] = row.split('\t'),
      [mode, h, stage] = meta.split(' ');
    if (!['100644', '100755'].includes(mode) || stage !== '0')
      throw Error('Unresolved or linked index entry: ' + n);
    index.set(n, h);
  }
  const cache = new Map();
  function blob(h) {
    if (!cache.has(h)) cache.set(h, git(['cat-file', 'blob', h]));
    return cache.get(h);
  }
  function preload(tree) {
    const ids = [...new Set(tree.values())].filter(h => !cache.has(h));
    for (let i = 0; i < ids.length; i += 24) {
      const batch = ids.slice(i, i + 24);
      const bytes = execFileSync('git', ['cat-file', '--batch'], {
        cwd: root, input: batch.join('\n') + '\n', maxBuffer: 192 * 1024 * 1024,
      });
      let start = 0;
      for (const hash of batch) {
        const end = bytes.indexOf(10, start);
        const [id, type, length] = bytes.toString('ascii', start, end).split(' ');
        const size = Number(length);
        if (id !== hash || type !== 'blob' || !Number.isSafeInteger(size) || size < 0)
          throw Error('Unexpected Git blob header.');
        start = end + 1;
        cache.set(hash, bytes.subarray(start, start + size));
        start += size + 1;
      }
      if (start !== bytes.length) throw Error('Truncated Git blob stream.');
    }
  }
  if (index.size) { preload(index); examine(index, blob, 'staged snapshot'); }
  const hasHead =
    spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'ignore' }).status ===
    0;
  const commits = hasHead ? git(['rev-list', 'HEAD'], 'utf8').trim().split(/\s+/) : [];
  for (const c of commits) {
    const tree = new Map();
    for (const row of filesFrom(git(['ls-tree', '-r', '-z', c], 'utf8'))) {
      const [meta, n] = row.split('\t'),
        [mode, type, h] = meta.split(' ');
      if (type !== 'blob' || !['100644', '100755'].includes(mode))
        throw Error('Unreviewed object in history.');
      tree.set(n, h);
    }
    preload(tree);
    examine(tree, blob, 'commit ' + c.slice(0, 10));
  }
  return { ...current, staged: index.size, reachableCommits: commits.length };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log('Release content verified', verifyRelease());
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
