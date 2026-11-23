import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.');
const allow = new Set([
  'datasets/quality-cycle-02/review.html',
  'datasets/quality-cycle-02/comparison.csv',
  'datasets/quality-cycle-02/comparison.json',
  'datasets/quality-cycle-02/labels.json',
  'datasets/quality-cycle-02/final-holdout-labels.json',
  'docs/15-testing-and-qa/quality-cycle-02.md',
]);
for (const name of [
  'datasets/quality-audit-01/labels.json',
  'datasets/quality-cycle-02/labels.json',
  'datasets/quality-cycle-02/final-holdout-labels.json',
])
  for (const c of JSON.parse(await fs.readFile(name, 'utf8')).cases) allow.add(c.file);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/datasets/quality-cycle-02/review.html' });
      res.end();
      return;
    }
    const rel = decodeURIComponent(url.pathname.slice(1));
    if (
      !allow.has(rel) &&
      !/^datasets\/quality-cycle-02\/review\/focus-[a-z0-9-]+\.png$/.test(rel)
    ) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const full = path.resolve(root, rel);
    if (!full.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await fs.readFile(full);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(full)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(4186, '127.0.0.1', () =>
  console.log('Relay paired quality review: http://127.0.0.1:4186'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
