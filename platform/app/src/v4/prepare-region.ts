import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { stripMetadata } from '../../../packages/core/v4/photo-privacy';

export type PhotoRect = [number, number, number, number];
function normalize(rect: PhotoRect, w: number, h: number) {
  const [l, t, r, b] = rect;
  if (!rect.every(Number.isFinite) || l < 0 || t < 0 || r > 1 || b > 1 || l >= r || t >= b)
    throw Error('The selected part is outside the photograph.');
  const x = Math.min(w - 1, Math.floor(l * w)),
    y = Math.min(h - 1, Math.floor(t * h));
  return {
    originX: x,
    originY: y,
    width: Math.min(w - x, Math.max(1, Math.ceil(r * w) - x)),
    height: Math.min(h - y, Math.max(1, Math.ceil(b * h) - y)),
  };
}
function checked(raw: string) {
  const bytes = stripMetadata(Uint8Array.from(atob(raw), (s) => s.charCodeAt(0)));
  let text = '';
  for (let i = 0; i < bytes.length; i += 16384)
    text += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { base64: btoa(text), metadataChecked: true as const, byteLength: bytes.length };
}
export async function prepareRegion(uri: string, rect: PhotoRect, maxEdge = 1600) {
  if (!Number.isInteger(maxEdge) || maxEdge < 32 || maxEdge > 1600)
    throw Error('Invalid photograph size');
  if (Platform.OS === 'web') {
    const img = new Image();
    try {
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(Error('Could not open the photograph.'));
        img.src = uri;
      });
    } finally {
      img.onload = null;
      img.onerror = null;
    }
    if (img.naturalWidth * img.naturalHeight > 50_000_000)
      throw Error('Choose a photo under 50 megapixels.');
    const box = normalize(rect, img.naturalWidth, img.naturalHeight),
      scale = Math.min(1, maxEdge / Math.max(box.width, box.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(box.width * scale));
    cv.height = Math.max(1, Math.round(box.height * scale));
    try {
      const ctx = cv.getContext('2d');
      if (!ctx) throw Error('Could not prepare the photograph.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(
        img,
        box.originX,
        box.originY,
        box.width,
        box.height,
        0,
        0,
        cv.width,
        cv.height,
      );
      return {
        ...checked(cv.toDataURL('image/jpeg', 0.88).split(',')[1]!),
        width: cv.width,
        height: cv.height,
        rect,
      };
    } finally {
      cv.width = 0;
      cv.height = 0;
    }
  }
  const context = ImageManipulator.manipulate(uri);
  const source = await context.renderAsync();
  let tmp: string | undefined;
  try {
    if (source.width * source.height > 50_000_000)
      throw Error('Choose a photo under 50 megapixels.');
    const box = normalize(rect, source.width, source.height);
    const crop = ImageManipulator.manipulate(source);
    try {
      crop.crop(box);
      if (Math.max(box.width, box.height) > maxEdge)
        crop.resize(box.width >= box.height ? { width: maxEdge } : { height: maxEdge });
      const rendered = await crop.renderAsync();
      try {
        const saved = await rendered.saveAsync({
          format: SaveFormat.JPEG,
          compress: 0.88,
          base64: true,
        });
        tmp = saved.uri;
        if (!saved.base64) throw Error('Could not prepare the selected photograph.');
        return { ...checked(saved.base64), width: saved.width, height: saved.height, rect };
      } finally {
        rendered.release();
      }
    } finally {
      crop.release();
    }
  } finally {
    source.release();
    context.release();
    if (tmp && tmp !== uri)
      await FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => undefined);
  }
}
