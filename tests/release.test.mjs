import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateEntry } from '../scripts/check-release.mjs';
test('only reviewed media bytes can enter a release snapshot', () => {
  const image = Buffer.from([12, 0, 14]);
  const allowed = {
    'public/media/example.webp': { sha256: createHash('sha256').update(image).digest('hex') },
  };
  assert.doesNotThrow(() => validateEntry('public/media/example.webp', image, allowed));
  assert.throws(() =>
    validateEntry('public/media/example.webp', Buffer.from([13, 0, 14]), allowed),
  );
  assert.throws(() => validateEntry('public/media/extra.webp', image, allowed));
});
test('logs, private records, local paths, image payloads and unlisted binaries are rejected', () => {
  for (const [n, b] of [
    ['data/item.json', '{}'],
    ['src/material.json', '{}'],
    ['notices/briefing.md', 'ordinary prose'],
    ['public/cases.js', 'export const items=[]'],
    [
      'src/machine.ts',
      'Q:' + String.fromCharCode(92) + 'private' + String.fromCharCode(92) + 'photos',
    ],
    ['public/screenshot.png', 'x'],
    ['src/book.ts', 'RL' + '17-' + '005'],
    ['src/book.ts', 'data:image/jpeg;base64,' + 'A'.repeat(120)],
    ['src/module.ts', Buffer.from([42, 0, 9])],
  ])
    assert.throws(() => validateEntry(n, Buffer.from(b), {}));
});

test('public templates cannot contain credentials and clients cannot inline a provider key', () => {
  const name = ['OPENAI', 'API', 'KEY'].join('_');
  assert.doesNotThrow(() => validateEntry('.env.example', Buffer.from(name + '=\n'), {}));
  assert.throws(() => validateEntry('.env.example', Buffer.from(name + '=sample\n'), {}));
  for (const [file, prefix] of [['src/module.ts', 'VITE'], ['platform/app/client.ts', 'EXPO_PUBLIC']]) {
    const source = Buffer.from('process.env.' + prefix + '_' + name);
    assert.throws(() => validateEntry(file, source, {}, { [file]: {} }));
  }
});
