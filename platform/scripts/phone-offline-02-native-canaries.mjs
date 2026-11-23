import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dir = 'benchmarks/phone-offline-02/native';
const adb = '.tooling/android-sdk/platform-tools/adb.exe';
const run = (args) =>
  execFileSync(adb, ['-s', 'emulator-5560', ...args], {
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 30000,
  });
const ui = (command, value) =>
  execFileSync(
    process.execPath,
    ['scripts/phone-offline-02-native-driver.mjs', command, ...(value ? [value] : [])],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 40000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
const xml = () => fs.readFileSync(dir + '/window.xml', 'utf8');
const control = (label) =>
  [...xml().matchAll(/<node\b[^>]*>/g)]
    .map((m) => m[0])
    .find((n) => n.includes('content-desc="' + label + '"') && n.includes('enabled="true"'));
const visible = (label) => {
  const b = control(label)?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  return b && +b[4] > +b[2] && +b[3] > +b[1];
};
function reveal(label, prefix) {
  for (let i = 0; i < 6; i++) {
    if (visible(label)) return;
    ui('down');
    ui('snapshot', prefix + '-scroll' + i);
  }
  throw Error('Missing control: ' + label);
}
if (run(['shell', 'getprop', 'ro.kernel.qemu']).trim() !== '1')
  throw Error('This is an emulator-only test');
ui('snapshot', 'context-v3-home');
if (visible('Continue your gear check')) {
  ui('tap', 'Offline and privacy settings');
  ui('snapshot', 'context-v3-settings');
  ui('tap', 'Remove current draft');
  ui('tap', 'Confirm: remove this draft');
}
ui('tap', 'Start a gear check');
const protocol = JSON.parse(
  fs.readFileSync('experiments/round-05/hard-case-protocol.json', 'utf8'),
);
for (const [id, name] of [
  ['biker-black--reference', 'control'],
  ['sample-01--reference', 'user01'],
  ['sample-02--reference', 'user02'],
  ['sample-03--reference', 'user03'],
]) {
  const c = protocol.cases.find((c) => c.id === id),
    prefix = 'context-v3-' + name;
  if (fs.existsSync(dir + '/' + prefix + '-outcome.json'))
    throw Error('Existing evidence: ' + prefix);
  const remote = '/sdcard/Pictures/relay-context-v3-' + name + '.jpg';
  run(['push', c.inputFile, remote]);
  run(['shell', 'touch', remote]);
  run([
    'shell',
    'am',
    'broadcast',
    '-a',
    'android.intent.action.MEDIA_SCANNER_SCAN_FILE',
    '-d',
    'file://' + remote,
  ]);
  ui('tap', 'Choose a photograph');
  const node = [...xml().matchAll(/<node\b[^>]*>/g)]
    .map((m) => m[0])
    .find((n) => n.includes('content-desc="Photo taken on '));
  const b = node?.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (!b) throw Error('Picker thumbnail absent');
  run([
    'shell',
    'input',
    'tap',
    String(Math.round((+b[1] + +b[3]) / 2)),
    String(Math.round((+b[2] + +b[4]) / 2)),
  ]);
  ui('snapshot', prefix + '-input');
  ui('tap', 'Analyze these photographs on this phone');
  ui('tap', 'Review the evidence');
  console.log(
    JSON.stringify({
      case: id,
      expectedDamage: c.expectedDamage,
      inputSha256: c.inputSha256,
      startedAt: new Date().toISOString(),
    }),
  );
  execFileSync(process.execPath, ['scripts/phone-offline-02-watch.mjs', prefix], {
    windowsHide: true,
    stdio: 'inherit',
    timeout: 760000,
  });
  const result = JSON.parse(fs.readFileSync(dir + '/' + prefix + '-outcome.json', 'utf8'));
  const flagged = result.status.includes('Offer on hold');
  if (!result.done || flagged !== c.expectedDamage) throw Error('Native canary mismatch: ' + id);
  ui('snapshot', prefix + '-findings');
  reveal('See the next step', prefix + '-evidence');
  ui('tap', 'See the next step');
  reveal('Save brief &amp; check next item', prefix + '-brief');
  ui('tap', 'Save brief &amp; check next item');
  console.log(JSON.stringify({ case: id, passedDetectionCheck: true, saved: true }));
}
ui('snapshot', 'context-v3-all-saved');
