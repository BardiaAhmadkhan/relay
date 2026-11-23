import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
const root = path.resolve(import.meta.dirname, '..');
const galleryPath = 'design/round-03-review.html';
const html = await fs.readFile(path.join(root, galleryPath), 'utf8');
const routes = new Map([
  ['/', galleryPath],
  ['/' + galleryPath, galleryPath],
]);
for (const match of html.matchAll(/src="([^"]+)"/g)) {
  const route = new URL(match[1], 'http://127.0.0.1/' + galleryPath).pathname;
  const relative = route.slice(1);
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep) || !relative.endsWith('.png'))
    throw Error('Unexpected review asset');
  routes.set(route, relative);
}
http
  .createServer(async (req, res) => {
    const route = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const file = routes.get(route);
    if (req.method !== 'GET' || !file) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const bytes = await fs.readFile(path.join(root, file));
      res.writeHead(200, {
        'Content-Type': file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(4184, '127.0.0.1', () => console.log('Local visual review: http://127.0.0.1:4184'));
