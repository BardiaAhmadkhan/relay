import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
export const hash = (s) => createHash('sha256').update(s).digest('hex');
export const problem = (status, message) => Object.assign(new Error(message), { status });
export function tradeLedger(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const newFile = file !== ':memory:' && !fs.existsSync(file);
  const db = new DatabaseSync(file);
  if (newFile && process.platform !== 'win32') fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS catalog(origin TEXT PRIMARY KEY, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS workspaces(name TEXT PRIMARY KEY, scope TEXT NOT NULL, merchant TEXT);
 CREATE TABLE IF NOT EXISTS starts(space TEXT,claim TEXT,until_ms INTEGER,PRIMARY KEY(space,claim));
 CREATE TABLE IF NOT EXISTS riders(space TEXT, claim TEXT, item TEXT NOT NULL, PRIMARY KEY(space,claim), UNIQUE(space,item));
 CREATE TABLE IF NOT EXISTS credits(space TEXT,item TEXT,receipt TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),remaining INTEGER NOT NULL CHECK(remaining>=0),code TEXT UNIQUE NOT NULL,channel TEXT NOT NULL,state TEXT NOT NULL,ref TEXT UNIQUE NOT NULL,remote TEXT,actor TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(space,item));
 CREATE TABLE IF NOT EXISTS spends(space TEXT,order_ref TEXT,item TEXT NOT NULL,variant TEXT NOT NULL,amount INTEGER NOT NULL,applied INTEGER NOT NULL,actor TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(space,order_ref));`);
  if (
    !db
      .prepare('PRAGMA table_info(credits)')
      .all()
      .some((c) => c.name === 'offer_json')
  )
    db.exec('ALTER TABLE credits ADD COLUMN offer_json TEXT');
  const query = (sql, ...args) => db.prepare(sql).get(...args),
    run = (sql, ...args) => db.prepare(sql).run(...args);
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  const credit = (space, id) => query('SELECT * FROM credits WHERE space=? AND item=?', space, id);
  return {
    close: () => db.close(),
    snapshot: (origin) => {
      const r = query('SELECT body FROM catalog WHERE origin=?', origin);
      return r ? JSON.parse(r.body) : null;
    },
    saveCatalog: (key, c) =>
      run(
        'INSERT INTO catalog VALUES (?,?) ON CONFLICT(origin) DO UPDATE SET body=excluded.body',
        key,
        JSON.stringify(c),
      ),
    rider: (space, claim) =>
      query('SELECT item FROM riders WHERE space=? AND claim=?', space, hash(claim))?.item,
    bind: (space, claim, item) =>
      run('INSERT INTO riders VALUES (?,?,?)', space, hash(claim), item),
    assignSpace: (name, legacy, merchant) =>
      tx(() => {
        const row = query('SELECT * FROM workspaces WHERE name=?', name);
        if (!row) {
          run('INSERT INTO workspaces VALUES(?,?,?)', name, legacy, merchant);
          return legacy;
        }
        if (merchant && row.merchant && row.merchant !== merchant)
          throw problem(
            409,
            'This credit ledger belongs to a different store. Configure a separate workshop ledger.',
          );
        if (merchant && !row.merchant)
          run('UPDATE workspaces SET merchant=? WHERE name=?', merchant, name);
        return row.scope;
      }),
    lockStart: (space, claim) =>
      tx(() => {
        const now = Date.now(),
          key = hash(claim);
        run('DELETE FROM starts WHERE until_ms<=?', now);
        return (
          run('INSERT OR IGNORE INTO starts VALUES(?,?,?)', space, key, now + 45000).changes === 1
        );
      }),
    unlockStart: (space, claim) =>
      run('DELETE FROM starts WHERE space=? AND claim=?', space, hash(claim)),
    credit,
    byCode: (space, code) => query('SELECT * FROM credits WHERE space=? AND code=?', space, code),
    sale: (space, order) =>
      query('SELECT * FROM spends WHERE space=? AND order_ref=?', space, order),
    reserve: (space, id, receipt, amount, channel, actor, snapshot = null) =>
      tx(() => {
        const old = credit(space, id);
        if (old) return old;
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw problem(422, 'The shop has no credit amount for this trade.');
        const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        const code = Array.from(randomBytes(20), (byte) => alphabet[byte & 31]).join(''),
          ref = randomBytes(12).toString('hex');
        run(
          'INSERT INTO credits (space,item,receipt,amount,remaining,code,channel,state,ref,remote,actor,created,offer_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          space,
          id,
          receipt,
          amount,
          amount,
          code,
          channel,
          channel === 'shopify' ? 'pending' : 'issued',
          ref,
          null,
          actor,
          new Date().toISOString(),
          snapshot ? JSON.stringify(snapshot) : null,
        );
        return credit(space, id);
      }),
    activate: (space, id, remote) => {
      run(
        "UPDATE credits SET remote=?,state='issued' WHERE space=? AND item=? AND state='pending'",
        remote,
        space,
        id,
      );
      return credit(space, id);
    },
    redeem: (space, id, order, variant, amount, actor) =>
      tx(() => {
        const c = credit(space, id);
        if (!c || c.channel !== 'counter' || c.state !== 'issued')
          throw problem(409, 'This credit cannot be spent at this counter.');
        const old = query('SELECT * FROM spends WHERE space=? AND order_ref=?', space, order);
        if (old) {
          if (old.item !== id || old.amount !== amount || old.variant !== variant)
            throw problem(409, 'This sale reference was already used for a different purchase.');
          return { applied: old.applied, remaining: c.remaining };
        }
        if (!Number.isSafeInteger(amount) || amount <= 0 || c.remaining === 0)
          throw problem(409, 'There is no credit to apply to this sale.');
        const amt = Math.min(amount, c.remaining);
        run(
          'INSERT INTO spends VALUES (?,?,?,?,?,?,?,?)',
          space,
          order,
          id,
          variant,
          amount,
          amt,
          actor,
          new Date().toISOString(),
        );
        run('UPDATE credits SET remaining=remaining-? WHERE space=? AND item=?', amt, space, id);
        return { applied: amt, remaining: c.remaining - amt };
      }),
  };
}
