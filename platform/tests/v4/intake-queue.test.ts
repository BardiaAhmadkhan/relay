import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createDesk } from '../../server/v4/desk';
import { registerIntake } from '../../server/v4/intake';
const delay = (n: number) => new Promise((r) => setTimeout(r, n));
it('resumes an interrupted durable waitlist in its recorded order without re-running a finished intake', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-queue-restore-')),
    root = path.join(temp, 'items'),
    received = path.join(temp, 'v4-received');
  fs.mkdirSync(root);
  fs.mkdirSync(received);
  const a = 'capture-000000000000000002',
    b = 'capture-000000000000000001',
    done = 'capture-000000000000000003';
  for (const [id, stamp, state] of [
    [b, '2026-11-21T10:02:00Z', 'queued'],
    [a, '2026-11-21T10:01:00Z', 'queued'],
    [done, '2026-11-21T09:00:00Z', 'complete'],
  ]) {
    const d = path.join(received, id!);
    fs.mkdirSync(d);
    fs.writeFileSync(
      path.join(d, 'status.json'),
      JSON.stringify({
        id,
        createdAt: stamp,
        queuedAt: stamp,
        state,
        photoCount: 4,
        exclusionHistory: 'no',
      }),
    );
  }
  const key = 'z'.repeat(40),
    m = createDesk({ root, key, demo: true, dbPath: path.join(temp, 'desk.sqlite') }),
    called: string[] = [];
  registerIntake(m, {
    root,
    key,
    python: 'unused',
    spawnWorker: (_p, args, opt) => {
      called.push(path.basename(args[args.indexOf('--input') + 1]!));
      return spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(7),80)'], opt);
    },
  });
  try {
    for (let i = 0; i < 100; i++) {
      const s = JSON.parse(fs.readFileSync(path.join(received, b, 'status.json'), 'utf8'));
      if (s.state === 'retry') break;
      await delay(20);
    }
    expect(called).toEqual([a, b]);
    expect(
      JSON.parse(fs.readFileSync(path.join(received, a, 'status.json'), 'utf8')).photoCount,
    ).toBe(4);
  } finally {
    await m.app.close();
    const real = fs.realpathSync(temp);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('relay-queue-restore-')
    )
      throw Error('Unexpected test directory');
    fs.rmSync(real, { recursive: true, force: true });
  }
});
it('queues same-desk requests once, persists waiting jobs, preserves private guard logs and permits a zero-photo exclusion immediately', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-queue-')),
    root = path.join(dir, 'items'),
    key = 'q'.repeat(40);
  fs.mkdirSync(root);
  const app = createDesk({ root, key, demo: true, dbPath: path.join(dir, 'desk.sqlite') });
  const launched: string[] = [];
  registerIntake(app, {
    root,
    key,
    python: 'unused',
    spawnWorker: (_p, args, opts) => {
      const name = path.basename(args[args.indexOf('--input') + 1]!),
        out = args[args.indexOf('--out') + 1]!;
      launched.push(name);
      const i = launched.length,
        reason = i === 1 ? 'hardware_guard' : i === 2 ? 'cooldown_timeout' : 'other_failure',
        code = i === 1 ? 23 : 7;
      return spawn(
        process.execPath,
        [
          '-e',
          'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"test");console.log("attempt stdout");console.error(process.argv[2]);setTimeout(()=>process.exit(Number(process.argv[3])),250);',
          path.join(out, '.gpu-started'),
          reason,
          String(code),
        ],
        opts,
      );
    },
  });
  try {
    const post = (url: string, payload: object) => app.app.inject({ method: 'POST', url, payload });
    const status = async (id: string) =>
      (await app.app.inject({ url: '/v4/intakes/' + id })).json();
    const image = (
      await sharp({ create: { width: 90, height: 110, channels: 3, background: '#425a4d' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
    const create = async (answer: string) => {
      const id = (await post('/v4/intakes', { exclusionHistory: answer })).json().id;
      if (answer !== 'yes') await post('/v4/intakes/' + id + '/photos', { base64: image });
      return id;
    };
    const finish = (id: string) => post('/v4/intakes/' + id + '/finish', {});
    const first = await create('no'),
      second = await create('no'),
      excluded = await create('yes');
    expect((await finish(first)).statusCode).toBe(200);
    expect((await finish(second)).json().state).toBe('queued');
    expect((await finish(second)).statusCode).toBe(200);
    expect(launched).toEqual([first]);
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'v4-received', second, 'status.json'), 'utf8'))
        .state,
    ).toBe('queued');
    expect((await finish(excluded)).json()).toMatchObject({ state: 'complete', photoCount: 0 });
    for (let i = 0; i < 100 && (await status(second)).state !== 'retry'; i++) await delay(30);
    expect(launched).toEqual([first, second]);
    for (const id of [first, second]) {
      const result = await status(id);
      expect(result).toMatchObject({ state: 'retry', photoCount: 1 });
      expect(result.message).toContain('busy finishing another garment');
      const folder = path.join(dir, 'v4-received', id);
      const logs = fs.readdirSync(folder).filter((f) => /^attempt-[a-f0-9]{16}\.log$/.test(f));
      expect(logs).toHaveLength(1);
      expect(fs.readFileSync(path.join(folder, logs[0]!), 'utf8')).toContain('attempt stdout');
      expect(JSON.stringify(result)).not.toContain('hardware_guard');
    }
    await finish(first);
    for (let i = 0; i < 80 && (await status(first)).state !== 'retry'; i++) await delay(30);
    expect((await status(first)).message).toBe(
      'The inspection did not finish. Your photos are kept.',
    );
    expect(launched).toEqual([first, second, first]);
    expect(
      fs.readdirSync(path.join(dir, 'v4-received', first)).filter((f) => f.endsWith('.log')),
    ).toHaveLength(2);
  } finally {
    await app.app.close();
    const target = fs.realpathSync(dir);
    if (
      path.dirname(target) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(target).startsWith('relay-queue-')
    )
      throw Error('Unexpected test directory');
    fs.rmSync(target, { recursive: true, force: true });
  }
});
