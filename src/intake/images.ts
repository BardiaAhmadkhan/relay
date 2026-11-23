import { type Prepared, type Rect } from '../shared/domain';
import { stripMetadata } from '../engine/photo-privacy';
import { rasterMime } from './photo-format';
import { labelRect } from '../shared/workshop';
export async function readImage(file: File, includeLabel = false): Promise<Prepared> {
  if (file.size > 64 * 1024 * 1024) throw Error('Choose a photo smaller than 64 MB.');
  const mime = rasterMime(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  if (!mime) throw Error('Choose a photograph in a format your browser can open.');
  const url = URL.createObjectURL(file.type === mime ? file : file.slice(0, file.size, mime));
  const image = new Image();
  try {
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw Error('This photograph could not be opened. Try a JPEG, PNG or WebP copy.');
    }
    const w = image.naturalWidth,
      h = image.naturalHeight;
    if (!w || !h || w * h > 50_000_000) throw Error('Choose a photograph under 50 megapixels.');
    function render(rect: Rect) {
      const left = Math.floor(w * rect[0]),
        top = Math.floor(h * rect[1]);
      const sw = Math.max(1, Math.ceil(w * rect[2]) - left),
        sh = Math.max(1, Math.ceil(h * rect[3]) - top);
      const factor = Math.min(1, 1600 / Math.max(sw, sh)),
        c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw * factor));
      c.height = Math.max(1, Math.round(sh * factor));
      const ctx = c.getContext('2d');
      if (!ctx) throw Error('This browser cannot prepare a photograph.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(image, left, top, sw, sh, 0, 0, c.width, c.height);
      return {
        uri: 'data:image/jpeg;base64,' + b64(c.toDataURL('image/jpeg', 0.88)),
        width: c.width,
        height: c.height,
      };
    }
    const main = render([0, 0, 1, 1]);
    const binary = Uint8Array.from(atob(main.uri.split(',')[1]), (c) => c.charCodeAt(0));
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', binary)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    return { ...main, hash, ...(includeLabel ? { crop: render(labelRect).uri } : {}) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function b64(uri: string) {
  const raw = Uint8Array.from(atob(uri.slice(uri.indexOf(',') + 1)), (char) => char.charCodeAt(0));
  const clean = stripMetadata(raw);
  const pieces: string[] = [];
  for (let at = 0; at < clean.length; at += 32768)
    pieces.push(String.fromCharCode(...clean.subarray(at, at + 32768)));
  return btoa(pieces.join(''));
}
