# Failure ledger · 2026-10-26
Only observed failures or direct code-path defects are recorded here.

| ID | Reproduction / cause | Repair | Regression evidence |
|---|---|---|---|
| F01 | Windows process creation rejected a single oversized source-write command | Split source into cohesive modules and bounded writes | Files written; strict typecheck/build |
| F02 | Expo 57 peers hoisted RN 0.88/React 19.3 while app required RN 0.86/React 19.2; rn-get-polyfills export failed | Explicit compatible root pins and dedupe | Native/web bundles and dependency resolution check |
| F03 | Consent checkbox changed visually but lacked web checked-state semantics | Explicit ARIA checked state alongside native accessibility state | Playwright check() and axe |
| F04 | Direct policy calls could give forged local metadata condition authority, or accept repeated photo hashes | Local-provider scope guard and duplicate evidence guard in policy itself | Added three policy regressions |
| F05 | Clearing cache during inference could allow a late result to repopulate it | Cache generation invalidation | API in-flight-clear regression |
| F06 | Broad attribute regex accepted Guaranteed protection / Buy now / Roadworthy / No injuries possible | Field-specific validator, provenance checks, narrow marking/material/size vocabulary; quote label text | Provider regressions; semantic certainty explicitly not claimed |
| F07 | A prepared photo from deleted draft A could attach to later draft B | Active assessment identity/capture generation; delete stale owned output | Lifecycle ownership review and session cleanup tests |
| F08 | External consent boolean survived provider/model changes | Bind approval to service URL/provider/model; server exact identity check before processing | Eight provider identity API cases |
| F09 | An old cancelled request could clear a newer controller; evidence change could accept stale analysis | Conditional controller cleanup, central cancellation and evidence-change invalidation | Focused lifecycle review; browser cancellation coverage |
| F10 | Cache reuse TTL did not delete idle cached data | Scheduled per-entry eviction and on-close clearing | Cache lifecycle tests/source review |
| F11 | Metadata removal before file deletion lost the cleanup record after partial failure | Persistent deletion tombstone, replay, narrow owned-file cleanup | Native-filesystem mocked session tests; device filesystem still unverified |
| F12 | Native AbortSignal polyfill lacks timeout/any used by initial client | Plain AbortController, timer and parent listener with cleanup | Installed polyfill inspected; typecheck; browser network tests |
| F13 | Result recovery sent missing label/front/back to generic Detail | Typed recovery action selects requested view | Recovery tests and rendered review |
| F14 | Camera fade ignored reduced motion; screenshots caught transitions | Respect reduced-motion preference; settled captures | Updated screenshots and browser tests |

## Recognition/quality failures that remain limits
Mixed scenes, partial crash panels and label-only controls expose recognition weaknesses. Model labels cannot verify the item or history. A severe synthetic blur may not cross the conservative soft-warning threshold; do not claim reliable blur detection from this heuristic. Representative quality labels and expert gear inspection are still needed. These limits route toward human review, not a fabricated positive result.

## Outstanding dependency issue
Two upstream Expo tooling advisories have no verified compatible resolution in the inspected release line. See [the dependency review](../15-testing-and-qa/dependency-review.md). No forced downgrade, untested major override or public deployment was used to hide the issue.
