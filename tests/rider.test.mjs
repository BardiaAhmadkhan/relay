import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { riderGateway } from '../server/rider-access.mjs';
import { tradeService } from '../server/trade-service.mjs';
import { tradeLedger } from '../server/trade-ledger.mjs';

test('two riders have independent case notebooks, photo permissions and shop-counter boundaries', async () => {
  const db = tradeLedger(':memory:'),
    ids = [],
    upstream = new URL('https://service.example');
  const fetcher = async (url) => {
    const p = url.pathname;
    if (p.endsWith('/intakes')) {
      const id = 'case-' + (ids.length + 1);
      ids.push(id);
      return Response.json({ id, state: 'capture' });
    }
    if (p.endsWith('/health')) return Response.json({ demo: false });
    const id = p.split('/')[3];
    if (!ids.includes(id)) return new Response('', { status: 404 });
    if (p.includes('/photo/'))
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } });
    return Response.json({
      value: {
        id,
        category: 'jacket',
        names: ['Fictional'],
        images: [],
        identity: { unresolved: false },
        sourceCount: 0,
        result: { title: 'Review', action: 'specialist', offerEligible: false },
      },
    });
  };
  const trade = tradeService(
    {},
    {
      db,
      staff: new Map(),
      upstream,
      cache: { store: 'https://gear.example' },
      fetcher,
      online: null,
    },
  );
  const json = (s, n, b) => {
    s.writeHead(n, { 'content-type': 'application/json' });
    s.end(JSON.stringify(b));
  };
  const cb = riderGateway(
    { RELAY_RIDER_ACCESS: '1' },
    upstream,
    () => trade,
    json,
    () => true,
    fetcher,
  );
  const web = http.createServer((q, s) => void cb(q, s));
  await new Promise((r) => web.listen(0, '127.0.0.1', r));
  const root = 'http://127.0.0.1:' + web.address().port + '/relay-rider/';
  const req = (p, body, cookie) =>
    fetch(root + p, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const alice = await req('trade/begin', { claim: 'a'.repeat(48), history: 'no' }),
      bob = await req('trade/begin', { claim: 'b'.repeat(48), history: 'unknown' });
    const ca = alice.headers.get('set-cookie').split(';')[0],
      cb = bob.headers.get('set-cookie').split(';')[0],
      a = (await alice.json()).id,
      b = (await bob.json()).id;
    assert.notEqual(a, b);
    assert.deepEqual(
      (await (await req('notebook', null, ca)).json()).items.map((i) => i.id),
      [a],
    );
    assert.deepEqual(
      (await (await req('notebook', null, cb)).json()).items.map((i) => i.id),
      [b],
    );
    assert.deepEqual((await (await req('notebook')).json()).items, []);
    assert.equal((await req('v4/items/' + a + '/photo/' + 'a'.repeat(64), null, ca)).status, 200);
    assert.equal((await req('v4/items/' + a, null, cb)).status, 403);
    assert.equal((await req('trade/issue', { id: a }, ca)).status, 404);
    assert.equal((await req('trade/offer', { id: a, scenario: 'crash' }, ca)).status, 403);
    assert.equal((await req('access', { id: a, claim: 'b'.repeat(48) })).status, 403);
    const restored = await req('access', { id: a, claim: 'a'.repeat(48) });
    assert.equal(restored.status, 200);
    assert.equal(
      (await req('v4/items/' + a, null, restored.headers.get('set-cookie').split(';')[0])).status,
      200,
    );
  } finally {
    await new Promise((r) => web.close(r));
    db.close();
  }
});
