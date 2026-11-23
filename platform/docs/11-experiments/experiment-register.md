# Experiment register
Run dates use UTC. Machine-readable records are the authority for exact timings/configurations.

| ID | Question | Artifact | Conclusion and limit |
|---|---|---|---|
| VISION-001 | CLIP versus SigLIP on identical licensed fixtures and two fixed label formulations | benchmarks/vision-latest.json, vision-report.md; scripts/benchmark-vision.ts | CLIP is the provisional category baseline; both fail difficult controls. No condition accuracy established. |
| VISION-002 | Label-only input, conflicting views, abort and adapter scope | benchmarks/vision-adapter-checks.json and its mjs runner | Explicit abstention/scope behavior verified; no claim of exhaustive recognition. |
| QUALITY-001 | Severe exposure, blur, compression and resolution effects on pixel heuristics | benchmarks/quality-001-initial.json | Initial run used the already resized source derivative; preserve this to explain why1600 and960 targets matched. |
| QUALITY-002 | Repeat against the preserved original source | benchmarks/quality-latest.json; scripts/benchmark-quality.ts | Pixel quality/bytes and host processing times only. Synthetic changes, not a labeled rider-capture study. |
| POLICY-001 | Historical exclusions and all 27 disclosure combinations | tests/policy.test.ts; benchmarks/unit-results.json | No test output recommends an offer/certification. A finite test suite is not a guarantee about all inputs. |
| API-001 | Consent, malformed data, references, duplicates, timeout/coalescing/cache | tests/api.test.ts | Injected providers isolate boundary correctness; no paid calls. |
| PROVIDER-001 | Cloud request contract, refusal and unsupported claims | tests/provider.test.ts | Fake fetch verifies integration logic; live model behavior remains unknown. |
| UI-001 | Connected import/inference/correction/recovery flow | tests/mobile.spec.ts; benchmarks/ui-results.json; output/playwright | Chromium at mobile sizes, real local inference on non-gear fixtures. Not native runtime proof. |

## Measurement discipline
Keep source fixtures frozen and near-duplicate groups together. Do not tune prompts against the same tiny scored sample and claim a general improvement. Save raw measurements, code/model/manifest hashes and failed cases. Label timing stages separately: inference measurements are not camera-to-result timings. Distinguish provider list prices, calculated scenarios and actual billable usage. A cloud Pareto frontier is not measured until comparable expert-labeled images and approved credentials exist.
