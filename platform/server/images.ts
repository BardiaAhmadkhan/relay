import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { analyzePixels } from '../packages/core/quality';
import type { AnalysisRequest, PhotoEvidence, VisionImage } from '../packages/core/schema';
export class IntakeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export async function prepareImages(
  inputs: AnalysisRequest['images'],
  maxEdge = 1600,
): Promise<{ photos: PhotoEvidence[]; images: VisionImage[] }> {
  const photos: PhotoEvidence[] = [],
    images: VisionImage[] = [];
  for (const input of inputs) {
    const bytes = Buffer.from(input.base64, 'base64');
    if (bytes.length > 4_200_000)
      throw new IntakeError(
        'image_too_large',
        'This photograph is too large. Choose a smaller image.',
        413,
      );
    let jpeg: Buffer,
      width: number,
      height: number,
      rgba: Buffer,
      previewWidth: number,
      previewHeight: number;
    try {
      const source = sharp(bytes, {
        limitInputPixels: 24_000_000,
        failOn: 'error',
        animated: false,
      });
      const metadata = await source.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1)
        throw new Error('Unsupported image format');
      const prepared = await source
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
      jpeg = prepared.data;
      width = prepared.info.width;
      height = prepared.info.height;
      const preview = await sharp(jpeg)
        .resize({ width: 192, height: 192, fit: 'inside' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      rgba = preview.data;
      previewWidth = preview.info.width;
      previewHeight = preview.info.height;
    } catch {
      throw new IntakeError(
        'invalid_image',
        'A photograph could not be opened. Use a still JPEG, PNG or WebP image under 24 megapixels.',
      );
    }
    const sha256 = createHash('sha256').update(jpeg).digest('hex');
    if (photos.some((p) => p.sha256 === sha256))
      throw new IntakeError(
        'duplicate_photo',
        'Two views contain the same photograph. Replace one with a different view.',
      );
    photos.push({
      id: input.id,
      view: input.view,
      sha256,
      byteLength: jpeg.length,
      quality: analyzePixels(rgba, previewWidth, previewHeight, width, height),
    });
    images.push({ id: input.id, view: input.view, jpeg });
  }
  return { photos, images };
}
