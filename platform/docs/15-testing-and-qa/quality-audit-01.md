# Quality audit 01 - larger labelled image set

Date: 2026-10-26 UTC. The inspection implementation, model weights, prompts, image preparation and policy remained unchanged. No agents, model training, external vision API calls from the evaluation runner, application release or publication occurred. The phone-native integration work was paused at the user's request.

The larger set exposed substantial false alarms and explanation errors. Of 85 images labelled without visible structural defects, 45 raised concerns. Of 75 labelled defect images, the model returned some finding on 73; direct correspondence review found 63 that actually identified the reference defect, nine that only partly identified or misdescribed it, and three that missed it. These are different metrics: an alert about the wrong feature is not a correct defect identification.

[Open the review gallery](../../datasets/quality-audit-01/review.html), [reference labels CSV](../../datasets/quality-audit-01/labels.csv), [results CSV](../../datasets/quality-audit-01/results.csv), and [machine-readable summary](../../benchmarks/quality-audit-01/summary.json). The read-only local gallery can be served with `node scripts/quality-audit-serve.mjs` at http://127.0.0.1:4185.

## Corpus and label boundaries

- 194 byte-distinct source images, across 82 recorded groups. Related garment views are grouped; industrial material captures have few independent groups and are not 100 independent businesses or garments.
- 94 Commons images were acquired from 100 title-selected candidates. Four thumbnail requests were rate-limited and two licence records were unresolved; all six exclusions are retained. The selection favours visible items, normal construction and difficult detail views, not real intake prevalence.
- 80 original fabric images were selected by a fixed seeded hash, 20 from each publisher class, from the publisher's 720-image [Fabric Defects Object Detection Dataset](https://doi.org/10.6084/m9.figshare.25546465.v2), by Osamah N. Neamah, CC BY 4.0. These are a separate morphology stress set.
- 20 raw leather samples were selected uniformly from the primary [Leather defect detection Raw Dataset](https://doi.org/10.6084/m9.figshare.25012643.v1), by Jiachao Wang, CC BY 4.0. Raw cut boundaries are outside the frozen structural-defect definition; this is not a motorcycle-jacket accuracy sample.
- 75 visible-defect labels, 85 negative/control labels, 28 ambiguous and six unassessable. The last 34 remain outside binary detection totals. Stains and printed patterns are controls for structural damage; a false alarm in this report need not mean the stain itself was invented. Intentional fashion rips still contain visible material breaks, with cause unknown.
- Labels were assigned by the assistant's direct visual review before target-system inference, supported by publisher annotations. They are not independently expert-reviewed physical-condition labels. One subtle publisher-labelled hole was kept ambiguous after inspecting its original pixels. No photograph establishes crash history.
- One new boot-detail view relates to a previously exposed boot source and is marked `priorRelated`. The original three user jackets were excluded from the new corpus and checked separately.

The archive contains 723 raw JPEG files with 720 unique byte hashes, and 720 annotated exports. Forty export names sanitize `(2)` as `-2-`; the frozen selection script skipped those unmatched names. Its 80 chosen images came from the directly matched, single-class pool. Three raw files have no corresponding export. This affects coverage, not the identity of any selected input. See the [source inventory](../../experiments/quality-audit-01/source-inventory.json).

## Results by image group

| Group                    | Images | Matching defect description / positive | Partial explanation | Missed reference defect | Flags / negative controls | Unscored labels |
| ------------------------ | -----: | -------------------------------------: | ------------------: | ----------------------: | ------------------------: | --------------: |
| Garments and gear        |     78 |                                  6 / 8 |                   0 |                       2 |                   20 / 52 |              18 |
| Other material close-ups |      3 |                                  1 / 1 |                   0 |                       0 |                         - |               2 |
| Scenes / thermal         |      6 |                                      - |                   0 |                       0 |                         - |               6 |
| Zippers / hardware       |      7 |                                      - |                   0 |                       0 |                     3 / 7 |               0 |
| Fabric close-ups         |     80 |                                50 / 59 |                   9 |                       0 |                   16 / 20 |               1 |
| Raw leather close-ups    |     20 |                                  6 / 7 |                   0 |                       1 |                     6 / 6 |               7 |

Across the 160 binary-labelled images, 45 negative-control flags and 12 missed/misdescribed positive cases make 57 visual-review failures under the stated criteria. This is a diagnostic-set count, not a field error rate. The nine partial cases generally identify the location of a mark but fail to identify the material break. The correspondence rubric was added after early outputs exposed this distinction; it is a disclosed secondary adjudication, not a preregistered independent expert metric. See the [review protocol](../../experiments/quality-audit-01/correspondence-review-protocol.json).

Further errors overlap these counts: 12 positive cases have no correct structured defect type; eight raw-material/hardware images invent a garment zone. Secondary review of the positive cases identifies seven location errors and 12 unsupported additional claims. Do not add these overlapping measures into a single failure total. Identifying one real defect does not mean every returned finding is correct.

## Reference-label disputes

Three frozen negative labels are questionable on secondary full-size review: commons-024 (glove trim), commons-038 (worn display boots) and commons-061 (vintage leather finish). Their original scores are preserved. Excluding all three yields 42 flags among 82 negative controls. This sensitivity result is not a new blind evaluation. [Dispute record](../../benchmarks/quality-audit-01/reference-label-disputes.json).

## Concrete failures

- `commons-087` and `commons-090`: visible ripped jeans/shorts received no finding.
- `leather-007`: actual scraped lines were missed; the raw cut edge was labelled as a frayed garment hem instead. This is why any-alert recall overstates useful detection.
- `fabric-049`, `fabric-051`, `fabric-052`, `fabric-053` and `fabric-058`: cuts were described as seams, discoloration, a stain or a thin mark.
- `commons-099`: an ordinary zipper description was accepted as a defect finding.
- `commons-043`: a regular opening in boot reinforcement was called a puncture.
- Stain controls, decorative stitching, fringe and raw manufacturing boundaries repeatedly produced damage concerns. Those are the next narrowly scoped visual weakness to address.

## Reliability and timing

All 194 images eventually produced schema-valid responses using the audit harness, but 20 initial requests disconnected and required retries. The app itself does not implement those recovery retries. This is a real reliability problem, not 20 extra visual errors. The unchanged service's 10-second connection timeout is shorter than some inference calls. A [controlled real-HTTP check](../../benchmarks/quality-audit-01/transport-timeout-proof.json) with a disclosed 12-second test adapter lost the client at 10.05 seconds while the adapter completed at 12.01 seconds. This diagnostic is not counted as image-model accuracy.

Total measured latency including recorded retries: median 4.10 s, p95 15.85 s. Model-only: median 3.94 s, p95 15.59 s. Slow calls clustered early in the run; host load and runtime cache state were not controlled. Three cache-cleared post-corpus repeats completed in 4.08 s, 6.15 s, 7.55 s. Do not claim a performance improvement or phone latency from these variable host timings. The repeats used the front view; the main material cases used detail. These roles share the same non-label model task, but the follow-up is not an identical full-request benchmark.

An initial incomplete diagnostic run is preserved in `first-pass.jsonl` and `cold-start-interruption.json`. It made 44 requests (seven socket failures, 36 busy responses and one successful response). The following v2 harness run failed before HTTP because of a fractional timeout argument; `harness-invalid-run.json` documents its exclusion. Neither is used in the main visual counts. The corrected harness was smoke-tested, then completed the entire frozen corpus. It retains every attempt and respects service backoff.

Canonical model results: [evaluation-full.json](../../benchmarks/quality-audit-01/evaluation-full.json), [run metadata](../../benchmarks/quality-audit-01/evaluation-full-run.json), and [all attempts as JSONL](../../benchmarks/quality-audit-01/evaluation-full.jsonl). The evaluated profile is `qwen3.5:4b@d8b0f5e9760c/photo-evidence-2+low-detail-cue-1`. No expected label, filename, source title or annotation box was sent to inference.

## Preservation checks and next scope

All frozen inspection/policy/preprocessing source hashes matched before and after the run. The original three jacket photos still returned abrasion/tear/seam evidence: 3/3 in the separate follow-up. No model/prompt change was made in this audit. Existing experimental locks remain intact.

The next visual change should target normal-feature false alarms only, retaining all current true defect identifications and the three user-image checks. The socket cutoff is a separate bounded transport defect. Neither issue is silently fixed in this audit; these results establish the reviewable baseline. Future tuning exposes this corpus, so it must not be reused as an untouched generalization test.
