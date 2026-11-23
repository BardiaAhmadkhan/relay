import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
const rows = [
  {
    path: '.cache/mobile-vision/qwen-2b-q4.gguf',
    name: 'Qwen3.5-2B-Q4_K_M.gguf',
    sha: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
    size: 1280835840,
  },
  {
    path: '.cache/mobile-vision/qwen-2b-mmproj-f16.gguf',
    name: 'mmproj-F16.gguf',
    sha: '7035e9cb8d7c6a9681d07eef9a364783e86ea4cd73faab2eabb4f43a101830c7',
    size: 668227264,
  },
];
for (const d of rows) {
  const url =
    'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/f6d5376be1edb4d416d56da11e5397a961aca8ae/' +
    d.name;
  console.log('Downloading ' + d.name);
  const r = await fetch(url);
  if (!r.ok) throw Error(String(r.status));
  await pipeline(Readable.fromWeb(r.body), createWriteStream(d.path, { flags: 'wx' }));
  const h = createHash('sha256');
  for await (const b of createReadStream(d.path)) h.update(b);
  if (h.digest('hex') !== d.sha || (await fs.stat(d.path)).size !== d.size)
    throw Error('Integrity mismatch');
  console.log('Verified ' + d.name);
}
await fs.writeFile(
  'experiments/phone-offline-02/second-candidate-downloads.json',
  JSON.stringify(
    {
      source: 'unsloth/Qwen3.5-2B-GGUF',
      revision: 'f6d5376be1edb4d416d56da11e5397a961aca8ae',
      license: 'Apache-2.0',
      files: rows,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
