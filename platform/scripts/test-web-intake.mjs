import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withPreview } from '../../tests/support/preview.mjs';
import { createDesk } from '../server/v4/desk.ts';
import { registerIntake } from '../server/v4/intake.ts';

const temp = await mkdtemp(path.join(os.tmpdir(), 'relay-browser-desk-'));
const key = randomBytes(32).toString('hex');
const token = randomBytes(32).toString('hex');
const root = path.join(temp, 'items');
const desk = createDesk({ root, key, demo: false, accessToken: token, dbPath: path.join(temp, 'desk.sqlite') });
registerIntake(desk, { root, key, python: 'unused-for-history' });
try {
  const origin = await desk.app.listen({ host: '127.0.0.1', port: 0 });
  await withPreview(async web => {
    async function call(route, body, cookie) {
      const reply = await fetch(web + '/relay-rider/' + route, {
        method: body ? 'POST' : 'GET',
        headers: { origin: web, ...(cookie && { cookie }), ...(body && { 'content-type': 'application/json' }) },
        body: body && JSON.stringify(body),
      });
      const value = await reply.json();
      assert.equal(reply.ok, true, route + ' returned ' + reply.status + ' ' + JSON.stringify(value));
      return { value, cookie: reply.headers.get('set-cookie')?.split(';')[0] };
    }
    const begin = await call('trade/begin', { history: 'yes', claim: randomBytes(32).toString('hex') });
    const id = begin.value.id;
    assert.ok(id && begin.cookie);
    const done = await call('v4/intakes/' + id + '/finish', {}, begin.cookie);
    assert.equal(done.value.state, 'complete');
    const result = await call('v4/items/' + id, null, begin.cookie);
    assert.equal(result.value.value.result.offerEligible, false);
    assert.equal(result.value.value.sourceCount, 0);
    const book = await call('notebook', null, begin.cookie);
    assert.deepEqual(book.value.items.map(item => item.id), [id]);
    assert.deepEqual((await call('notebook')).value.items, []);
  }, { RELAY_UPSTREAM: origin, RELAY_UPSTREAM_TOKEN: token, RELAY_RIDER_ACCESS: '1',
       RELAY_TRADE_DB: path.join(temp, 'trade.sqlite') });
  console.log('Real rider gateway, inspection desk, signed history exclusion and private notebook passed.');
} finally {
  await desk.app.close();
  await rm(temp, { recursive: true, force: true });
}
