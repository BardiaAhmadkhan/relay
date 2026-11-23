# Relay V3.5

**Activation addendum, 19 November 2026 (Pacific).** The owner subsequently enabled the optional OpenAI count check on the working V3.5 laptop release. The default-off description below records the original sealed build. The dated addendum records the active config, new guards, verification, production decision and physical-device gaps. [Activation evidence](v35-activation-results.md) · [Event runbook](../../docs/relay-v35-event.md)

V3.5 fixes a case in which Relay could issue a visible-damage exclusion, then recommend an offer on the same intake after the rider replaced the photograph. A verified earlier exclusion now follows the item. An earlier *possible* concern travels to the notebook and inspection brief while the current photographs still determine the outcome. Fresh intakes use normal photographs and require no rider tap.

**Release scope.** The default engine uses the original calibrated `qwen3.5:4b` checkpoint. Its weights, visual projector, battery, thresholds and ordinary V3.1 policy ordering are preserved. The public wire format remains version 2.0. The health response identifies the engine as 3.5. The API-client mobile release is 3.5.0, Android version code 3 and iOS build 3. The separate historical offline profile keeps its earlier version. This is a local pre-event release.

Android APK · Android and iOS JavaScript bundles and assets · Package manifest · Collaboration and approvals

## What changed on the actual 4B

| Workflow on the same recorded history | V3.1 | V3.5 default |
| --- | --- | --- |
| Display a visible no-offer, reopen the intake and replace the flagged front | Offer | **No offer**. The earlier signed exclusion and original photograph remain available. |
| Replace a front that triggered only a possible road-contact concern | Offer | **Offer**. The earlier photograph, possible cue and replacement relation are retained. |
| Keep the possible-cue overview and add the requested detail in the controlled mobile test | Specialist review | The same ordinary review rules apply. |
| Submit ordinary inputs without a historic mark or displaced exclusion | Original decision | The full decision matched in **7,148 of 7,148 replay contexts**, including grade, reasons, next action and requested photograph. |
| Restore a tap-era draft that contained a marked concern | A mark could require review | The mark is read-only. An otherwise eligible item goes to review. Unreconciled geometry is explicitly identified. |
| Lose verification of a formerly issued exclusion | The old evidence could disappear | An otherwise eligible item goes to review. A missing prior finding leaves the ordinary decision in force. |

The live witness passed real source JPEGs through the normal image processing, stock model, signing and HTTP assessment on both engines. The two clean views show the same displayed pair of gloves. The earlier front and readable label were deliberate comparison fixtures from other items. The experiment establishes what the software does with the evidence. It cannot estimate the incidence of such replacements in a shop. The three separate V3.1 phone journeys use controlled scores to establish the original navigation, persistence and outcomes. Real paired 4B witness · Original phone journeys · Ordinary decision replay

### How the system preserves a finding

1. The service authenticates the active score records and runs the ordinary decision. It signs an exclusion finding only when that decision actually issued a visible road-contact or protective-area no-offer for the identified front or back photo. A high answer alone cannot establish a prior exclusion. An outside-protective-zone finding stays observational.
2. The finding identifies the assessment, photo ID, normalized photo digest, view, policy and threshold versions, and relevant reason codes. Its HMAC uses a separate message prefix from photo scores. When an older draft lacks a finding receipt, the service can replay the earlier assessment from its complete authenticated score set.
3. Replacing or removing an overview transfers relevant evidence to the persisted draft before cleanup retires its file. Active coverage uses only the current images. A pending score attaches to its original photo ID. Undo restores that source. A missing or foreign receipt is identified separately.
4. On the next assessment the service verifies the archived source and the earlier disposition. A confirmed exclusion preserves no-offer. A known exclusion that cannot be reconciled caps an otherwise eligible result at review. A possible cue leaves the current decision intact. A possible-cue replacement that reaches an offer gets one transition per original/replacement ID pair, including after retry.
5. The existing notebook retains the earlier photograph and identifies the superseded view. The shared text brief tells the specialist which possible cue to check in hand. Sharing text does not transmit the archived image. A genuine reported crash, protective damage or protective repair continues to block an offer.

The result has three practical limits. **A stateless API cannot recover evidence a modified client omits. A device that has lost the original record cannot carry its verified exclusion. An erroneous earlier block can now keep an honest replacement from getting an automatic offer.** The shop must reconcile that last case in person. Stored history and image evidence never certify protective performance or establish an unseen crash history. Policy and receipt implementation · Mobile draft and file ownership · [Service acceptance tests](../../tests/v2-api.test.ts) · [Mobile journeys](../../tests/mobile-v2.spec.ts)

## Timing and resource use

Sixteen matched intake pairs used eight three-photo workloads, two passes in opposite fixture order, and both arm orders for each fixture. The same warmed stock runtime served one request at a time. Each intake got a fresh API cache. The runner logged model forwards, prompt and image hashes, full-precision answers, the final decision, and sampled GPU temperature and clock. The timing starts after the phone-equivalent JPEGs exist and includes the three score requests and final assessment.

| Local stock 4B measure | V3.1 | V3.5 default |
| --- | ---: | ---: |
| Photo median | 2.299 s | 2.273 s |
| Photo p95 | 2.742 s | 2.721 s |
| Three-photo assessment median | 7.136 s | 7.319 s |
| Three-photo assessment p95 | 8.321 s | 8.431 s |
| Model calls per assessment, median / p95 | 17 / 18 | 17 / 18 |
| Model input tokens per assessment, median / p95 | 9,555 / 10,131 | 9,555 / 10,131 |

All 16 pairs had identical model inputs, scores and decisions. The paired median assessment was 72 ms slower with V3.5. The 10th to 90th percentile spanned 1.873 s slower to 0.713 s faster. The observed median and p95 shifts all fell inside repeatability limits calculated from separate V3.1 repeats before the comparison. The peak across both arms was 80 °C and 4,052 MiB GPU memory. Minimum free system RAM was 6,702 MiB. These measurements support the reliability improvement at comparable runtime. They do not establish a speed gain. Pre-registered timing interpretation · Per-pair results · Per-photo inputs, timings and clocks

## Optional count check

**Off by default.** The stock engine remains sufficient to run a full intake. A deployment with appropriate accepted processing terms can enable a separate count check with the independently tested `gpt-6.2-sol` request. The photo is re-sent only after the completed local decision identifies a binding count problem.

| Gate | Required condition |
| --- | --- |
| Decision | Retake with exactly one reason, `multiple_items`, on the front or back that is being requested. |
| Evidence and history | All three disclosures are negative. Every current photo has its matching score. Digests are unique and photos pass the quality gates. Historic concerns and retained exclusions forbid routing. |
| Local model | A calibrated local score on the current battery, category head boots or gloves, with `single_item < 0.5`. |
| Client and image | The capable client has received the terms notice. The server independently rechecks the gate and reconstructs the calibrated working JPEG at 1600 px. Its SHA-256 and quality must match the intended photograph. |
| Answer | The server accepts only the strictly validated discrete result `one` or `matched_pair`. It uses the result for that count condition only, then reruns the ordinary rules. The original signed 4B probability stays intact. |

The optional request uses the exact evaluated system text, question and JSON schema, pinned by SHA-256 `a8ecf2cf54b5e42a49b3225761248227b1a98f3e972391f4763b8569d3291cc4`. It requests high image detail, medium reasoning and at most 1,024 output tokens. There are no automatic retries. The server shares an eight-second deadline across image handling and adjudication. The phone keeps the original decision and allows a bounded transit margin. Unavailable service, budget exhaustion, cancellation, low-quality or changed pixels, refusal, malformed output, a several/unsure answer and timeouts cannot produce an upgraded result. The provider request sets `store: false`. [Pinned protocol](../../server/count-protocol.json) · [Binding-gate code](../../packages/core/v2/count-review.ts) · [Timeout and image verification](../../server/count-assessment.ts)

On success, the server can issue a provider-neutral signed count receipt bound to the assessment ID, photo ID, digest, verdict and prompt version. The client can retain it in the draft or saved notebook. The specialist submission accepts it only after the same ordinary and safety gates pass again. The console does not send a photo to the auxiliary service. A changed, foreign, malformed or obsolete receipt gives the ordinary outcome. Older clients use the local engine. [Receipt verification](../../server/count-receipt.ts) · [Specialist submission](../../server/review-v2.ts) · [Failure, expiry and tamper tests](../../tests/v35-count.test.ts)

**Measured benefit.** E19 routed 10 of 363 historically held-out photos, about 2.8%. Opus reported 10 correct counts on those 10. In the integrated replay two single-photo decisions moved from retake to offer, five changed from an unnecessary one-item retake to a targeted close-up, and three stayed one-item retakes. All ten working-image digests and expected decisions matched. The recorded provider time was about 2.4 s median and 4.4 s p95. Across the broader count-labelled test, the model would have passed three several-item photos outside the route. **Keep this gate narrow. Any wider use needs a new pre-registered assessment.** Ten selected cases do not establish a field error rate or a real-world garment offer rate. Exact integrated results · All 68 ordinary counterfactuals · Model comparison and decision

### Running the service and setting the optional budget

The existing service commands run in the independent Relay repository. Use two terminals and the existing server-side signing key. The key must contain at least 32 characters. Reusing the same key across restarts keeps previous receipts verifiable. The mobile APK and bundles do not contain model weights or API credentials.

```powershell
npm.cmd run vision:serve
```

```powershell
npm.cmd run dev:api:v2
```

Once the API is listening, a separate shell can run `Invoke-RestMethod http://127.0.0.1:8788/v2/health`. The default service uses loopback and the project's pinned model store. The phone's Connection and privacy settings accept the address of the authorized Relay service. No hosted service was deployed as part of this release.

| Optional setting | Effect |
| --- | --- |
| `RELAY_R2_ENABLED=1` | Requests the optional count feature. Unset or zero is the release default. |
| `RELAY_R2_TERMS_COVERED=1` | Operator assertion for a platform where applicable processing terms were accepted. The pre-event lab adds no terms screen. |
| `RELAY_ALLOW_PAID=1`, `OPENAI_API_KEY` | Explicitly permits a paid call from the server. Credentials belong only in the server environment. |
| `RELAY_R2_DAILY_CALLS` | Hard UTC-day cap on issued attempts. The default is zero. |
| `RELAY_R2_DAILY_USD` and `RELAY_R2_RESERVE_USD` | Optional paired reservation limits. Each attempted call reserves the full configured amount locally. |
| `RELAY_R2_LEDGER` | Durable SQLite file on shared local storage for workers enforcing the same allowance. The default is `data/count-allowance.sqlite`. |

An example operator allowance is 300 attempts per UTC day, a USD 0.02 reservation and a USD 6 daily reservation limit. These are examples, not defaults or a quote for provider billing. An atomic reservation is made before sending the photo. Worker races, restarts and timeouts cannot reset a spent slot. The result cache is eligible for ten minutes. The service clears photo digests and count labels after that window, sweeps on startup and access, and schedules expiry while running. Day, keyed ticket, model, protocol, reservation, status, request ID and elapsed time remain for metering. An eleven-minute test verifies the missing digest and label alongside the intact paid slot. Billing also depends on the operator's price agreement and provider-account limits. [Metering implementation](../../server/count-reader.ts)

## Evidence and rejected alternatives

| Question | Result and decision |
| --- | --- |
| Are the underlying labels reliable enough to clear wear? | Two independent visual reviews of 72 photos agreed on structural damage in 57, abrasion in 48, repair in 66, ordinary wear in 51 and item count in 71. The reviewers recorded prior exposure. Human shop expertise remains necessary on disputed cases. Agreed retrospective corrections are append-only. Rating sheets · Audit |
| Will a new local count prompt help everyone? | On the stock 4B, confirmed pairs passing rose from 8/15 to 14/15. Six of 25 known several-item photos newly passed, five of 70 singles newly failed, and scene passes rose from 1/213 to 20/213. The 2B moved in the opposite direction. The release keeps the original local prompt and cutoff. 4B flips · Framing splits |
| Can native recurrent checkpoints remove repeated image work? | In the 128-request 2B screen, same-image changes saved −2.04 ms in one order and +3.31 ms in the reverse order. The installed renderer placed the image before both questions. Identical requests reused 371/375 or 382/386 tokens, while changing just the question reused zero. The stored recurrent snapshot was beyond the common prefix. The checkpoint settings were excluded. Measured replies and native trace · [Ollama 0.40.16 renderer](https://github.com/ollama/ollama/blob/v0.40.16/model/renderers/qwen35.go) |
| Can image preparation be cheaper without altering model input? | All 54 bundled photos plus nine edge cases matched in the CPU prototype. Forty-six of 48 crossed preparations were faster. The median paired saving was 8.17 ms. On real 4B intakes only eight of 16 pairs finished faster. Opus parked the prototype. CPU observations · 4B comparison |
| Should a second reader clear suspected abrasion or change category? | The team kept both out of the product. The evidence did not support clearing subtle damage from a photo. Category changes can alter the protective zones used by the policy. A scuffed sacrificial slider receives the original V3.1 treatment. Decision record |

The restorable source baseline includes 284 authored files. The E19 ledger contains 385 rows, 363 historically held-out. The calibration set contains 223 unambiguous photo labels and lacks the complete question battery for commercial decisions. The localisation study contains 140 images, with full-precision ordinary views available for 44. Some photos, physical items and photographers recur across records. The controlled replay contexts, repeated timing rows and previously discussed cases do not count as independent test garments. Original baseline and scope for each dataset

## Build, verification and reproduction

- **Software.** Both TypeScript projects passed. The final combined suite passed **628 assertions** and **18 phone-sized browser journeys**. The tests exercise malicious or stale inputs defensively, incomplete answers, duplicate views, late scores, key rotation, cancellation, replacement, undo, no-upload failure paths, signed count reuse and immutable spending reservations. Final test records
- **Android.** The release APK is 49,715,157 bytes with SHA-256 `a3674b465f96d0a61432b422896a76b68010fb9a877e090ac6938dd3cdb914f6`. It supports arm64-v8a and x86_64 and verifies under the same certificate as the V3.1 lab build. A fresh Android 36 x86_64 emulator installed that exact APK, imported a real photo through the system picker, contained no rider-mark controls, and correctly closed the offer process for a reported crash with networking disabled. Native evidence and screenshots
- **iOS.** The API-profile iOS Hermes bundle compiled with the same sources as Android. This Windows verification produced no signed IPA, physical-iPhone result or App Store release. Platform bundle checksums
- **Source and recovery.** The V3.5 release source archive SHA-256 is `977052ed848321a5772636aa0793f79839055e3fc7b73aaedc7d71d7c1f181c7`. The point-in-time diff and hash manifest include all 29 changes from the restored V3.1 sources. The original APK remains at its existing path, SHA-256 `80df6756fd6ed60ac164468f4e5dc308723970e9cc703e314c405dab3e3e11d0`. A prior Git commit alone does not reconstruct the working-tree baseline. Final change list · Original V3.1 APK

To rerun the CPU decision suite from Relay's project root, choose a new output directory. The replay uses the archived score data and compares the full ordinary decision against each original ledger entry.

```powershell
node --import tsx research/analysis/astra_policy_cases.mjs .cache/v35-my-policy-replay . collab/baseline/v31-as-restored/policy
```

For paired 4B reproduction, extract the original V3.1 source archive into a new directory under this project's `.cache`. The comparison verifies both manifests before starting the GPU. The `replacement` mode checks the visible-exclusion and possible-cue paths. The `timing` mode runs the counterbalanced intake benchmark. The existing local model store and installed project dependencies are required. The runner uses the single-lane temperature, memory and game guards.

```powershell
Expand-Archive -LiteralPath collab/baseline/v31-as-restored/source-snapshot.zip -DestinationPath .cache/v31-reproduction
node research/analysis/astra_release_replay.mjs replacement .cache/v31-reproduction . .cache/v35-my-4b-witness
node research/analysis/astra_release_replay.mjs timing .cache/v31-reproduction . .cache/v35-my-timing
```

The guarded runners require the original local model, CUDA runtime and licensed fixture files. The optional integration replay substitutes the already-recorded count answers, independently hashes the JPEGs, and makes zero external calls. [Integration replay](../analysis/astra_integrated_r2.mjs) · Eligibility decisions

## Post-promotion readback

The working tree matched all 293 hashes in the final source manifest. A further 16 paired three-photo intakes compared that promoted tree with the preserved V3.1 tree. All model inputs, scores and ordinary decisions matched again. Whole-intake median wall time went from 7.045 to 7.839 seconds. The p95 went from 8.201 to 8.386 seconds. V3.5 was slower in 12 of the 16 pairs. The median paired increase was 326 ms, and the median paired increase in recorded cooling waits was 312 ms. With those waits removed, the two intake medians were 6.254 and 6.272 seconds. All four observed photo and intake changes were within the pre-registered V3.1 repeatability scales. The unadjusted times remain the primary timings.

The promoted service again preserved the exclusion after replacement and allowed the companion possible-cue case to reach its ordinary offer. The local release left the Git index and commit intact. Post-promotion readback · Measured timing components · Exact stock 4B responses · Research launcher corrections
