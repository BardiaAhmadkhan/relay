// Candidate search for more photographs of REAL used motorcycle gear, damaged and intact (the largest gap
// in the evaluation set: 15 damaged gear photographs). Metadata only; nothing is downloaded here.
// Openverse aggregates openly licensed images (mostly Flickr and Wikimedia). Anonymous access is rate
// limited, so requests are spaced and retried. No-derivatives licences are skipped because evaluation
// resizes and crops the image.
// node experiments/backend-v2/discover-openverse.mjs [--out benchmarks/backend-v2/openverse-candidates.json]
//   [--queries "q1|q2|..."] [--pages N] [--exclude benchmarks/backend-v2/openverse-candidates.json]
// --queries replaces the built-in list, --pages reads pages 1..N of each, and --exclude skips images an
// earlier harvest already listed (added 2026-11-18 for the E19 damage search; the defaults are unchanged).
import fs from 'node:fs/promises';
import path from 'node:path';
import { OUT, args } from './lib.mjs';

const a = args();
const out = a.out ?? path.join(OUT, 'openverse-candidates.json');
const BUILT_IN = [
  'crashed motorcycle jacket',
  'motorcycle jacket crash damage',
  'motorcycle crash gear',
  'road rash jacket',
  'torn leather motorcycle jacket',
  'shredded motorcycle jacket',
  'motorcycle gloves crash',
  'motorcycle boots crash',
  'damaged motorcycle helmet',
  'motorcycle helmet after crash',
  'motorcycle accident jacket',
  'kevlar jeans crash',
  'motorcycle jacket',
  'motorcycle gloves',
  'motorcycle boots',
  'leather motorcycle jacket worn',
];
const QUERIES = a.queries ? String(a.queries).split('|').map((q) => q.trim()).filter(Boolean) : BUILT_IN;
const PAGES = Number(a.pages ?? 1);
const excluded = new Set(
  a.exclude ? JSON.parse(await fs.readFile(String(a.exclude), 'utf8')).candidates.map((c) => c.openverseId) : [],
);
const ALLOWED = new Set(['by', 'by-sa', 'cc0', 'pdm', 'by-nc', 'by-nc-sa']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function search(q, page) {
  const url =
    'https://api.openverse.org/v1/images/?' +
    new URLSearchParams({ q, page: String(page), page_size: '20', mature: 'false' });
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'gear-recognition-lab research script' },
      signal: AbortSignal.timeout(30_000),
    }).catch((e) => ({ ok: false, status: 0, error: e }));
    if (response.ok) return response.json();
    if (response.status === 429 || response.status >= 500 || response.status === 0) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    throw new Error('openverse ' + response.status + ' for ' + q);
  }
  return { results: [], failed: true };
}
const seen = new Map();
const log = [];
// Saved after every page, so an interrupted run (the API is slow and rate limited) keeps what it found.
const save = () =>
  fs.writeFile(
    out,
    JSON.stringify(
      { retrieved: new Date().toISOString(), queries: log, candidates: [...seen.values()] },
      null,
      1,
    ) + '\n',
  );
for (const q of QUERIES)
  for (let page = 1; page <= PAGES; page++) {
    const json = await search(q, page);
    log.push({ q, page, count: json.result_count ?? null, failed: !!json.failed });
    for (const r of json.results ?? []) {
      if (!ALLOWED.has(r.license) || excluded.has(r.id)) continue;
      const entry = seen.get(r.id) ?? {
        openverseId: r.id,
        title: r.title,
        creator: r.creator,
        creatorUrl: r.creator_url,
        license: r.license,
        licenseVersion: r.license_version,
        licenseUrl: r.license_url,
        source: r.source,
        landingUrl: r.foreign_landing_url,
        url: r.url,
        thumbnail: r.thumbnail,
        width: r.width,
        height: r.height,
        tags: (r.tags ?? []).map((t) => t.name).slice(0, 20),
        queries: [],
      };
      entry.queries.push(q);
      seen.set(r.id, entry);
    }
    await save();
    console.log(q, page, json.result_count ?? 'failed', seen.size);
    await sleep(2500);
  }
console.log(JSON.stringify({ out, candidates: seen.size, failedQueries: log.filter((l) => l.failed) }));
