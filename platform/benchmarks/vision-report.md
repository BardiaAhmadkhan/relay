# Local vision comparison — 2026-10-26

Status: executed on the development computer. Raw record: [vision-2026-10-26T06-37-23-456Z.json](vision-2026-10-26T06-37-23-456Z.json). No paid APIs, training or phone inference were used.

## What was measured

Two pinned q8 pretrained models processed eight licensed image derivatives twice each. Every request ran two fixed prompt wordings. Six photographs had source-based category reference labels; they represent five item groups because two photographs show the same glove pair. A partial crashed shoulder and a backpack label are unscored challenge controls.

| Result | CLIP | SigLIP |
|---|---:|---:|
| First-pass category references matched | 5 / 6 images | 4 / 6 images |
| Item groups with all scored views matching | 4 / 5 groups | 3 / 5 groups |
| Warm requests recorded | 16 | 16 |
| Median request time | 121.0 ms | 593.6 ms |
| Descriptive p95, nearest rank | 137.6 ms | 693.2 ms |
| Model initialization from populated cache | 883.9 ms | 719.0 ms |
| Load or inference failures | 0 | 0 |

These times include local decoding, two prompt runs and observation construction for one image; they exclude camera, mobile upload, server queueing and response rendering. Model initialization is separate. They are neither end-to-end phone latency nor stable service-level estimates. At n=16, nearest-rank p95 is the maximum observed request. Models ran sequentially with CLIP first; no randomized thermal/load control was performed.

## Per-image outcomes

| Image | Reference/use | CLIP | SigLIP |
|---|---|---|---|
| Decorated leather jacket | motorcycle_jacket | motorcycle_jacket | other |
| Herobiker armour jacket on mannequin | motorcycle_jacket; broad source-based taxonomy | motorcycle_jacket | other |
| Glove backs | gloves | gloves | gloves |
| Glove palms, same pair | gloves | gloves | gloves |
| Racing boot | boots | boots | boots |
| Jacket, boots, gloves and helmet together | multiple | motorcycle_jacket | multiple |
| Crashed shoulder close-up | Unscored partial-view control | helmet | boots |
| Backpack material label | Unscored negative-domain/OCR control | motorcycle_jacket | unknown |

The Herobiker reference deliberately uses the challenge's broad jacket category; it is a body-armour garment on a mannequin rather than a conventional outer jacket. That taxonomy choice needs organizer/expert confirmation. Visual inspection confirmed the mixed scene contains multiple gear types and that the backpack image is a material label, not a garment overview.

The crash history comes from the source caption. Neither model detected or cleared crash damage; their outputs are category-only. Passing that known crash disclosure to the independent policy engine must exclude the item regardless of these categories.

## Important findings

CLIP is the practical default **for this local category-only prototype**, given the observed jacket outcomes and lower elapsed time in this run. SigLIP correctly selected the mixed-item scene where CLIP selected its dominant jacket. This is useful disagreement evidence, not a reason to label one model universally better.

Both models can confidently rank an irrelevant close-up as a gear type. Agreement between prompt wordings does not remove that error. The actual adapter therefore excludes declared label views from category classification and requires a front/back overview. A user assigning the wrong view type can still supply an irrelevant crop; category-only coverage must continue to route to human inspection.

No prompt or label list was tuned after inspecting these results. The two template rankings are in the raw artifact, including differing raw scores. CLIP uses candidate-relative softmax; SigLIP uses independent sigmoid. Neither score is calibrated probability.

## Behavioral checks

For both adapters, the executed benchmark confirmed:

- Label-only input returned unknown with no attributes/concerns.
- An already-aborted request rejected.
- A front jacket and back boot returned unknown, exercising view disagreement.
- Outputs kept category-only coverage and did not emit a condition or certification.

Additional adapter checks, when present, are recorded in [vision-adapter-checks.json](vision-adapter-checks.json). Project domain-policy and API tests are separate; this report does not count them as vision accuracy.

## Data and reproducibility

See [fixture attribution](../assets/fixtures/ATTRIBUTION.md), [manifest](../assets/fixtures/manifest.json), and [model provenance](../docs/07-computer-vision-research/model-provenance.md). The JSON record includes Node/OS/CPU, package version, thread settings, model revisions, fixture-manifest SHA-256, prompt wording, per-view raw scores, individual times, RSS samples and downloaded-model hashes.

Seven source images were preserved as Commons originals and checked against source SHA-1. The eighth uploader original returned HTTP429 with a 600-second retry instruction; the server explicitly suggested standard thumbnails. Its permitted 960px thumbnail is the preserved downloaded source representation, clearly identified in the manifest. It was not represented as a verified uploader original.

## Limits and next experiment

This convenience sample is too small and biased for a general accuracy percentage or a provider selection. Public images could have appeared in pretraining. There are no standalone trousers/helmet examples, verified protective condition labels or representative phone captures. Repetition improves timing observations, not independent sample count.

Next collect owner-authorized photographs of distinct real items, with expert category labels and a locked holdout. Compare multi-view capture and background diversity, then evaluate OCR on readable and worn sewn labels. Condition observations and hosted providers require a separately authorized, expert-labelled evaluation. Preserve the current raw baseline.
