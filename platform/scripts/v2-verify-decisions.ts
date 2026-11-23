// First contact with the hosted closed-question service. Sends ONE public fixture and prints the raw reply,
// the mapped answers, the billed tokens and the latency, so the adapter can be corrected to reality.
//
//   $env:GEMINI_API_KEY = "..."; npx tsx scripts/v2-verify-decisions.ts [path/to/public-image.jpg]
//
// Default image: assets/fixtures/crashed-shoulder.jpg (CC BY-SA 4.0, see assets/fixtures/ATTRIBUTION.md).
// Do not point this at private or event photographs on a free-tier key.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {
  GARMENT_QUESTIONS,
  ZONE_QUESTIONS,
  renderInstruction,
} from '../packages/vision/v2/battery';
import { DecisionsScorer } from '../packages/vision/v2/scorer-decisions';

const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error('Set GEMINI_API_KEY first.');
const root = path.resolve(import.meta.dirname, '..');
const file = process.argv[2] ?? path.join(root, 'assets/fixtures/crashed-shoulder.jpg');
const jpeg = await sharp(await fs.readFile(file))
  .rotate()
  .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 84 })
  .toBuffer();
const questions = [...GARMENT_QUESTIONS, ...ZONE_QUESTIONS.jacket!];

// 1. Raw request, so a mismatch with the published reference is visible before any mapping.
const started = performance.now();
const raw = await fetch('https://generativelanguage.googleapis.com/v1beta/decisions', {
  method: 'POST',
  headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'gemini-decision-1',
    input: [
      { type: 'image', data: jpeg.toString('base64'), mime_type: 'image/jpeg', resolution: 'high' },
    ],
    questions: Object.fromEntries(
      questions.map((q) => [
        q.key,
        q.type === 'yesno'
          ? { type: 'noul', instructions: renderInstruction(q) }
          : q.type === 'choice'
            ? { type: 'choice', instructions: renderInstruction(q), criteria: q.options }
            : { type: 'score', instructions: renderInstruction(q), criteria: q.levels },
      ]),
    ),
  }),
});
console.log('HTTP', raw.status, Math.round(performance.now() - started), 'ms');
console.log(JSON.stringify(await raw.json(), null, 2));

// 2. Through the adapter. A failure here with a 200 above means the mapping needs correcting.
for (const resolution of ['low', 'medium', 'high'] as const) {
  const scorer = new DecisionsScorer(key, 'gemini-decision-1', resolution);
  try {
    const result = await scorer.score({ jpeg }, questions, AbortSignal.timeout(30_000));
    console.log(resolution, {
      ms: Math.round(result.ms),
      inputTokens: result.inputTokens,
      estimatedUsd: +((result.inputTokens * 0.1) / 1e6).toFixed(6),
      broken: result.answers.broken,
      road_contact: result.answers.road_contact,
      category: result.answers.category,
      wear: result.answers.wear,
      zone_shoulder: result.answers.zone_shoulder,
    });
  } catch (error) {
    console.log(resolution, 'FAILED', error instanceof Error ? error.message : error);
  }
}
