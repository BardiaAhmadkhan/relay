// Backend v2 service with the stub scorer: the whole app flow without a model or a GPU.
// For rehearsals, demos of the flow and browser tests. Never for measurements: the stub's model name
// says "stub" in every record and on /v2/health.
//
//   npx tsx scripts/v2-demo-service.ts [--port 8790] [--damage 0.4] [--delay 600]
//
// --damage sets the road-contact answer for every garment photograph (0.4 lands in the review band,
// 0.9 blocks); --delay adds milliseconds per photograph so the "Checking this photo" state is visible.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PolicyConfigSchema, ThresholdsSchema } from '../packages/core/v2/schema';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { createAppV2 } from '../server/app-v2';
import { CLEAN_ITEM, stubScorer } from '../server/stub-scorer';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(a.slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
  }
}
const root = path.resolve(import.meta.dirname, '..');
const read = async (p: string) => JSON.parse(await fs.readFile(path.join(root, p), 'utf8'));
const state = {
  answers: {
    ...CLEAN_ITEM,
    ...(args.get('damage') ? { road_contact: Number(args.get('damage')) } : {}),
  },
  delayMs: Number(args.get('delay') ?? 0),
};
const app = createAppV2({
  chain: new ScorerChain([stubScorer(state)]),
  thresholds: ThresholdsSchema.parse(await read('packages/core/v2/thresholds.json')),
  config: PolicyConfigSchema.parse(await read('packages/core/v2/policy.config.json')),
  signingKey: 'demo-signing-key-for-the-stub-service-only',
  workingEdge: 1024,
  review: { verdictsFile: path.join(root, 'data', 'demo-verdicts.jsonl') },
});
const address = await app.listen({ host: '127.0.0.1', port: Number(args.get('port') ?? 8790) });
console.log(JSON.stringify({ event: 'demo_service_ready', address, scorer: 'stub', state }));
