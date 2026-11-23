# Round 02 vision protocol — registered before inference

Baseline: e3a6f5876d1c6c7341d4fae7d460ca632af8923c. This file registers the design before model evaluation. The later freeze.json will bind exact source/derivative manifests, labels, grouping, prompt/model settings, run schedule and runner hashes before inference. This is a local preregistration, not an independently timestamped public registry.

## Scope and separation

Use only the existing pinned CLIP/SigLIP q8 models and existing two prompt templates/category labels. No training, paid APIs, prompt tuning, production code edits or modification of historical fixtures/results. Eight historical images are a diagnostic set with known prior outcomes. Newly downloaded licensed source photos are new to this project; public pretraining overlap is unknown, so they are not guaranteed model-unseen holdout data.

Acquire at most sixteen new photos, prioritizing previously missing helmet/trouser overviews, distinct gloves/boots, casual-clothing/non-gear negatives, and real labels/details. Source pages/licences and visual content must be reviewed before labels are frozen. Exclude only unavailable/unlicensed/undecodable sources or images whose reference category cannot be resolved; record exclusions. Alternate views/crops of the same item stay in one group. Ambiguous category references are retained as unscored challenge controls.

## Hypotheses fixed before evaluation

H1: A 480px-long-edge JPEG at quality70 can substantially reduce bytes relative to960px/quality88 without adding wrong accepted categories on the new item groups. Candidate acceptance requires at least50% median byte reduction and no added group-level wrong accepted category; report abstention changes and limited sample power. This criterion is a proposed local engineering gate, not statistical proof of noninferiority.

H2: Degraded framing, detail crops and mixed scenes cause errors that two-template agreement does not reliably detect. Report raw per-view ranking and workflow abstention separately.

H3: Requiring CLIP/SigLIP category agreement reduces wrong accepted categories at a coverage and latency cost. Do not optimize thresholds; compare the fixed agreement rule.

H4: Using only front/back overview evidence for category aggregation can preserve categories when valid same-item detail photos disagree. It may also fail to notice a wrong-item detail photo. Report both cases; do not recommend production use if the tradeoff is unresolved.

## Fixed image conditions

1. reference: longest edge960px, JPEG88, sRGB, metadata removed.
2. medium:480px, JPEG70.
3. small:224px, JPEG70.
4. tiny:112px, JPEG40.
5. compressed:960px, JPEG30.
6. dark_blur: reference geometry, brightness multiplier0.45 and Gaussian blur sigma1.4, JPEG88.
7. framed_clutter: entire reference photo fitted inside a432x432 tile centered on a960x960 deterministic gray checkerboard, JPEG88. This is reduced photo occupancy plus synthetic framing; it is not a segmented garment-background replacement or a realistic phone condition.
8. center_detail: centered30% width/height crop, resized to at most960px, JPEG88; declared detail view. This is a synthetic crop, not necessarily an informative physical detail.

No transformation creates a new independent item. Actual Commons thumbnails may be the downloaded source representation; record this explicitly. Images retain their original/compatible attribution and share-alike obligations.

## Evaluation and scheduling

Three repetitions per source/condition/model. Freeze a deterministic random seed and shuffled source-condition schedule. Each case is processed by both models consecutively with balanced AB/BA order, independently reshuffled each repetition. Both models initialize before timed trials; record initialization separately. Use one synchronous experiment process and no concurrent inference in this harness.

The existing adapter supplies two-template category consensus and raw view rankings. Real label inputs are evaluated with their label role, yielding no visual classification; record that as a workflow gate, not model accuracy. Detail-only observations must remain unknown, while their raw rankings can illustrate misclassification. Treat transformed overview conditions as front views, and distinguish the raw category hypothesis from the application observation.

Predefined experimental decisions:
- baseline: existing within-model two-template agreement and all-nonlabel-view aggregation.
- overview-only: use template-agreed front/back categories for category, retaining other evidence only diagnostically.
- cross-model: accept an overview category only when both models agree on the same non-unknown category.
- multiview probes: same-item overview+detail, same-item overview+label, mismatched overview+other-item detail, and mismatched overview+other-item overview. No model can turn these into protective clearance.

## Measurements

Record per-trial bytes/dimensions/hash, model and prompt revisions, ordered raw scores, per-view and request time, process RSS sample, failure and repeat index. Scores are uncalibrated and architecture-specific.

Report historical and new sets separately. For scored overview cases report correct accepted, wrong accepted and unknown counts; coverage=accepted/scored and selective correctness=correct/accepted, with all denominators. Also report a conservative group endpoint: a group is wrong if any scored photo view in it is wrongly accepted; a clean accepted group requires all scored views correct. Do not inflate n with alternate views, transformations or repeats. Report model agreement, repeat consistency, per-item changes and exact timing percentiles. Use group-level resampling only as a descriptive uncertainty sensitivity; no population-level significance or safety claims.

## Stop, record and integration rules

No replacement of failed trials with successful retries in the same record. Record recoverable execution problems as deviations and retain earlier files. Do not change prompts, labels, hypotheses or condition settings after first inference. A later experiment requires a separate version.

All candidates remain experimental. Root integrates only specific changes supported by this evidence and independent regression tests. Missing real-phone data, expert safety labels, brand/model verification and domain calibration remain open.
