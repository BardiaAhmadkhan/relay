import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const out = 'experiments/quality-audit-01';
const queries = [
  '"motorcycle jacket"',
  '"motorcycle leather"',
  '"leather jacket" -incategory:"People wearing leather jackets"',
  '"worn leather"',
  '"torn jacket"',
  '"torn fabric"',
  '"damaged leather"',
  '"broken zipper"',
  '"denim jacket"',
  '"motorcycle gloves"',
  '"motorcycle boots"',
  '"motorcycle clothing"',
  '"seam" "clothing"',
  '"Denim Hole"',
];
const pages = new Map();
const sources = [];
for (const query of queries) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '6',
    gsrlimit: '30',
    prop: 'imageinfo|revisions',
    rvprop: 'ids|timestamp',
    iiprop: 'url|extmetadata|size|sha1',
    iiurlwidth: '960',
  }))
    url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'RelayQualityAudit/1.0 (licensed local visual evaluation)' },
    signal: AbortSignal.timeout(40000),
  });
  if (!response.ok) throw new Error('Metadata HTTP ' + response.status);
  const data = await response.json();
  const found = data.query?.pages ?? [];
  for (const p of found) {
    const previous = pages.get(p.pageid);
    pages.set(p.pageid, { ...p, queries: [...(previous?.queries ?? []), query] });
  }
  sources.push({ query, pages: found.length });
  console.log(query, found.length);
  await delay(500);
}
await fs.writeFile(
  out + '/commons-candidates.json',
  JSON.stringify(
    { at: new Date().toISOString(), queries: sources, pages: [...pages.values()] },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log('unique candidate pages', pages.size);
