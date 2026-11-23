import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const version = JSON.parse(await fs.readFile('node_modules/llama.rn/package.json', 'utf8')).version;
if (version !== '0.13.0-rc.8')
  throw Error('Review runtime patches before changing llama.rn version.');
const records = [];
async function patch(file, oldText, newText) {
  const old = await fs.readFile(file, 'utf8');
  if (old.includes(newText)) {
    records.push({
      file,
      alreadyApplied: true,
      sha256: createHash('sha256').update(old).digest('hex'),
    });
    return;
  }
  if (!old.includes(oldText)) throw Error('Runtime patch anchor changed: ' + file);
  const updated = old.replace(oldText, newText);
  await fs.writeFile(file, updated);
  records.push({
    file,
    beforeSha256: createHash('sha256').update(old).digest('hex'),
    sha256: createHash('sha256').update(updated).digest('hex'),
  });
}
const file = 'node_modules/llama.rn/android/src/main/java/com/rnllama/RNLlama.java';
await patch(
  file,
  `for (String abi : Build.SUPPORTED_ABIS) {\n      if ("arm64-v8a".equalsIgnoreCase(abi)) return true;\n    }\n    return false;`,
  `// Relay APK contains both 64-bit ABIs. Select the primary ABI, not an emulated fallback.\n    return Build.SUPPORTED_ABIS.length > 0 && "arm64-v8a".equalsIgnoreCase(Build.SUPPORTED_ABIS[0]);`,
);
await patch(
  file,
  `for (String abi : Build.SUPPORTED_ABIS) {\n      if ("x86_64".equalsIgnoreCase(abi)) return true;\n    }\n    return false;`,
  `return Build.SUPPORTED_ABIS.length > 0 && "x86_64".equalsIgnoreCase(Build.SUPPORTED_ABIS[0]);`,
);
await patch(
  'node_modules/llama.rn/cpp/rn-llama.cpp',
  `                       const char *format, ...)\n{\n    va_list args;`,
  `                       const char *format, ...)\n{\n    // Relay: candidate descriptions and image paths must not enter release diagnostic logs.\n    #if defined(__ANDROID__) && defined(NDEBUG)\n    if (strcmp(level, "ERROR") != 0) return;\n    #endif\n    va_list args;`,
);
// The specialized x86 build may use AVX2 only when the device advertises every required feature.
await patch(
  file,
  'else if (isX86_64()) {',
  'else if (isX86_64() && cpuFeatures.contains("avx2") && cpuFeatures.contains("fma") && cpuFeatures.contains("f16c")) {',
);
for (const cmake of [
  'node_modules/llama.rn/android/src/main/CMakeLists.txt',
  'node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt',
]) {
  await patch(
    cmake,
    '-march=x86-64;-mtune=generic;-msse4.2;-mpopcnt"',
    '-march=x86-64;-mtune=generic;-msse4.2;-mpopcnt;-mavx2;-mfma;-mf16c"',
  );
}
const recordPath = 'experiments/phone-offline-02/runtime-patches-v2.json';
try {
  await fs.writeFile(recordPath, JSON.stringify({ version, records }, null, 2) + '\n', {
    flag: 'wx',
  });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const previous = JSON.parse(await fs.readFile(recordPath, 'utf8'));
  const expected = new Map(previous.records.map((record) => [record.file, record.sha256]));
  for (const [file, sha] of expected) {
    if (
      createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex') !== sha
    )
      throw Error('Patched runtime differs from its recorded source: ' + file);
  }
}
console.log('Pinned Android runtime patches verified.');
