/** One serial job, two independent in-memory scorer caches for a reproducible local drift baseline. */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { compareHardware, repeatabilityForRows } from './astra_hardware_comparison.mjs';
const root = 'collab/baseline/v35-activation/hosting',
  file = root + '/cloud-parity-closeups.json',
  dir = root + '/reference-closeups',
  raw = fs.readFileSync(file),
  m = JSON.parse(raw);
const hash = (b) => createHash('sha256').update(b).digest('hex'),
  signature = hash(raw);
assert.equal(signature, 'b2738e202a435fb0f2edac83cdd58bbba174801125ff620ed2bd5761e027a3c9');
const lines = (p) =>
  fs.existsSync(p)
    ? fs.readFileSync(p, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)
    : [];
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !/^RELAY_|TOKEN|API_KEY|SECRET|PASSWORD/i.test(k)),
);
let server, runner;
function stop() {
  if (runner?.exitCode === null) runner.kill();
  if (server?.exitCode === null) server.kill();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
fs.mkdirSync(dir, { recursive: true });
const passes = [];
for (const [name, port] of [
  ['first', 8803],
  ['repeat', 8804],
]) {
  const dst = path.join(dir, name),
    ledger = path.join(dst, 'local.jsonl');
  passes.push(ledger);
  if (lines(ledger).length === m.memberships) continue;
  const gpu = execFileSync(
    'nvidia-smi',
    ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true },
  )
    .split(',')
    .map(Number);
  const games = execFileSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert(
    gpu[0] < 80 &&
      gpu[1] < 7000 &&
      os.freemem() > 2 * 2 ** 30 &&
      !/^"(?:Civilization[^"]*|FortniteClient[^"]*|cs2|dota2|GTA5|eldenring|Overwatch|RocketLeague|[^"]*-Win64-Shipping)\.exe"/im.test(
        games,
      ),
    'Resource guard at startup',
  );
  const lock = net.createServer();
  await new Promise((r, j) => {
    lock.once('error', j);
    lock.listen(port, '127.0.0.1', r);
  });
  await new Promise((r) => lock.close(r));
  const url = 'http://127.0.0.1:' + port,
    flags = {
      ...env,
      RELAY_PORT: String(port),
      RELAY_HOST: '127.0.0.1',
      RELAY_SIGNING_KEY: randomBytes(40).toString('hex'),
      RELAY_OLLAMA_URL: 'http://127.0.0.1:11439',
      RELAY_SCORERS: 'local_logprob',
      RELAY_R2_ENABLED: '0',
      RELAY_ALLOW_PAID: '0',
    };
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index-v2.ts'], {
    env: flags,
    windowsHide: true,
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (server.exitCode !== null) break;
      try {
        const h = await fetch(url + '/v2/health').then((r) => r.json());
        if (h.engineRelease === '3.5' && !h.processingNotice) {
          ready = true;
          break;
        }
      } catch {}
      await wait(180);
    }
    assert(ready, 'Dedicated local reference server did not start');
    runner = spawn(
      process.execPath,
      ['--import', 'tsx', 'research/analysis/astra_cloud_parity.mjs', 'local', dst],
      {
        env: {
          ...env,
          RELAY_PARITY_MANIFEST: file,
          RELAY_PARITY_REVERSE: name === 'repeat' ? '1' : '0',
          RELAY_PARITY_URL: url,
        },
        windowsHide: true,
        stdio: 'inherit',
      },
    );
    const [code] = await once(runner, 'exit');
    if (code !== 0)
      throw Error(
        'The controlled ' +
          name +
          ' pass stopped; retain saved rows and investigate before resuming.',
      );
  } finally {
    if (server.exitCode === null) {
      const finish = once(server, 'exit');
      server.kill();
      await finish;
    }
    server = undefined;
    runner = undefined;
  }
}
const [a, b] = passes.map(lines);
assert.equal(a.length, m.memberships);
assert.equal(b.length, m.memberships);
const baseline = repeatabilityForRows(m, a, b);
assert.equal(baseline.issues.length, 0);
const write = (name, v) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(v, null, 2) + '\n');
write('local-repeatability.json', baseline);
const repeatResult = compareHardware(m, signature, a, b, baseline);
write('local-repeat-comparison.json', {
  scope:
    'Two independent local API scorer-cache processes, same original laptop GPU, opposite photo order. No cloud or external count calls.',
  ...repeatResult,
});
const branches = (r) =>
  Object.fromEntries(
    ['settled512', 'reasked1600'].map((k) => [
      k,
      r.filter((v) => v.detailCascadeBranch === k).length,
    ]),
  );
const sum = {
  manifest: signature,
  firstSha256: hash(fs.readFileSync(passes[0])),
  repeatSha256: hash(fs.readFileSync(passes[1])),
  perPass: a.length,
  views: m.viewCounts,
  firstBranches: branches(a),
  repeatBranches: branches(b),
  operativeLocalFlips: repeatResult.operationalDecisionOrRoutingFlips,
  localBranchChanges: repeatResult.cascadeBranchChanges,
  localMargins: repeatResult.smallestLocalDistanceToLine,
  photoSources: m.uniqueRawImages,
  threeDistinctLabelSources: true,
  openAICalls: 0,
  cloudSpendUsd: 0,
  hostedCloudQualified: false,
};
write('summary.json', sum);
console.log(JSON.stringify(sum));
