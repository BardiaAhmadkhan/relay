# Relay quality repair cycle 02

This round retains narrow changes that improved the paired evidence and rejects changes that discarded real damage. It does **not** resolve every recognition mistake. The selected service still makes too many false alerts and incorrect descriptions for a claim of reliable unattended business use.

The [image comparison](../../datasets/quality-cycle-02/review.html), [CSV](../../datasets/quality-cycle-02/comparison.csv) and [case ledger](../../experiments/quality-cycle-02/failure-ledger-reviewed.json) expose both improvements and remaining errors. Serve the comparison locally with `node scripts/quality-cycle-02-serve.mjs` at http://127.0.0.1:4186.

## Current paired results

All 194 original audit photographs were sent through actual HTTP, once each, without retries. The original adapter was then run against exactly matching captured model responses. This isolates the code change from model-output variation. The final program was subsequently executed through the same Fastify routes using those recorded responses; only the one new corrective review used additional live inference.

| Measure                                                            | Original control |             Selected code |
| ------------------------------------------------------------------ | ---------------: | ------------------------: |
| Actual reference defects described, out of 75 positive photographs |               61 |                        63 |
| Partial or wrong descriptions of the reference defect              |               10 |                        10 |
| Reference defects missed                                           |                3 |                         2 |
| Processing failures on a positive photograph                       |                1 | 0 in final-program replay |
| False alerts, out of 85 negative photographs                       |               45 |                        41 |
| Previously matched defects lost in this paired comparison          |                - |                         0 |
| New alerts on previously clear negative controls                   |                - |                         0 |

**53 visual failures remain** among the 160 scored photographs: 41 false alerts, 10 partial descriptions and two misses. The other 34 images are ambiguous or unassessable. Matching one real defect does not establish that every additional claim, exact kind, anatomy or severity is correct. The review records these separate errors rather than treating any nonempty alert as correct recognition.

The 194-image live run completed 193 first requests, with **zero socket disconnects** and one invalid verifier reference. The final-program replay completed all 194 routes, preserving the 193 successful visual outputs exactly; the one corrective model call took 1.88 seconds. This is not a claim of 194 fresh live inferences succeeding on the final build. Successful live requests had median 4.28 seconds, p95 7.47 seconds, maximum 10.76 seconds on this laptop. Replay time is not an inference-speed measurement.

The pre-cache-final build passed 17 fresh live HTTP regression contracts, including the three supplied damaged jackets, two low-detail damage controls, ordinary graphics, one optional focus per multi-photo assessment and a deferred photo subsequently inspected alone. The `fabric-069` and low-resolution black-jacket contracts deliberately retain their known visual failures; completion or an expected alert is not correctness. No test response recommended an offer or certified protection.

## Changes kept

1. **HTTP processing lifetime.** The server used a ten-second idle connection timeout while inference could legitimately take longer. The assessment handler now gives its socket the configured analysis deadline plus five seconds, while retaining the separate intake timeout and bounded abort. Real HTTP tests cover an eleven-second result, coalescing/cache, a busy response and the processing-deadline error. [Fastify documents the distinction between connection and request timeouts](https://fastify.dev/docs/latest/Reference/Server/); [Node documents socket timeout handling](https://nodejs.org/api/http.html#responsesettimeoutmsecs-callback).
2. **Evidence-to-alert consistency.** A closed, conservative vocabulary removes wholly negated defect statements, clear cosmetic-only descriptions and descriptions that merely name a normal graphic or zipper. Mixed claims, unfamiliar terms and all possible cosmetic observations remain. This is a consistency check on the model's words, not an algorithm that independently understands physical condition.
3. **Bounded detail inspection.** Empty trouser/multiple-item views and unresolved linear details can receive one targeted crop from the original pixels. The verifier sees the full photograph and crop together. Only a clear, explicitly described tear is accepted, then capped at possible with unknown body area and no inferred crash history. One optional focus is allowed per assessment, with a 6.5-second budget. Existing physical evidence is not reinterpreted. Ordinary full-resolution jacket paths retain their previous call count.
4. **Review-reference repair.** A schema-valid verifier response could refer to candidate 1 when only candidate 0 existed. One corrective call uses fixed per-candidate verdict slots, with a 2.5-second budget. There is no silent index remapping or acceptance of unverified evidence. Valid reviews retain their existing requests. Corrective crop reviews retain full-photo context.
5. **Cache correctness.** A photo whose focus stage is deferred by a multi-photo budget is not cached as completed. Such a deferred photo also no longer evicts an unrelated completed entry. Failed optional stages are marked incomplete internally, so neither the image cache nor the HTTP result cache suppresses a later retry. Public observation fields are unchanged. Crop-verification caches cannot cross full-photo contexts.

Selected profile: `qwen3.5:4b@d8b0f5e9760c/photo-evidence-2+low-detail-cue-1+evidence-claims-4+review-index-1+focused-tear-context-3`. The primary inspection prompt, ordinary verification prompt, image preprocessing, model weights, safety/history policy and app UI remain the prior versions. All inference is local; no paid provider call or private-image upload occurred. The active 4B model is still computer-based. No phone-native performance claim is made.

## Experiments rejected and why

| Experiment                           | Strength observed                              | Reason not selected                                                                                               |
| ------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Additional structural reviewer       | Removed 19 false alerts in the examined subset | Lost four previously matched true defects; rejected before full completion                                        |
| Independent blind review             | Alternative descriptions of suspicious details | Incorrect defect vocabulary; reasoning mode took 10-35 seconds and truncated a response                           |
| Text-only assertion classifier       | Removed 16 false alerts                        | Discarded a correctly identified scraped boot and other real cues                                                 |
| Neutral item/material primary prompt | Promising pilot on raw material images         | Re-described a true scraped toe slider as paint/sticker/repair; full candidate stopped                            |
| Crop without whole-photo context     | Recovered small tears                          | Turned a printed emblem into a false tear                                                                         |
| Aggressive cosmetic filtering        | Removed nine historical false alerts           | Erased a real puncture described uncertainly as a stain; uncertainty preservation restored                        |
| Focus for all empty wearable views   | Broader coverage                               | Added a call to the existing full-size jacket fast path; scope narrowed rather than weakening its regression test |

Failed harness/schema prototypes and their invalid-run notes remain separate from valid experiments. JSON-schema tuple output was rejected by the runtime; another early replay supplied an unsupported imageId field. Neither is evidence of model quality. The first fixed-slot test filename was produced after a failed source-edit anchor and actually exercised the older array prototype; only `fixed-slot-review-tests-v2.json` and subsequent selected tests validate fixed slots.

## Additional images and independence

The authorized 64 images were downloaded, attributed, visually labelled and organized: 19 Commons photographs and 45 raw-fabric images. All 64 encoded image hashes are distinct and verified. Five Commons photographs are previously evaluated source controls; 59 are new source photographs. Each source has author, licence URL, source URL, transformation and grouping records in [labels](../../datasets/quality-cycle-02/labels.json) and the [final five labels](../../datasets/quality-cycle-02/final-holdout-labels.json).

The first 59 images informed the conservative uncertainty guard and are therefore **development validation**, not untouched final tests. The last five were frozen before inference and were not used to tune visual rules. Subsequent exception-only review repair, cache correctness and narrower eligibility preserve their outputs. Many fabric photographs share the earlier publisher and capture population; they do not establish independent field generalization. References are assistant visual annotations, not specialist inspection or crash-history ground truth.

| Additional validation | Reference defects matched |      False alerts |           Partial / missed defects |
| --------------------- | ------------------------: | ----------------: | ---------------------------------: |
| First 59 images       |        28 / 33, unchanged | 8 / 23, unchanged |                4 partial, 1 missed |
| Final five            |          0 / 2, unchanged |  1 / 2, unchanged | Both positive defects misdescribed |
| Combined 64           |        28 / 35, unchanged | 9 / 25, unchanged |                6 partial, 1 missed |

These images expose **16 remaining visual failures**; they are not presented as evidence of improved out-of-sample accuracy. Fabric imagery is from [Osamah N. Neamah's Fabric Defects Object Detection Dataset](https://doi.org/10.6084/m9.figshare.25546465.v2), CC BY 4.0. Individual Commons licences and attribution remain attached to each photograph. No user-provided photograph is part of the distributable review corpus.

## Regression evidence and limits

- 480 unit tests pass, including real socket deadlines, source validation, cancellation, fixed-slot correction, full-context verification, the prior jacket call-count contract and deferred-photo cache behavior. TypeScript passes.
- Final normalization replay covers the frozen 194-image audit, 106 hard variants, 36 repeats and three original-image checks. All positive evidence is preserved. Six rows change; one unassessable row has no visual output.
- Latest eligibility/normalization replay preserves every scored output across 364 recorded experiment rows (363 with visual outputs). Three historical true recoveries remain eligible. One optional finding on ambiguous patched denim is removed by the narrower scope and is not scored as an accuracy gain.
- The historical isolated comparison was 63 to 66 matched defects and 45 to 41 false alerts. The fresh current comparison is 61 to 63 and 45 to 41. They must not be merged or selectively substituted. Current original-model descriptions differ from historical outputs; nine separately paired repeat trials had identical primary request hashes and primary replies between control and candidate. A particular runtime cause for historical variation is not established.
- `commons-087` is an explicit reliability limit: its crop found both rips, but the optional deadline interrupted contextual verification in the 194-image run. A later live check succeeded. The failed first attempt remains a miss in the headline result.
- Three disputed original negative references, `commons-024`, `commons-038` and `commons-061`, remain unchanged. Excluding them gives false-alert sensitivity of 42 to 38 out of 82; the headline includes all 85.
- No new training, benchmark relabelling, external upload, publication or phone-native integration was performed. No universal zero-regression or production-readiness claim is supported.

## Final cache and activation verification

A late regression reproduced a fallback being cached after an optional runtime failure. Fixing the image cache alone was insufficient: the HTTP cache still returned the incomplete assessment. Two failing route tests caught this and now pass. The final `focused-tear-context-3` profile propagates internal completion metadata before response-schema cloning; incomplete results neither enter the cache nor evict completed entries. The retry is user-triggered, not an automatic extra inference loop. A full final-program replay preserves all 194 visual outputs and completes all routes with recorded responses only. Earlier successful trials and failed intermediate implementations remain recorded separately.

The source-photo flow was exercised in a 390-pixel browser: torn denim returned a possible tear with its source image; the printed-graphic control returned zero findings; both retained unknown crash history and no offer/certification. Neither result had horizontal overflow. The local comparison filters show 53 audit failures, six improved visual results and 16 additional-validation failures; the source-image dialog was checked at phone width. The browser initially logged a missing preview favicon, and one automation label selector timed out; the corrected selector check passes. No app UI redesign is part of this repair cycle.

The final normal API then completed **17/17 live contracts** on the cache-fixed profile, with no retries. The three-photo request completed in 10.54 seconds on its first attempt, also exercising the repaired socket lifetime. The final activation results and [verification record](../../benchmarks/quality-cycle-02/final-verification.json) distinguish these runtime checks from recognition accuracy.

## Remaining root causes

The transport and reference-addressing defects have concrete reproductions and repairs. Remaining recognition errors cluster around texture/graphic confusion, tiny breaks reduced to spots, invented garment anatomy on raw material, wrong damage kinds and failure to select a small relevant garment in a scene. The experiments show why simply adding another reviewer or deleting weak-sounding claims is insufficient: those approaches also remove real defects. The complete case ledger remains open where these mechanisms are unresolved. Further training would require independently reviewed, grouped defect/localization examples and a separate untouched evaluation; no small specialist is represented as trained or validated by this round.

The original baseline locks, round-05 evidence/activation locks and original quality-audit labels/evidence locks are checked without modification. New artifacts, exact selected source snapshots, validation results and image hashes are sealed separately at the end of this cycle. The [selected summary](../../benchmarks/quality-cycle-02/selected-summary.json), [actual HTTP results](../../benchmarks/quality-cycle-02/current-http-audit.jsonl), [final-program replay](../../benchmarks/quality-cycle-02/cache-fixed-program-replay.jsonl), live smoke, [current correspondence review](../../benchmarks/quality-cycle-02/current-correspondence-review.json) and unit results provide the underlying evidence.

One missing intermediate-source snapshot was reconstructed from the known one-line change and verified byte-for-byte against the hash recorded before that intermediate run. The [provenance resolution](../../benchmarks/quality-cycle-02/provenance-resolution.json) identifies it explicitly; it was a failed cache prototype, not the selected implementation.
