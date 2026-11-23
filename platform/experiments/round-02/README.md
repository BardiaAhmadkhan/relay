# Round 02 experiment plan
Date: 2026-10-26. Baseline: e3a6f5876d1c6c7341d4fae7d460ca632af8923c. Status: preregistration before new measurements.

## Scope and authority
Continue research, experiments, implementation and verification in . only. Preserve baseline source/reports, pinned model revisions and original fixture manifest. No paid calls, model training, publication, private-image uploads or organizer contact. New experiment artifacts use round-02 paths. Source changes are integrated by the root after a reproduced defect or controlled comparison.

## Workstreams
1. Vision robustness: fixed model/prompt comparison, deterministic transforms, separate historical diagnostics and new licensed item groups; freeze labels and split before inference. Measure category correctness/abstention, bytes, latency and multi-view aggregation tradeoffs.
2. Quality checks: grouped development/evaluation controls; compare existing Laplacian with normalized multi-scale alternatives; report false warnings and synthetic-only limits. Do not claim expert garment-condition labels.
3. Experience/lifecycle: actual browser fault experiments, small/large-text rendering, response binding, replacement, cancellation, privacy choices and error recovery. Clearly mark mocked network faults.
4. Root protocol/native: request/response integrity, slow HTTP bodies, real network cancellation, preflight cost avoidance and resource limits; attempt a project-local Android build/runtime if supported, with no OS feature or global configuration changes.

## Decision rules
- Keep a frozen baseline. New results never silently replace baseline measurements.
- Do not tune prompts or thresholds on evaluation groups. Synthetic variants of one source remain one item group.
- Stronger safety routing is allowed; no confidence score can clear crash/damage/repair disclosures.
- Prefer a reproducible functional repair over an unverified recognition heuristic.
- Measure improvements on matched inputs with identical configurations; report all regressions and denominators.
- Reject an experiment's candidate if benefits are weak, overfit or trade correctness for speed.
- Native bundles/APKs/emulators/physical devices are separate validation levels.

## Environment observations
Windows 11 Home, 32 GB installed RAM, about 5.7 GB available at initial check, approximately 166 GB free disk. No Java/Android SDK on PATH or standard locations. A Windows hypervisor is present; CPU virtualization feature fields are masked/false and feature inspection requires OS elevation. No feature changes are authorized or attempted. Emulator acceleration will be checked with its own diagnostic if tooling can be installed locally.

## Known baseline limits to probe
Details/label crops can corrupt coarse category matching; synthetic blur escaped the current advisory; response correlation is weaker than server-side shape validation; actual Android runtime was not exercised. These are hypotheses until reproduced, except recorded baseline failures.
