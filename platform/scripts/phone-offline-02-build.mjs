import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
await import('./phone-offline-02-prepare-runtime.mjs');
const root = path.resolve('.');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = path.join(root, 'benchmarks/phone-offline-02/build-' + stamp + '.log');
const log = fs.createWriteStream(logPath, { flags: 'wx' });
const env = {
  ...process.env,
  JAVA_HOME: path.join(root, '.tooling/jdk/jdk-21.0.12.1+1'),
  ANDROID_HOME: path.join(root, '.tooling/android-sdk'),
  ANDROID_SDK_ROOT: path.join(root, '.tooling/android-sdk'),
  GRADLE_USER_HOME: path.join(root, '.cache/gradle'),
  CI: '1',
  NODE_ENV: 'production',
};
const build = spawn(
  path.join(env.JAVA_HOME, 'bin/java.exe'),
  [
    '-Xmx64m',
    '-Xms64m',
    '-Dorg.gradle.appname=gradlew',
    '-jar',
    path.join(root, 'app/android/gradle/wrapper/gradle-wrapper.jar'),
    ':app:assembleRelease',
    '-PreactNativeArchitectures=arm64-v8a,x86_64',
    '--no-daemon',
    '--max-workers=2',
    '-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m',
    '--console=plain',
  ],
  { cwd: path.join(root, 'app/android'), env, windowsHide: true },
);
console.log('Build log: ' + logPath);
let pending = '';
for (const stream of [build.stdout, build.stderr])
  stream.on('data', (chunk) => {
    log.write(chunk);
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines)
      if (
        /(FAILED|FAILURE:|BUILD SUCCESSFUL|BUILD FAILED|^e:|^> Task :app:.*(?<!UP-TO-DATE))$/.test(
          line,
        )
      )
        console.log(line);
  });
build.on('error', (e) => {
  console.error(e.message);
  log.end();
  process.exitCode = 1;
});
build.on('exit', (code) => {
  log.end();
  console.log('Gradle exit: ' + code);
  process.exitCode = code ?? 1;
});
