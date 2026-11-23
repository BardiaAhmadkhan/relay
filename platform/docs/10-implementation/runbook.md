# Build and run

Commands use .. Windows tools used here: Node 24.12, npm 11, Ollama 0.40.4, JDK 21 and Android SDK 36. Use npm.cmd/npx.cmd in PowerShell.

## Local inspection

~~~powershell
npm.cmd ci
npm.cmd run vision:serve
~~~

This starts an isolated loopback Ollama instance on port 11435, uses .cache/ollama, disables cloud, and limits concurrent inference to one model. An unrelated Ollama installation on 11434 is unaffected. Set RELAY_OLLAMA_BIN if Ollama is not on PATH.

In a second terminal:

~~~powershell
npm.cmd run vision:pull
npm.cmd run vision:warm
npm.cmd run dev:api
~~~

The selected reference is qwen3.5:4b with full digest d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04. Startup rejects a different digest for this profile. Warmup avoids first-use loading delay. The model remains loaded for 30 minutes; photograph-derived observations expire after ten minutes. No cloud fallback occurs.

In a third terminal:

~~~powershell
npm.cmd run export:mobile
npm.cmd run preview
~~~

Open http://localhost:4173 for the engineering preview. For native development use npm.cmd run dev:app and a compatible SDK 57 development environment. Exporting bundles does not build an IPA or prove a physical phone works.

## Standalone Android release

For the Galaxy S26 Ultra, use the [offline APK installation guide](android-install.md). The Android 0.2 package bundles its model, projector and native inference runtime. No computer service, port forwarding, cloud account or network connection is needed. This privately distributed experimental package is not a store release.

The project-local SDK, JDK, NDK and Gradle caches live under .tooling and .cache. The generated project is app/android. The build helper verifies pinned llama.rn source patches and builds both ARM64 and x86_64 from source. Assets are checked against app/assets/offline/manifest.json before staging. If regenerating Android with Expo prebuild, retain both the network-permission and offline-vision plugins, then stage the assets again.

~~~powershell
node scripts/phone-offline-02-sync-assets.mjs
node scripts/phone-offline-02-build.mjs
python scripts/phone-offline-02-inspect-apk.py
~~~

The build output is app/android/app/build/outputs/apk/release/app-release.apk. The reviewed handoff copy is artifacts/Relay-0.2-offline-android.apk, with a SHA-256 record alongside it. The old relay-round04-android.apk is an archived computer-dependent client. Do not distribute it as the offline app.

The optional scripts/install-android.ps1 installs the verified handoff APK while preserving app records. Copying it to the phone and opening it in My Files is also supported. USB is used only for transfer/installation. The installer neither starts a service nor creates ADB reverse mappings. Physical Galaxy S26 Ultra execution remains unmeasured; see [the native verification record](../15-testing-and-qa/phone-offline-02.md).

## Web and iOS service connection

These platforms retain the existing service adapter. Use a trusted HTTPS Relay endpoint with RELAY_HOST and a strong RELAY_ACCESS_TOKEN configured server-side. Enter the service URL/session token in Connection & privacy. Localhost on a physical phone is the phone itself. No TLS proxy, firewall rule, hosted service or tunnel was deployed here.

Do not put provider API keys in the app. The optional cloud adapter is inactive and unvalidated live; gear-image inference remains local. The small specialist routing artifacts remain separate research and do not determine eligibility.

## Verification

The original five browser scenarios and the 22-case recovery/trust suite expect a local_clip service on 8787. Use RELAY_PROVIDER=local_clip for those suites. The three real-photo tests expect local_vlm on 8788. They require the user-supplied ignored fixtures. Test services can be started with RELAY_PORT; return the normal 8787 service to local_vlm after the checks.

~~~powershell
$env:RELAY_UI_URL='http://localhost:4173'
npm.cmd run test:ui
$env:RELAY_ROUND02_RUN='your-unique-run-name'
npx.cmd playwright test --config experiments/round-02/experience/playwright.config.ts
$env:RELAY_LIVE_RUN='your-unique-run-name'
npx.cmd playwright test --config experiments/round-03/playwright.config.ts
~~~

Experiment scripts refuse to overwrite frozen protocols. Use a new cycle directory for a new candidate; preserve failures. scripts/routing-cycle-02.py, quantization-cycle-03.py and precision-cycle-04.py require local Python with torch, PIL, numpy, onnx and onnxruntime. No gear photo leaves this computer.

## Recovery and retention

Cancel retains the draft and rejects late responses. Changing history reuses unchanged photo evidence without another model call. Drafts expire on opening after 24 hours of inactivity; saved briefs and their photos do not expire automatically. Notebook capacity is 50 records, with an explicit error rather than silent eviction. Storage failure keeps the current draft. Saved-record removal requires explicit confirmation.

Policy upgrades discard an obsolete analysis while retaining its photos/history for refresh. Owned photo deletion uses a recoverable tombstone; original gallery images are not deleted. Saved notebook photo references are protected during orphan cleanup. Metadata corruption does not authorize deletion of potentially saved photos.
