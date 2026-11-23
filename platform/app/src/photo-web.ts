import { analyzePixels } from '../../packages/core/quality';
import type { PhotoView } from '../../packages/core/schema';
/** Browser preview encoding. One decode, one final encode; no idle-scheduled toBlob chain. */
export async function prepareWebPhoto(uri: string, view: PhotoView, id: string) {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The photograph could not be opened.'));
  });
  image.src = uri;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      loaded,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The photograph took too long to open. Please choose it again.')),
          15000,
        );
      }),
    ]);
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 50_000_000
    )
      throw new Error('Choose a photograph under 50 megapixels.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale)),
      height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const preview = document.createElement('canvas'),
      ratio = Math.min(1, 192 / Math.max(width, height));
    preview.width = Math.max(3, Math.round(width * ratio));
    preview.height = Math.max(3, Math.round(height * ratio));
    const small = preview.getContext('2d', { willReadFrequently: true });
    if (!small) throw new Error('Photo quality could not be checked.');
    small.drawImage(canvas, 0, 0, preview.width, preview.height);
    const pixels = small.getImageData(0, 0, preview.width, preview.height);
    const quality = analyzePixels(pixels.data, preview.width, preview.height, width, height);
    const finalUri = canvas.toDataURL('image/jpeg', 0.82);
    canvas.width = canvas.height = preview.width = preview.height = 0;
    return { id, view, uri: finalUri, width, height, quality };
  } finally {
    if (timer) clearTimeout(timer);
    image.onload = null;
    image.onerror = null;
    if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
  }
}
