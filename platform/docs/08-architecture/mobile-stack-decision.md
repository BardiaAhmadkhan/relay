# Mobile stack decision — preparation prototype

Decision date: 2026-10-26 UTC. Status: selected for the first experimental implementation; reopen if the triggers below occur. This is a documented engineering judgement, not a measured framework performance comparison.

## Decision

Use **React Native with Expo SDK 57 and TypeScript**, plus a separate local Node service for pretrained vision experiments. The phone application owns capture, disclosure, review and recovery. A shared deterministic domain package owns assessment states and exclusions. Provider-specific inference remains behind an adapter.

Build an actual iOS/Android-oriented app. A browser rendering is useful for layout inspection and automated interaction checks, but does not satisfy native camera, permission, lifecycle, accessibility or performance acceptance criteria.

The current Expo project-creation guide specifically recommends SDK 57 for physical-device Expo Go during the SDK 58 transition. The SDK reference pairs SDK 57 with React Native 0.86, React 19.2.3 and minimum Node 22.13.x. SDK 58 is paired with React Native 0.88 and React 19.3.0. Use the installed Expo package's compatibility map and lockfile for exact patch pins, rather than combining unrelated latest packages. [Expo creation guidance](https://docs.expo.dev/get-started/create-a-project/), [SDK compatibility](https://docs.expo.dev/versions/latest/)

The parent's live registry inspection reported expo 58.0.19, expo-camera 58.0.12, react-native 0.88.0 and @huggingface/transformers 4.3.1. Those latest tags are discovery facts, not instructions to install them into the SDK 57 app. The fetched SDK 57 camera page recommends ~57.0.6. Root implementation records and the final lockfile remain authoritative for what was installed. [SDK 57 camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/)

## Constraints behind the choice

- One preparation codebase must support both phones and be reconstructable within a build-on-day event.
- Camera stills, a small sequence of screens, editable structured observations and deterministic exclusions are the initial workload. Continuous frame processing is not required by the supplied brief.
- The inspected Windows environment has Node 24.12.0/npm 11, a Flutter command, and no Android SDK, adb, Java or Python detected in PATH. A command being present does not prove its native toolchain works. There is no local macOS/Xcode capability.
- API credentials are not available. Real inference can begin on the computer without a hosted model or Python.
- Existing TypeScript tooling is available. Team Dart/Swift/Kotlin experience has not been measured; this is an explicit assumption that can change the decision.
- Native proof requires physical devices or configured emulators/simulators. It cannot be manufactured by a successful JavaScript build.

## Capability evidence

| Candidate | Evidence relevant to this task | Costs or gaps to manage |
|---|---|---|
| React Native + Expo | Expo camera supports still capture and permissions on Android/iOS, and is included in Expo Go. React Native exposes native accessibility properties. Development builds allow native libraries outside Expo Go. | Custom on-device CV generally needs a native module and development build. SDK/plugin version compatibility needs enforcement. Native lifecycle and image URIs still need device tests. |
| Flutter + Dart | Flutter supports Android and iOS. Its first-party camera package supports preview, image capture and image buffers; platform channels/Pigeon connect Kotlin and Swift. | Dart becomes another language beside Node inference. Shared safety rules need a single service or generated contracts with cross-language tests. Camera lifecycle handling is explicitly the app's responsibility. |
| Swift/SwiftUI + Kotlin/Compose | Direct Apple/Android framework access, including Android CameraX and Apple Vision, provides the greatest freedom for frame processing and platform integration. | Two UI implementations, two release pipelines and more opportunities for policy divergence. Current Windows environment cannot compile the iOS target. |

Sources: [Expo camera](https://docs.expo.dev/versions/v57.0.0/sdk/camera/), [React Native accessibility](https://reactnative.dev/docs/accessibility), [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Flutter platforms](https://docs.flutter.dev/reference/supported-platforms), [Flutter camera](https://pub.dev/packages/camera), [Flutter platform channels](https://docs.flutter.dev/platform-integration/platform-channels), [Android CameraX](https://developer.android.com/media/camera/camerax), [Apple Vision text recognition](https://developer.apple.com/documentation/vision/recognizing-text-in-images).

The retrieved Flutter deployment page described Flutter 3.47. The retrieved first-party camera package was 0.12.1. These establish a current alternative, not an installed or tested Flutter stack. Apple documentation exposed a JavaScript-only page to the retrieval tool; its indexed first-party text describes on-device text recognition. Native Apple implementation details must be verified from the SDK before use.

## Weighted decision matrix

Scores use 1 = poor fit in this environment, 3 = viable with notable extra work, 5 = strong fit. These are **ordinal implementation-fit judgements**. They are not latency, defect, accessibility or design-quality measurements. Weighted total = sum(weight × score) / 5, maximum 100.

| Criterion | Weight | Expo | Flutter | Swift + Kotlin | Why this weight / scoring rationale |
|---|---:|---:|---:|---:|---|
| Delivery and reconstruction effort with available tooling | 25 | 5 | 4 | 2 | Build-on-day and a single authoring path matter. Expo reuses available TypeScript; Flutter has one UI language; two native apps double implementation surfaces. |
| Capture workflow and lifecycle integration | 20 | 4 | 4 | 5 | Photos are the primary input. Both cross-platform stacks have supported camera packages; native APIs offer direct control. No comparative camera-quality claim is made. |
| Design and accessibility capability | 15 | 5 | 5 | 5 | All can produce the required premium experience. Framework selection alone does not prove it. |
| Reuse of policy contracts and test harness | 15 | 5 | 4 | 3 | Same TypeScript domain functions can run in app and Node. Other stacks can use generated schemas/service contracts but need extra conformance work. |
| Offline/native CV extension effort | 10 | 3 | 4 | 5 | Expo Go's native-library boundary is material. Flutter has plugin/platform channels; native stacks use platform CV directly. This is integration effort, not an FPS ranking. |
| Build/test feasibility from this Windows environment | 10 | 4 | 3 | 1 | Expo Go can aid early physical preview and EAS can build remotely; Flutter still needs native toolchains. No option produces a local signed iOS binary here. |
| Adaptation to unknown rubric and policies | 5 | 5 | 4 | 3 | One small domain package and declarative steps reduce duplicated changes. All remain viable if equally well modularized. |
| **Total** | **100** | **90** | **81** | **69** | Context-specific judgement. |

The 9-point Expo/Flutter separation should not be interpreted as 9% faster development or better quality. Several scores depend on the TypeScript implementation assumption.

## Sensitivity and decision reversibility

| Scenario | Changes | Expo | Flutter | Native | Interpretation |
|---|---|---:|---:|---:|---|
| Base | Weights above | 90 | 81 | 69 | Expo selected for first implementation. |
| Team is primarily experienced Flutter developers | Delivery score Expo 3, Flutter 5; other values unchanged | 80 | 86 | 69 | Flutter wins. Verify team experience before competition-day commitment. |
| Offline CV becomes central | Weights: delivery 10, capture 15, design 15, contracts 10, offline 35, environment 10, adaptation 5 | 81 | 81 | 80 | Tie: do a real native CV spike before selecting. |
| Device processing dominates the rubric | Weights: delivery 5, capture 10, design 10, contracts 10, offline 50, environment 10, adaptation 5 | 76 | 80 | 83 | Direct native wins this hypothetical priority set. Two-platform effort must still be funded. |

The calculations were recomputed from the displayed score arrays. Changing every subjective Expo score downward by one would reduce its total by 20 points, demonstrating why the scores cannot replace a spike. The choice is intentionally reversible: capture and inference adapters, JSON contracts, policy fixtures and design tokens should survive a framework change.

## Module and language boundaries

| Area | Language/runtime | Responsibility |
|---|---|---|
| Mobile UI | TypeScript/React Native | Permission-aware camera, evidence review, disclosure, progress, accessible state-specific results, retry and reset. |
| Domain package | TypeScript, no device dependencies | Runtime validation, facts with provenance, required-evidence state, exclusion rules, revisions, and deterministic result derivation. |
| Local research gateway | Node.js | Image decoding limits, pretrained model loading, category inference, optional OCR, request bounds and diagnostics. Keep heavy inference off the UI thread. |
| Future hosted gateway | Node.js initially | Server-only provider keys, consent enforcement, token accounting, bounded retries, redacted logs and provider mapping. Not automatically deployed. |
| Optional native CV bridge | Swift/Kotlin only if justified | Apple Vision or ML Kit OCR and image-quality feedback; native adapter tests required. |
| Evaluation | Node.js | Freeze fixtures/labels, compare models, record raw scores, durations, failures and hashes. No model training. |

Do not import Node inference, ONNX native bindings or provider secrets into the mobile bundle. The local service is a preparation backend, not on-device inference. A phone accessing a laptop over Wi-Fi is networked even when no cloud provider is involved.

## Capture and integration contract

Use still photos first: front, back, maker/size/certification label, and an optional concern close-up only when needed. Preserve the original capture locally for review, while sending a bounded derivative. Treat proposed resolution/quality presets as experiments; check label readability before downsampling. Correct orientation and remove location metadata from transmitted derivatives. Inspect actual bytes and decoding limits on the service, not just the supplied MIME string.

Request camera permission only in the capture flow. Handle denial, permanently denied permission, return from settings, background/foreground transitions, device rotation, retake, cancellation during processing, and retry after service loss. Disable unnecessary audio permission for still-photo use.

An asynchronous response must carry the assessment ID and input revision. Apply it only if both still match the active draft. Replacing a photo or changing crash history invalidates old results immediately. A stale inference result must never restore an excluded assessment to an eligible state.

## Verification gates

1. Domain rules: all known crash/protective damage/protective repair cases remain excluded regardless of model scores, provider failures, edits or stale responses.
2. Backend: real image bytes produce schema-validated evidence; corrupted/oversized inputs fail safely; local model unavailability is clearly reported.
3. UI: complete capture/review/disclosure/result flow, recoverable denial/error paths, screen reader labels and text scaling.
4. Android: actual native launch and capture with recorded OS/device/build; lifecycle, back gesture and network interruption.
5. iOS: actual native launch and capture with recorded OS/device/build; permissions/settings, safe areas, keyboard, VoiceOver and app resume.
6. Performance: cold/warm capture-to-result timings and UI responsiveness on target devices, not desktop browser substitutes.
7. Distribution: reproducible pinned install/build and a pre-event installed build; cloud-build availability/account permissions are verified separately.

Expo documents EAS as a hosted build service, and development builds as the path to arbitrary native libraries. That is a feasible route around missing local iOS tooling, not evidence that an account, signing certificate, build credit or device deployment is currently available. [EAS Build](https://docs.expo.dev/build/introduction/), [development builds](https://docs.expo.dev/develop/development-builds/introduction/)

## Reopen this decision when

- The rubric requires continuous on-device detection, segmentation, or entirely disconnected inference.
- A measured device issue cannot be resolved with a narrow Expo native module.
- Actual team skill makes Dart reconstruction materially less risky.
- Expo Go compatibility or signing/distribution constraints cannot be satisfied before the event.
- Competition organizers disallow prepared code and the chosen template cannot be rebuilt transparently within the allowed rules.

No package, native build, performance number or successful physical-device test is claimed by this research document. See the implementation and verification records for executed results.
