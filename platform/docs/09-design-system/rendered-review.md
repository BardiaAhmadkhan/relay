# Rendered UX and visual review

Review date: **2026-10-26 (UTC)**. Scope: 11 supplied Playwright screenshots, the two saved axe reports, and targeted reading of the current screen/navigation source. No application code was changed by this reviewer.

**Assessment:** the settled screens form a coherent, readable experimental mobile interface. The entry, history, capture, evidence and exclusion states make their main action clear. Two concrete issues require correction or refreshed evidence before the screenshot package can support a complete visual sign-off. This review does not establish native readiness, user preference or overall accessibility conformance.

## Observed strengths

| Screens inspected | Observed result |
|---|---|
| Home, 320, 390, 430 | Serif headline, restrained sans-serif utility text and original jacket illustration give the app an identifiable character. The orange start action is prominent at all three widths. The narrower headline wraps without overlap. No visible horizontal overflow appears in these frames. |
| History | Three distinct questions, adjacent explanations and equally available “Not sure” choices make the disclosure task understandable. The instruction explicitly acknowledges the limits of photographs. No choice appears selected in this initial state. |
| Empty capture, filled capture | Front/back/label/detail organisation is visible; active view and capture status are distinguishable. Instructions refer to the current view. The filled screen offers retake/import and explicit processing consent. Synthetic fixture markings remain visible; these screenshots are not real-gear evaluation evidence. |
| Evidence | “Model inference · not verified,” “None reported” and “Not established” separate inference, rider history and protective performance. The local-model notice explicitly says condition, label and exact model were not assessed. Correction and revisiting photographs are available. |
| Result | Specialist review is the actual next step. The unknown category is presented as an inference, with a concrete instruction to bring the item and record to a person. Copying the brief is the primary action; this is not presented as an accepted offer. |
| Exclusion | The title, stated crash reason and instruction that photographs cannot clear that history reinforce the hard exclusion. The record can still be copied or revisited. The colour is supplementary to explicit wording. |

Spacing, rules, image treatment and action styling remain consistent across the settled frames. The technical labels are small, but the safety explanations and primary actions use larger readable text.

The 320-pixel Home disclaimer and the History action extend below their captured viewport. [App.tsx](../../app/App.tsx) places content in an internal ScrollView. These frames do **not** establish a clipping dead end; scrolling and all reachable content need their own interaction evidence.

## Priority findings

### P1 — a requested missing view opens the wrong capture slot

**Source-confirmed; not exercised by the supplied result screenshot.**

In [Result](../../app/src/screens-review.tsx), recovery distinguishes unknown history from all other cases. Every remaining result uses “Add a closer photograph” and selects `detail`.

The policy can specifically request a clearer front, back or label view through `vision_missing_*` reasons. For those results, the button sends the rider to Detail rather than replacing the requested view. The rider can navigate manually, but the suggested next action can leave the original evidence gap unresolved.

**Required narrow correction:** derive the recovery label and selected slot from the actual missing-view reason. Preserve Detail for a concern that needs a close-up. Add a regression for an unreadable/missing label request. Do not change the policy threshold or make additional photographs imply safety.

### P2 — camera and settings captures are transitional, and modal motion ignores the explicit reduction preference

Camera permission shows a partially transparent modal over Capture. Settings still shows the camera modal over Settings. Neither image is adequate evidence of the final settled surface.

[App.tsx](../../app/App.tsx) hard-codes the camera Modal to a fade. [The browser test](../../tests/mobile.spec.ts) captures immediately after visibility and immediately after closing the camera. This supports a transition-capture explanation; it does **not** prove a permanent transparency or blocked-navigation defect. The explicit modal fade also remains present despite the reduced-motion capture setting.

**Required narrow correction:** honour reduced motion for the camera modal and wait for a settled open/closed state before capture. Replace both screenshots, then inspect the actual camera-denied controls and unobstructed Settings screen. Do not record the existing overlaid frames as approved final UI.

## Verification and limits

The saved Home axe report and Result axe report each contain **zero listed violations**. Those reports cover their captured browser states; they do not validate all screens, text enlargement, screen-reader use or native semantics.

The implementer reports three passing browser tests covering local inference with synthetic inputs, keyboard access, draft restoration and deletion. Those tests were not rerun as part of this visual pass. No real-camera capture, physical iPhone/Android runtime, VoiceOver/TalkBack session or rider comprehension study was performed by this reviewer.

The current frames support the visual coherence of the experimental baseline. They do not support claims of protective-condition accuracy, a connected expert service, measured usability improvement or perfection. The two findings above should be resolved and recorded against refreshed evidence.


## Resolution checkpoint · 2026-10-26
The review above records the initial defects. Its image links now point to refreshed captures.
- P1 resolved: packages/core/recovery.ts chooses the exact requested/missing/low-quality view; six regression tests pass. Unknown history returns to history; suspected concerns may request Detail.
- P2 resolved: the camera modal now respects reduced motion. Fresh exported-build camera-permission and settings images were inspected after transitions settled. The controls are legible and settings are unobstructed.
- Five browser tests now pass, including provider/model consent renewal and cancellation. The final end-to-end flow also checks for browser console errors. Native-device and human-study limitations remain unchanged.
