import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { createDesk } from './desk';
/** The signed decision and photo membership establish the item. A sidecar can only annotate its existing sources. */
export function mountZoneSources(desk: ReturnType<typeof createDesk>) {
  const { app, base, folder, fail } = desk;
  app.get('/v4/items/:id/zone-display', async (q) => {
    const { id } = q.params as { id: string };
    const known = base(id);
    const f = path.join(folder(id), 'zone-display.json');
    if (!fs.existsSync(f)) return { version: 1, entries: {} };
    const v = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (v.version !== 1 || !v.entries) return { version: 1, entries: {} };
    const allowed = new Map(known.images.map((p) => [p.photoId, p]));
    const entries: Record<string, any> = {};
    for (const [k, raw] of Object.entries(v.entries)) {
      const e = raw as any,
        im = allowed.get(e?.photo);
      if (
        !im ||
        e.source !== im.workingHash ||
        typeof e.region !== 'string' ||
        k !== im.photoId + ':' + e.region ||
        !Number.isFinite(e.fraction) ||
        e.fraction < 0 ||
        e.fraction > 1
      )
        continue;
      if (
        ![...im.areaChecks, ...im.findings].some(
          (r) => r.regionHash === e.region && JSON.stringify(r.box) === JSON.stringify(e.box),
        )
      )
        continue;
      entries[k] = e;
    }
    return { version: 1, entries };
  });
  app.get('/v4/items/:id/viewer-labels', async (q) => {
    const { id } = q.params as { id: string };
    const raw = base(id),
      labels: Record<string, any> = {};
    await Promise.all(
      raw.images
        .filter((im) => im.role === 'tag')
        .map(async (im) => {
          const parent = raw.images.find((p) => im.anchor && p.workingHash === im.anchor) ?? im;
          const crop = im.acceptedLabelCrop?.hash ?? im.workingHash,
            rect = im.acceptedLabelCrop?.rect ?? im.region ?? [0, 0, 1, 1];
          const original = path.join(folder(id), 'regions', crop + '.jpg'),
            fallback = path.join(folder(id), 'photos', crop + '.jpg');
          const file = fs.existsSync(original) ? original : fallback;
          let exact = false,
            width = im.width,
            height = im.height;
          if (fs.existsSync(file)) {
            const buf = fs.readFileSync(file);
            if (createHash('sha256').update(buf).digest('hex') === crop) {
              const md = await sharp(buf).metadata();
              exact = true;
              width = md.width ?? width;
              height = md.height ?? height;
            }
          }
          labels[im.photoId] = {
            photo: im.photoId,
            parent: parent.photoId,
            crop,
            box: rect,
            exact,
            width,
            height,
          };
        }),
    );
    return { labels };
  });
  app.get('/v4/items/:id/zone-source/:hash', async (q, reply) => {
    const { id, hash } = q.params as { id: string; hash: string };
    if (!/^[a-f0-9]{64}$/.test(hash)) throw fail(404, 'Source crop unavailable.');
    const raw = base(id);
    if (
      !raw.images.some(
        (p) =>
          [...p.areaChecks, ...p.findings].some((r) => r.regionHash === hash) ||
          (p.role === 'tag' && (p.acceptedLabelCrop?.hash === hash || p.workingHash === hash)),
      )
    )
      throw fail(404, 'Source crop unavailable.');
    const regionFile = path.join(folder(id), 'regions', hash + '.jpg');
    const file = fs.existsSync(regionFile)
      ? regionFile
      : path.join(folder(id), 'photos', hash + '.jpg');
    if (!fs.existsSync(file)) throw fail(404, 'Source crop unavailable.');
    const b = fs.readFileSync(file);
    if (createHash('sha256').update(b).digest('hex') !== hash)
      throw fail(409, 'The crop could not be verified.');
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=1800').send(b);
  });
}
