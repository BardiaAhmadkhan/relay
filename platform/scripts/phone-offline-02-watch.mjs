import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const adb = './.tooling/android-sdk/platform-tools/adb.exe';
const name = process.argv[2];
if (!/^[a-z0-9-]+$/.test(name ?? '')) throw Error('Provide a case name.');
const dir = 'benchmarks/phone-offline-02/native',
  start = Date.now();
const output = dir + '/' + name + '-timeline.jsonl';
if (fs.existsSync(output)) throw Error('Evidence already exists.');
const run = (args) =>
  execFileSync(adb, ['-s', 'emulator-5560', ...args], {
    windowsHide: true,
    timeout: 20000,
    maxBuffer: 8 * 1024 * 1024,
  });
let previous = '';
for (;;) {
  const remote = '/sdcard/relay-watch-' + name + '-' + Date.now() + '.xml';
  let xml;
  try {
    const dump = run(['shell', 'uiautomator', 'dump', remote]).toString();
    if (!dump.includes(remote)) throw Error('Android hierarchy is busy');
    xml = run(['shell', 'cat', remote]).toString();
  } catch (error) {
    if (Date.now() - start > 720000) throw error;
    console.log('Waiting for a fresh Android hierarchy.');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    continue;
  } finally {
    try {
      run(['shell', 'rm', '-f', remote]);
    } catch {}
  }

  const texts = [...xml.matchAll(/\btext="([^"]+)"/g)].map((m) =>
    m[1]
      .replace(/&#10;/g, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"'),
  );
  const status = texts.filter((t) =>
    /offline engine|engine files|Inspecting photo|Checking the evidence|timed out|could not finish|Visible evidence|Offer on hold|finding|Physical review|More photo detail|Analysis cancelled/i.test(
      t,
    ),
  );
  const elapsedMs = Date.now() - start,
    done = texts.includes('Visible evidence'),
    failed = texts.some((t) => /Analysis timed out|offline review could not finish/.test(t));
  const row = { at: new Date().toISOString(), elapsedMs, status, done, failed };
  const key = JSON.stringify(status);
  if (previous !== key || done || failed) {
    fs.appendFileSync(output, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
    previous = key;
  }
  if (done || failed || elapsedMs > 720000) {
    fs.writeFileSync(dir + '/' + name + '-outcome.xml', xml);
    fs.writeFileSync(dir + '/' + name + '-outcome.png', run(['exec-out', 'screencap', '-p']));
    fs.writeFileSync(
      dir + '/' + name + '-outcome.json',
      JSON.stringify({ ...row, texts }, null, 2),
    );
    if (!done) process.exitCode = 1;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 15000));
}
