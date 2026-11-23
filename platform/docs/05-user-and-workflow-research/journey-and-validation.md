# Rider journey, trust and validation plan

Version: 1.0 · Research/specification date: **2026-10-26 (UTC)**.

**Status:** proposed product behaviour and a reproducible validation protocol. No rider interviews, expert sessions, usability tests, VoiceOver/TalkBack sessions or physical-device trials are claimed in this document. Implementation and automated checks must be evidenced separately.

## The task and the people

The rider's job is: **“Help me understand whether this item is worth taking to an assessor, and what information they need.”** This is a working hypothesis from the brief, not a validated interview finding.

The assessor's job is: **“Show me an identifiable item, what its owner disclosed, what the photographs actually support, and what I still need to inspect.”** The eventual buyer has an interest in truthful records, but this preparation app is not a buyer marketplace.

Avoid invented demographic personas. Recruit across actual differences that may affect the task: familiarity with protective gear, ownership history, phone performance, accessibility needs and comfort taking photographs. No construction-industry habits are assumed.

### Evidence-informed design principles

Microsoft's Human-AI Interaction guidelines support explaining capability limits, making correction efficient, narrowing scope under uncertainty and making the system's reasons available. Their evaluation supports general design guidance, not a predicted conversion improvement in this product. [Amershi et al., CHI 2019](https://www.microsoft.com/en-us/research/wp-content/uploads/2019/01/Guidelines-for-Human-AI-Interaction-camera-ready.pdf)

An experiment with 199 participants found that interventions encouraging deliberation reduced overreliance compared with simple explanations, with a usability/subjective-rating trade-off. It did not test motorcycle gear. **Our inference:** ask for history before showing favourable machine observations, and make contradictory evidence salient. Do not add arbitrary delays or repeated confirmations to every action. [Buçinca, Malaya and Gajos, 2021](https://arxiv.org/abs/2102.09692)

Progressive disclosure, recognition over recall and reduced cognitive load are **design hypotheses here**: show an example view when asking for a photo; expose detailed inspection evidence when it helps a decision; keep the normal path short. We do not use Hick's law or Fitts's law to predict a numerical time saving. Larger targets and fewer simultaneously competing controls will be tested as concrete design choices.

## One connected assessment, not a long onboarding sequence

| Surface | Rider's immediate question | Intended interaction | Evidence or recovery requirement |
|---|---|---|---|
| **Home** | What will I get? | One main action: **Start an assessment**. A short promise: “A clear first look, ready for an expert.” Show that photographs cannot certify protection or establish unseen history. | No sign-up gate for the experiment. An optional example is visibly labelled as an example before entry and on its result. |
| **History** | Does the app need anything I already know? | Three independent rows: crash history; known damage in protective areas; repairs in protective areas. Each has **Yes / No / Not sure**, with no answer preselected. | Explain protective areas with an expert-approved diagram and text when available. Until then, qualify examples; never silently define the business's policy. |
| **Capture workbench** | What should I photograph next? | Front, back and label slots; one active capture task, a short instruction and an example silhouette. Existing photos remain visible and replaceable individually. | Keep the image-to-view link. Do not treat a filename or selected slot as proof that the correct view is pictured. |
| **Evidence and item details** | Did it understand my item? | Show proposed category, visible label text and any supported identity suggestion alongside their source photo. Permit correction or “Not sure.” | Preserve original model output, correction source and unresolved conflict. Do not turn a rider correction into expert verification. |
| **Result / inspection brief** | What happens now, and why? | Lead with the next action. Show the reasons, evidence limits and unresolved questions. The brief is useful to a human even when automated condition analysis is unavailable. | No safety score, certification badge, value estimate or simulated accepted offer. Show analysis unavailable separately. |
| **Settings / data control** | Where does analysis happen and how do I remove this? | Experimental service configuration, an explanation of processing, and **Forget assessment**. | State the actual deletion scope. Removing local data must not claim to erase a provider's records. Confirm destructive forgetting after explaining scope. |

The History surface can route a known exclusion directly to a clear result before any photo is required. The rider can still inspect the explanation and exit. Do not pressure them to continue or imply that a different photo might reverse a hard exclusion.

## Outcome language and state contract

These names align with the engineering direction. Visible copy may be refined after comprehension testing; identifiers are stable integration contracts.

| Policy state / operation | Rider-facing title | Explanation pattern | Primary next step |
|---|---|---|---|
| `not_eligible` | **Not eligible for an offer** | “You reported [specific history]. The challenge excludes offers for this history.” Use a policy reason, not a diagnosis. | Review the record or finish. A correction must preserve a positive disclosure for reconciliation; changing Yes to No cannot silently reopen offer consideration. |
| `more_information` | **A little more information is needed** | Name the missing disclosure or view. “Crash history is still unknown” does not mean a crash happened. | Answer the specific question or add/replace the specified evidence. If unavailable, leave it unresolved and show how a human could discuss it. |
| `human_inspection` | **An expert needs to take a closer look** | Name a suspected concern, contradictory evidence, unsupported category or the limit of category-only analysis. Distinguish suspicion from confirmed damage. | Review the inspection brief. Do not pretend an expert has received it unless a real handoff exists. |
| `ready_for_review` | **Ready for specialist review** | Required history is recorded, supported views are present and the current structured analysis raises no concern. This is a review-readiness decision, not evidence that the item is safe or an offer should be made. | Review/share the brief only through implemented, explicit actions. The business decides whether to proceed. |
| Processing status `unavailable` | **Photo analysis is unavailable** | State whether the cause is connection, service or invalid response. Do not display a successful policy result from an unsuccessful analysis. | Retry without losing captured material, review the collected record, or finish. Promise resume only if persistence is implemented and verified. |

A local image-category model does not assess protective condition; its most favourable route is `human_inspection`. A cloud observation alone cannot override disclosures or exclusion rules. No state is named “safe,” “certified,” “approved,” or “offer accepted.”

### Evidence wording

Use source-aware phrasing:

- **You told us:** “No crash history reported.”
- **Visible in photo:** “The label appears to read [text].”
- **Suggested identity:** “[Brand/model] may match the label.”
- **Needs a closer look:** “Possible abrasion near the right elbow.”
- **Still unknown:** “Internal condition and protective performance are not established by these photographs.”
- **Review decision:** “This record is ready for a specialist to consider.”

Do not transform “no visible concern detected in these photos” into “no damage.” Do not display fabricated percentages as confidence.

## Capture recipe and stop rule

**Initial hypothesis:** front, back and label are a minimum starting set for a jacket, followed by only a targeted detail when useful. This is not a validated sufficiency rule; the expert session and benchmark must determine coverage by category.

1. Ask the rider to lay or hang the garment so the whole requested side fits; use even light and avoid obstructing the label.
2. Before capture, explain one action. During capture, avoid paragraphs and tiny technical overlays.
3. After capture, show the actual photo with **Use photo** and **Retake**. If a supported quality check identifies a problem, state the problem and a fix.
4. Request a close-up by reason and area, e.g. “A closer view of this elbow seam may help the assessor.” Only place an evidence marker when an actual observation supports it.
5. Stop asking when another photo cannot resolve the uncertainty, or when the same ambiguity persists after a targeted retake. Keep the result unresolved for human inspection rather than collecting endless near-duplicates.

The provider examples support evaluating such a pattern, not assuming it works for garments. [Inspektlabs quality documentation](https://inspektlabs.com/photo-quality), [Stripe capture guidance](https://support.stripe.com/express/questions/best-practices-for-successful-id-verification?locale=en-GB)

**Copy must match implementation:** if blur detection is absent, show manual photography advice rather than “Blur detected.” A camera framing guide is guidance, not evidence that a protective area was analysed.

## Recovery is part of the normal path

| Situation | Required behaviour | What must not happen |
|---|---|---|
| Camera permission denied | Explain why camera access is useful; offer supported photo import or a settings route; preserve the assessment. | Repeated permission loops or a blank screen. |
| Camera granted but preview black | Offer retry/close/import and a readable failure message. Test separately from permission denial. | Treat a permission grant as proof of camera readiness. |
| User cancels camera/import | Return to the same slot and prior photographs. | Mark the slot complete or erase another image. |
| Wrong item or duplicate view | Identify the missing evidence and request the correct view. If identity consistency cannot be established, keep uncertainty. | Accept the slot name as image content. |
| Label unreadable or missing | Allow “Label unavailable”; keep exact model/size unknown and route conservatively. | Require invented text to continue. |
| Wrong recognition | Allow a factual edit or unknown value; retain original observation and correction provenance. | Re-run an expensive model merely to edit text, or use an edit to erase adverse evidence. |
| Connection lost / request timeout | Keep material already collected; distinguish waiting, retryable failure and completed analysis. | A fake successful result or repeated paid retries without a bound. |
| App backgrounded / process killed | Restore only what persistence actually guarantees; otherwise state that the draft was not saved. | Claim offline/resume support from an in-memory state alone. |
| Prior positive disclosure changed | Record the correction and preserve the unresolved prior positive for authorized reconciliation. | Let a tap turn excluded gear into a review-ready candidate. |
| Additional evidence changes result | Display the new reason and distinguish the new record/version from the prior result. | Quietly overwrite the earlier finding. |
| Exit / forget | Provide a clear exit; explain and confirm irreversible forgetting. | Pressure to finish, hidden retention, or an untrue server-deletion claim. |

The camera-failure branch is motivated by a direct report, not evidence of a Relay bug. [Airbnb user's support thread](https://community.withairbnb.com/t5/Support-with-your-bookings/Verification/td-p/2219098)

## Accessibility and mobile ergonomics acceptance specification

WCAG 2.2 supplies testable requirements for contrast, text resizing/reflow, focus visibility, error identification, redundant entry, status messages and target sizing. These are references for web preview and useful cross-platform design checks; they do not by themselves certify a native app. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

| Area | Proposed requirement / review method |
|---|---|
| Touch | Use at least 48 × 48 logical-unit hit areas for repeated controls and 56-high primary actions, with adequate separation. Android recommends 48 dp; Apple's published design tips describe 44-point controls. Confirm actual platform hit regions. [Android](https://support.google.com/accessibility/android/answer/7101858?hl=en), [Apple](https://developer.apple.com/design/tips/) |
| Type | Start with 17 logical-unit body text, readable line spacing and platform font scaling. Test enlarged text, long labels, long translated strings and smallest supported viewport. Do not truncate outcome reasons. |
| Contrast and meaning | Normal text target 4.5:1, large text 3:1; actionable boundaries and focus must remain distinguishable. Pair each status with a title/icon and explanation. Do not use colour alone. |
| Screen reader | Logical heading order; selected state on segmented answers; photo labels include view and presence; announce completion/error once. Decorative jacket art is hidden from accessibility. |
| Focus | Move focus to the new surface heading, the first actionable error or the result. Restore focus after dialogs. No keyboard or screen-reader traps. |
| Motion | Respect platform reduced-motion settings; replace large travel/scale with an immediate change or short fade. No mandatory timed flourish, scanning loop or flashing. [Apple reduced-motion evaluation guidance](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria) |
| Reach and handling | Keep frequent action near the bottom without covering content; use safe-area insets. Test left/right hand, a garment on a table, phone held above it, and a borrowed helper. Do not assume touchscreen operation in motorcycle gloves. |
| Camera accessibility | Explain view requirements textually; provide import/assisted capture where supported. A visual silhouette alone is insufficient. No automatic shutter essential to completion. |
| Environmental | Test sunlight, reflective leather, dark textile, visually busy backgrounds and indoor low light; do not claim quality from office screenshots alone. |
| Feedback | Haptics may confirm capture but must be optional and accompanied by visible/audible-accessible feedback. No meaning depends on sound or vibration alone. |

WCAG's 24 CSS-pixel AA target criterion has exceptions and is a minimum, not the proposed native touch target. [W3C explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Validation protocol: planned, not run

### V1 — expert definition session

Recruit at least two relevant assessors if possible; do not treat that small number as consensus. Before showing AI output, ask them independently to identify: accepted categories; facts required for triage; hard exclusions; protective-area boundaries; cases no photograph can resolve; appropriate minimum view sets; evidence required for offer consideration; reasons to decline for commercial rather than safety policy. Record disagreements. Obtain permission for any gear photographs and quote attribution. Organizer availability remains unknown.

### V2 — moderated rider workflow

Target 6–8 exploratory participants spanning novice/experienced gear knowledge, iOS/Android and at least one accessibility or dexterity consideration where ethically recruitable. This sample is for finding issues, not estimating population completion rates.

Tasks, in counterbalanced order:

1. Assess an item with known ownership history.
2. Deal with an unreadable label and a wrong brand suggestion.
3. Explain an unknown-history result in their own words.
4. Encounter a camera failure or simulated network timeout.
5. Identify whether “Ready for specialist review” means safe to wear or an accepted offer.
6. Change a history answer after a positive disclosure and explain why reconciliation is needed.
7. Find the original evidence and leave/forget the assessment.

Ask neutral questions: “What do you think happens next?” and “What can this result tell you?” Avoid asking whether the interface is trustworthy or easy before observing behaviour.

Capture task success, hesitation, wrong assumptions, assistance required, corrections, taps, photos, retakes and elapsed time. Separate think-aloud time from unmoderated task timing. Record OS, device, text scale, network and lighting. Obtain consent; use pseudonymous IDs.

### V3 — guided-photo experiment

Compare an unguided single photo with the proposed guided set using the same gear cases, counterbalanced condition order and blinded expert review. Record evidence coverage, identity accuracy, unresolved cases, false concerns, missed concerns, number of photos and time. Prevent the same expert's remembered answer from contaminating a later rating. Use the official dataset only under its supplied licence and evaluation rules.

The hypothesis is **guided evidence improves useful review quality enough to justify capture effort**. A larger photo count is not automatically better. Expert ground truth can itself be uncertain; preserve disagreement.

### V4 — trust-comprehension and exclusion gates

Before a public demo, every observed participant must be able to explain that the app cannot certify protection and that a specialist still decides. Treat any mistaken safety/offer interpretation as a release-blocking design defect, then retest the revised wording with fresh participants when possible. This is a qualitative gate, not proof that all future users will understand.

Required software scenarios include crashed gear, protective-area damage, protective-area repair, historical-positive edits, unknown history, unrelated images, malformed AI output, timeout, contradictory photos and category-only results. Automated safety tests belong to the engineering suite; passing them does not replace comprehension testing.

### Metrics and honest reporting

| Metric | Definition | Reporting rule |
|---|---|---|
| Safety exclusion violation | A known hard-excluded case reaches any offer recommendation or positive candidate state. | Target zero; report exact numerator/denominator and case list. |
| Review readiness | Experts judge whether the submitted packet is sufficient for the intended next triage step. | Report per category and reviewer; do not label it protective safety accuracy. |
| Clarification burden | Additional questions/photos an assessor requests after seeing the packet. | Compare matched cases and state sample size. |
| Task completion | Participant reaches the intended state without moderator intervention. | Separate blocked policy outcomes from usability failure. |
| Comprehension | Participant correctly states the outcome's scope and next actor. | Record verbatim response and coding criteria; do not substitute “trust” ratings. |
| Capture/analysis time | Capture begins to confirmed evidence; analysis submission to valid response. | Separate user, network and provider time; report medians/ranges and failures. |
| Retry cost | Additional processing caused by retakes, errors or retries. | Report actual calls and measured/estimated cost separately. |

**Current results:** none of the above human studies have been run. All numerical sample sizes and thresholds are plans or acceptance criteria, not findings.
