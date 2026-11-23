import { spawn } from 'node:child_process';
import fs from 'node:fs';
const args = [
  '-m',
  '.cache/ollama/blobs/sha256-a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50',
  '--mmproj',
  '.cache/ollama/blobs/sha256-e56a899b1540860385465756dd308c84417410b94dbc1c380adffd20a921ca60',
  '--host',
  '127.0.0.1',
  '--port',
  '8792',
  '-c',
  '4096',
  '-t',
  '4',
  '-tb',
  '4',
  '-np',
  '1',
  '--no-webui',
  '--no-context-shift',
  '--reasoning',
  'off',
  '--image-min-tokens',
  '64',
  '--image-max-tokens',
  '768',
  '-ngl',
  '99',
  '--chat-template-kwargs',
  JSON.stringify({ enable_thinking: false }),
];
const stream = fs.createWriteStream(
  'benchmarks/phone-offline-02/desktop-reference-gpu-runtime.log',
  { flags: 'wx' },
);
const child = spawn('.tooling/llama-cpp-mobile/vulkan/llama-server.exe', args, {
  cwd: process.cwd(),
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(stream);
child.stderr.pipe(stream);
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  console.log('runtime exit', code);
  process.exitCode = code ?? 1;
});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill());
console.log('Local compact-model evaluation runtime: 127.0.0.1:8792; no image upload');
