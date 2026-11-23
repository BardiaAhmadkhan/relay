/** A real close-up across the private GPU RPC and the local V3.5 HTTP API. No paid calls. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { scorePhoto } from '../../app/src/api-v2.ts';
import { prepareImages } from '../../server/images.ts';
import { inspectionScorer } from '../../packages/vision/v2/inspection-model.ts';
import { PlannedScorer } from '../../packages/vision/v2/plan.ts';
import { questionsFor } from '../../packages/vision/v2/battery.ts';
import { createGpuWorker, remoteGpuScorer } from '../../server/gpu-rpc.ts';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
const guard = () => {
  const [t, v] = execFileSync(
    'nvidia-smi',
    ['--query-gpu=temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true },
  )
    .split(',')
    .map(Number);
  const p = execFileSync(
    'nvidia-smi',
    ['--query-compute-apps=pid,process_name', '--format=csv,noheader'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (
    t >= 80 ||
    v >= 7000 ||
    os.freemem() < 2 * 2 ** 30 ||
    /\\steamapps\\common\\|\\xboxgames\\|shipping\.exe/i.test(p)
  )
    throw Error('Hardware guard');
};
const signal = AbortSignal.timeout(90000),
  secret = randomBytes(32).toString('hex'),
  raw = fs.readFileSync('datasets/realworld-v3/images/cm-107.jpg').toString('base64');
const cfg = (n) => JSON.parse(fs.readFileSync('packages/core/v2/' + n)).perScorer.local_logprob;
const hi = cfg('thresholds.json'),
  lo = cfg('thresholds.cascade512.json'),
  m = await inspectionScorer('http://127.0.0.1:11439');
const planner = new PlannedScorer(
  m,
  () => hi,
  () => lo,
);
let observed;
const worker = createGpuWorker(
  {
    id: planner.id,
    model: planner.model,
    async score(...args) {
      observed = await planner.score(...args);
      return observed;
    },
  },
  secret,
);
const url = await worker.listen({ host: '127.0.0.1', port: 0 });
try {
  guard();
  const ordinary = await scorePhoto(
    { url: 'http://127.0.0.1:8788', token: '' },
    { assessmentId: 'detail-rpc-verification', photoId: 'detail', view: 'detail', base64: raw },
    signal,
  );
  const image = async (edge) =>
    (await prepareImages([{ id: 'detail', view: 'detail', base64: raw }], edge)).images[0].jpeg;
  const full = await image(1600),
    low = await image(512);
  guard();
  const result = await remoteGpuScorer(url, secret).score(
    { jpeg: full, low, view: 'detail' },
    questionsFor('detail'),
    signal,
  );
  assert.deepEqual(result.answers, observed.answers);
  assert(result.answers.road_contact_low);
  assert(result.answers.broken_low);
  const sameDirect =
    JSON.stringify(
      Object.keys(result.answers)
        .sort()
        .map((k) => result.answers[k]),
    ) ===
    JSON.stringify(
      Object.keys(ordinary.signed.scores.answers)
        .sort()
        .map((k) => ordinary.signed.scores.answers[k]),
    );
  const rep = {
    photo: 'cm-107',
    view: 'detail',
    transportPreservesEveryValue: true,
    independentLocalRunExactlyEqual: sameDirect,
    localWorkingSha: ordinary.photo.sha256,
    keys: Object.keys(result.answers),
    paidCalls: 0,
    scope:
      'Live stock model, fresh normal HTTP score and same two image renditions over the private worker transport.',
  };
  fs.writeFileSync(
    'collab/baseline/v35-activation/hosting/split-detail.json',
    JSON.stringify(rep, null, 2) + '\n',
  );
  console.log(JSON.stringify(rep));
} finally {
  await worker.close();
}
