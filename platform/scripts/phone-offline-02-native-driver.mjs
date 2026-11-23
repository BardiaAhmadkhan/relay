import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const adb = './.tooling/android-sdk/platform-tools/adb.exe',
  dir = 'benchmarks/phone-offline-02/native';
fs.mkdirSync(dir, { recursive: true });
const run = (args) =>
  execFileSync(adb, ['-s', 'emulator-5560', ...args], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
const [command, value = 'screen'] = process.argv.slice(2);
if (command === 'tap') {
  const xml = fs.readFileSync(dir + '/window.xml', 'utf8');
  const nodes = [...xml.matchAll(/<node\b[^>]*>/g)].map((m) => m[0]);
  const match = nodes.find(
    (n) =>
      (n.includes('content-desc="' + value + '"') || n.includes('text="' + value + '"')) &&
      n.includes('enabled="true"'),
  );
  const b = match?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!b || +b[3] <= +b[1] || +b[4] <= +b[2])
    throw new Error('Control absent or outside viewport: ' + value);
  run([
    'shell',
    'input',
    'tap',
    String(Math.round((+b[1] + +b[3]) / 2)),
    String(Math.round((+b[2] + +b[4]) / 2)),
  ]);
} else if (command === 'down') run(['shell', 'input', 'swipe', '540', '1700', '540', '700', '350']);
else if (command === 'up') run(['shell', 'input', 'swipe', '540', '700', '540', '1700', '350']);
run(['shell', 'uiautomator', 'dump', '/sdcard/relay-window.xml']);
run(['pull', '/sdcard/relay-window.xml', dir + '/window.xml']);
const xml = fs.readFileSync(dir + '/window.xml', 'utf8');
console.log(
  [...xml.matchAll(/<node\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((n) => !n.includes('text=""') || !n.includes('content-desc=""'))
    .map((n) => n.match(/(?:text|content-desc|bounds|clickable)="[^"]*"/g)?.join(' '))
    .join('\n'),
);
if (command === 'snapshot' && /^[a-z0-9_-]+$/.test(value)) {
  fs.copyFileSync(dir + '/window.xml', dir + '/' + value + '.xml');
  fs.writeFileSync(dir + '/' + value + '.png', run(['exec-out', 'screencap', '-p']));
}
