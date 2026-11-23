import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { authentic } from '../../server/v4/seal';
import {
  packImpact,
  type DependentQuote,
  type ComponentRecord,
} from '../../packages/core/v4/pack-impact';
const args = process.argv.slice(2),
  opt = (k: string) => {
    const at = args.indexOf(k);
    return at < 0 ? undefined : args[at + 1];
  };
const data = opt('--items'),
  dbPath = opt('--db'),
  proposalFile = opt('--proposal'),
  out = opt('--out'),
  secret = process.env.RELAY_SIGNING_KEY;
if (!data || !dbPath || !proposalFile || !out || !secret)
  throw Error(
    'Use --items directory --db read-only-desk.sqlite --proposal change.json --out report.json, with the local signing identity.',
  );
const rates = z.array(z.number().int().nonnegative()).min(1).max(200);
const proposal = z
  .discriminatedUnion('key', [
    z.strictObject({
      key: z.literal('knox-purchase'),
      oldYears: z.number().int().min(1).max(50),
      newYears: z.number().int().min(1).max(50),
    }),
    z.strictObject({ key: z.literal('US-to-CA-retail-postage'), oldCents: rates, newCents: rates }),
    z.strictObject({
      key: z.literal('leather-apparel-duty'),
      oldPercent: z.number().min(0).max(100),
      newPercent: z.number().min(0).max(100),
    }),
  ])
  .parse(JSON.parse(fs.readFileSync(proposalFile, 'utf8')));
const cases = fs
  .readdirSync(data, { withFileTypes: true })
  .filter((f) => f.isDirectory() && fs.existsSync(path.join(data, f.name, 'inspection.json')))
  .map((f) => {
    const record = JSON.parse(fs.readFileSync(path.join(data, f.name, 'inspection.json'), 'utf8'));
    if (!authentic(record, 'inspection', secret))
      throw Error('An original dossier failed verification');
    return { id: record.value.id, receipt: record.sha256, fields: record.value.fields };
  });
const quotes: DependentQuote[] = [],
  components: ComponentRecord[] = [];
const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  for (const row of db
    .prepare(
      "SELECT body FROM desk_event WHERE kind IN ('commercial_quote','component_service') ORDER BY seq",
    )
    .all()) {
    const e = JSON.parse(String(row.body));
    if (!authentic(e, 'desk-event', secret)) throw Error('Desk record failed verification');
    const p = e.value.payload;
    if (e.value.kind === 'commercial_quote')
      quotes.push({
        id: e.sha256,
        item: e.value.item,
        inspection: p.inspection,
        market: p.market,
        packedGrams: p.packedGrams,
        quantity: p.quantity,
        tariffItem: p.tariffItem,
        customsValueMinor: p.customsValueMinor,
      });
    else components.push({ item: e.value.item, receipt: e.sha256, purchaseDate: p.purchaseDate });
  }
} finally {
  db.close();
}
const impact = packImpact(proposal, cases, quotes, components);
fs.writeFileSync(
  out,
  JSON.stringify(
    {
      asOf: new Date().toISOString(),
      inspectionsRead: cases.length,
      quoteRecordsRead: quotes.length,
      componentRecordsRead: components.length,
      proposal,
      impact,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  impact.fact,
  impact.affectedCases.length,
  'dependent cases',
  impact.affectedQuotes.length,
  'affected quotes',
  impact.affectedReminders.length,
  'affected reminders; no promotion',
);
