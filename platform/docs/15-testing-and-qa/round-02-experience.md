# Round 02 experience stress tests

Research date: **2026-10-26 (UTC)**. Preserved baseline: **e3a6f58**. Scope: the actual exported browser app at `http://localhost:4173`, its local CLIP service at `http://127.0.0.1:8787`, and targeted lifecycle source review.

**Baseline result: 22 new scenario cases, 15 passed and 7 failed.** The failures reproduced response-binding, consent, asynchronous connection-selection and error-presentation defects. They were reported to the implementation owner for narrow fixes. Existing 295 unit tests and five browser tests were not counted as new coverage.

**After-fix status: pending the refreshed export and execution of the same 22 cases.** Do not interpret this baseline report as a completion claim.

## Method and artifact integrity

The [new test file](../../tests/round-02-mobile.spec.ts) and [isolated configuration](../../experiments/round-02/experience/playwright.config.ts) leave existing tests/configuration unchanged. Five generated PNGs explicitly say “ROUND 02 SYNTHETIC / NOT GEAR EVIDENCE.” Photo selection, resizing, draft persistence and navigation run through the actual app.

Most fault cases intercept the browser's localhost `/health` and `/assess` requests. Their responses are labelled deterministic test doubles. No paid provider request is made, including cases whose synthetic response says `openai`. These cases test orchestration and trust boundaries, not model accuracy.

R15 uses the real local CLIP service for duplicate detection, replacement and subsequent analysis. The app is the static export, not a mocked screen or a development-only component mount. The implementation owner held that export unchanged during both baseline runs.

Evidence is retained separately:

- Focused baseline result: eight cases, one pass and seven failures.
- Recovery/layout baseline result: fourteen cases, all passed.
- [Combined baseline summary](../../benchmarks/round-02/experience/baseline-summary.json): unique case names, statuses and durations.
- [Baseline case measurements](../../benchmarks/round-02/experience/baseline) and [recovery measurements](../../benchmarks/round-02/experience/baseline-recovery): JSON and screenshots.
- Failure traces: reproducible browser traces, error contexts and screenshots.

No production app/server file, existing test file, package installation or commit was changed by this testing specialist.

## Seven reproduced baseline failures

| Case | Reproduction | Measured baseline outcome | Required invariant |
|---|---|---|---|
| **R07 unrelated photo IDs** | Capture front/back/label; return a schema-valid result with the same assessment ID but three different photo IDs. | The foreign photo record was accepted and persisted. | Every returned photo must correspond to the submitted evidence; same assessment ID alone is insufficient. |
| **R07 swapped photo views** | Keep the submitted IDs but exchange the front/back view associations in a valid response. | The swapped view associations were accepted and persisted. | Submitted ID-to-view associations cannot change silently. |
| **R07 wrong model** | Health identifies one local model; return a valid observation naming another. | The unrelated model observation became the stored result. | Response analysis identity must match the checked/authorized target. |
| **R07 unexpected external provider** | Health identifies local CLIP with no external consent; return an observation claiming an external provider and visual-observation coverage. | The observation was accepted and persisted. | A local-analysis session cannot silently accept a different provider/scope. The policy's use of visual observations makes this more than cosmetic metadata. |
| **R09 external consent withdrawn during health** | Obtain the external-choice prompt; select it; start another review; hold the second health response; uncheck the external choice; release health. | **One intercepted upload** started while the checkbox was false. No real external call occurred. | Withdrawing consent before upload must invalidate the pending operation rather than allowing invocation-time state to authorize it. |
| **R11 overlapping connection saves** | Save local endpoint A with a delayed health response; change the field to B and save; let B succeed; then release A. | Stored URL reverted to A while the input still displayed B; status also changed back to A. | The most recent user save owns the connection. A stale completion must not redirect subsequent processing. |
| **R06 malformed 200 response** | Return only `{"schemaVersion":"1.0"}` with HTTP 200. | The request was rejected, but the visible alert contained the raw multi-entry Zod diagnostic array. Photos survived. | Schema failure must remain fail-closed while presenting a short, actionable message. Preserve diagnostics only in an appropriate developer context. |

The binding cases are **P1 record/processing integrity defects**. R09 is a **P1 consent race**; R11 is a **P1 target-selection race**. R06 is **P2 error clarity**: it did not turn malformed data into a positive assessment.

The different-assessment-ID control case passed, confirming that the baseline already rejected that simpler mismatch. The new failures specifically probe boundaries the existing check did not cover.

## Passing stress cases and what they establish

| Case family | Baseline evidence |
|---|---|
| **R01 replacement + optional detail** | Replacing Front changed only its ID, retained Back/Label, invalidated the previous result and included all four current IDs after adding Detail and reviewing again. |
| **R02 missing-label recovery** | A deterministic request for a clearer label opened Label, retained the other two views, and allowed replacement/review. The final favourable route is a test fixture, not an observed gear assessment. |
| **R03 corrupt replacement** | An intentionally corrupt PNG produced a recoverable error; the existing three photographs remained intact and import stayed enabled. |
| **R04 network, 503, 401 and incompatible health** | Each failure made zero assessment uploads, retained photos and allowed a subsequent successful routed retry. These are four separate cases. |
| **R05 assessment outage** | A 503 response retained the draft; the next request completed without recapture. |
| **R08 cancellation after upload** | A held assessment response was cancelled; Front was replaced and crash history added. Releasing the old result did not overwrite the new evidence or exclusion; exclusion survived reload. |
| **R10 core consent + reload** | Core consent was disabled while processing. After cancellation it could be withdrawn; no upload followed. Reload retained photographs but did not silently restore processing consent. |
| **R12 320px doubled text** | Nine history answer controls remained horizontally inside 320 pixels, each measured 74 × 96 pixels; the test selected all unknown answers and reached Capture. This is browser text/line-height doubling, not native Dynamic Type. |
| **R13 320 × 568 camera denial** | The fallback measured x=24, y=496, width=272, height=48 and was entirely in the viewport. Keyboard traversal reached it. No running browser animation was recorded under reduced motion. |
| **R14 keyboard correction** | Keyboard entry/tab/Enter saved a rider correction at 320 × 568 and reached the conservative result. The axe check found no serious/critical violations in that result state. |
| **R15 real local pipeline** | Duplicate Front/Back content was rejected; replacement recovered without losing the photo set and real local CLIP analysis completed. |

The viewed small-screen captures are coherent and preserve the main task controls. Doubled text makes the headline occupy much more vertical space; successful scripted scrolling is not proof that users find that comfortable. Full-page screenshots still capture the internal ScrollView's current viewport, so below-viewport content is not called a dead end.

### One measured real-pipeline run

The warm local R15 run reported:

- Model: `Xenova/clip-vit-base-patch32@d15189d7028b:q8`.
- Successful response total: **295.68 ms**; preprocessing: **82.34 ms**; inference: **212.89 ms**.
- Measured interval from the first duplicate submission through error, replacement and successful evidence display: **1,041 ms**.
- Route: `human_inspection`; offer recommendation remained false.

These are **one local synthetic-input observation**, not representative latency, real-gear accuracy or a production capacity benchmark. The timing artifact specifies the exact measured fields.

## Source-backed lifecycle review

The baseline [useRelay](../../app/src/useRelay.ts) uses operation generations to discard cancelled analysis, invalidates analysis when photos/history/corrections change, and guards delayed photo work with the active draft ID/capture serial. R01 and R08 exercise browser-visible portions of those protections.

The AppState handler closes the camera when leaving the active state; Android back handling is platform-gated. Browser tests cannot establish real iOS/Android camera lifecycle, system picker, background process termination, native filesystem cleanup or native keyboard behaviour. Those require actual devices.

The [session implementation](../../app/src/session.ts) serializes draft saves and records pending deletion cleanup. This pass verifies browser restore/deletion-related state only where described above; it does not claim native cleanup durability.

The baseline's external-consent toggle and asynchronous settings save did not invalidate their pending work. R09 and R11 turn those source concerns into reproducible user-visible failures rather than leaving them as speculative review comments.

## Reproduce and compare without overwriting evidence

From the isolated repository:

```powershell
node scripts/round-02/ui-run.mjs after-fix
node scripts/round-02/ui-report.mjs after-fix
```

The [runner](../../scripts/round-02/ui-run.mjs) refuses an existing result label, fingerprints the served HTML/JavaScript and relevant source before/after execution, records local service identity, and fails if the served bundle changed mid-run. It does not start/stop the shared services or install anything.

The [comparison script](../../scripts/round-02/ui-report.mjs) combines the two disjoint baseline sets and compares case titles against the named after-fix run. Missing after-fix cases remain explicit. Use a fresh label for another justified run; keep the initial failures.

The baseline commands used the Node CLI entry point because the Windows `.cmd` wrapper interpreted a grep expression containing pipe characters as shell syntax. That initial launcher failure executed no browser cases and is not counted as a product defect.

## Completion boundary

Required next evidence: refreshed static export; the same 22 cases executed against it; zero unresolved regressions in these contracts; direct review of the revised error and connection behaviour; an environment fingerprint showing a stable build. Production fixes belong to the implementation owner.

This stress pass neither certifies protective gear nor proves a complete accessible/native product. It adds measured recovery and state-integrity evidence, with seven specific defects for correction.
