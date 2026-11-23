const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require('@expo/config-plugins');
const fs = require('node:fs/promises'),
  path = require('node:path'),
  crypto = require('node:crypto');
module.exports = function withOfflineVision(config) {
  config = withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = m.application[0];
    delete app.$['android:networkSecurityConfig'];
    app.$['android:usesCleartextTraffic'] = 'false';
    app['uses-native-library'] = [
      ...(app['uses-native-library'] || []).filter(
        (x) => !['libOpenCL.so', 'libcdsprpc.so'].includes(x.$['android:name']),
      ),
      { $: { 'android:name': 'libOpenCL.so', 'android:required': 'false' } },
    ];
    return c;
  });
  config = withMainApplication(config, (c) => {
    const statement = 'add(ca.relaygearlab.experimental.offline.RelayOfflinePackage())';
    if (!c.modResults.contents.includes(statement)) {
      const marker = 'PackageList(this).packages.apply {';
      if (!c.modResults.contents.includes(marker))
        throw Error('Offline package registration anchor missing');
      c.modResults.contents = c.modResults.contents.replace(
        marker,
        marker + '\n          ' + statement,
      );
    }
    return c;
  });
  return withDangerousMod(config, [
    'android',
    async (c) => {
      const project = c.modRequest.projectRoot,
        root = path.resolve(project, '..'),
        android = c.modRequest.platformProjectRoot;
      const manifest = JSON.parse(
        await fs.readFile(path.join(project, 'assets/offline/manifest.json'), 'utf8'),
      );
      const assets = path.join(android, 'app/src/main/assets/relay-models');
      await fs.mkdir(assets, { recursive: true });
      for (const key of ['model', 'projector']) {
        const entry = manifest[key],
          source = path.resolve(root, entry.source);
        if (!source.startsWith(root + path.sep)) throw Error('Model escaped project');
        if ((await fs.stat(source)).size !== entry.bytes) throw Error('Model size mismatch');
        const hash = crypto.createHash('sha256');
        for await (const chunk of require('node:fs').createReadStream(source)) hash.update(chunk);
        if (hash.digest('hex') !== entry.sha256) throw Error('Model hash mismatch');
        await fs.copyFile(
          source,
          path.join(assets, key === 'model' ? 'vision.gguf' : 'projector.gguf'),
        );
      }
      await fs.writeFile(path.join(assets, 'manifest.json'), JSON.stringify(manifest));
      const dest = path.join(android, 'app/src/main/java/ca/relaygearlab/experimental/offline');
      await fs.mkdir(dest, { recursive: true });
      await fs.copyFile(
        path.join(project, 'native/offline/RelayOfflineAssets.kt'),
        path.join(dest, 'RelayOfflineAssets.kt'),
      );
      await fs.copyFile(
        path.join(project, 'assets/offline/NOTICE.txt'),
        path.join(assets, 'NOTICE.txt'),
      );
      await fs.copyFile(
        path.join(project, 'assets/offline/LICENSE.txt'),
        path.join(assets, 'LICENSE.txt'),
      );
      await fs.copyFile(
        path.join(project, 'assets/offline/RUNTIME-LICENSES.txt'),
        path.join(assets, 'RUNTIME-LICENSES.txt'),
      );
      return c;
    },
  ]);
};
