# Relay 0.2: standalone Android verification

The delivered APK performs image analysis inside Android using its bundled model and projector. It requires no computer service, account, API key, model download or network connection. The package is 3,316,903,550 bytes (3.32 GB), version 0.2.0 / code 2, for ARM64 and x86_64.

SHA-256: `ba762cc7928bf31d600dfcfcdce0dff7d194f0d3405526e651276cdac02a6a0a`.

See the [installation guide](../10-implementation/android-install.md), APK integrity record and [structured verification record](../../benchmarks/phone-offline-02/verification-final.json). Physical Samsung Galaxy S26 Ultra execution, GPU-driver behavior, battery use and latency remain untested. This is an experimental local test-key release, not a Play Store release.

## Native results

The corrected normal app was tested on Android 36 with an 8 GB x86_64 CPU emulator. Each picture was assessed as a separate item and its brief saved. The final full APK has exactly the same JavaScript bundle and all 56 native libraries as this tested build; full model packaging and hashes were independently checked.

| Input | Observed result | Displayed review time |
| --- | --- | --- |
| Intact black leather control | Zero findings; physical review still required | 188.4 s, including process/model startup |
| Original photo 1 | Shoulder/sleeve abrasion flagged; offer on hold | 115.7 s |
| Original photo 2 | Torn sleeves and abrasion flagged; offer on hold | 106.9 s |
| Original photo 3 | Torn/frayed sleeve material flagged; offer on hold | 82.9 s |

These are four detection checks, not a broad accuracy score. They do not establish that every description or location is correct. Photo 3 still has an ambiguous possible side-panel abrasion claim. The prior desktop quality cycle retained 53 visual failures; that audit is neither erased nor converted into a phone accuracy claim. See [the earlier quality report](quality-cycle-02.md). Emulator times are not measurements of the S26 Ultra.

The final complete APK was then installed on a separate 20 GB emulator over the previous 0.1 client. Its installed-file hash matches the handoff APK. The full-package checks verified:

- The previous-version brief survived the upgrade.
- Fresh model preparation used only the APK's bundled files. The older client contained no offline model.
- A real supplied photograph was inspected offline. Cancelling native analysis preserved the photograph; retry removed the stale cancellation notice and completed with visible damage findings (88.4 s displayed).
- Rechecking that unchanged photo displayed under one second of analysis time using the validated result cache.
- The saved result and photograph, together with the older brief, survived a force-stop and relaunch.
- The emulator's synthetic camera completed permission, preview and capture. Its low-detail frame correctly received a photo-quality warning. Physical-camera quality remains untested.
- A reported crash continued to exclude the item after the answer was changed to No. The synthetic-camera draft was then removed; saved briefs remained.

Airplane mode was on, Wi-Fi and mobile data were off, ADB reverse mappings were empty, and the installed package had no Internet permission. The app did not call the desktop API or a cloud provider. Private screenshots, UI hierarchies and detailed results remain under `benchmarks/phone-offline-02/native` and are excluded from publication.

## Targeted recognition correction

The first complete native candidate flagged the three damaged photos but also returned four false abrasion findings on the intact control. A clean process restart and a full native state reset both failed to remove that false positive. Those candidates and failures are retained; state isolation is not claimed as the recognition fix.

Controlled reference-runtime comparisons used the Android-prepared JPEG and the same candidate descriptions. CPU/GPU, attention/batching settings and image-grid probes did not reproduce the native false positive. A real preprocessing-version difference was found, including half-even dimension rounding, but it was not accepted as the root cause on that evidence. No speculative preprocessing patch was shipped.

The native diagnostic comparison isolated the verifier request assembly. Combining the instructions and candidate claims in one user message supported all four false claims. Keeping the trusted verification instructions in a system message and the candidate/image data in a user message rejected all four, while retaining the fixed candidate-key schema. The index-list/system variant also rejected them, so no index-list migration was needed.

The selected `phone-evidence-3` profile uses that verified separation and a stable candidate-field order. Full-photo/crop relationship instructions remain trusted context; generated candidate descriptions remain untrusted data. The primary inspection, model weights, normal image budget and deterministic eligibility policy are unchanged. The four normal-app checks above followed this correction. No new model was trained.

## Model and runtime

The 0.8B candidate missed subtle damage and produced invalid/repetitive structured output. The 2B candidate introduced a reduced-image miss and an intact-jacket false alarm. The existing Qwen3.5 4B Q4 reference weights were therefore retained. This is a larger first standalone build, not the completed tiny-specialist architecture. The separate trained routing prototype does not determine product decisions.

The model and projector total 3,324,162,336 bytes before APK compression. Their complete hashes, source digest and license are in `app/assets/offline/manifest.json`. The upstream [Qwen model](https://huggingface.co/Qwen/Qwen3.5-4B) is Apache-2.0. Runtime and font license notices are included in the package.

- A native background worker streams and verifies private model files without creating multi-gigabyte JavaScript buffers. A fresh process verifies existing files before use. Failed setup retains the photo for retry.
- ARM64 attempts supported GPU acceleration and falls back to CPU if initialization fails. NPU acceleration and physical-phone GPU success are not claimed.
- Inference requests are serialized. The JSI stop method's possible void return is handled, and cancellation releases the caller promptly without overlapping the unfinished native task.
- Chat/image formatting is kept separate from the strict JSON sampler. The rejected assistant-role-header output is not repaired with arbitrary text stripping.
- Independent native inference state is cleared while loaded weights and the separate byte-keyed, ten-minute result cache remain available. Failed, cancelled or incomplete optional recovery is not cached as a completed success.
- Photo evidence cannot override known crash/protective-damage history or establish hidden condition, authenticity or protective performance.
- `llama.rn` 0.13.0-rc.8 is pinned and built from source. Reproducible patches select the primary ABI, suppress prompt/candidate informational logs and guard x86 AVX2/FMA/F16C usage. The x86 optimization left all 33 ARM64 libraries unchanged.

## Verification and retained failures

All 505 automated tests, TypeScript checks and formatting checks passed. The tests include runtime doubles; native model evidence is reported separately above. Web/iOS/Android exports passed before the final Android-only verifier assembly adjustment; subsequent native release compilation and execution verified that selected assembly. All 471 previously sealed experiment/audit files still match their hashes.

The final package passed complete model hashing, packaged-manifest/profile matching, signing verification, certificate continuity with the old APK, 16 KB ELF/ZIP alignment, fixture-exclusion and diagnostic-marker checks. The code comparison is in `full-package-code-parity.json`; the installed APK hash is independently recorded.

An early candidate exceeded its former 120-second setup allowance. Bounded preparation progress and a six-minute single-photo / ten-minute maximum review allowance were added. A later rejected candidate also timed out under measured host memory pressure; it returned no completed assessment and retained its photo. These failures remain in the evidence.

The original 10 GB emulator could not stage the large final update with retained model files. A separate 20 GB emulator installed it successfully, preserving the old client brief. The original emulator and its four saved canary briefs were left intact. Allow about 12 GB free storage before copying/installing the APK on the phone.

Private thin diagnostic/test APKs temporarily reused already prepared model files to speed experiments. Their JavaScript diagnostic entry was removed, full asset packaging restored, and the final bundle/native identities checked. Those test APKs are not standalone deliverables. The old `relay-round04-android.apk` and the rejected v6 package remain separately named; install only `Relay-0.2-offline-android.apk`.

## Reproduce

Use the isolated SDK, JDK 21, NDK 27.1, Gradle cache and exact model cache in this repository. Do not substitute weights by filename alone.

```powershell
node scripts/phone-offline-02-sync-assets.mjs
node scripts/phone-offline-02-build.mjs
python scripts/phone-offline-02-inspect-apk.py
npm run typecheck
npm test
npm run format:check
npm run check:docs
```

The runtime API and source-build requirement are documented by [llama.rn](https://github.com/mybigday/llama.rn). The older preprocessing reference is pinned to [llama.cpp 620d2225c](https://github.com/ggml-org/llama.cpp/tree/620d2225c/tools/mtmd), with downloaded source hashes retained under the experiment directory. New experiments must use new evidence paths and preserve the rejected results.
