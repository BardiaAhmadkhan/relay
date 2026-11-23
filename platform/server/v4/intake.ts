import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { setInterval, clearInterval } from 'node:timers';
import sharp from 'sharp';
import { z } from 'zod';
import { createDesk } from './desk';
import { stripMetadata } from '../../packages/core/v4/photo-privacy';
import { buildDossier, header } from './dossier';
import { seal, authentic } from './seal';
import { fillTagFields } from './enrich';
import { requestedPhotos } from './requested-photo';
import { mountZoneSources } from './zone-source';
import { intakeViews, requiredViews, type IntakeView } from '../../packages/core/v4/capture-views';

export function registerIntake(
  desk: ReturnType<typeof createDesk>,
  cfg: {
    key: string;
    python: string;
    root: string;
    spawnWorker?: (program: string, args: string[], options: SpawnOptions) => ChildProcess;
  },
) {
  const { app, db, folder, fail } = desk;
  requestedPhotos(desk, cfg.key);
  mountZoneSources(desk);
  const idRE = /^capture-[a-f0-9]{18}$/;
  const parentRoot = path.join(path.dirname(cfg.root), 'v4-received');
  const workRoot = path.join(path.dirname(cfg.root), 'v4-inflight');
  fs.mkdirSync(workRoot, { recursive: true });
  fs.mkdirSync(parentRoot, { recursive: true });
  const getJob = (id: string) => {
    if (!idRE.test(id)) throw fail(422, 'Invalid intake.');
    const dir = path.join(parentRoot, id);
    if (!fs.existsSync(dir)) throw fail(404, 'Intake not found.');
    const job = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    return { dir, job };
  };
  const set = (dir: string, s: any) => {
    const f = path.join(dir, 'status.json'),
      tmp = f + '.' + randomBytes(5).toString('hex') + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, f);
  };
  const busy = new Set<string>();
  const pending: string[] = [];
  let closing = false,
    recovering = true;
  const activeState = (s: string) => s === 'queued' || s === 'analyzing';
  const busyMessage =
    'The checker is busy finishing another garment. Your photos are kept. Tap Open inspection to try again.';
  const published = (id: string) => {
    const f = path.join(folder(id), 'inspection.json');
    if (!fs.existsSync(f)) return false;
    try {
      return authentic(JSON.parse(fs.readFileSync(f, 'utf8')), 'inspection', cfg.key);
    } catch {
      return false;
    }
  };
  const publicStatus = (job: any) => ({
    id: job.id,
    state:
      job.state === 'queued' &&
      typeof job.attempt === 'string' &&
      /^[a-f0-9]{16}$/.test(job.attempt) &&
      fs.existsSync(path.join(workRoot, job.attempt, '.gpu-started'))
        ? 'analyzing'
        : job.state,
    photoCount: job.photoCount,
    message: job.message,
    createdAt: job.createdAt,
  });
  app.post('/v4/intakes', async (q) => {
    const b = z
      .strictObject({
        exclusionHistory: z.enum(['yes', 'no', 'unknown']),
        processingTerms: z.boolean().default(false),
        captureMode: z.literal('guided').optional(),
      })
      .parse(q.body);
    const id = 'capture-' + randomBytes(9).toString('hex'),
      dir = path.join(parentRoot, id);
    fs.mkdirSync(dir);
    set(dir, {
      id,
      exclusionHistory: b.exclusionHistory,
      processingTerms: b.processingTerms,
      captureMode: b.captureMode,
      views: {},
      state: 'capture',
      photoCount: 0,
      createdAt: new Date().toISOString(),
    });
    return { id, state: 'capture' };
  });
  app.get('/v4/intakes/:id', async (q) => {
    const { job } = getJob((q.params as any).id);
    return publicStatus(job);
  });
  app.post('/v4/intakes/:id/photos', async (q) => {
    const id = (q.params as any).id;
    let { dir, job } = getJob(id);
    if (job.state !== 'capture') throw fail(409, 'This intake has already started.');
    const b = z
      .strictObject({
        base64: z
          .string()
          .min(80)
          .max(6500000)
          .regex(/^[A-Za-z0-9+/=]+$/),
        rect: z
          .tuple([
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
            z.number().min(0).max(1),
          ])
          .optional(),
        nativeRegion: z
          .string()
          .min(80)
          .max(4000000)
          .regex(/^[A-Za-z0-9+/=]+$/)
          .optional(),
        purpose: z.enum(['overview', 'attached_label']).default('overview'),
        view: z.enum(intakeViews).optional(),
      })
      .parse(q.body);
    const raw = Buffer.from(b.base64, 'base64'),
      clean = Buffer.from(stripMetadata(raw));
    // Photo privacy is enforced on device and independently validated on entry.
    if (!raw.equals(clean))
      throw fail(422, 'Please reselect the image so its metadata is removed on your device.');
    const md = await sharp(clean, { limitInputPixels: 50_000_000 }).metadata();
    if (!md.width || !md.height || md.width > 1600 || md.height > 1600 || md.format !== 'jpeg')
      throw fail(422, 'Unsupported evidence size.');
    ({ dir, job } = getJob(id));
    if (job.state !== 'capture') throw fail(409, 'The intake has started.');
    const sha = createHash('sha256').update(clean).digest('hex'),
      file = path.join(dir, sha + '.jpg');
    let childAsset: { hash: string; bytes: Buffer; receipt: unknown } | undefined;
    if (b.purpose === 'attached_label' && !b.rect)
      throw fail(422, 'A label region and its surrounding context are required.');
    if (b.purpose === 'attached_label' && b.rect) {
      const [l, t, r, bt] = b.rect;
      if (r <= l || bt <= t || r - l > 0.94 || bt - t > 0.94)
        throw fail(422, 'Choose a tag with surrounding garment visible.');
      const x = Math.floor(l * md.width),
        y = Math.floor(t * md.height);
      const crop = Buffer.from(
        stripMetadata(
          await sharp(clean)
            .extract({
              left: x,
              top: y,
              width: Math.max(1, Math.min(md.width - x, Math.ceil(md.width * r) - x)),
              height: Math.max(1, Math.min(md.height - y, Math.ceil(md.height * bt) - y)),
            })
            .jpeg({ quality: 92 })
            .toBuffer(),
        ),
      );
      let chosen = crop;
      if (b.nativeRegion) {
        const n = Buffer.from(b.nativeRegion, 'base64'),
          safe = Buffer.from(stripMetadata(n));
        if (!n.equals(safe)) throw fail(422, 'Metadata was found in the tag region.');
        const m = await sharp(safe, { limitInputPixels: 4_000_000 }).metadata();
        if (!m.width || !m.height || m.width > 1600 || m.height > 1600)
          throw fail(422, 'Invalid source region.');
        const expected = ((r - l) * md.width) / ((bt - t) * md.height);
        if (Math.abs(Math.log(m.width / m.height / expected)) > 0.075)
          throw fail(422, 'The region does not match the parent framing.');
        const miniature = (x: Buffer) =>
          sharp(x)
            .resize(38, 38, { fit: 'fill' })
            .removeAlpha()
            .toColourspace('srgb')
            .raw()
            .toBuffer();
        const [smallParent, smallNative] = await Promise.all([miniature(crop), miniature(safe)]);
        let difference = 0,
          s = 0,
          ss = 0;
        for (let i = 0; i < smallParent.length; i++) {
          const v = smallParent[i]!;
          difference += Math.abs(v - smallNative[i]!);
          s += v;
          ss += v * v;
        }
        const length = smallParent.length,
          spread = Math.sqrt(Math.max(0, ss / length - (s / length) ** 2));
        // Uniform cloth could match any photo, so only the actual server-derived child can bind in this case.
        // The high-resolution image may sharpen text, but the downsampled context must line up as well.
        if (spread >= 12 && difference / length <= 7) chosen = safe;
        else if (difference / length > 12)
          throw fail(422, 'This tag does not align with the submitted parent photo.');
      }
      const hash = createHash('sha256').update(chosen).digest('hex');
      const receipt = seal(
        'same-frame-derivation',
        {
          intake: id,
          parent: sha,
          child: hash,
          derivedProof: createHash('sha256').update(crop).digest('hex'),
          sourceMode: chosen === crop ? 'server-derived' : 'native with verified parent projection',
          rect: b.rect,
          metadataChecked: true,
        },
        cfg.key,
      );
      childAsset = { hash, bytes: chosen, receipt };
    }
    // Validate the entire parent/child request before publishing either asset. Re-read after asynchronous
    // image decoding so two uploads, a retry or Finish cannot overwrite a newer count or state.
    ({ dir, job } = getJob(id));
    if (job.state !== 'capture') throw fail(409, 'The intake has started.');
    if (job.captureMode === 'guided') {
      if (
        !b.view ||
        (b.view === 'label'
          ? !childAsset || b.purpose !== 'attached_label'
          : b.purpose !== 'overview')
      )
        throw fail(422, 'Use the requested view and include the garment around its label.');
      const previous: Partial<Record<IntakeView, string>> = job.views ?? {};
      if (previous[b.view] && previous[b.view] !== sha)
        throw fail(409, 'This set has already started uploading. Open a new set for a retake.');
      if (Object.entries(previous).some(([view, hash]) => view !== b.view && hash === sha))
        throw fail(422, 'Each view needs a different photograph.');
      job.views = { ...previous, [b.view]: sha };
    }
    const parents = new Set<string>(
      job.parents ??
        (job.photoCount
          ? fs
              .readdirSync(dir)
              .filter((n) => n.endsWith('.jpg'))
              .map((n) => n.slice(0, -4))
          : []),
    );
    if (!parents.has(sha) && parents.size >= 24)
      throw fail(422, 'This intake already contains 24 photographs.');
    const files = new Set(fs.readdirSync(dir).filter((name) => name.endsWith('.jpg')));
    files.add(sha + '.jpg');
    if (childAsset) files.add(childAsset.hash + '.jpg');
    if (files.size > 160)
      throw fail(
        422,
        'The inspection supports at most 160 distinct source images and derived regions.',
      );
    const writeAsset = (f: string, v: Buffer) => {
      if (!fs.existsSync(f)) fs.writeFileSync(f, v, { flag: 'wx' });
    };
    writeAsset(file, clean);
    if (childAsset) {
      writeAsset(path.join(dir, childAsset.hash + '.jpg'), childAsset.bytes);
      db.prepare('INSERT OR IGNORE INTO native_photo(id,case_id,sha,body) VALUES (?,?,?,?)').run(
        childAsset.hash + ':' + id,
        id,
        childAsset.hash,
        JSON.stringify(childAsset.receipt),
      );
    }
    parents.add(sha);
    job.parents = [...parents];
    job.photoCount = parents.size;
    set(dir, job);
    return { photo: sha, derived: childAsset?.hash, metadataChecked: true, count: job.photoCount };
  });
  app.post('/v4/intakes/:id/finish', async (q) => {
    const id = (q.params as any).id;
    const { dir, job } = getJob(id);
    if (job.state === 'complete' || activeState(job.state)) return publicStatus(job);
    if (
      job.captureMode === 'guided' &&
      (job.exclusionHistory ?? job.crash) !== 'yes' &&
      !requiredViews.every((view) => job.views?.[view])
    )
      throw fail(
        422,
        'Add the front, back, attached label and inside front before opening the inspection.',
      );
    if (!job.photoCount && (job.exclusionHistory ?? job.crash) !== 'yes')
      throw fail(422, 'Add at least one photograph.');
    if ((job.exclusionHistory ?? job.crash) === 'yes' && !job.photoCount) {
      const dest = folder(id);
      fs.mkdirSync(dest, { recursive: true });
      const input = header.parse({
        id,
        category: 'unknown',
        at: new Date().toISOString(),
        images: [],
        history: 'unknown',
        damage: 'unknown',
        repair: 'unknown',
        combinedHistory: 'yes',
        foundation: 'no_offer',
        foundationReason: 'The rider reported a crash, damage, or a repair in an impact area.',
      });
      fs.writeFileSync(path.join(dest, 'input.json'), JSON.stringify(input));
      fs.writeFileSync(
        path.join(dest, 'inspection.json'),
        JSON.stringify(buildDossier(input, cfg.key)),
      );
      const b = {
        outcome: 'no_offer',
        summary: 'The rider reported at least one exclusion.',
        grade: null,
      };
      fs.writeFileSync(
        path.join(dest, 'foundation.json'),
        JSON.stringify({
          decisions: {
            unreported: b,
            declared_clear_scenario: { ...b, outcome: 'pending' },
            declared_crash_scenario: b,
          },
        }),
      );
      job.state = 'complete';
      set(dir, job);
      return publicStatus(job);
    }
    job.state = 'queued';
    job.queuedAt = new Date().toISOString();
    delete job.attempt;
    delete job.pid;
    delete job.message;
    set(dir, job);
    pending.push(id);
    pump();
    return publicStatus(job);
  });
  function pump() {
    if (closing || recovering || busy.size || !pending.length) return;
    const id = pending.shift()!,
      { dir, job } = getJob(id);
    if (job.state !== 'queued' || job.attempt) {
      queueMicrotask(pump);
      return;
    }
    const attempt = randomBytes(8).toString('hex'),
      work = path.join(workRoot, attempt);
    busy.add(id);
    job.attempt = attempt;
    let fd: number | undefined;
    try {
      fs.mkdirSync(work, { recursive: true });
      set(dir, job);
      fd = fs.openSync(path.join(dir, 'attempt-' + attempt + '.log'), 'ax');
      const worker = cfg.spawnWorker ?? spawn;
      const child = worker(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/v4/run.ts',
          '--input',
          dir,
          '--out',
          work,
          '--python',
          cfg.python,
        ],
        { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', fd, fd] },
      );
      job.pid = child.pid;
      set(dir, job);
      child.once('error', () => {
        if (!closing) void finalize(id, 1, attempt);
      });
      child.once('close', (code) => {
        if (!closing) void finalize(id, code, attempt);
      });
    } catch {
      void finalize(id, 1, attempt);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  function guardFailed(dir: string, attempt: unknown, code: number | null) {
    if (code === 23) return true;
    if (typeof attempt !== 'string' || !/^[a-f0-9]{16}$/.test(attempt)) return false;
    const f = path.join(dir, 'attempt-' + attempt + '.log');
    if (!fs.existsSync(f)) return false;
    const fd = fs.openSync(f, 'r');
    try {
      const size = fs.fstatSync(fd).size,
        length = Math.min(size, 8192),
        buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return /hardware_guard|cooldown_timeout|hardware stop|hardware guard|resource guard/i.test(
        buffer.toString('utf8'),
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  async function finalize(id: string, code: number | null, attempt?: string) {
    const { dir, job } = getJob(id);
    if (!activeState(job.state) || (attempt && job.attempt !== attempt) || busy.has('seal-' + id))
      return;
    busy.add('seal-' + id);
    try {
      if (!published(id)) {
        if (code !== 0 || !/^[0-9a-f]{16}$/.test(job.attempt)) throw Error('acquisition_failed');
        const dest = path.join(workRoot, job.attempt, id),
          fp = path.join(dest, 'input.json'),
          raw = header.parse(JSON.parse(fs.readFileSync(fp, 'utf8')));
        raw.combinedHistory = job.exclusionHistory ?? job.crash;
        if (raw.combinedHistory === 'no') {
          raw.history = 'no';
          raw.damage = 'no';
          raw.repair = 'no';
          const f = JSON.parse(fs.readFileSync(path.join(dest, 'foundation.json'), 'utf8'))
            .decisions.declared_clear_scenario;
          raw.foundation = f.outcome;
          raw.foundationReason = f.summary;
          raw.foundationGrade = f.grade;
        }
        const persisted = db
          .prepare('SELECT body FROM native_photo WHERE case_id=?')
          .all(id)
          .map((r) => JSON.parse(String(r.body)));
        for (const rec of persisted) {
          if (!authentic(rec, 'same-frame-derivation', cfg.key)) continue;
          const v = rec.value;
          const parent = raw.images.find((x) => x.sourceHash === v.parent),
            crop = raw.images.find((x) => x.sourceHash === v.child);
          if (!parent || !crop || crop.role !== 'tag') continue;
          // A cryptographic crop relationship is exact. A cropped card, isolated text page or unrelated image
          // does not establish attachment to a garment; the source must itself be a visible garment view.
          if (!['outer_front', 'outer_back', 'outer_side', 'inner_overview'].includes(parent.role))
            continue;
          crop.attachment = 'same_frame';
          crop.anchor = parent.workingHash;
          crop.region = v.rect;
        }
        await fillTagFields(raw, dest, process.env, job.processingTerms === true);
        const basis = JSON.parse(fs.readFileSync(path.join(dest, 'foundation.json'), 'utf8'));
        const decision =
          basis.decisions[raw.combinedHistory === 'no' ? 'declared_clear_scenario' : 'unreported'];
        const record = buildDossier(raw, cfg.key, {
          foundationEvidence: { decision, slots: basis.slots },
        });
        fs.writeFileSync(fp, JSON.stringify(raw));
        fs.writeFileSync(path.join(dest, 'inspection.json'), JSON.stringify(record));
        if (
          !authentic(
            JSON.parse(fs.readFileSync(path.join(dest, 'inspection.json'), 'utf8')),
            'inspection',
            cfg.key,
          )
        )
          throw Error('bad_receipt');
        fs.mkdirSync(cfg.root, { recursive: true });
        fs.renameSync(dest, folder(id));
      }
      job.state = 'complete';
      delete job.message;
    } catch {
      job.state = 'retry';
      job.message = guardFailed(dir, job.attempt, code)
        ? busyMessage
        : 'The inspection did not finish. Your photos are kept.';
      job.lastExitCode = code;
    } finally {
      delete job.pid;
      set(dir, job);
      busy.delete('seal-' + id);
      busy.delete(id);
      queueMicrotask(pump);
    }
  }
  // A restart cannot expose a partially sealed record. A surviving local worker may finish the same
  // attempt; a stopped worker can be retried with the same uploaded photos in a fresh work directory.
  const timers = new Set<ReturnType<typeof setInterval>>();
  for (const it of fs.readdirSync(parentRoot, { withFileTypes: true })) {
    if (!it.isDirectory() || !idRE.test(it.name)) continue;
    const id = it.name,
      { job } = getJob(id);
    if (!activeState(job.state)) continue;
    if (job.state === 'queued' && !job.attempt) {
      pending.push(id);
      continue;
    }
    busy.add(id);
    const check = () => {
      const complete =
        typeof job.attempt === 'string' &&
        /^[0-9a-f]{16}$/.test(job.attempt) &&
        fs.existsSync(path.join(workRoot, job.attempt, 'index.json'));
      if (complete || published(id)) {
        void finalize(id, 0);
        return true;
      }
      try {
        if (Number.isInteger(job.pid) && job.pid > 0) {
          process.kill(job.pid, 0);
          return false;
        }
      } catch {}
      void finalize(id, 1);
      return true;
    };
    if (!check()) {
      const t = setInterval(() => {
        if (check()) {
          clearInterval(t);
          timers.delete(t);
        }
      }, 2000);
      timers.add(t);
    }
  }
  pending.sort(
    (a, b) =>
      String(getJob(a).job.queuedAt).localeCompare(String(getJob(b).job.queuedAt)) ||
      a.localeCompare(b),
  );
  recovering = false;
  queueMicrotask(pump);
  app.addHook('onClose', async () => {
    closing = true;
    for (const t of timers) clearInterval(t);
  });
}
