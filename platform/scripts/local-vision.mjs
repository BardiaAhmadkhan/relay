import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const model = 'qwen3.5:4b',
  digest = 'd8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const action = process.argv[2],
  url = 'http://127.0.0.1:11435';
if (action === 'warm') {
  const r = await fetch(url + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, stream: false, keep_alive: '30m' }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error('Local model could not be warmed');
  console.log('Local inspection model is loaded.');
} else if (action === 'serve' || action === 'pull') {
  await fs.mkdir(path.join(root, '.cache/ollama'), { recursive: true });
  const runtime = process.env.RELAY_OLLAMA_BIN ?? 'ollama';
  const child = spawn(runtime, action === 'serve' ? ['serve'] : ['pull', model], {
    cwd: root,
    env: {
      ...process.env,
      OLLAMA_HOST: '127.0.0.1:11435',
      OLLAMA_MODELS: path.join(root, '.cache/ollama'),
      OLLAMA_NO_CLOUD: '1',
      OLLAMA_NUM_PARALLEL: '1',
      OLLAMA_MAX_LOADED_MODELS: '1',
      OLLAMA_CONTEXT_LENGTH: '8192',
      // Ollama 0.40.16 starts llama-server without --cache-ram, so llama.cpp keeps an 8 GiB prompt cache
      // in system RAM; this was the per-photograph RAM growth in E12. Off, memory stays flat with the same
      // answers and speed (experiment report E12d). Set LLAMA_ARG_CACHE_RAM yourself to override.
      LLAMA_ARG_CACHE_RAM: process.env.LLAMA_ARG_CACHE_RAM ?? '0',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', () => {
    console.error('Install Ollama or set RELAY_OLLAMA_BIN to its executable, then retry.');
    process.exitCode = 1;
  });
  child.on('exit', async (code) => {
    process.exitCode = code ?? 1;
    if (action === 'pull' && code === 0) {
      const r = await fetch(url + '/api/tags');
      const tags = await r.json();
      if (!tags.models?.some((m) => m.name === model && m.digest === digest)) {
        console.error(
          'Downloaded model differs from the evaluated digest. Do not activate it without a new evaluation.',
        );
        process.exitCode = 1;
      }
    }
  });
} else throw new Error('Use serve, pull or warm.');
