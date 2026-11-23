import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPreview } from '../tests/support/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) out.push(...(await files(path.join(dir, entry.name), name + '/')));
    else if (entry.isFile()) out.push(name);
    else throw Error('Unexpected link or special file in build: ' + name);
  }
  return out;
}
const publicDir = path.join(root, 'public'),
  dist = path.join(root, 'dist');
const approved = new Set(await files(publicDir));
const built = await files(dist);
for (const name of built) {
  if (approved.has(name)) {
    assert.deepEqual(
      await fs.readFile(path.join(dist, name)),
      await fs.readFile(path.join(publicDir, name)),
      'Static asset changed during build: ' + name,
    );
    approved.delete(name);
  } else {
    assert.ok(
      name === 'index.html' || /^assets\/[\w.-]+-[\w-]{8,}\.(?:js|css)$/.test(name),
      'Unexpected distributable file: ' + name,
    );
  }
}
assert.equal(approved.size, 0, 'A public file is missing from the production build.');
await withPreview(async (base) => {
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Rider trade-in/);
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const url = new URL(ref, base + '/');
    assert.equal(url.origin, base);
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 200, 'Missing entry asset: ' + ref);
  }
  const config = await (await fetch(base + '/workspace.json')).json();
  assert.equal(config.connected, false);
  assert.equal(config.catalogConnected, false);
  assert.equal(config.riderAccess, false);
  assert.equal((await fetch(base + '/missing-public-file')).status, 404);
});
console.log(
  'Production entry point, example configuration and ' +
    built.length +
    ' distributable files verified.',
);
