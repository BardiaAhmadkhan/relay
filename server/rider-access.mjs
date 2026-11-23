import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { problem } from './trade-ledger.mjs';
import { bodyJSON } from './trade-service.mjs';
const hour = 3600000;
const idPattern = /^[\w-]{1,100}$/;
const picture = /^(?:photo|zone-source)\/[a-f0-9]{64}$/i;
function forRider(raw) {
  const d = raw.value;
  if (!d) return raw;
  const keys = [
    'id',
    'category',
    'names',
    'sourceCount',
    'images',
    'history',
    'identity',
    'result',
    'guidance',
    'visible',
    'areaChecks',
    'appearance',
    'fields',
    'custodyAttested',
    'specialistNote',
    'nextObservation',
  ];
  const value = Object.fromEntries(keys.filter((k) => Object.hasOwn(d, k)).map((k) => [k, d[k]]));
  if (value.result) {
    const r = value.result;
    value.result = Object.fromEntries(
      ['action', 'title', 'next', 'reasons', 'limitation', 'resolvingSets', 'offerEligible']
        .filter((k) => Object.hasOwn(r, k))
        .map((k) => [k, r[k]]),
    );
  }
  return { sha256: raw.sha256, value };
}
export function riderGateway(env, upstream, trade, json, sameOrigin, fetcher = fetch) {
  const sessions = new Map(),
    starts = new Map();
  const enabled = env.RELAY_RIDER_ACCESS === '1' && !!upstream;
  const tokenOf = (req) =>
    /(?:^|;\s*)relay_rider=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
  function desk(req, res, create = false) {
    const now = Date.now();
    for (const [k, v] of sessions) if (v.until <= now) sessions.delete(k);
    let key = tokenOf(req),
      s = sessions.get(key);
    if (!s && create) {
      key = randomBytes(32).toString('hex');
      s = { until: now + 8 * hour, items: new Set() };
      sessions.set(key, s);
      res.setHeader(
        'Set-Cookie',
        'relay_rider=' +
          key +
          '; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800' +
          (env.RELAY_HTTPS === '1' ? '; Secure' : ''),
      );
    }
    return s;
  }
  const upstreamHeaders = () =>
    env.RELAY_UPSTREAM_TOKEN ? { 'x-relay-token': env.RELAY_UPSTREAM_TOKEN } : {};
  async function getItem(id) {
    const r = await fetcher(new URL('/v4/items/' + id + '?scenario=actual', upstream), {
      headers: upstreamHeaders(),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (r.status === 404) return null;
    if (!r.ok) throw problem(503, 'Your inspection is unavailable. Try again.');
    return (await r.json()).value;
  }
  return async (req, res) => {
    try {
      if (!enabled)
        return json(res, 404, {
          error: 'Personal rider intake is unavailable on this installation.',
        });
      if (!sameOrigin(req) || req.headers['sec-fetch-site'] === 'cross-site')
        return json(res, 403, { error: 'Open your rider desk in its own tab.' });
      const u = new URL(req.url, 'http://localhost'),
        route = u.pathname.slice('/relay-rider/'.length),
        method = req.method ?? 'GET';
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      if (route === 'access' && method === 'POST') {
        const b = await bodyJSON(req);
        if (!idPattern.test(b.id ?? '') || !trade().owns(b.id, b.claim))
          throw problem(403, 'This device does not hold the receipt for that inspection.');
        desk(req, res, true).items.add(b.id);
        return json(res, 200, { ok: true });
      }
      if (route.startsWith('trade/') && method === 'POST') {
        const a = route.slice(6);
        if (!['begin', 'offer', 'balance'].includes(a))
          throw problem(404, 'This action belongs to the shop counter.');
        const b = await bodyJSON(req);
        if (a === 'begin') {
          const ip = req.socket.remoteAddress ?? '',
            now = Date.now();
          for (const [k, v] of starts) if (v.until <= now) starts.delete(k);
          const p = starts.get(ip) ?? { count: 0, until: now + hour };
          if (!trade().hasClaim(b.claim)) {
            if (p.count >= Number(env.RELAY_RIDER_STARTS_PER_HOUR ?? 30))
              throw problem(429, 'Too many new intakes from this connection. Try again later.');
            p.count++;
            starts.set(ip, p);
          }
          const v = await trade().handle('begin', b);
          desk(req, res, true).items.add(v.id);
          return json(res, 200, v);
        }
        if (
          a === 'offer' &&
          (!desk(req, res)?.items.has(b.id) || (b.scenario && b.scenario !== 'actual'))
        )
          throw problem(403, 'Open your own inspection to see its offer.');
        return json(res, 200, await trade().handle(a, { ...b, scenario: 'actual' }));
      }
      if (route === 'notebook' && method === 'GET') {
        const items = [];
        for (const id of desk(req, res)?.items ?? []) {
          const d = await getItem(id);
          if (!d) continue;
          const front = d.images.find((i) => i.role === 'outer_front') ?? d.images[0];
          items.push({
            id,
            category: d.category,
            names: d.identity?.unresolved ? [] : d.names,
            product: d.identity?.unresolved ? 'Garment with mixed labels' : undefined,
            title: d.result.title,
            action: d.result.action,
            count: d.sourceCount,
            thumb: front?.hash ?? null,
          });
        }
        return json(res, 200, { items });
      }
      const m = /^v4\/(items|intakes)\/([\w-]{1,100})(?:\/(.*))?$/.exec(route);
      if (!m || !desk(req, res)?.items.has(m[2]))
        return json(res, 403, {
          error: 'This inspection is private to its rider.',
          code: 'rider_access',
        });
      const [, group, id, tail = ''] = m;
      const target = new URL('/v4/' + group + '/' + id + (tail ? '/' + tail : ''), upstream);
      let data;
      if (
        group === 'items' &&
        method === 'GET' &&
        (!tail || ['zone-display', 'viewer-labels'].includes(tail) || picture.test(tail))
      ) {
        if (!tail) target.searchParams.set('scenario', 'actual');
        if (tail.startsWith('photo/') && u.searchParams.get('thumbnail') === '1')
          target.searchParams.set('thumbnail', '1');
      } else if (group === 'intakes' && method === 'GET' && !tail) {
      } else if (
        method === 'POST' &&
        ((group === 'intakes' && ['photos', 'finish'].includes(tail)) ||
          (group === 'items' && tail === 'requested-photo'))
      ) {
        const b = await bodyJSON(req, 10_000_000);
        if (tail === 'requested-photo') b.scenario = 'actual';
        data = JSON.stringify(b);
      } else throw problem(404, 'Unknown rider action.');
      const result = await fetcher(target, {
        method,
        headers: { ...upstreamHeaders(), ...(data ? { 'content-type': 'application/json' } : {}) },
        body: data,
        redirect: 'error',
        signal: AbortSignal.timeout(80000),
      });
      if (group === 'items' && method === 'GET' && !tail && result.ok)
        return json(res, 200, forRider(await result.json()));
      res.writeHead(result.status, {
        'Content-Type': result.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      if (!result.body) return res.end();
      Readable.fromWeb(result.body)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (e) {
      if (!res.headersSent)
        return json(res, e.status ?? 503, {
          error: e.status ? e.message : 'Your rider desk is temporarily unavailable.',
        });
      res.destroy();
    }
  };
}
