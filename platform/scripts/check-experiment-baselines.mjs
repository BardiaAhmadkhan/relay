import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const lock = JSON.parse(
  await fs.readFile(process.argv[2] ?? 'experiments/baselines.lock.json', 'utf8'),
);
for (const entry of lock.files) {
  const actual = createHash('sha256')
    .update(await fs.readFile(entry.path))
    .digest('hex');
  if (actual !== entry.sha256) throw new Error('Frozen experiment changed: ' + entry.path);
}
console.log(lock.files.length + ' frozen experimental artifacts match their recorded hashes.');
