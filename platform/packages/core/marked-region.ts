import { z } from 'zod';

const positivePixels = z.number().int().min(1).max(50000);
export const MarkedRegionSchema = z
  .strictObject({
    parentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
    parentView: z.enum(['front', 'back']),
    source: z.enum(['capture', 'saved_overview']),
    sourceWidth: positivePixels,
    sourceHeight: positivePixels,
    left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(),
    side: positivePixels,
  })
  .refine(
    (r) =>
      r.sourceWidth * r.sourceHeight <= 50_000_000 &&
      r.side >= 64 &&
      r.left + r.side <= r.sourceWidth &&
      r.top + r.side <= r.sourceHeight,
    { message: 'The selected area must fit inside the oriented photograph.' },
  );
export type MarkedRegion = z.infer<typeof MarkedRegionSchema>;
export type Selection = { x: number; y: number; extent: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** x/y locate the mark; extent describes the mark itself as a fraction of the short edge. */
export function cropPixels(width: number, height: number, selection: Selection) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= 50000) ||
    width * height > 50_000_000 ||
    ![selection.x, selection.y, selection.extent].every(Number.isFinite) ||
    selection.extent <= 0
  )
    throw new Error('Choose a clearer photograph to mark.');
  const short = Math.min(width, height);
  const side = Math.min(short, Math.max(64, Math.ceil(3 * selection.extent * short)));
  return {
    left: clamp(Math.round(selection.x * width - side / 2), 0, width - side),
    top: clamp(Math.round(selection.y * height - side / 2), 0, height - side),
    side,
  };
}

export function containFrame(width: number, height: number, boxWidth: number, boxHeight: number) {
  if (![width, height, boxWidth, boxHeight].every((n) => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return {
    left: (boxWidth - width * scale) / 2,
    top: (boxHeight - height * scale) / 2,
    width: width * scale,
    height: height * scale,
    scale,
  };
}

export function photoPoint(frame: ReturnType<typeof containFrame>, x: number, y: number) {
  if (
    !frame ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < frame.left ||
    x > frame.left + frame.width ||
    y < frame.top ||
    y > frame.top + frame.height
  )
    return null;
  return { x: (x - frame.left) / frame.width, y: (y - frame.top) / frame.height };
}

export function sameRegion(a?: MarkedRegion, b?: MarkedRegion) {
  return (
    (!a && !b) ||
    (!!a &&
      !!b &&
      a.parentId === b.parentId &&
      a.parentView === b.parentView &&
      a.source === b.source &&
      a.sourceWidth === b.sourceWidth &&
      a.sourceHeight === b.sourceHeight &&
      a.left === b.left &&
      a.top === b.top &&
      a.side === b.side)
  );
}
