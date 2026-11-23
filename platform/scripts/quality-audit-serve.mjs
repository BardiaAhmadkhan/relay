import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('datasets/quality-audit-01'),
  labels = JSON.parse(await fs.readFile(path.join(root, 'labels.json'), 'utf8'));
const routes = new Map([
  ['/', path.join(root, 'review.html')],
  ...['review.html', 'labels.csv', 'results.csv', 'README.md', 'attribution.json'].map((name) => [
    '/' + name,
    path.join(root, name),
  ]),
  ...labels.cases.map((c) => [
    '/' + c.file.replace('datasets/quality-audit-01/', ''),
    path.resolve(c.file),
  ]),
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method ?? '')) {
    res.writeHead(405);
    res.end();
    return;
  }
  let filename;
  try {
    filename = routes.get(decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname));
  } catch {}
  if (!filename) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const body = await fs.readFile(filename);
    res.writeHead(200, {
      'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(4185, '127.0.0.1', () => console.log('Local audit review: http://127.0.0.1:4185'));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
