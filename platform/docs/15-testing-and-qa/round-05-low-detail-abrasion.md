# Round 05 - low-resolution abrasion only

Date: 2026-10-26 UTC. The live model weights, product UI, core policy and photograph preparation were held fixed. This round targets one failure: an abrasion cue visible in a small photo was missed by the original inspection. All inference remained local; no agents, training, cloud calls, commits or publication.

## Retained change

The pinned Qwen3.5 4B profile can make one short abrasion-only call after an empty result, only for a 96px-minimum / under-480px-longest-edge photograph with aspect ratio at most four. A linear enlargement gives the vision encoder a bounded pixel budget; it does not restore missing physical detail. The extra call has a 2.5-second transport deadline and keeps the original result on failure or abstention.

Existing findings return unchanged. Category, material, history and source-image identity are preserved. Any recovered cue is marked possible, with an unknown anatomical location and an unclear mechanism. It never becomes a crash-history claim. Explicit label views skip the extra task. The model fingerprint now ends in +low-detail-cue-1, and the photo cache distinguishes label and garment tasks while retaining reuse across front/back/detail views.

Changed runtime files: packages/vision/inspection.ts plus the new packages/vision/abrasion-cue.ts. Hash comparison against the prior verification record confirmed no existing app, core-policy, schema, preprocessing or other runtime source changed.

## Harder cases and labels

106 variants from 18 source photographs / 15 source groups: originals, JPEG35, dimming, 320px, 240px with compression, 320px JPEG18, and combined 320px/dimming. Five new public-source photos added three new source groups; the two worn-detail views share a previous garment. Labels were frozen before inference. See [fixture attribution](../../assets/fixtures/round-05/ATTRIBUTION.md).

There are 28 known-damaged source variants, 41 visually negative variants and 37 ambiguous variants. These are dependent observations, not 106 independent garments. Negative means no localized physical defect apparent in the pre-inference visual review, not verified undamaged or safe. The baseline flagged 15 negative variants; this round does not claim to repair those preexisting false concerns.

## Candidate decisions

| Candidate | Strength | Weakness / decision |
|---|---|---|
| Enlarge the entire low-resolution inspection | Recovered the first missed abrasion in the probe | Also changed the label-only image's item category; rejected as a change outside the target task |
| Enlarge only verification of existing abrasion candidates | Preserved all prior findings | Zero recoveries: on hard inputs the primary stage described logos instead of proposing abrasion |
| One short abrasion task, 1024-token rendering | Recovered the target; no new labelled-negative flags | Selected only after fresh repeat evidence; details below |
| Same task, 256-token rendering | Recovered all three missed variants in the fixed set | Added three false flags on denim/helmet variants; rejected |
| Small task plus high-resolution verifier | Removed those new false flags | Only one fixed-set recovery, more work and three budget expiries; rejected |
| High-resolution task plus bounded exposure normalization | Preserved existing findings | No extra known-damage repair and another unscored ambiguity flag; rejected |

The selected task recovered one known-damaged variant in the original 106-case comparison. It was not accepted on that result alone. In 36 fresh end-to-end repeat cases, both previously missed 320px images (the first user photo and source-described crash detail) were missed by the baseline and recovered by the candidate in all three repetitions each. That supplies the required second damaged variant and repeat stability. The source-detail baseline varied between runs; do not hide that variation behind a single accuracy percentage.

All 65 nonempty baseline observations in the hard set were retained exactly, and no additional flags appeared on its 41 labelled-negative variants. The repeat run also had zero paired regressions. One ambiguous worn-detail variant gained a possible cue; this is not scored as a verified defect. The production mapping deliberately discards the cue model's anatomical guess because precise localization was not validated.

## Speed and recovery

The extra task ran on 26/106 variants. Median added time was 0.92 seconds; p95 1.37 seconds. Successful baseline findings and sufficiently large photos made no additional model call. These are local host/GPU timings, not physical-phone measurements.

A real cache test inspected the same pixels first as a label, then as a garment: the garment recovered a cue instead of inheriting the label's empty result. Subsequent back/label lookups took 13/14 ms with zero model tokens and correct new photo IDs. Raw evidence bytes/hashes were preserved. No additional model weights or paid calls were introduced.

## Verification

- 392/392 unit/integration tests passed, including timeout, cancellation, malformed response, unsupported claim, profile pinning, unchanged successes, cache clearing and label/garment cache separation.
- The original three real-photo browser flows passed. Four harder upload flows passed. A fifth, explicitly seeded restored-draft flow used real local inference and rendered the new possible cue with no asserted body location or crash mechanism. The upload flows for the two damaged photos already produced primary findings after browser JPEG preparation; the restored-draft case specifically exercised the optional positive recovery.
- A shiny-jacket browser control retained an existing primary-model concern. Its recovery stage did not run; this is a known baseline false concern, not a clean-condition success claim.
- Strict type checking passed. Original frozen experiment files, all 106 case hashes and six baseline snapshots remained intact.
- No app UI or mobile bundle changed, so no new Android/iOS build is claimed. The prior installed app uses the updated local API profile.

Raw evidence: summary, paired hard cases, fresh repeats, [cache scopes](../../benchmarks/round-05/cache-scope-live.json), and [restored-photo app result](../../benchmarks/round-05/restored-cue-ui.json).

## Limits and next boundary

Very small/dark images still require a better photograph. Ordinary-wear false alarms, exact item identity and precise localization remain outside this round. No finite test set proves universal absence of regressions; the preserved strengths and zero added labelled-control flags are bounded to this evidence. Representative expert-labelled gear and real-phone measurements remain necessary for business deployment.

Research basis: [Qwen processor pixel budgets](https://github.com/QwenLM/Qwen3-VL), [the Ollama runtime discussion](https://github.com/ollama/ollama/issues/17218), and [QwenVL preprocessing discussion](https://github.com/ggml-org/llama.cpp/issues/16842) motivated the hypothesis. The runtime issue report is not treated as proof of an identical local bug. Our probe measured extraction prompt tokens rising from 480 to 1436 under enlargement, with the same model and task prompt.

## Local activation and reproduction

The selected profile is enabled on the normal 127.0.0.1:8787 endpoint. The final smoke test recovered the small-photo cue, preserved the original photo hash, and reused it under a new garment-view ID in about 20 ms with zero model tokens. The [activation record](../../benchmarks/round-05/verification.json) binds the source hashes and runtime identity. The UI remains available at http://localhost:4173. No publication or new mobile binary was made.

Run the original baseline integrity check with npm run check:experiments. Check this round with node scripts/check-experiment-baselines.mjs experiments/round-05/evidence.lock.json. These files intentionally preserve failures and refuse silent replacement. Experimental scripts require the local-only user fixtures; missing source photos must not be substituted with invented results.
