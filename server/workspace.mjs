import http from 'node:http';
import https from 'node:https';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

import { riderGateway } from './rider-access.mjs';
import { tradeService, bodyJSON } from './trade-service.mjs';
const HOUR = 60 * 60 * 1000;
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const digest = (value) => createHash('sha256').update(value).digest();
function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers['sec-fetch-site'] !== 'cross-site';
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
export function workspaceRequest(env) {
  const upstream = env.RELAY_UPSTREAM ? new URL(env.RELAY_UPSTREAM) : null;
  if (
    upstream &&
    (!['https:', 'http:'].includes(upstream.protocol) ||
      upstream.username ||
      upstream.password ||
      upstream.search ||
      upstream.hash ||
      upstream.pathname !== '/')
  ) {
    throw Error('RELAY_UPSTREAM must be a plain HTTP(S) service origin.');
  }
  const password = env.RELAY_WEB_PASSWORD || '';
  if (upstream && !loopback.has(env.HOST || '127.0.0.1') && !password)
    throw Error('Set RELAY_WEB_PASSWORD before exposing a connected workshop on the network.');
  const sessions = new Map();
  const attempts = new Map();
  const staff = new Map();
  let trade;
  const getTrade = () => (trade ??= tradeService(env, { staff, upstream }));
  const rider = riderGateway(env, upstream, getTrade, json, sameOrigin);
  function session(req) {
    const token = /(?:^|;\s*)relay_workshop=([a-f0-9]{64})(?:;|$)/.exec(
      req.headers.cookie || '',
    )?.[1];
    if (!token) return null;
    if ((sessions.get(token) || 0) <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return token;
  }
  return async (req, res, next) => {
    const path = (req.url || '/').split('?')[0];
    if (path.startsWith('/relay-rider/')) return rider(req, res);
    const privateRoute =
      path === '/workspace.json' ||
      path === '/relay-session' ||
      path.startsWith('/relay-api/') ||
      path.startsWith('/relay-trade/');
    if (upstream && privateRoute) {
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      const peer = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      let hostname = '';
      try {
        hostname = new URL('http://' + req.headers.host).hostname;
      } catch {}
      if (!password && (!loopback.has(peer) || !loopback.has(hostname)))
        return json(res, 403, { error: 'This workshop connection is local to its operator.' });
      if (req.headers['sec-fetch-site'] === 'cross-site')
        return json(res, 403, { error: 'Open this workshop in its own tab.' });
    }
    if (path === '/workspace.json')
      return json(res, 200, {
        connected: !!upstream,
        locked: !!password && !session(req),
        protected: !!password,
        catalogConnected: !!env.RELAY_STORE_URL,
        riderAccess: !!upstream && env.RELAY_RIDER_ACCESS === '1',
        retailer: env.RELAY_STORE_NAME || undefined,
        title: env.RELAY_WORKSHOP_NAME || 'Connected workshop',
      });
    if (path.startsWith('/relay-trade/')) {
      const action = path.slice('/relay-trade/'.length);
      if (!['catalog', 'begin', 'offer', 'issue', 'redeem', 'balance'].includes(action))
        return json(res, 404, { error: 'Unknown trade action.' });
      if (req.method !== (action === 'catalog' ? 'GET' : 'POST'))
        return json(res, 405, { error: 'Method unavailable.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Open the workshop in its own tab.' });
      if (action !== 'catalog' && password && !session(req))
        return json(res, 401, { error: 'Open the workshop first.' });
      try {
        trade ??= tradeService(env, { staff, upstream });
        const b = action === 'catalog' ? {} : await bodyJSON(req);
        return json(res, 200, await trade.handle(action, b, req.headers['x-relay-staff']));
      } catch (e) {
        return json(res, e.status ?? 503, {
          error: e.status ? e.message : 'The trade service is temporarily unavailable.',
        });
      }
    }
    if (path !== '/relay-session' && !path.startsWith('/relay-api/')) return next();
    if (!upstream)
      return json(res, 404, { error: 'This installation uses the example workspace.' });
    const method = req.method || 'GET';
    if (!['GET', 'HEAD', 'POST', 'DELETE'].includes(method))
      return json(res, 405, { error: 'Method unavailable.' });
    if (!['GET', 'HEAD'].includes(method) && !sameOrigin(req))
      return json(res, 403, { error: 'Open the workshop in its own tab to continue.' });
    if (path === '/relay-session') {
      const key = req.socket.remoteAddress || 'local';
      const secure = req.socket.encrypted || env.RELAY_HTTPS === '1';
      const cookie = '; Path=/; HttpOnly; SameSite=Strict' + (secure ? '; Secure' : '');
      if (method === 'DELETE') {
        const token = session(req);
        if (token) sessions.delete(token);
        res.setHeader('Set-Cookie', 'relay_workshop=; Max-Age=0' + cookie);
        return json(res, 200, { ok: true });
      }
      if (method !== 'POST') return json(res, 405, { error: 'Use the workshop sign-in form.' });
      if (!password) return json(res, 200, { ok: true });
      const now = Date.now();
      for (const [id, expiry] of sessions) if (expiry <= now) sessions.delete(id);
      for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
      const recent = attempts.get(key);
      if (recent?.count >= 8)
        return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
      try {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 2048) return json(res, 413, { error: 'Sign-in request too large.' });
        }
        const supplied = JSON.parse(raw).password;
        if (typeof supplied !== 'string' || !timingSafeEqual(digest(supplied), digest(password))) {
          attempts.set(key, {
            count: (recent?.count || 0) + 1,
            until: recent?.until || now + 60000,
          });
          return json(res, 401, { error: 'That workspace password was not recognised.' });
        }
      } catch {
        return json(res, 400, { error: 'Invalid sign-in request.' });
      }
      attempts.delete(key);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, now + 8 * HOUR);
      res.setHeader('Set-Cookie', 'relay_workshop=' + token + '; Max-Age=28800' + cookie);
      return json(res, 200, { ok: true });
    }
    if (password && !session(req)) return json(res, 401, { error: 'Sign in to this workshop.' });
    const raw = (req.url || '').slice('/relay-api'.length);
    if (
      !/^\/v4\/(?:health|items|intakes|shop|staff)(?:[/?]|$)/.test(raw) ||
      raw.includes('\\') ||
      raw.includes('..') ||
      /%(?:2f|5c|2e)/i.test(raw)
    )
      return json(res, 404, { error: 'Unknown workshop route.' });
    if (raw === '/v4/staff/session' && method === 'POST') {
      try {
        const b = await bodyJSON(req);
        const response = await fetch(new URL(raw, upstream), {
          method: 'POST',
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(env.RELAY_UPSTREAM_TOKEN ? { 'x-relay-token': env.RELAY_UPSTREAM_TOKEN } : {}),
          },
          body: JSON.stringify(b),
          signal: AbortSignal.timeout(15000),
        });
        const data = await response.json();
        if (response.ok && typeof data.token === 'string' && typeof data.demo === 'boolean') {
          for (const [k, v] of staff) if (v.expires <= Date.now()) staff.delete(k);
          staff.set(createHash('sha256').update(data.token).digest('hex'), {
            name: String(b.name ?? 'Workshop staff').slice(0, 60),
            demo: data.demo,
            expires: Date.now() + HOUR,
          });
        }
        return json(res, response.status, data);
      } catch (e) {
        return json(res, e.status ?? 502, {
          error: 'The workshop could not open a staff session.',
        });
      }
    }
    if (method === 'DELETE') return json(res, 405, { error: 'Method unavailable.' });
    if (Number(req.headers['content-length'] || 0) > 10_000_000)
      return json(res, 413, { error: 'Photo is too large.' });
    const headers = {};
    for (const h of ['content-type', 'content-length', 'x-relay-staff', 'accept'])
      if (req.headers[h]) headers[h] = req.headers[h];
    if (env.RELAY_UPSTREAM_TOKEN) headers['x-relay-token'] = env.RELAY_UPSTREAM_TOKEN;
    const outgoing = (upstream.protocol === 'https:' ? https : http).request(
      new URL(raw, upstream),
      { method, headers, timeout: 85000 },
      (remote) => {
        const responseHeaders = {
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        };
        for (const h of ['content-type', 'content-length', 'retry-after'])
          if (remote.headers[h]) responseHeaders[h] = remote.headers[h];
        res.writeHead(remote.statusCode || 502, responseHeaders);
        remote.pipe(res);
        remote.on('error', () => res.destroy());
      },
    );
    outgoing.on('timeout', () => outgoing.destroy());
    outgoing.on('error', () => {
      if (!res.headersSent && !res.destroyed)
        json(res, 502, {
          error: 'The inspection service is unavailable. Your draft stays on this device.',
        });
      else res.destroy();
    });
    let bytes = 0;
    req.on('data', (c) => {
      bytes += c.length;
      if (bytes > 10_000_000) {
        if (!res.headersSent) json(res, 413, { error: 'Photo is too large.' });
        outgoing.destroy();
      }
    });
    res.on('close', () => {
      if (!res.writableEnded) outgoing.destroy();
    });
    req.pipe(outgoing);
  };
}
