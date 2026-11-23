import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { tagReader, routingReason, extractionTask } from './tag-reader';
import { stripMetadata } from '../../packages/core/v4/photo-privacy';
import type { SourceCase } from './dossier';

/** Only a crop produced by intake can leave. Never send a wide photo, history, price, or dossier. */
export async function fillTagFields(
  input: SourceCase,
  itemDirectory: string,
  env: NodeJS.ProcessEnv,
  permitted: boolean,
) {
  if (!permitted || env.RELAY_V4_ALLOW_EXTERNAL_TAGS !== '1') return input;
  const reader = tagReader(env);
  if (!reader) return input;
  for (const im of input.images) {
    if (
      im.role !== 'tag' ||
      !im.region ||
      !im.anchor ||
      im.acceptedLabel ||
      !routingReason(im.label)
    )
      continue;
    try {
      const f = path.join(itemDirectory, 'photos', im.workingHash + '.jpg');
      const redacted = Buffer.from(stripMetadata(await fs.promises.readFile(f)));
      const meta = await sharp(redacted).metadata();
      if (!meta.width || !meta.height || Math.max(meta.width, meta.height) > 1600) continue;
      const result = await reader.read(extractionTask, redacted, routingReason(im.label)!);
      if (result.status === 'completed' && result.text) {
        im.acceptedLabel = result.text;
        im.acceptedLabelCrop = {
          hash: createHash('sha256').update(redacted).digest('hex'),
          rect: im.region,
        };
      }
    } catch {
      /* The local reading and its confirmation state survive any unavailable reader. */
    }
  }
  return input;
}
