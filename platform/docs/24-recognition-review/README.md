# Relay | Recognition and weight-editing review

**18 November 2026 · Experiments on the implemented v3.1 baseline and size-eligible alternatives.**

**Keep the original recognition weights as the scientific reference. The tested edits did not earn promotion.** We produced actual, byte-identical-size model files without training. The most repeatable improvement came from showing the existing scorer the right small region of a garment. It appeared on two disjoint sets of real post-consumer clothes. An automatic textile detector did not reproduce the benefit of the known location.

One change is active in the Relay working tree: the decision engine now withholds an offer when a photograph lacks a required usable observation. A complete clean record can still receive an offer. The model experiments remain separate from rider decisions.

Actual edited vision projector · Exact portable weight delta · Source, commands and experiment protocols · [Measurement index](../../benchmarks/recognition-weights-01/index.json)

The portable study packet contains the scripts, raw scores, source attribution, policy diff and binary weight delta. The 671 MB projector is provided separately. Historical source links resolve in the Relay checkout.

## What changed in my assessment

| Original proposal | What the review uncovered | Revised decision |
| --- | --- | --- |
| Inspect fine detail more closely | The original 42/45 source-parent result supplied the correct source to the evaluator. It did not establish that Relay could locate the relevant region. On an external sample a model-chosen crop degraded the full-view result. | Separate finding a mark from recognizing it. Measure the location, scale and final decision with no access to annotation coordinates. Use a rider/staff-pointed detail as a measured alternative until an unaided method wins. |
| Ask the same model to explain wear versus damage | On the stock 2B, a five-choice surface question selected the same explanation in only 24/39 cases after a reversal of answer positions. The proposed two-order gate resolved none of the two eligible road-contact-only suspicions. | An explanation and its paraphrase are correlated model outputs. A second answer does not independently verify the first. Compare against the strongest existing single question and measure the cost of each extra call. |
| Alter weights while retaining size | Re-quantization describes a representation. It does not specify what a model should learn. The implemented checkpoint tagged 4b also exceeds the clarified literal four-billion-parameter limit. | Define a physical distinction, specify an algebraic change that implements it, and test the edit against a size-matched unrelated control. Also compare to the same calculation using unchanged weights when mathematically possible. |
| Judge an upgrade on historical gear photographs | Only three blind-damaged photographs remained in the earlier E19 cohort after excluding known E14 photographer overlap. Material samples, fashion denim, damaged protective gear and crash histories answer different questions. | Add genuinely external labeled garments. Count physical items, pair all views of an item, identify expert agreement and marks too small to see. Keep motorcycle exclusions and protective-area repairs as separate field endpoints. |
| Treat any returned photo score as completed evidence | With a complete-looking record, the old policy recommended an offer in all 44 targeted missing/wrong-type observation fixtures. A score for another view could mask a missing check. | Enforce the minimum evidence for a positive recommendation at the point the policy would issue it. Earlier exclusions, valid retakes, completed decisions and existing input records retain their semantics. |
| Improve attribution and handle follow-up views | A precise flag can belong to a background garment or the other boot. A clean photograph of a different patch cannot settle a suspected tear. | The next capture study must identify item, side, location and whether the new view genuinely resolves the original question. No attribution or history claim follows from an isolated model score. |

## What an excellent small model would have learned

It would react to a gap between seam edges, frayed yarn ending at a hole, or an exposed layer. It would respond differently to fading, a painted graphic, factory ventilation, benign creasing and surface soil. It would attribute those observations to the correct item and body area, preserve uncertainty when the evidence is occluded or too small, and recognize that crash history can be known independently of appearance.

Those are **behavioral constraints**. They do not uniquely determine billions of weights. Different sets of weights can agree on known photos and diverge on the next garment. A direct edit can impose an exact transformation on a specific layer. Whether that transformation implements the intended visual distinction requires independent observations. We tested both a direction derived from pretrained language meaning and a direction derived from filters that had actually learned to recognize holes and stains. Neither relied on labels to calculate the weights.

Research supports the feasibility of editing a trained model. Task arithmetic uses a compatible, genuinely learned specialist delta. It does not infer the delta from a written job description. Research on language-guided anomaly detection motivates testing physical state words. Its published results do not establish that a word direction in Qwen is a visually grounded gear detector. [Task arithmetic](https://arxiv.org/abs/2212.04089) · [WinCLIP](https://openaccess.thecvf.com/content/CVPR2023/html/Jeong_WinCLIP_Zero-Few-Shot_Anomaly_Classification_and_Segmentation_CVPR_2023_paper.html)

## Size and data boundaries

| Component | Recorded size |
| --- | --- |
| Current historical Qwen v3.1 reference | 4,205,751,296 language parameters plus 333,514,240 vision parameters. Combined **4,539,265,536**. Recorded previous results only for this review. |
| Eligible Qwen reference and edits | **2,213,241,664 total parameters**. Language GGUF 2,012,012,448 bytes and vision GGUF 671,372,768 bytes. **2,683,385,216 learned bytes** for every Qwen arm. |
| Optional textile expert used in the unaided test | 41,455,540-byte ONNX before and after the edit. Counting every serialized initializer gives an upper bound of 20,045,479 values. |
| One eligible Qwen plus that expert | At most **2,233,287,143 parameters/initializer values** and **2,724,840,756 bytes** counting the full secondary file. Experiments used one Qwen arm at a time. |

The existing application default still names the older 4b reference. Swapping in a 2B candidate without category-, damage- and repair-specific qualification would silently change the decision function. Historical stock damage review/block boundaries were 0.145/0.646 for the 4b and 0.078/0.255 for the 2B. Never inherit decision thresholds merely because two checkpoints expose the same scorer ID. Future promotion must bind calibration to the exact weights, vision projector, prompts and rendition.

All new Qwen inference ran locally on the same Windows machine and pinned Ollama 0.40.16. We used no gradients, model training, additional learned parameters or paid inference. Public external data was downloaded only for assessment. The experimental files are locally reproducible from digests and attribution. [Pinned Qwen family](https://huggingface.co/Qwen/Qwen3.5-2B) · [Baseline profile](../23-backend-design-2026-11-18/01-engine-design.md) · [Exact weights](../../benchmarks/recognition-weights-01/semantic/weight-manifest.json)

## Direct edits and the evidence for each

### 1. Fine texture versus global texture amplification

For each existing 16×16 input patch filter and channel, calculate its mean. Replace the weights with `mean + gain × (W − mean)`. Both temporal halves are included. A constant-color patch has the same response before and after, up to floating-point rounding. A within-patch change in brightness has its existing response amplified or attenuated. The fixed gains were 1.125 and its reciprocal. Both edits changed 1,572,864 FP32 values. Every other byte was checked against stock.

All three arms saw the same 60 inputs. The primary natural subset contained 11 blind-positive images from five photographer groups and 22 visually clean images from 18 groups. Group-weighted ranking AUC moved from **0.9583 to 0.9611** with the boost and to **0.9574** with attenuation. The prespecified improvement was at least 0.01. The boost recovered zero additional damaged images, removed zero of five visually clean blocks, and sent two previously clear clean images to review. All three arms assigned identical bands to the 16 tiny-defect stress images. Identity repeats matched on the six selected controls. Retire global texture gain for this task. On these same 33 natural photos the previously recorded v3.1 reference blocked 10/11 damage positives and sent one to review. It blocked two of the 22 visually clean examples, sent six to review and cleared 14. The fixed-scale 2B experiment and the earlier role-dependent v3.1 service use different operating thresholds. That comparison is diagnostic. [Protocol](../../experiments/recognition-weights-01/protocol.json) · [Paired results and case IDs](../../benchmarks/recognition-weights-01/texture/results.json)

### 2. Encode an expert distinction in the existing visual projection

The failed texture test suggested a more precise question: can Relay distinguish *broken material* from *ordinary marks on continuous material*? We used the existing 2B model’s pretrained embeddings for two sets of words, including *torn, ripped, shredded* and *intact, dusty, stained*. No garment example set the direction or its magnitude. A separate control used sound-related words, with the exact same pre-rounding change magnitude.

Let `u` be the normalized difference between the two centroids of normalized word embeddings. The visual merger produces `y = Wx + b` in language-embedding space. We replaced its existing weight and bias with:

```text
W' = W + 0.5 u (uᵀW)
b' = b + 0.5 u (uᵀb)
```

Before storage rounding this multiplies the component along `u` by 1.5 and preserves the orthogonal component. The task edit changed **5,759,206** BF16 coefficients and **2,048** FP32 biases. Approximately 98.14% of the realized edit energy remained along the intended direction after BF16 rounding. The language model and all other projector tensors remained byte-identical. The study verified the complete output SHA-256 as `9aa415f841355a2a56a983815e61204b388e1f98cea788b722922a6fd9686ec7`. Applying the portable delta to the stock projector independently recreated that exact file.

On 32 publisher-labeled fabric images outside the two earlier Relay audit selections, with surface markings and material breaks represented in each of two capture sessions, mean within-session AUC was **0.9766 stock, 0.9766 directed, 0.9844 unrelated control**. On 10 tear-labeled and 16 visually clean garment photos drawn from other recorded authors, scores were **0.9438, 0.9500 and 0.9313**. The change amounted to **one of 160** positive-negative orderings. This transfer sample includes fashion jeans; it is not a motorcycle-specific release cohort. The old stock broken-material question alone ranked all 160 comparisons correctly in that sample. The directed edit changed no transfer photo damage bands. Its primary improvement requirement failed. [Protocol](../../experiments/recognition-weights-01/semantic-protocol.json) · [Matched results](../../benchmarks/recognition-weights-01/semantic/semantic-results.json)

### 3. Independent used-garment validation

We selected one image variant per physical item from Wargön Innovation’s public validation releases. The first set contained **12 garments with an annotated hole and 12 with an annotated spot**. A second set later used 24 different item IDs. A spot annotation identifies the labeled region. It does not certify the absence of any hole elsewhere on the garment. The two sets come from the same publisher and are not two independent sites. The publicly documented sorter dataset separately contains front/back views, an item-level hole field and repeated assessments for its gold set. [CISUTAC garment projects](https://www.cisutac.eu/datasets) · [Holes](https://huggingface.co/datasets/wargoninnovation/Garment_condition_holes) · [Spots](https://huggingface.co/datasets/wargoninnovation/Garment_condition_spots) · [Nauman / RISE sorter data](https://zenodo.org/records/13788681)

Each row below shows correctly ranked hole-versus-spot pairs out of **144**. This is a ranking measure. It does not mean that many individual garments were classified correctly.

| First external set, fixed dual-question score | Stock | Directed edit | Equal-strength unrelated edit |
| --- | ---: | ---: | ---: |
| Whole photograph | 99 | 99 | 97 |
| Correct region provided from the publisher annotation | 129 | 130 | 130 |

The stock engine gained **30 pair orderings** from access to the correct region. The one-pair regional improvement over stock also occurred under the unrelated edit. On the eight shared-date garments the directed whole-view score fell from 15/15 to 14/15 orderings. The original single stock broken-material question gave **107/144 whole and 132/144 localized**, exceeding the prespecified dual-question score. The median native long side of a labeled hole was only 20.5 pixels, with a minimum of 3.5. Zooming can reframe those pixels; it cannot restore detail absent from the original.

In the independent RISE gold collection, **only one hole-positive physical item** met the strict repeat-assessment agreement and availability rules, with an eligible stain-marked no-hole item as its paired control. The records came from two institutions. All three models ordered those two items correctly under the dual-question score and incorrectly under the legacy broken question. One item comparison is too small to estimate production sensitivity. Six gold item groups had contradictory explicit hole judgments. Keeping disagreements visible materially changed the denominator. [Fixed external conditions](../../experiments/recognition-weights-01/external-protocol.json) · [External results](../../benchmarks/recognition-weights-01/external/semantic-results.json)

### 4. Use weights that actually learned from visual textile defects

We inspected a small pretrained detector with distinct, supervised hole and stain channels. Its source domain was industrial loom fabric. To express the *difference between evidence for a hole and for a stain at the same location*, we replaced the existing hole row with `W_hole − W_stain` and its bias with `b_hole − b_stain` at each of three detection scales. The stain channel stays available. Before FP16 rounding, adding the stain logit back exactly reconstructs the old hole logit. Only **771** learned values changed, without adding any parameter or growing the file. On the evaluated photos all decoded boxes and untouched class outputs had zero measured difference. [Publisher’s detector](https://huggingface.co/hazemaaa/fabric-defect-detection) · [Exact edit](../../experiments/recognition-weights-01/trained_head.py)

The corrected task readout combines absolute hole evidence with relative hole-versus-stain evidence at the same anchor. The 24-garment reserve was disjoint from the previous used-garment cohort. On marked patches, hole-versus-spot ranking improved from **73/144 to 80/144**. On whole garments it fell from **68/144 to 67/144**. Computing the same rule from the *unedited* trained logits produced the identical rankings. The physical in-model edit works, but it adds no information that the original learned channels did not already contain. The detector card labels the repository MIT and the binary identifies Ultralytics AGPL-3.0. We used it in local research and kept its binary outside the handoff. [Equal-rule control and raw scores](../../benchmarks/recognition-weights-01/trained-head/head-results.json)

### 5. Test the actual autonomous recognition path

On those same 24 reserve garments, the trained detector chose a location using only image pixels. One size-compliant **unedited 2B** model then answered its stock broken-material question on the whole garment and the proposed detail. The baseline preserved earlier warnings by taking the maximum. A second control cropped the center using the exact same pixel dimensions as the detector proposal. A deliberately favorable reference used the annotation location and size.

| Evidence fed to the 2B scorer | Correct pairs / 144 | AUC |
| --- | ---: | ---: |
| Whole photograph | 111 | 0.771 |
| Whole plus detector-proposed region | 107 | 0.743 |
| Whole plus same-size center crop | 109 | 0.757 |
| Whole plus publisher-marked region | 126 | 0.875 |

The detector-selected route improved six pair orderings and worsened ten versus the whole photograph. The paired item-bootstrap interval on the AUC difference was **−0.139 to +0.083**. Its crops contained the labeled center in 10/12 hole and 9/12 spot photographs, but the median proposed crop covered **56.25% of the image**; the publisher-directed crops covered about **1%**. The observed center error also limits a smaller crop. On post-run inspection, a 128-pixel square centered on the detector predictions would have contained just 1/24 labeled centers. Both location and scale matter. Do not use this automatic crop to clear gear. [Unassisted selection protocol](../../experiments/recognition-weights-01/unguided-protocol.json) · [Paired results](../../benchmarks/recognition-weights-01/unaided/unguided-results.json)

A separate zero-weight spectral-saliency proposal had the same problem. With identical two-crop area, it covered one more labeled center than the coverage control on 59 archival fabric images (58 vs 57) and none more on 16 fresh material images (15 vs 15). On the first 24 independently annotated garments it covered 13 centers versus eight for the matched-area control. Only five of the twelve holes were covered. In only one of all 24 cases did a proposed crop center actually point inside the target box. Use region coverage and achieved magnification as separate measurements. [Location comparison](../../benchmarks/recognition-weights-01/external/location-results.json) · [Spectral-residual method](https://bcmi.sjtu.edu.cn/~zhangliqing/Papers/2007CVPR_Houxiaodi_04270292.pdf)

Correctly ranked hole-versus-spot pairs across the two disjoint used-garment cohorts.

## The engine change that passed

The shared policy now checks all evidence needed **before issuing an offer**. Each garment photo needs typed results for surface visibility, broken material, road-contact marks, repair and wear. Overview views additionally need item/category and motorcycle-gear checks. A label photo needs readability. Details do not redundantly require whole-item classification when an overview supplies it. A previously reported or established exclusion still takes precedence.

The pre-change engine returned an offer for all **44/44** targeted single-omission or wrong-type fixtures. The new engine routes all 44 to review, identifies the affected photo and names the missing observation. These are controlled contract tests, not 44 observed unsafe customer transactions. A service-level test also delivers a partial observation through the normal score-to-decision path. All **609 tests across 32 files** and the TypeScript no-emit check passed. Before/after replay preserved the outcome, reason codes, next view, category and grade on **385/385 archived one-photo diagnostics**. The historical log stores the winning category probability at three decimals; one reconstructed category differed from the original pre-change log on both old and new code. All historical action outcomes matched. [Policy](../../packages/core/v2/policy.ts) · [Verification and source hashes](../../benchmarks/recognition-weights-01/policy/checks.json)

## What to pursue next

1. **Test obtaining the mark from a rider or qualified reviewer.** Compare the current overview, a real rider tap plus same-image crop, and a genuinely fresh close-up of the same area. Include several items, left/right pairs, factory seams, printed damage, grime and missing labels. Record seconds, target-center error, native pixels across the actual mark, abandoned requests, and whether experts can resolve the case. Ground-truth boxes give an upper reference; rider taps and fresh captures have not yet earned the same evidence.
2. **Make location and scale the next specialist’s objectives.** A candidate must distinguish the intended item from its surroundings, locate the mark closely enough to add native detail, and retain wider context. Compare against the original single broken-material question, equal-area/equal-compute crops and blinded in-hand observations. A region scorer that only highlights contrast is insufficient. Keep a small randomized audit of quiet overviews for confidently missed damage.
3. **For future direct weight edits, require a source of visual expertise.** A licensed, architecture-compatible donor trained on comparable garment defects could supply a genuine learned task delta, which can be folded into fixed-size weights. An industrial welding adapter uses welding images and telemetry. IAD-R1 uses different Qwen architectures and its original model repository required gated access. Neither establishes transferable motorcycle expertise. Require exact base compatibility, donor provenance, an unchanged-weight readout control and a sealed, representative gear cohort before accepting a donor. A labeled fit, including a fitted linear probe with no gradients, is data-dependent training. Keep that distinct from these data-free edits. [IAD-R1 authors](https://github.com/Yanhui-Lee/IAD-R1) · [Intel adapter card](https://huggingface.co/Intel/qwen3.5-2b-vlm-weld-explainability-lora)
4. **Qualify an item-level decision, including uncertainty and cost.** Recruit independent physical items in the intended categories, including confirmed protective-area repairs, crash disclosures, naturally worn undamaged gear and ambiguous construction. Blind the first inspection, record inter-rater differences, keep all views of a garment in one cohort, and evaluate a single locked candidate. Measure unsafe eligibility, wrongful terminal exclusion, review load and mistaken attribution. A trained specialist can learn visual evidence. A photograph cannot establish unreported crash history. Keep the deterministic exclusion authority and the completeness gate.

The direct edits are reproducible research artifacts. The positive finding is specific: in two disjoint item draws from the same used-garment source, the **existing single-question stock model** gained when given the correct mark. The tested automatic methods have yet to deliver that information reliably at the right scale.
