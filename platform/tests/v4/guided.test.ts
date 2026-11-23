import { expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createDesk } from '../../server/v4/desk';
import { registerIntake } from '../../server/v4/intake';
import { notebookItem } from '../../server/v4/notebook';
it('requires four distinct named sources on guided intakes, preserves idempotence and charges no model call on an incomplete set', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-guided-')),
    root = path.join(parent, 'items');
  fs.mkdirSync(root);
  const key = 'v'.repeat(48),
    desk = createDesk({ root, key, demo: true, dbPath: path.join(parent, 'demo.sqlite') });
  registerIntake(desk, { root, key, python: 'intentionally-unused' });
  try {
    const post = (url: string, payload: object) =>
      desk.app.inject({ method: 'POST', url, payload });
    const start = await post('/v4/intakes', { exclusionHistory: 'unknown', captureMode: 'guided' }),
      id = start.json().id,
      prefix = '/v4/intakes/' + id;
    const raw = async (color: string) =>
      (
        await sharp({ create: { width: 180, height: 120, channels: 3, background: color } })
          .jpeg()
          .toBuffer()
      ).toString('base64');
    const front = await raw('#234e38'),
      back = await raw('#806631'),
      label = await raw('#e4dec6');
    expect((await post(prefix + '/photos', { view: 'front', base64: front })).statusCode).toBe(200);
    expect((await post(prefix + '/finish', {})).statusCode).toBe(422);
    expect((await post(prefix + '/photos', { view: 'back', base64: front })).statusCode).toBe(422);
    expect((await post(prefix + '/photos', { view: 'front', base64: back })).statusCode).toBe(409);
    expect((await post(prefix + '/photos', { view: 'front', base64: front })).json().count).toBe(1);
    expect((await post(prefix + '/photos', { view: 'back', base64: back })).statusCode).toBe(200);
    expect((await post(prefix + '/photos', { view: 'label', base64: label })).statusCode).toBe(422);
    expect(
      (
        await post(prefix + '/photos', {
          view: 'label',
          base64: label,
          purpose: 'attached_label',
          rect: [0.23, 0.23, 0.77, 0.78],
        })
      ).statusCode,
    ).toBe(200);
    expect((await post(prefix + '/finish', {})).statusCode).toBe(422);
    const state = (await desk.app.inject({ url: prefix })).json();
    expect(state).toMatchObject({ photoCount: 3, state: 'capture' });
    const crash = (
      await post('/v4/intakes', { exclusionHistory: 'yes', captureMode: 'guided' })
    ).json().id;
    expect((await post('/v4/intakes/' + crash + '/finish', {})).json()).toMatchObject({
      photoCount: 0,
      state: 'complete',
    });
    const no = (await desk.app.inject({ url: '/v4/items/' + crash })).json();
    expect(
      (
        await post('/v4/items/' + crash + '/requested-photo', {
          scenario: 'actual',
          inspection: no.sha256,
          base64: front,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await post('/v4/items/' + crash + '/requested-photo', {
          scenario: 'actual',
          inspection: 'f'.repeat(64),
          base64: front,
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await desk.app.close();
    const real = fs.realpathSync(parent);
    if (
      path.dirname(real) !== fs.realpathSync(os.tmpdir()) ||
      !path.basename(real).startsWith('relay-guided-')
    )
      throw Error('Invalid test directory.');
    fs.rmSync(real, { recursive: true, force: true });
  }
});
it('only presents garment model, year and class from bound, confirmed fields and withholds disputed identity', () => {
  const item: any = {
    id: 'sample',
    category: 'pants',
    names: ['RiderCo'],
    identity: { unresolved: false },
    fields: [
      { field: 'model_line', value: 'THE OPEN ROAD]', attachment: 'unresolved' },
      { field: 'garment_class', value: 'AAA', attachment: 'conflict' },
      {
        field: 'production_date',
        value: '2020-01',
        attachment: 'custodial',
        requiresConfirmation: true,
      },
    ],
    images: [
      { role: 'outer_back', hash: 'back' },
      { role: 'outer_front', hash: 'front' },
    ],
    result: { title: 'Review', action: 'request' },
    sourceCount: 5,
  };
  expect(notebookItem(item, false)).toMatchObject({
    product: 'Riderco riding trousers',
    details: 'Trousers',
    thumb: 'front',
    rehearsal: false,
  });
  item.fields[0].attachment = 'same_frame';
  item.fields[1].attachment = 'continuity';
  expect(notebookItem(item, true)).toMatchObject({
    product: 'Riderco Open Road',
    details: 'Trousers · Class AAA',
    rehearsal: true,
  });
  item.identity.unresolved = true;
  expect(notebookItem(item, false)).toMatchObject({
    product: 'Garment with mixed labels',
    details: 'Trousers',
  });
});
