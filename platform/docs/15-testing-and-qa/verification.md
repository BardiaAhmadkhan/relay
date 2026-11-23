# Verification - rounds 03-04

Historical checkpoint. The [194-image quality audit](quality-audit-01.md) records later failures on the unchanged system. The [latest focused inspection change](round-05-low-detail-abrasion.md) adds its own evidence without replacing these original records.

Date: 2026-10-26. This checkpoint supersedes the initial category-only experiment. Machine-readable record binds source hashes, bundles and the Android package.

## Executed checks

- 360/360 unit/integration tests passed. Coverage includes policy, schemas, provider contracts, image boundaries, cache identity, cancellation, native-compatible AbortSignal handling, notebook retention and old-policy draft migration.
- Strict TypeScript checking and Prettier checks passed. Documentation links and 17 frozen experiment hashes passed. Legacy adapters: 14/14 real pinned-model checks.
- 30 browser scenarios passed: 22 recovery/trust scenarios, five original mobile scenarios, three real user-photo flows. The final real-photo flow includes saved-photo retention, removal/Undo and resetting the next item from a prior detail view to front. Original five-case results were observed in the runner console; the other suites have their actual JSON reports linked in the machine-readable record.
- Tested mobile widths 320, 390 and 430; keyboard, reduced-motion, camera-denial recovery and doubled text. Automated checks reported no serious/critical accessibility violations on the tested real-result screens. These checks do not replace screen-reader or user testing.
- iOS, Android and web bundles exported. Android release APK built for arm64-v8a and x86_64. Local artifact: artifacts/relay-round04-android.apk, 62,322,031 bytes; hash in its JSON sidecar. Android lint passed after network configuration correction. Camera is present; microphone and overlay permissions are absent. This is a local experimental package, not a store release.
- Actual Android API36 emulator: first-use camera permission/capture, native picker/import, process/draft recovery, real local damage analysis, unusable-photo recovery, removal/Undo, share-sheet launch/dismissal, save-next-item and saved-photo survival after restart. Native findings were read back and source thumbnails visually checked. Nothing was sent through the share sheet.
- The separate no-network native research application executed the shared encoder plus routing head. FP16-storage parity and emulator timing are documented in the experiment report; this does not establish phone damage recognition.
- All 20 visual-review images loaded; no horizontal overflow in the inspected gallery. Before images are preserved baseline screenshots; matching viewport comparisons and separate live-photo/native examples are explicitly labelled.

## Live local evidence

The three original supplied photographs produced crash-like material findings and blocked offers through the real browser application. The normal API on 127.0.0.1:8787 now reports local_vlm, pinned qwen3.5:4b/photo-evidence-2 and policy 2026-10-26.2; a fresh real-photo smoke test passed on that default endpoint. The app is available at http://localhost:4173 and the local visual review at http://127.0.0.1:4184.

Repeated unchanged pixels were reused after ID/history edits: one measured 5.16-second fresh call became 58 ms with zero model tokens. The source-described small detail varied across calls; reduced-resolution failures remain recorded. No favorable outcome follows a model failure, empty result or reported historical exclusion.

## Material limits

Browser tests are not native tests; an emulator is not a physical phone. No physical Android/iPhone runtime, native screen reader, real camera optics, network roaming, thermal/power profile or long-duration business trial is verified. Windows cannot establish an iOS application runtime result merely by exporting its bundle.

The reference model still has ordinary-wear false alarms, anatomical errors and reduced-resolution instability. The 52 stress-test rows are dependent variants of 13 development cases. No representative accuracy, accident-history proof or protective-performance certification is claimed. The routing research is inactive, and trained damage/logo/extent specialists are not implemented.

Notebook storage is device-local with a 50-record cap; sharing exports the text brief. A business-grade inventory, backup/export policy, authentication/multi-user deployment and independent expert labels remain future acceptance requirements. The previous dependency review records two upstream Expo tooling advisories without a verified compatible fix. No public release or competition reuse approval is asserted.

See [experiment decisions](evolution-rounds-03-04.md), [architecture](../08-architecture/small-specialists.md) and [runbook](../10-implementation/runbook.md).
