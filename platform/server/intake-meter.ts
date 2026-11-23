import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/** Denominator for operator cost reporting. A repeated assessment or fallback follow-up is the same intake. */
export function intakeMeter(file: string, key: string) {
  if (key.length < 32 || /^:|^file:/i.test(file))
    throw Error('Use a persistent intake meter and a stable signing key.');
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=250; CREATE TABLE IF NOT EXISTS assessed_intake(ticket TEXT PRIMARY KEY, first_ms INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS intake_time ON assessed_intake(first_ms)',
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS scored_photo(ticket TEXT PRIMARY KEY, first_ms INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS photo_time ON scored_photo(first_ms)',
  );
  const photo = db.prepare('INSERT OR IGNORE INTO scored_photo(ticket,first_ms) VALUES(?,?)');
  const add = db.prepare('INSERT OR IGNORE INTO assessed_intake(ticket,first_ms) VALUES(?,?)');
  return {
    record(id: string, now = Date.now()) {
      const ticket = createHmac('sha256', key)
        .update('relay-cost-intake-v1\0' + id)
        .digest('hex');
      add.run(ticket, now);
    },
    recordPhoto(assessment: string, id: string, now = Date.now()) {
      const ticket = createHmac('sha256', key)
        .update('relay-cost-photo-v1\0' + JSON.stringify([assessment, id]))
        .digest('hex');
      photo.run(ticket, now);
    },
    close() {
      db.close();
    },
  };
}
