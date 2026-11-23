import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  errors = [];
let documents = 0,
  links = 0;
async function scan(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.cache' || e.name === 'dist')
      continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await scan(full);
      continue;
    }
    if (!e.name.endsWith('.md')) continue;
    documents++;
    const text = await fs.readFile(full, 'utf8');
    if (text.includes('\uFFFD')) errors.push(full + ': invalid encoding');
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|#|mailto:)/.test(target)) continue;
      const relative = decodeURIComponent(target.split('#')[0].replace(/^<|>$/g, ''));
      if (!relative || relative.startsWith('/C:')) continue;
      links++;
      try {
        await fs.access(path.resolve(path.dirname(full), relative));
      } catch {
        errors.push(path.relative(root, full) + ': missing ' + relative);
      }
    }
  }
}
await scan(path.join(root, 'docs'));
for (const target of ['README.md', 'LICENSES.md']) {
  try {
    await fs.access(target);
  } catch {
    errors.push('Missing ' + target);
  }
}
for (const file of await fs.readdir('docs/21-research-sources')) {
  if (file.endsWith('.json'))
    try {
      JSON.parse(await fs.readFile('docs/21-research-sources/' + file, 'utf8'));
    } catch {
      errors.push('Invalid JSON ' + file);
    }
}
const report = { checkedAt: new Date().toISOString(), documents, links, errors };
await fs.writeFile('benchmarks/documentation-check.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
