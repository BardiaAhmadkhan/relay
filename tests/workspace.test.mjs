import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { workspaceRequest } from '../server/workspace.mjs';

async function serve(fn) {
  const app = http.createServer(fn);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  return {
    url: 'http://127.0.0.1:' + app.address().port,
    close: () =>
      new Promise((r) => {
        app.close(r);
        app.closeAllConnections();
      }),
  };
}
const use = (env) => {
  const cb = workspaceRequest(env);
  return (q, s) =>
    cb(q, s, () => {
      s.writeHead(404).end();
    });
};
test('the default installation has only its local example workspace', async () => {
  const web = await serve(use({}));
  try {
    const cfg = await (await fetch(web.url + '/workspace.json')).json();
    assert.equal(cfg.connected, false);
    assert.equal((await fetch(web.url + '/relay-api/v4/items')).status, 404);
  } finally {
    await web.close();
  }
});
test('protected workspaces require a session, forward a server-side token and preserve the service result', async () => {
  const privateToken = randomBytes(22).toString('hex'),
    password = randomBytes(15).toString('hex');
  let calls = 0;
  const api = await serve(async (q, s) => {
    calls++;
    assert.equal(q.headers['x-relay-token'], privateToken);
    assert.equal(q.headers.cookie, undefined);
    s.setHeader('Content-Type', 'application/json');
    s.end(
      JSON.stringify({
        title: 'One more piece of evidence needed',
        staff: q.headers['x-relay-staff'] ?? null,
        method: q.method,
      }),
    );
  });
  const web = await serve(
    use({
      RELAY_UPSTREAM: api.url,
      RELAY_UPSTREAM_TOKEN: privateToken,
      RELAY_WEB_PASSWORD: password,
    }),
  );
  try {
    const cfg = await (await fetch(web.url + '/workspace.json')).json();
    assert.equal(cfg.locked, true);
    assert.equal(JSON.stringify(cfg).includes(privateToken), false);
    assert.equal((await fetch(web.url + '/relay-api/v4/items')).status, 401);
    const auth = await fetch(web.url + '/relay-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    assert.equal(auth.status, 200);
    const setCookie = auth.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];
    const result = await (
      await fetch(web.url + '/relay-api/v4/items/example', {
        headers: { cookie, 'x-relay-staff': 'session-fixture' },
      })
    ).json();
    assert.deepEqual(result, {
      title: 'One more piece of evidence needed',
      staff: 'session-fixture',
      method: 'GET',
    });
    const other = await fetch(web.url + '/relay-api/v4/intakes', {
      method: 'POST',
      headers: { cookie, origin: 'https://unrelated.example' },
    });
    assert.equal(other.status, 403);
    assert.equal(calls, 1);
    const locked = await fetch(web.url + '/relay-session', {
      method: 'DELETE',
      headers: { cookie },
    });
    assert.equal(locked.status, 200);
    assert.equal(
      (await fetch(web.url + '/relay-api/v4/items', { headers: { cookie } })).status,
      401,
    );
  } finally {
    await web.close();
    await api.close();
  }
});
test('a network-facing connected workshop requires an access credential', () => {
  assert.throws(() =>
    workspaceRequest({ HOST: '0.0.0.0', RELAY_UPSTREAM: 'http://127.0.0.1:8086' }),
  );
  assert.doesNotThrow(() => workspaceRequest({ HOST: '0.0.0.0' }));
});
test('an unavailable service produces a recoverable error with no fabricated inspection', async () => {
  const dead = await serve((_q, s) => s.end());
  await dead.close();
  const web = await serve(use({ RELAY_UPSTREAM: dead.url }));
  try {
    const response = await fetch(web.url + '/relay-api/v4/items');
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /unavailable/);
  } finally {
    await web.close();
  }
});
