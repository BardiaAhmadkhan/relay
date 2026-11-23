import sharp from 'sharp';
import { remoteGpuScorer } from './gpu-rpc';
import { intakeMeter } from './intake-meter';
import { PolicyConfigSchema, ThresholdsSchema } from '../packages/core/v2/schema';
import configJson from '../packages/core/v2/policy.config.json';
import thresholdsJson from '../packages/core/v2/thresholds.json';
import cascadeJson from '../packages/core/v2/thresholds.cascade512.json';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { DecisionsScorer } from '../packages/vision/v2/scorer-decisions';
import { inspectionScorer, inspectionModel } from '../packages/vision/v2/inspection-model';
import { InspectionLane } from '../packages/vision/v2/inspection-lane';
import { PlannedScorer, staticKeys } from '../packages/vision/v2/plan';
import { BATTERY_VERSION, GARMENT_QUESTIONS } from '../packages/vision/v2/battery';
import type { Scorer } from '../packages/vision/v2/scorer';
import { createAppV2 } from './app-v2';

// Backend entry point (v2 contracts, v3 engine since 2026-11-17). RELAY_SCORERS is an ordered,
// comma-separated fallback list.
//   decisions      hosted closed-question scorer; needs GEMINI_API_KEY and RELAY_ALLOW_PAID=1
//   local_logprob  local model through the loopback runtime started by `npm run vision:serve`
// v3 switches, each on unless set to 0 (build guide section 14):
//   RELAY_PLAN=0     ask the whole battery on every photograph, as v2 did
//   RELAY_CASCADE=0  no 512 px first stage: every question on the full working image
//   RELAY_RECYCLE    unload the local model every N photographs (default 25; 0 turns it off)
const host = process.env.RELAY_HOST ?? '127.0.0.1';
const token = process.env.RELAY_ACCESS_TOKEN;
if (host !== '127.0.0.1' && host !== 'localhost' && (!token || token.length < 24))
  throw new Error('Serving beyond loopback needs a RELAY_ACCESS_TOKEN of at least 24 characters.');
const signingKey = process.env.RELAY_SIGNING_KEY ?? '';
const thresholds = ThresholdsSchema.parse(thresholdsJson);
const modelIdentity = inspectionModel.name + '@' + inspectionModel.digest.slice(0, 12);
thresholds.perScorer.local_logprob!.models = [modelIdentity, modelIdentity + ' cascade'];
if (Number(process.env.RELAY_WORKING_EDGE ?? 1600) !== 1600)
  throw new Error('The calibrated live checkpoint requires a 1600 pixel working image.');
const stage1 = ThresholdsSchema.parse(cascadeJson);
const plan = process.env.RELAY_PLAN !== '0';
const cascade =
  plan && process.env.RELAY_CASCADE !== '0' && stage1.batteryVersion === BATTERY_VERSION;
const recycleEvery = Number(process.env.RELAY_RECYCLE ?? 25);
const scorers: Scorer[] = [];
let localPromise: ReturnType<typeof inspectionScorer> | undefined;
function getLiveModel() {
  if (
    (process.env.RELAY_LOCAL_MODEL && process.env.RELAY_LOCAL_MODEL !== inspectionModel.name) ||
    (process.env.RELAY_LOCAL_DIGEST && process.env.RELAY_LOCAL_DIGEST !== inspectionModel.digest)
  )
    throw new Error(
      'The live engine requires the calibrated original Qwen 4B checkpoint and visual projector.',
    );
  return (localPromise ??= inspectionScorer(process.env.RELAY_OLLAMA_URL).catch((error) => {
    localPromise = undefined;
    throw error;
  }));
}
const lane = new InspectionLane(process.env.RELAY_GPU_ORIGIN ? 0 : recycleEvery, async () =>
  (await getLiveModel()).unload(),
);
for (const name of (process.env.RELAY_SCORERS ?? 'local_logprob').split(',').map((s) => s.trim())) {
  if (name === 'decisions') {
    if (process.env.RELAY_ALLOW_PAID !== '1')
      throw new Error(
        'The hosted scorer is disabled. Set RELAY_ALLOW_PAID=1 only after authorising charges.',
      );
    const hosted = new DecisionsScorer(process.env.GEMINI_API_KEY ?? '');
    // Billed per image, so one request with only the questions the rules can read (plan.ts).
    scorers.push(
      plan
        ? {
            id: hosted.id,
            model: hosted.model,
            score: (photo, questions, signal) =>
              hosted.score(photo, staticKeys(photo.view, questions), signal),
          }
        : hosted,
    );
  } else if (name === 'local_logprob' && process.env.RELAY_GPU_ORIGIN) {
    if (!plan || !cascade || (process.env.RELAY_SCORERS ?? 'local_logprob') !== 'local_logprob')
      throw new Error('The hosted photo worker requires the calibrated 3.5 cascade.');
    scorers.push(
      lane.wrap(
        remoteGpuScorer(
          process.env.RELAY_GPU_ORIGIN,
          process.env.RELAY_GPU_TOKEN,
          process.env.RELAY_GPU_PROVIDER_KEY,
        ),
      ),
    );
  } else if (name === 'local_logprob') {
    const local = await getLiveModel();
    const scorer: Scorer = plan
      ? new PlannedScorer(
          local,
          (id) => thresholds.perScorer[id],
          cascade ? (id) => stage1.perScorer[id] : undefined,
        )
      : local;
    scorers.push(lane.wrap(scorer));
  } else throw new Error('Unknown scorer: ' + name);
}
const chain = new ScorerChain(scorers);
let countReview;
if (
  process.env.RELAY_R2_ENABLED === '1' &&
  process.env.RELAY_R2_TERMS_COVERED === '1' &&
  process.env.RELAY_ALLOW_PAID === '1'
) {
  try {
    const { configuredCountReader } = await import('./count-reader');
    countReview = configuredCountReader(process.env, signingKey);
  } catch {
    console.warn('Optional count check unavailable. Using the ordinary assessment.');
  }
}
const app = createAppV2({
  intakeMeter: process.env.RELAY_USAGE_DB
    ? intakeMeter(process.env.RELAY_USAGE_DB, signingKey)
    : undefined,
  countReview,
  chain,
  // Preserve the existing live signing-context identifier for ordinary camera views.
  legacyPhotoContext: true,
  thresholds,
  config: PolicyConfigSchema.parse(configJson),
  signingKey,
  token,
  // The shipped thresholds were fitted on 1600 px images (thresholds.json `version`); the first-stage
  // thresholds on 512 px images (thresholds.cascade512.json).
  workingEdge: Number(process.env.RELAY_WORKING_EDGE ?? 1600),
  planned: plan,
  lowEdge: cascade ? 512 : undefined,
  // Expert console at /v2/review (work package 12). Verdicts append to a local, git-ignored file.
  review:
    process.env.RELAY_REVIEW === '1'
      ? { verdictsFile: process.env.RELAY_VERDICTS_FILE ?? 'data/verdicts.jsonl' }
      : undefined,
});
const address = await app.listen({ host, port: Number(process.env.RELAY_PORT ?? 8788) });
// Warm every scorer with a real scored request, so the first rider does not pay for model load and the
// first image evaluation (73 s cold on the reference laptop).
if (!process.env.RELAY_GPU_ORIGIN) {
  const warm = await sharp({
    create: { width: 256, height: 256, channels: 3, background: '#6b6b6b' },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  void chain
    .score(
      { photoId: 'warmup', view: 'detail', jpeg: warm },
      GARMENT_QUESTIONS.filter((q) => q.key === 'road_contact'),
      AbortSignal.timeout(180_000),
    )
    .then(
      (s) =>
        console.log(
          JSON.stringify({ event: 'scorer_warm', scorer: s.scorer.id, ms: Math.round(s.usage.ms) }),
        ),
      (e) =>
        console.log(
          JSON.stringify({ event: 'scorer_warm_failed', error: String(e?.message ?? e) }),
        ),
    );
}
console.log(
  JSON.stringify({
    event: 'service_ready',
    address,
    scorers: scorers.map((s) => s.id + ':' + s.model),
    engine: { plan, cascade, recycleEvery, workingEdge: process.env.RELAY_WORKING_EDGE ?? 1600 },
    imagesLogged: false,
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => void app.close().then(() => process.exit(0)));
