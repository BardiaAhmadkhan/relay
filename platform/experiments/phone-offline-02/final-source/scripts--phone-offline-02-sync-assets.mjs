import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('.'),
  manifest = JSON.parse(await fs.readFile('app/assets/offline/manifest.json', 'utf8')),
  dest = path.join(root, 'app/android/app/src/main/assets/relay-models');
await fs.mkdir(dest, { recursive: true });
for (const key of ['model', 'projector']) {
  const entry = manifest[key],
    source = path.resolve(root, entry.source);
  if (!source.startsWith(root + path.sep)) throw Error('Model source outside project');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(source)) hash.update(chunk);
  if (hash.digest('hex') !== entry.sha256 || (await fs.stat(source)).size !== entry.bytes)
    throw Error('Model integrity mismatch');
  await fs.copyFile(source, path.join(dest, key === 'model' ? 'vision.gguf' : 'projector.gguf'));
  console.log('Bundled verified ' + key + ' (' + entry.bytes + ' bytes)');
}
for (const name of ['manifest.json', 'NOTICE.txt', 'LICENSE.txt'])
  await fs.copyFile('app/assets/offline/' + name, path.join(dest, name));
let notices = '';
for (const candidate of [
  'node_modules/llama.rn/LICENSE',
  'node_modules/llama.rn/vendor/llama.cpp/LICENSE',
  'node_modules/@expo-google-fonts/dm-sans/LICENSE_FONT',
  'node_modules/@expo-google-fonts/instrument-serif/LICENSE_FONT',
  'node_modules/react-native/LICENSE',
  'node_modules/react/LICENSE',
  'node_modules/expo/LICENSE',
]) {
  try {
    notices += '\n' + candidate + '\n' + (await fs.readFile(candidate, 'utf8'));
  } catch {
    throw Error('Runtime licence missing: ' + candidate);
  }
}
await fs.writeFile('app/assets/offline/RUNTIME-LICENSES.txt', notices);
await fs.writeFile(path.join(dest, 'RUNTIME-LICENSES.txt'), notices);
await fs.copyFile(
  'app/native/offline/RelayOfflineAssets.kt',
  'app/android/app/src/main/java/ca/relaygearlab/experimental/offline/RelayOfflineAssets.kt',
);
