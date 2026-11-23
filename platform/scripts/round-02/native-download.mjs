import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
const root = path.resolve('.tooling'),
  downloads = path.join(root, 'downloads');
await fs.mkdir(downloads, { recursive: true });
const items = [
  {
    id: 'temurin-jdk21',
    url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12.1_1.zip',
    sha256: 'f9d6e191ab098c0d416e7d588a24420a8621cd2f4720dab2459b8b7b2d2d8b4e',
    file: 'jdk21.zip',
    source:
      'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse',
  },
  {
    id: 'android-command-line-tools',
    url: 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip',
    sha256: '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a',
    file: 'android-command-tools.zip',
    source: 'https://developer.android.com/studio',
  },
];
const results = await Promise.all(
  items.map(async (item) => {
    const file = path.join(downloads, item.file);
    const start = performance.now();
    try {
      await fs.access(file);
    } catch {
      const response = await fetch(item.url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body)
        throw new Error(item.id + ' download HTTP ' + response.status);
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
    }
    const hash = createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
    if (hash !== item.sha256) throw new Error(item.id + ' checksum mismatch');
    const result = {
      ...item,
      localPath: path.relative(process.cwd(), file).replaceAll('\\', '/'),
      bytes: (await fs.stat(file)).size,
      verifiedSha256: hash,
      durationMs: performance.now() - start,
    };
    console.log(JSON.stringify({ id: item.id, verified: true, bytes: result.bytes }));
    return result;
  }),
);
await fs.mkdir('benchmarks/round-02/native', { recursive: true });
await fs.writeFile(
  'benchmarks/round-02/native/tool-downloads.json',
  JSON.stringify({ recordedAt: new Date().toISOString(), items: results }, null, 2),
);
