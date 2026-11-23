// Score a set of photographs with one scorer and write production score records (one PhotoScores per line).
// This is the first half of calibration; scripts/v2-calibrate.ts is the second.
//
//   npx tsx scripts/v2-score-set.ts --list <list.json> --out <scores.jsonl> [--scorer local|decisions]
//        [--edge 1280] [--zones] [--limit n]
//
// list.json: [{ "photoId": "...", "file": "path/relative/to/repo", "view": "front|back|label|detail" }]
// --scorer decisions needs GEMINI_API_KEY. Use a paid key for anything but public licensed fixtures:
// free-tier content may be used to improve the provider's products.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { ViewSchema } from '../packages/core/schema';
import { questionsFor } from '../packages/vision/v2/battery';
import { ScorerChain } from '../packages/vision/v2/scorer-chain';
import { DecisionsScorer } from '../packages/vision/v2/scorer-decisions';
import { createLocalLogprobScorer } from '../packages/vision/v2/scorer-local';
import type { Scorer } from '../packages/vision/v2/scorer';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]!;
  if (a.startsWith('--')) {
    const next = process.argv[i + 1];
    args.set(a.slice(2), next && !next.startsWith('--') ? (i++, next) : 'true');
  }
}
const root = path.resolve(import.meta.dirname, '..');
const list = z
  .array(z.object({ photoId: z.string(), file: z.string(), view: ViewSchema.default('detail') }))
  .parse(JSON.parse(await fs.readFile(args.get('list') ?? '', 'utf8')))
  .slice(0, Number(args.get('limit') ?? 1e9));
const out = args.get('out');
if (!out) throw new Error('missing --out');
const edge = Number(args.get('edge') ?? 1280);
const kind = args.get('scorer') ?? 'local';
const scorer: Scorer =
  kind === 'decisions'
    ? new DecisionsScorer(process.env.GEMINI_API_KEY ?? '')
    : await createLocalLogprobScorer(
        process.env.RELAY_LOCAL_MODEL ?? 'qwen3.5:4b',
        process.env.RELAY_LOCAL_DIGEST,
        process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11435',
      );
const chain = new ScorerChain([scorer], { cacheTtlMs: 0 });
const finished = new Set(
  fsSync.existsSync(out)
    ? fsSync
        .readFileSync(out, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l).photoId as string)
    : [],
);
let done = 0,
  failed = 0;
for (const item of list) {
  if (finished.has(item.photoId)) continue;
  // The same normalisation the service applies: orientation, bounded edge, white background, JPEG.
  const jpeg = await sharp(await fs.readFile(path.join(root, item.file)), {
    limitInputPixels: 24_000_000,
  })
    .rotate()
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  try {
    let scores = await chain.score(
      { photoId: item.photoId, view: item.view, jpeg },
      questionsFor(item.view),
      AbortSignal.timeout(180_000),
    );
    const category = scores.answers.category;
    if (args.get('zones') === 'true' && category?.type === 'choice') {
      const zoned = await chain.score(
        { photoId: item.photoId, view: item.view, jpeg },
        questionsFor(item.view, category.choice).filter((q) => q.key.startsWith('zone_')),
        AbortSignal.timeout(180_000),
      );
      scores = {
        ...scores,
        answers: { ...scores.answers, ...zoned.answers },
        usage: {
          inputTokens: scores.usage.inputTokens + zoned.usage.inputTokens,
          ms: scores.usage.ms + zoned.usage.ms,
        },
      };
    }
    await fs.appendFile(out, JSON.stringify(scores) + '\n');
    done++;
  } catch (error) {
    failed++;
    console.error(item.photoId, error instanceof Error ? error.message : String(error));
  }
  if ((done + failed) % 20 === 0) console.log(done + failed + '/' + (list.length - finished.size));
}
console.log(
  JSON.stringify({ scorer: scorer.id, model: scorer.model, edge, scored: done, failed, out }),
);
