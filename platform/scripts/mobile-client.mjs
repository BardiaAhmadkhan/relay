import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [platform, mode, ...extra] = process.argv.slice(2);
if (!['android', 'ios'].includes(platform)) throw Error('Choose android or ios.');
const expo = path.join(root, 'node_modules/expo/bin/cli');
const run = (cwd, args) => {
  const result = spawnSync(process.execPath, [expo, ...args], {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (process.env.RELAY_MOBILE_PROFILE === 'offline') {
  run(path.join(root, 'app'), ['run:' + platform, ...[mode, ...extra].filter(Boolean)]);
} else {
  // Expo reuses an existing android/ tree. The archived laboratory tree already contains offline
  // weights. Generate this client in a fresh project so those files cannot reach its assets.
  // Short paths keep Windows Ninja object paths below its legacy limit.
  const buildRoot =
    process.env.RELAY_NATIVE_BUILD_ROOT ??
    (process.platform === 'win32' ? path.join(root, '.cache') : os.tmpdir());
  await fs.mkdir(buildRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(buildRoot, 'ph-')),
    app = path.join(dir, 'app');
  await fs.mkdir(app);
  for (const name of ['package.json', 'package-lock.json'])
    await fs.copyFile(path.join(root, name), path.join(dir, name));
  for (const name of [
    'app.json',
    'app.config.js',
    'metro.config.js',
    'react-native.config.js',
    'package.json',
    'tsconfig.json',
    'App.tsx',
    'index.ts',
  ])
    await fs.copyFile(path.join(root, 'app', name), path.join(app, name));
  for (const name of ['src', 'plugins'])
    await fs.cp(path.join(root, 'app', name), path.join(app, name), { recursive: true });
  await fs.mkdir(path.join(app, 'assets'));
  await fs.copyFile(
    path.join(root, 'app/assets/editorial-jacket.jpg'),
    path.join(app, 'assets/editorial-jacket.jpg'),
  );
  await fs.mkdir(path.join(dir, 'assets/brand'), { recursive: true });
  await fs.copyFile(
    path.join(root, 'assets/brand/relay-icon.png'),
    path.join(dir, 'assets/brand/relay-icon.png'),
  );
  await fs.cp(path.join(root, 'packages'), path.join(dir, 'packages'), {
    recursive: true,
    filter: async (file) =>
      (await fs.stat(file)).isDirectory() || /\.(?:[cm]?[jt]sx?|json)$/.test(file),
  });
  for (const [src, dest] of [
    [path.join(root, 'node_modules'), path.join(dir, 'node_modules')],
    [path.join(root, 'app/node_modules'), path.join(app, 'node_modules')],
  ]) {
    if (await fs.stat(src).catch(() => null))
      await fs.symlink(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
  }
  run(app, ['prebuild', '--no-install', '--platform', platform]);
  console.log('Native API client project: ' + app);
  if (mode !== '--prepare') run(app, ['run:' + platform, ...[mode, ...extra].filter(Boolean)]);
}
