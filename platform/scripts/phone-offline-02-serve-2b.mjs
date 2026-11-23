import { spawn } from 'node:child_process';
import fs from 'node:fs';
const args = [
  '-m',
  '.cache/mobile-vision/qwen-2b-q4.gguf',
  '--mmproj',
  '.cache/mobile-vision/qwen-2b-mmproj-f16.gguf',
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
  '--no-mmproj-offload',
  '--chat-template-kwargs',
  JSON.stringify({ enable_thinking: false }),
];
const stream = fs.createWriteStream('benchmarks/phone-offline-02/desktop-2b-runtime.log', {
  flags: 'wx',
});
const child = spawn('.tooling/llama-cpp-mobile/runtime/llama-server.exe', args, {
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
