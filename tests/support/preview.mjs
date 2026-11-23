import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Start the real production entry point with an isolated, example-only configuration. */
export async function withPreview(check, settings = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('RELAY_')),
  );
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: { ...env, ...settings, HOST: '127.0.0.1', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines = createInterface({ input: child.stdout });
  const ended = once(child, 'close');
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  let timer;
  try {
    const url = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Relay did not start in time.')), 20000);
      lines.on('line', (line) => {
        const match = /^Relay web on (http:\/\/127\.0\.0\.1:[1-9]\d*)$/.exec(line);
        if (match) resolve(match[1]);
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error('Relay exited before startup: ' + code)));
    });
    clearTimeout(timer);
    return await check(url);
  } finally {
    clearTimeout(timer);
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await ended;
  }
}
