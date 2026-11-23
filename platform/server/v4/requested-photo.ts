import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { createDesk } from './desk';
import { stripMetadata } from '../../packages/core/v4/photo-privacy';
import { authentic } from './seal';
const state = z.enum(['actual', 'clear', 'custody_clear', 'crash']);
/** Supplemental evidence is filed against a signed decision for human review. It never mutates that decision. */
export function requestedPhotos(desk: ReturnType<typeof createDesk>, key: string) {
  const { app, db, root, current, fail, log } = desk;
  const area = path.join(path.dirname(root), 'v4-requested-photos');
  const records = (id: string, scenario: string) =>
    db
      .prepare("SELECT body FROM desk_event WHERE kind='requested_photo' AND item=? ORDER BY seq")
      .all(id)
      .map((row) => {
        const entry = JSON.parse(String(row.body));
        if (!authentic(entry, 'desk-event', key))
          throw fail(500, 'Supplementary evidence failed its integrity check.');
        return entry;
      })
      .filter((e) => e.value.payload.scenario === scenario);
  app.post('/v4/items/:id/requested-photo', async (q) => {
    const { id } = q.params as { id: string };
    const b = z
      .strictObject({
        scenario: state,
        inspection: z.string().regex(/^[a-f0-9]{64}$/),
        base64: z
          .string()
          .min(80)
          .max(6500000)
          .regex(/^[A-Za-z0-9+/=]+$/),
      })
      .parse(q.body);
    const check = () => {
      const item = current(id, b.scenario);
      if (item.sha256 !== b.inspection)
        throw fail(
          409,
          'This inspection changed. Open its current request before attaching a photo.',
        );
      if (
        !['request', 'specialist'].includes(item.value.result.action) ||
        !item.value.result.next ||
        /has it been in a crash|choose yes, no/i.test(item.value.result.next)
      )
        throw fail(422, 'This inspection has no open photo request.');
      return item.value.result.next;
    };
    check();
    const raw = Buffer.from(b.base64, 'base64'),
      clean = Buffer.from(stripMetadata(raw));
    if (!raw.equals(clean))
      throw fail(422, 'Remove location and camera metadata from this photograph.');
    let md;
    try {
      md = await sharp(clean, { limitInputPixels: 2560000 }).metadata();
    } catch {
      throw fail(422, 'Choose a readable JPEG photograph.');
    }
    if (md.format !== 'jpeg' || !md.width || !md.height || md.width > 1600 || md.height > 1600)
      throw fail(422, 'Choose a JPEG up to 1600 pixels on its longest edge.');
    const request = check(),
      hash = createHash('sha256').update(clean).digest('hex'),
      old = records(id, b.scenario).filter((r) => r.value.payload.inspection === b.inspection);
    const same = old.find((r) => r.value.payload.photo === hash);
    if (same) return { receipt: same.sha256, photo: hash, inspection: b.inspection };
    if (old.length >= 5)
      throw fail(422, 'This request already has five photos for the specialist.');
    const dir = path.join(area, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, hash + '.jpg');
    if (!fs.existsSync(file)) fs.writeFileSync(file, clean, { flag: 'wx' });
    const s = log('requested_photo', id, 'Rider', {
      scenario: b.scenario,
      inspection: b.inspection,
      photo: hash,
      request,
    });
    return { receipt: s.sha256, photo: hash, inspection: b.inspection };
  });
  app.get('/v4/items/:id/requested-photos', async (q) => {
    const { id } = q.params as { id: string },
      scenario = state.parse((q.query as { scenario?: string }).scenario ?? 'actual');
    current(id, scenario);
    return {
      items: await Promise.all(
        records(id, scenario).map(async (e) => {
          const photo = e.value.payload.photo;
          const meta = await sharp(path.join(area, id, photo + '.jpg')).metadata();
          return {
            photo,
            request: e.value.payload.request,
            inspection: e.value.payload.inspection,
            receipt: e.sha256,
            width: meta.width,
            height: meta.height,
          };
        }),
      ),
    };
  });
  app.get('/v4/items/:id/requested-photos/:hash', async (q, reply) => {
    const { id, hash } = q.params as { id: string; hash: string },
      scenario = state.parse((q.query as { scenario?: string }).scenario ?? 'actual');
    current(id, scenario);
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      !records(id, scenario).some((e) => e.value.payload.photo === hash)
    )
      throw fail(404, 'Photograph unavailable.');
    const bytes = fs.readFileSync(path.join(area, id, hash + '.jpg'));
    if (createHash('sha256').update(bytes).digest('hex') !== hash)
      throw fail(500, 'Photograph integrity check failed.');
    return reply.type('image/jpeg').header('Cache-Control', 'private, max-age=300').send(bytes);
  });
}
