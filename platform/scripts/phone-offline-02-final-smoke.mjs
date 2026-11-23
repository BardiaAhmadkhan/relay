import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const adb = '.tooling/android-sdk/platform-tools/adb.exe',
  dir = 'benchmarks/phone-offline-02/native';
const run = (args) =>
  execFileSync(adb, ['-s', 'emulator-5560', ...args], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 20000,
  });
const ui = (cmd, name) =>
  execFileSync(process.execPath, ['scripts/phone-offline-02-native-driver.mjs', cmd, name], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  });
const started = Date.now();
let previous = '';
while (Date.now() - started < 420000) {
  const remote = '/sdcard/relay-delivery-progress-' + Date.now() + '.xml';
  let xml = '';
  try {
    const dumped = run(['shell', 'uiautomator', 'dump', remote]);
    if (!dumped.includes(remote)) throw Error('busy');
    xml = run(['shell', 'cat', remote]);
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  } finally {
    try {
      run(['shell', 'rm', '-f', remote]);
    } catch {}
  }
  const text = [...xml.matchAll(/text="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((t) => /engine|Inspecting|timed out|could not finish/.test(t));
  const row = { at: new Date().toISOString(), elapsedMs: Date.now() - started, status: text };
  if (JSON.stringify(text) !== previous) {
    fs.appendFileSync(dir + '/delivery-first-setup-timeline.jsonl', JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
    previous = JSON.stringify(text);
  }
  if (text.some((t) => /timed out|could not finish/.test(t)))
    throw Error('Final first-use setup failed');
  if (text.some((t) => t.startsWith('Inspecting photo'))) {
    ui('snapshot', 'delivery-before-cancel');
    ui('tap', 'Cancel analysis');
    ui('snapshot', 'delivery-after-cancel');
    const cancelled = fs.readFileSync(dir + '/window.xml', 'utf8');
    if (
      !cancelled.includes('Analysis cancelled. Your photographs are still here.') ||
      !cancelled.includes('Front photo captured')
    )
      throw Error('Cancellation did not preserve the draft');
    ui('tap', 'Review the evidence');
    ui('snapshot', 'delivery-retry-start');
    if (
      fs
        .readFileSync(dir + '/window.xml', 'utf8')
        .includes('Analysis cancelled. Your photographs are still here.')
    )
      throw Error('Stale cancellation notice on retry');
    console.log('Native cancellation preserved the photo; retry cleared its stale notice.');
    execFileSync(
      process.execPath,
      ['scripts/phone-offline-02-watch.mjs', 'delivery-photo02-retry'],
      { windowsHide: true, stdio: 'inherit', timeout: 760000 },
    );
    const outcome = JSON.parse(
      fs.readFileSync(dir + '/delivery-photo02-retry-outcome.json', 'utf8'),
    );
    if (!outcome.done || !outcome.status.includes('Offer on hold'))
      throw Error('Final photo retry failed');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 12000));
}
throw Error('No native inspection reached within observation window');
