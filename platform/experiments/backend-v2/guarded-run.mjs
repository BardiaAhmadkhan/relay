// Run one GPU experiment under a watchdog (added 2026-11-17 after two power losses on this laptop).
//
//   node experiments/backend-v2/guarded-run.mjs --label <name> --model <ollama model> -- <command...>
//
// Every 5 s it records GPU memory, temperature, power and utilisation and free system RAM to
// benchmarks/backend-v2/gpu-watch.csv. If GPU memory passes --vram-mib (default 7000 of 8151), the GPU
// reaches --temp-c (default 87) or free system RAM drops below --ram-mib (default 2048), it kills the
// experiment's process tree and asks the runtime to unload the model, which frees the GPU memory.
// Owner's instruction: models of 4B parameters or smaller only, and never fill the GPU memory.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep < 0) throw new Error('usage: guarded-run.mjs --label x --model m -- <command...>');
const opts = {};
for (let i = 0; i < sep; i += 2) opts[argv[i].replace(/^--/, '')] = argv[i + 1];
const command = argv.slice(sep + 1);
const label = opts.label ?? 'job';
const model = opts.model;
const limits = {
  vramMiB: Number(opts['vram-mib'] ?? 7000),
  tempC: Number(opts['temp-c'] ?? 87),
  ramMiB: Number(opts['ram-mib'] ?? 2048),
};
if (model && /:(9b|[1-9]\d+b)\b/i.test(model)) throw new Error('Refused: only models of 4B or smaller may run here.');
const root = path.resolve(import.meta.dirname, '..', '..');
const csv = path.join(root, 'benchmarks', 'backend-v2', 'gpu-watch.csv');
if (!fs.existsSync(csv))
  fs.writeFileSync(csv, 'time,label,vram_used_mib,vram_total_mib,temp_c,power_w,util_pct,free_ram_mib,action\n');

const sample = () =>
  new Promise((resolve) =>
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.used,memory.total,temperature.gpu,power.draw,utilization.gpu', '--format=csv,noheader,nounits'],
      { timeout: 4000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const [used, total, temp, power, util] = stdout.trim().split(',').map((v) => Number(v.trim()));
        resolve({ used, total, temp, power, util });
      },
    ),
  );
const child = spawn(command[0], command.slice(1), { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const peak = { used: 0, temp: 0, power: 0, minFreeRam: Infinity };
let stopped = null;
async function unload() {
  if (!model) return;
  await fetch((process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11435') + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}
function killTree() {
  if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
  else child.kill('SIGKILL');
}
const timer = setInterval(async () => {
  const s = await sample();
  const freeRam = Math.round(os.freemem() / 1048576);
  let action = '';
  if (s) {
    peak.used = Math.max(peak.used, s.used);
    peak.temp = Math.max(peak.temp, s.temp);
    peak.power = Math.max(peak.power, s.power);
    if (!stopped && (s.used > limits.vramMiB || s.temp >= limits.tempC)) stopped = s.used > limits.vramMiB ? 'vram' : 'temperature';
  }
  peak.minFreeRam = Math.min(peak.minFreeRam, freeRam);
  if (!stopped && freeRam < limits.ramMiB) stopped = 'system_ram';
  if (stopped && !action) {
    action = 'stop_' + stopped;
    killTree();
    await unload();
  }
  fs.appendFileSync(
    csv,
    [new Date().toISOString(), label, s?.used ?? '', s?.total ?? '', s?.temp ?? '', s?.power ?? '', s?.util ?? '', freeRam, action].join(',') + '\n',
  );
}, 5000);
child.on('exit', async (code) => {
  clearInterval(timer);
  const summary = { label, exitCode: code, stopped, peakVramMiB: peak.used, peakTempC: peak.temp, peakPowerW: peak.power, minFreeRamMiB: peak.minFreeRam, limits };
  console.log('GUARD ' + JSON.stringify(summary));
  process.exit(stopped ? 3 : (code ?? 1));
});
