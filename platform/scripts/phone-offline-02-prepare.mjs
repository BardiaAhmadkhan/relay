import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream, createReadStream } from 'node:fs';
const dir = 'experiments/phone-offline-02';
await fs.mkdir(dir + '/baseline', { recursive: true });
await fs.mkdir('benchmarks/phone-offline-02', { recursive: true });
await fs.mkdir('.cache/mobile-vision', { recursive: true });
await fs.mkdir('.tooling/llama-cpp-mobile', { recursive: true });
const sources = [
  'package.json',
  'package-lock.json',
  'app/package.json',
  'app/app.json',
  'app/metro.config.js',
  'app/App.tsx',
  'app/src/api.ts',
  'app/src/useRelay.ts',
  'app/src/session.ts',
  'app/src/screens-intake.tsx',
  'app/src/screens-review.tsx',
  'app/src/capture-footer.tsx',
  'app/src/briefs.ts',
  'packages/core/schema.ts',
  'packages/core/policy.ts',
];
const baseline = [];
for (const p of sources) {
  const bytes = await fs.readFile(p),
    snapshot = dir + '/baseline/' + p.replaceAll('/', '--');
  await fs.writeFile(snapshot, bytes, { flag: 'wx' });
  baseline.push({ path: p, snapshot, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const protocol = {
  at: new Date().toISOString(),
  target:
    'Samsung Galaxy S26 Ultra; physical phone not attached. ARM64 APK, on-device inference, bundled offline model, no computer service or cloud fallback.',
  baseline,
  priorEvidence: 'experiments/quality-cycle-02/evidence.lock.json',
  candidate: 'Qwen3.5-0.8B Q4_K_M plus F16 vision projector; evaluate before selection',
  gates: [
    'No network permission in standalone release; fresh install and real image inference with airplane mode and no adb reverse',
    'Original three damaged jackets must still show physically corresponding defects, not merely any alert',
    'Matched positive/negative controls recorded without silently discarding failures',
    'Deterministic history/offer policy, drafts, photo provenance, cancellation and saved briefs retained',
    'Separate physical-phone uncertainty from native emulator evidence',
  ],
  primarySources: [
    'https://github.com/mybigday/llama.rn',
    'https://huggingface.co/Qwen/Qwen3.5-0.8B',
    'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF',
    'https://news.samsung.com/us/samsung-unveils-galaxy-s26-series-most-intuitive-galaxy-ai-phone-yet/',
  ],
};
await fs.writeFile(dir + '/protocol.json', JSON.stringify(protocol, null, 2) + '\n', {
  flag: 'wx',
});
const downloads = [
  {
    path: '.tooling/llama-cpp-mobile/runtime.zip',
    url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11669/llama-b11669-bin-win-cpu-x64.zip',
    size: 19537886,
    sha: '37b3efcf962847ca869745fd4ccf7f5e7e8dacfeff9fa3523b4ca8cdc66d632b',
  },
  {
    path: '.cache/mobile-vision/qwen-0.8b-q4.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/Qwen3.5-0.8B-Q4_K_M.gguf',
    size: 532517120,
    sha: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
  },
  {
    path: '.cache/mobile-vision/qwen-0.8b-mmproj-f16.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/6ab461498e2023f6e3c1baea90a8f0fe38ab64d0/mmproj-F16.gguf',
    size: 204987232,
    sha: '56e4c6cfe73b0c82e3e82bc518d7591997e61d81f723fc41a586f4fa69ea2453',
  },
];
for (const d of downloads) {
  console.log('Downloading ' + d.path);
  const r = await fetch(d.url);
  if (!r.ok || !r.body) throw Error('Download failed ' + r.status);
  await pipeline(Readable.fromWeb(r.body), createWriteStream(d.path, { flags: 'wx' }));
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(d.path)) hash.update(chunk);
  if (hash.digest('hex') !== d.sha || (await fs.stat(d.path)).size !== d.size)
    throw Error('Integrity mismatch ' + d.path);
  console.log('Verified ' + d.path + ' ' + d.size + ' bytes');
}
await fs.writeFile(
  dir + '/downloads.json',
  JSON.stringify({ at: new Date().toISOString(), downloads }, null, 2) + '\n',
  { flag: 'wx' },
);
