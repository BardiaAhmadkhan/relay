# Evolution rounds 03-04

Checkpoint: 2026-10-26. All gear-image inference stayed local. No agents, commits, publication or deployment. Raw successes and failures are retained; 17 protocol/result files are hash-locked in experiments/baselines.lock.json. Run npm run check:experiments before comparing later work.

## Method

Freeze the current baseline and item/source groups. State one weakness and a candidate change before running it. Record damage misses, false concerns, abstentions, task correctness, latency and memory separately. Compare each original case, not only an aggregate score. Reject a candidate that gains speed or specificity by losing an existing detection. Image augmentations are dependent variants, never additional independent items. Keep failed candidates visible.

The present datasets are exposed development examples with visual/source labels, not expert condition ground truth. Three images are user diagnostics. One additional image is source-described crashed gear. Five negative controls include one generated illustration. Four cases are ambiguous and unscored for condition. Public pretraining overlap is unknown.

## Reference vision experiments

| Candidate | Damaged cases with findings | Controls flagged | Median host elapsed | Decision |
|---|---:|---:|---:|---|
| Qwen3.5 4B, evidence first | 4/4 | 3/5 | 3.48 s | Baseline |
| Qwen3.5 9B | 4/4 | 1/5 | 4.83 s | More memory/time; inappropriate crash-like interpretations on ambiguous wear; not selected |
| Gemma4 E2B | 4/4 | 5/5 | 1.01 s | Rejected: ordinary features treated as defects |
| Qwen3.5 4B, bounded verifier | 4/4 | 2/5 | 4.61 s | Retained experimental reference |
| Narrow morphology verifier | 3/4 | 0/5 | Additional verifier probe only | Rejected: misses first user photo |

These are small-run observations, not production sensitivity/specificity. Different candidate prompts can change category and anatomical descriptions. The 9B model had fewer control flags than the selected 4B pipeline; it is not honest to claim it was uniformly less accurate. The retained profile balances its observed errors, mechanism overstatement, memory and runtime. Reports live in benchmarks/round-03 and benchmarks/round-04/morphology-results.json.

Earlier generic Qwen3-VL thinking-tag/output-budget failures and constrained-prompt misses are retained too. Descriptive evidence extraction repaired those diagnostic misses; it did not turn photographs into historical proof.

## Image-quality stress test

| Input change | Known damaged images flagged | Control flags | Misses |
|---|---:|---:|---|
| Original | 4/4 | 2/5 | None |
| JPEG quality 35 | 4/4 | 0/5 | None |
| Brightness 70% | 4/4 | 1/5 | None |
| Longest edge 320 px | 2/4 | 2/5 | First user image; source crash detail |

All 52 responses kept offers blocked. Do not interpret the smaller compressed-image control count as a general improvement or deliberately discard detail to suppress findings. The follow-up source-detail call varied and returned a finding, reinforcing instability at low resolution. Neither model seed nor one successful retry establishes reliability.

Implemented recovery: low-detail empty results prioritize a clearer photograph; a black/overexposed extra view cannot suppress findings in usable views. Unassessed photos are explicitly identified. This is a workflow safeguard, not recovery of lost pixels or a sensitivity improvement.

## Small-model cycles

The original shared encoder plus 18,530-parameter routing head reproduced its logits exactly in cycle 02. It scored 5/6 evaluation images (five item/source groups) and 2/3 user diagnostics. It missed the armour jacket and close-up. The user photographs were never training inputs.

| Change | Strength | Weakness / regression | Decision |
|---|---|---|---|
| Crop augmentation, same MLP | Same 79 KB head | Lost third user original and six previously correct quality variants | Reject |
| Linear head | 1,154 parameters, 9.6 KB | Lost glove view; did not fix original failures | Reject |
| Linear plus crops | Small head | Lost glove and second user original | Reject |
| Int8, tensor scales | 1.12 MB encoder | Broad routing regressions | Reject |
| Int8, channel scales | 1.24 MB encoder | Glove/boot and quality-variant regressions | Reject |
| FP16 storage, unchanged head | 1.89 MB encoder, 49.28% smaller | Existing baseline mistakes remain; native heap did not fall | Retain research artifact |

FP16 preserved all 36 paired predictions. Native emulator encoder-plus-head median was 3.68 ms and p95 7.37 ms, compared with 4.09 / 8.66 ms for the float run. Two CPU threads, three warmups, 30 measured tensor-only runs, no network permission. These are neither complete capture-to-result timings nor physical-phone measurements. Approximate native heap was 42.80 MB versus 42.18 MB; claim storage reduction only. See [specialist architecture and data requirements](../08-architecture/small-specialists.md).

## Algorithms

Multiscale edge/texture proposals cost roughly 30-60 ms on this host. Whole-image plus two-crop CLIP cost about 0.2 seconds but confused normal materials/features with damage. Neither these proposals nor ROI-plus-VLM established a condition-quality gain. They remain research, not damage authority. A visible-area estimate will require a validated garment/defect mask; counting anomaly pixels without that mask would measure background, logos and texture as well as damage.

## Cost and repeated work

No paid vision calls were made. Local execution still consumes hardware, memory and electricity; no energy/cost-per-item claim is established. In a real loopback test, an original photo took 5.16 seconds; changing its ID/history reused pixel evidence in 58 ms with zero model tokens. Adding a black view preserved the known finding in 74 ms without re-inference. This is one warm-host measurement, not a business-network percentile. See benchmarks/round-04/service-recovery.json.

## Product and reliability retained

Photo-first entry; reachable camera/import/review controls; restrained graphite/warm-white design; source-photo findings; separate rider history; saved briefs with photos; reversible photo removal. Browser image preparation uses one bounded decode and encoding pass. Cache identity includes model/prompt; clearing invalidates late writes. Client checks assessment/photo/view/model identity and recomputes policy.

Native testing found and repaired two browser-invisible defects: permission-dialog backgrounding closed the camera, and React Native AbortSignal lacked throwIfAborted. Captures survive restart, saved-photo references survive cleanup, old policy results refresh without deleting evidence, and partial unusable photo sets retain usable findings. Final runtime evidence and exact checks are in [verification](verification.md).

## Next constraint

Better labels and actual devices now matter more than additional prompt variants. The shared representation and task contracts are implemented/proposed separately; trained damage, logo and extent heads do not yet exist. Collect expert-labelled material/defect masks and hard negatives with garment-separated splits, then test the next specialist on a fresh locked set and real phones. Do not activate the current routing head or describe the app as production-ready.
