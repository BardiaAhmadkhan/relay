# Relay recognition results and implementation

**Original 4B checkpoint for the application. Stock and physically edited 2B checkpoints for research.** The change that transferred to the original model was giving it a specific, source-resolution area to inspect while retaining the whole garment. The phone, backend, signed evidence record, result screen and specialist console now support that workflow. An ordinary assessment follows the calibrated v3.1 plan. A concern the rider marks can reach a specialist without an automatic exclusion from the crop score. [Implementation](engineering.md) · Reproduction · [Measurement index](../../benchmarks/recognition-transfer-02/index.json)

## What improved on the model used by Relay

We compared the original stock `qwen3.5:4b` on the same 128 garment items and the same existing broken-material question. Each item supplied a complete photo and a crop around the publisher's annotated hole or spot. Original pixels were held fixed across models. AUC is the fraction of hole–spot pairs in which the hole scores higher, with half credit for a tie. The confidence interval resamples physical item IDs by class and original cohort. The many pairs share items. Counting those pairs as independent observations would overstate precision. [Prespecified 4B comparison](../../benchmarks/recognition-transfer-02/05-live-location/protocol.json) · [Complete 4B and paired 2B results](../../benchmarks/recognition-transfer-02/05-live-location/results.json)

| Stock model and garments | Whole photograph AUC | Marked detail AUC | Paired gain and 95% interval |
| --- | ---: | ---: | ---: |
| 4B, first 64 | 0.6631 | 0.9092 | +0.2461 [0.1377, 0.3672] |
| 4B, next 64 | 0.7490 | 0.8750 | +0.1260 [0.0029, 0.2559] |
| **4B, all 128** | **0.7070** | **0.8931** | **+0.1860 [0.1086, 0.2678]** |
| 2B, identical 128 | 0.7158 | 0.8606 | +0.1448 [0.0583, 0.2341] |

Original stock 4B response on the whole and marked images of the same garments

At a diagnostic cutoff of 0.50, the full-view 4B response flagged 9 of 64 hole items and 0 of 64 spot items. The marked response flagged 41 of 64 holes and 5 of 64 spots. All five spot flags occurred in the second cohort. The improvement in recognition and the risk of a wrong automatic exclusion both matter to the user. The application preserves the original assessment, presents the additional pixels, and assigns a person the unresolved mark. **The cohort used publisher locations. Actual rider localization and field offer accuracy remain unmeasured.** [Raw predictions](../../benchmarks/recognition-transfer-02/05-live-location/scores.jsonl)

## Recovering detections while protecting existing ones

The first 4B comparison suggested a stricter operating point might retain much of the signal at lower cost in unnecessary flags. We inspected the development scores, declared a marked-response threshold of 0.90, and froze it before scoring 224 different items with the 4B model. The rule retained every pre-existing positive on the whole image. The shifted condition moved the tap horizontally by one-quarter crop width, with direction fixed by the item ID. The actual runtime never treats these diagnostic thresholds as eligibility thresholds. [Frozen test](../../benchmarks/recognition-transfer-02/07-live-priority/protocol.json) · [Full results](../../benchmarks/recognition-transfer-02/07-live-priority/results.json)

| On 112 holes and 112 spots | Hole items flagged | Spot items flagged | Extra holes versus whole | Extra spots versus whole |
| --- | ---: | ---: | ---: | ---: |
| Whole only, 0.50 | 20 | 1 | — | — |
| Keep whole and add centred mark at 0.50 | 73 | 13 | 53 | 12 |
| Keep whole and add centred mark at 0.90 | 50 | 3 | 30 | 2 |
| Keep whole and add shifted mark at 0.50 | 66 | 15 | 46 | 14 |
| Keep whole and add shifted mark at 0.90 | 49 | 3 | 29 | 2 |

Raising the marked cutoff removed 10 of the 12 additional centred spot flags while retaining 30 additional holes. The 0.90 rule preserved every whole-image detection in both groups and at both positions. Two new spot flags remained. That missed the declared zero-additional-alarm requirement. Further increasing the cutoff on these same cases would turn them into development data. The implemented safeguard acts at the decision boundary and leaves both observations available for a human. [Item-level scores and model identity](../../benchmarks/recognition-transfer-02/07-live-priority/scores.jsonl) · [Review policy](../../packages/core/v2/policy.ts)

## Physical weight experiments

The donor was Intel's public Qwen3.5-2B adapter for trained industrial weld inspection. Its task combines images with sensor telemetry. We used its learned changes to the visual block matrices, discarded its language and reporting changes, and performed no optimization on Relay images. For each matrix we added the rank-16 product of the published factors at a declared strength and rounded back to the stock BF16 representation. We verified eight interior-row samples against the pinned upstream base, checked all 96 target shapes, and verified that every byte outside the selected matrices was preserved. Each resulting model contained 2,213,241,664 parameters and 2,683,385,216 learned bytes, exactly equal to stock 2B. The calculations define a testable hypothesis about transfer from another inspection task. [Intel model card](https://huggingface.co/Intel/qwen3.5-2b-vlm-weld-explainability-lora) · [Training-free task arithmetic research](https://arxiv.org/abs/2212.04089) · [Measured tensors](../../benchmarks/recognition-transfer-02/01-vision-merge/weight-manifest.json)

| Frozen comparison | What improved | What regressed or failed to repeat | Disposition |
| --- | --- | --- | --- |
| Half-strength edit across 96 matrices, 64 garments | At 0.50, five stock misses recovered, zero new spot alarms | One stock-positive hole lost. Mark ranking improved by only 1 of 1,024 pairs. Whole AUC fell from 0.7031 to 0.6709 | Keep for research |
| Full-strength edit, same 64 | Seven stock misses recovered at 0.50 | Two stock-positive holes lost, one spot alarm added, marked AUC fell from 0.8506 to 0.8174 | Reject global replacement |
| Half-strength attention-only and MLP-only, another 64 | Each recovered two holes and added zero spot alarms. Whole AUC rose from 0.7295 to 0.7842 for attention and to 0.7578 for MLP | Mark AUC fell from 0.8789 to 0.8662 and 0.8584 | Test the apparently better whole-photo role independently |
| Attention-only on 224 previously unscored whole photos | One additional whole-photo hole flag, zero added spot flags at 0.50 | Whole AUC fell in both cohorts. Pooled stock 0.7579, attention 0.7502. Paired difference −0.0077 [−0.0333, +0.0171] | The whole-photo gain did not replicate |
| Stock-preserving second look on 96 new items | Centred marks recovered two holes and retained all stock detections. Six of 96 views needed the second score | One new spot alarm. Ranking stock alone at the same review budget found the same 22 holes and one spot. Shifted taps recovered four holes with one extra spot | No evidence of an advantage for the extra model |
| Strong edited score or tighter-scale stock corroboration on another 128 | Preserved stock detections with zero additional spot alarms at both tap positions | Recovered zero additional holes at either position. The stock-only second scale recovered one centred hole and none when shifted | The stricter rule removed the benefit as well |

[Full and half edits](../../benchmarks/recognition-transfer-02/01-vision-merge/results.json) · [Attention and MLP edits](../../benchmarks/recognition-transfer-02/02-isolated-branches/results.json) · [Whole-photo replication](../../benchmarks/recognition-transfer-02/06-whole-transfer/results.json) · [Stock-preserving trial](../../benchmarks/recognition-transfer-02/03-stock-preserving/results.json) · [Scale corroboration](../../benchmarks/recognition-transfer-02/04-scale-confirmation/results.json)

The review-budget control matters. Lowering stock to 0.20 on the 96 centred items flagged 25 holes and two spots. It is easy to recover more positives by calling more items positive. A second model needs to improve the mix of items sent for review at a comparable workload. The conditional edited pass added 6.25% model input tokens for centred views and 8.33% for shifted views in this trial. Those are empirical warm question costs. Switching between two deployed checkpoints, queuing and network time would add costs of their own. [Per-case comparison and recorded timings](../../benchmarks/recognition-transfer-02/03-stock-preserving/paired-cases.jsonl)

### What happened in individual photographs

In the first 64-item study the half edit lost the stock detection on a 7.5-source-pixel mark. Its score moved from 0.545 to 0.396. The five recovered holes spanned roughly 51 to 481 source pixels across the annotated mark and scored between 0.240 and 0.406 on stock. That led to testing a fixed, source-size-aware second look on new items. In that later study, one striped garment bearing a publisher-labelled spot triggered the additional flag at both tap positions. A hole beside a seam responded strongly to the edit, and another opening responded only weakly. These examples explain the subsequent tests. Their scores never changed the ground truth. [First cohort sources and boxes](../../benchmarks/recognition-transfer-02/01-vision-merge/sources.json) · [Recovery-case records](../../benchmarks/recognition-transfer-02/03-stock-preserving/paired-cases.jsonl)

### What can transfer between sizes

The stock 2B and 4B projectors share the same shapes for all 96 targeted matrices. **Zero of the 96 have identical bytes.** Their cosine similarities range from 0.5121 to 0.9978, with median 0.9672. Even the final merger's output dimension changes from 2048 to 2560. The original weights could plausibly support useful related edits, but copying the 2B values would discard real 4B specialization. No edited checkpoint earned transfer testing on 4B under its fixed criteria. The input method did, and the original 4B model reproduced the improvement. [Per-matrix coordinate audit](../../benchmarks/recognition-transfer-02/coordinates.json)

## Evidence and reproducibility

Across the seven series there were 352 distinct new item identifiers. The studies reuse items explicitly for paired method comparisons. There were 3,552 main scored image/model combinations plus 42 stock repeat checks. All 42 repeats matched their corresponding original probability exactly. Each run records input hashes, probabilities, answer coverage, timings, loaded model digest, hardware telemetry and a frozen protocol. The cohorts use Wargön Innovation's published hole and spot annotations. The publisher's training split was used solely for evaluation here. Different archives can contain different dates, designs, backdrops and forms of wear. An annotated spot is local evidence about that spot, and the camera cannot reveal crash history. [Hole dataset](https://huggingface.co/datasets/wargoninnovation/Garment_condition_holes) · [Spot dataset](https://huggingface.co/datasets/wargoninnovation/Garment_condition_spots) · [Measurement index](../../benchmarks/recognition-transfer-02/index.json)

The portable research archive contains the 192 original donor factor tensors, attribution, license and hashes. Its tensor payload is 25,165,824 bytes. The stock GGUF architecture stays fixed after folding. Rebuilding from the compact factors exposed a small numerical reproducibility issue. Changing the BLAS thread count altered 11 stored BF16 words in the half edit and 12 in the full edit. A fixed-order reference calculation and a sparse table of measured rounding outcomes now reproduce **all four complete projector SHA-256 digests**. The table was derived solely from checkpoint bytes. Portable donor factors · [Measured rounding outcomes](../../experiments/recognition-transfer-02/rounding.json) · [Verified whole-file hashes](../../benchmarks/recognition-transfer-02/rebuilt-projectors.json)

The application changes, limits, acceptance tests and commands are documented separately. The raw numerical record supports garment-recognition research and the mobile specialist-review workflow. Field safety, real rider tap accuracy and offer performance require a different validation set and direct observation of the shop process. [Engineering handoff](engineering.md) · Reproduction and run order
