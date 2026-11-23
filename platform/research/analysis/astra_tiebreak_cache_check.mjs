/** A synthetic start flag drives two real LOCAL probes. The first is a cache miss;
 * the second deliberately hits that same server's cache and must not count as a vote. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import assert from 'node:assert/strict';
const out = 'collab/baseline/v35-activation/hosting/tiebreak-cache-control.json',
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-tie-control-')),
  summary = {
    scope:
      'Synthetic initial flip, two local operations. No public cloud comparison and zero OpenAI calls.',
  },
  manifest = 'e0c09edc030f5dc547b2e4d803c0d6f34c4ae3062351c50121cb64c503077519';
let server;
try {
  const [t, v] = execFileSync(
    'nvidia-smi',
    ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true },
  )
    .split(',')
    .map(Number);
  assert(t < 80 && v < 7000 && os.freemem() > 2 * 2 ** 30);
  const check = net.createServer();
  await new Promise((r) => check.listen(0, '127.0.0.1', r));
  const port = check.address().port;
  await new Promise((r) => check.close(r));
  const url = 'http://127.0.0.1:' + port;
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !/^RELAY_|TOKEN|API_KEY|SECRET|PASSWORD/i.test(k)),
  );
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index-v2.ts'], {
    env: {
      ...clean,
      RELAY_HOST: '127.0.0.1',
      RELAY_PORT: String(port),
      RELAY_OLLAMA_URL: 'http://127.0.0.1:11439',
      RELAY_SCORERS: 'local_logprob',
      RELAY_SIGNING_KEY: randomBytes(40).toString('hex'),
      RELAY_ALLOW_PAID: '0',
      RELAY_R2_ENABLED: '0',
    },
    windowsHide: true,
    stdio: 'ignore',
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const h = await fetch(url + '/v2/health').then((r) => r.json());
      if (h.engineRelease === '3.5' && !h.processingNotice) {
        ready = true;
        break;
      }
    } catch {}
    await wait(200);
  }
  assert(ready);
  const faux = path.join(work, 'synthetic-first.json');
  fs.writeFileSync(
    faux,
    JSON.stringify({
      manifest,
      operationalDecisionOrRoutingFlips: ['routed10/ov-066'],
      cascadeBranchChanges: [],
    }),
  );
  for (const [i, name] of ['fresh', 'cached'].entries()) {
    const dst = path.join(work, name);
    const proc = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'research/analysis/astra_cloud_parity.mjs', 'local', dst],
      {
        env: {
          ...clean,
          RELAY_PARITY_URL: url,
          RELAY_PARITY_TIE_REPORT: faux,
          RELAY_PARITY_PROCESS_EVIDENCE: 'test-pid-' + server.pid,
          RELAY_PARITY_ROUND: String(i + 1),
        },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 145000,
      },
    );
    if (!i) {
      assert.equal(proc.status, 0, proc.stderr.slice(-500));
      const row = JSON.parse(fs.readFileSync(path.join(dst, 'local.jsonl'), 'utf8'));
      assert(row.tieBreak.indexScoredFresh);
      summary.fresh = {
        scoredBefore: row.tieBreak.scoredBefore,
        scoredAfter: row.tieBreak.scoredAfter,
        cachedBefore: row.tieBreak.cachedBefore,
        cachedAfter: row.tieBreak.cachedAfter,
      };
    } else {
      assert.notEqual(proc.status, 0);
      assert.match(proc.stderr, /Rerun did not add one fresh score|cache hit cannot count/);
      summary.sameProcessCacheHitRejected = true;
    }
  }
  summary.passed = true;
} finally {
  if (server?.exitCode === null) {
    const end = once(server, 'exit');
    server.kill();
    await end;
  }
  assert.equal(path.dirname(work), os.tmpdir());
  assert(path.basename(work).startsWith('relay-tie-control-'));
  fs.rmSync(work, { recursive: true, force: true });
  fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n');
}
console.log(JSON.stringify(summary));
