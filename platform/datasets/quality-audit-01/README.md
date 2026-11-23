# Relay quality audit image corpus

194 unique source photographs, labelled before the evaluated system was run. This is a deliberately difficult diagnostic collection, not a random sample of business intake.

- `labels.csv`: reference labels, source, licence, image path and SHA-256.
- `labels.json`: full records, related-view groups, label rationale and publisher annotation where available.
- `annotations/`: original direct visual annotations retained separately.
- `images/commons/`: garment, gear, decorative-detail, hardware and scene photographs.
- `images/fabric/`: 80 original fabric samples, separately reported as morphology stress cases.
- `images/leather/`: 20 raw leather samples, separately reported as morphology stress cases.
- `review/`: contact sheets used for visual annotation.
- `review.html`: labelled photographs and system results, generated after evaluation.
- `attribution.json`: per-image source and reuse information.

Reference labels describe visible structural material defects. Oil-like staining, printed graphics, mesh and regular seams are not labelled structural damage. Intentional fashion rips still contain visible breaks; their cause and crash history remain unknown. Ambiguous and unassessable examples stay outside binary detection totals.

The assistant assigned labels by direct visual review, supported by source annotations where available. These are not independent expert physical-condition labels. Subtle source annotations were inspected as original-pixel crops; one unresolved example was kept ambiguous. No target-system prediction was used to assign labels.

All photos are original distinct sources, not generated quality variants. Related views are grouped; raw-material capture groups are conservative because item identities are unavailable. The Commons boot-slider case is related to a previously exposed boot source and is marked `priorRelated`.

The model, prompts and policy are frozen in `experiments/quality-audit-01/protocol.json`. The corpus/label lock is `experiments/quality-audit-01/labels.lock.json`. No training or product change is part of this audit. The raw licence-verified material archives remain under the local `.cache/phone-training` acquisition folder.
