# Creative directions and design specification

Decision date: **2026-10-26 (UTC)**. Working identity: **Relay**. This is an original design proposal, with calculated colour checks and explicit validation gates. It is not a completed native-device visual audit or a claim that riders prefer the selected direction.

## Design purpose and references

The app should make a used garment feel worth examining carefully. It should communicate **attention, precision and an accountable handoff** without implying certification.

Three public reference principles informed the exploration:

- Vitsœ's presentation of Dieter Rams's principles links usefulness, understandability, restraint and honesty. We borrow those principles, not its furniture imagery, wordmark or layout. [Vitsœ](https://www.vitsoe.com/us/about/good-design)
- AETHER describes its Mulholland motorcycle jacket in terms of understated technical function and everyday design. This supports exploring motorcycle culture beyond racing graphics; it does not prove an interface preference or validate its protection claims. [AETHER](https://aetherapparel.com/mulholland-moto-jacket)
- Apple's interface guidance emphasizes adequate controls, readable information and consistent presentation. Those practical constraints apply regardless of art direction. [Apple design tips](https://developer.apple.com/design/tips/)

These are documented philosophies, not a pixel-by-pixel audit of the companies' current mobile experiences. No competitor artwork or private Tiercord component is reused.

## Three genuinely different directions

| Dimension | A — **Relay / the inspection desk** | B — **Aperture / the field instrument** | C — **Second Edition / the garment archive** |
|---|---|---|---|
| Core idea | A carefully assembled inspection sheet that moves from rider to expert. | A precise optical instrument helping someone gather evidence in the field. | Each object has an identity and history worth preserving before its next chapter. |
| Composition | Warm paper, ink rules, left-aligned hierarchy, orderly evidence rows and generous empty space. | Dark mineral surfaces, full-frame photographs, functional edge brackets and a strong bottom control dock. | Chalk canvas, generous photographs, editorial spreads, restrained serif headlines and clear sans-serif utility text. |
| Palette | Paper, deep green-black ink and a sparing burnt-orange action. | Graphite, pale grey and a cool citron action; never a neon “safe” verdict. | Bone, dark aubergine and mineral blue; warm material colour comes from the garment. |
| Type | Large confident grotesque headings; readable system sans; monospace only for short view/record metadata. | Compact technical sans; tabular numbers where measurement exists; no invented telemetry. | Contemporary serif for entry/result narrative; sans-serif for instructions, fields and evidence. |
| Graphic language | Original flat jacket construction drawing, useful region labels, fine separators, a small handoff-inspired mark. | Real camera preview, small orientation cues, measured alignment, optional minimal instrument iconography. | Garment portraits, quiet captions, an archival folio structure; original illustration for empty states. |
| Interaction | Captured image becomes a thumbnail in the evidence sheet; result resolves into a brief. | Camera takes centre stage; guidance responds rapidly; evidence expands from a bottom rail. | An item cover opens into its evidence; subdued page continuity without a literal page-flip effect. |
| Main strength — design judgement | Connects evidence provenance, human review and a calm premium character with modest implementation complexity. | Excellent focus during capture and a clear technical personality. | Gives reuse emotional resonance and suits textile/material storytelling. |
| Main risk — hypothesis to test | Paperwork cues could feel bureaucratic; small technical labels could become precious or unreadable. | Dark composition can imply a more powerful scanner than exists, make garment boundaries hard to see and feel like a familiar racing/tool aesthetic. | Narrative might overpromise a second life, slow the task or make a transactional intake feel like shopping. |
| Implementation cost | One light surface system, simple vector art and restrained transitions. | Additional dark-surface, live-preview and overlay testing; more varied contrast situations. | More editorial typography/photography tuning and careful compression at small sizes. |
| Best use | The complete rider-to-assessor journey. | A later focused capture mode if evidence shows it improves capture. | Editorial storytelling outside the critical capture path, if permitted and useful. |

## Selected direction: Relay / the inspection desk

Select **A** for the preparation baseline. This is a reasoned design choice, not an empirical winner. It maps cleanly to the actual product: collect evidence, distinguish its source and hand it to a person. It is visually distinct from a generic dashboard and can be built without elaborate effects or unlicensed assets.

Keep the strongest useful idea from B: a generous, unobstructed photo area with legible capture controls. Keep C's respect for the garment, expressed through actual imagery and careful language. Do not combine all three into a stylistically inconsistent interface.

**Working line:** “A second life, considered.” Place it on the entry surface, not as a congratulatory result on excluded gear. The core explanation must remain plainly functional.

### Original identity

- Wordmark: **RELAY**, typeset with deliberate spacing and a compact visual footprint.
- Optional mark: two offset angular strokes suggesting a handoff or folded tag. No shield, check seal, certification roundel or recycling guarantee.
- Hero art: an original vector jacket with credible seams and construction, not a copied branded product. Keep safety-region guidance separate and expert-reviewed; decorative seams do not establish anatomy.
- Photography: user-provided gear shown without cosmetic enhancement. Never replace worn areas with generated textures or a polished marketing image.
- Use “record,” “photos,” “history,” “review” and “next step” in ordinary copy. Keep provider names and technical service configuration in the appropriate experimental settings/evidence context.

The working name has not been trademark-screened. No claim of ownership exclusivity is made.

## Reference tokens

These tokens are an implementable reference, not an assertion that every rendered screen already uses them. The final design audit must compare actual component tokens and screenshots, then reconcile any intentional differences.

### Colour

| Token | Hex | Intended use |
|---|---|---|
| Paper | `#F4F1E9` | Main background. |
| Sheet | `#FFFEFA` | Photo/review sheet or dialog where separation is needed. |
| Ink | `#202822` | Main text, headings, primary outlines. |
| Secondary ink | `#62695F` | Supporting text on Paper. |
| Action | `#B94E2B` | Filled primary action and sparing illustration detail. |
| Action text | `#FFFFFF` | Text on Action. |
| Review ink / tint | `#374A3C` / `#E8EDE6` | Neutral specialist-review context; always labelled, never “safe.” |
| Attention ink / tint | `#79552A` / `#F5EBDD` | Missing information and unresolved questions. |
| Exclusion ink / tint | `#8D342A` / `#F9E8E1` | Policy exclusion or destructive confirmation. |
| Quiet line | `#ACB1A7` | Decorative separation only; insufficient as the sole actionable boundary on Paper. |

Calculated sRGB contrast on 2026-10-26: Ink/Paper **13.40:1**; Secondary/Paper **5.02:1**; white/Action **5.01:1**; Review pair **8.01:1**; Attention pair **5.66:1**; Exclusion pair **6.65:1**. **Action/Paper is 4.44:1**, so this orange must not be normal-sized text on Paper. Quiet line/Paper is **1.94:1**; use a stronger boundary for essential control affordances.

These calculations use linearized sRGB luminance and `(Llighter + 0.05) / (Ldarker + 0.05)`. They validate only the specified opaque pairs, not images, overlays, disabled states, font rendering or overall accessibility. [Contrast requirements](https://www.w3.org/TR/WCAG22/#contrast-minimum)

### Type and spacing

| Role | Starting specification |
|---|---|
| Entry headline | 42–48 logical units, tight but unclipped line-height, 2–3 intentional lines; adapt to small screens and larger text. |
| Surface heading | 28–32, semibold, left aligned. |
| Result heading | 30–34; enough width for “specialist review” without awkward single-word lines. |
| Body/instructions | 17, approximately 1.45 line-height; no forced uppercase. |
| Supporting text | 14–15; no low-contrast legal-looking caveat below the primary result. |
| Metadata | 12–13 monospaced only where a view number, time or record ID is meaningful; never the sole size for safety information. |
| Rhythm | 4-unit base; working increments 4, 8, 12, 16, 24, 32, 48. |
| Page gutter | 20–24 on ordinary phones; permit 16–20 on narrow layouts after testing. |
| Tap targets | Minimum shared target 48 × 48, primary button height 56. Larger targets for repeated capture use. |
| Corners | 4–8 for evidence surfaces, 10–12 for controls, restrained rounded dialogs; avoid pill-shaped containers everywhere. |
| Lines/elevation | Fine rules organize the page; shadows only when a real layer overlaps another. No permanent glowing border. |

Use platform system fonts initially to keep the experiment reproducible. A licensed custom face can be evaluated later only if it improves actual rendering and does not compromise scaling or load behaviour. Do not copy proprietary type assets from another repository.

## Component and screen craft

### Home

Use one focal illustration, a clear sentence about the outcome and one obvious start action. A small optional example link is secondary and labelled. Keep explanatory constraints visible in normal text, not a hidden disclaimer. No fake activity feed, popularity counter or unsupported completion-time promise.

### History

Use three clear questions with independent segmented answers. Selected state combines a visible outline/fill and an accessibility selected state. “Not sure” remains equally available; no guilt framing or implied penalty. If three segments become cramped at large text, stack choices rather than truncate them.

### Capture workbench

A large active view sits above a compact evidence rail/list. Show front, back and label with actual completion state. A missing label uses an explicit unknown state. The garment stays fully visible in overview photographs; detail photographs can zoom to the area. Preserve the original for review.

An outline guide may suggest composition. It must never pretend to have detected the jacket. A concern marker requires a real source observation. No animated scanning line is used to imply a capability that is absent.

### Evidence and corrections

Place source and uncertainty close to each fact. The user can open the relevant photograph and correct identity without losing the observation. Editable fields look editable. A row cannot become an enormous card simply because it has a label.

### Result and inspection brief

Lead with the next action, followed by why and what remains unknown. Show a short evidence summary with optional detail. Use the same item image so the record feels continuous. A review-ready state receives a calm completed layout, not confetti or a shield. Exclusion remains respectful and specific.

### Empty, waiting and error states

- Empty: show the missing evidence task and an example outline; do not show placeholder “AI insights.”
- Waiting: describe the real stage; use indeterminate progress if no percentage exists.
- Failure: explain what failed and provide a concrete action while retaining the record where supported.
- Disabled: show why an action is unavailable; avoid communicating that explanation through grey colour alone.
- Completion: signal that this step is complete; do not conflate it with business acceptance.

## Motion and haptics

Proposed timing ranges are craft defaults, not performance measurements: 120–160 ms press/selection feedback, 180–240 ms surface transitions and 160–220 ms thumbnail continuity. Never add a blocking animation if the next screen is ready.

A photo may reduce into its actual thumbnail after the user accepts it. The layout may resolve from evidence to result without a dramatic “reveal.” No spinner should imply continued work after a request has failed.

Reduced motion removes travel/scale and repetitive effects; a brief fade or immediate update preserves comprehension. Haptic capture feedback is optional and never the only signal. [Apple reduced-motion guidance](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)

## How this direction will be evaluated

**Visual review gate:** matched screenshots at a narrow phone, ordinary phone, large phone and large text for Home, History, Capture, Evidence and all result states. Inspect real content, long labels, empty states and errors. A desktop browser viewport is useful for layout checks but does not prove native camera or platform typography.

**Interaction gate:** review keyboard obstruction, safe areas, focus, scrolling, bottom actions, camera cancellation, returning from settings and provider failure. Verify reduced-motion and screen-reader behaviour on devices.

**Audience gate:** show equal-fidelity direction sketches in counterbalanced order to riders and assessors; ask what the app appears able to do, which action they would take and which elements mislead them. Preference alone is secondary to correct understanding and task success.

**Craft checklist:**

- Alignment follows a consistent grid; icons and text are optically balanced.
- Headings wrap intentionally at all reviewed widths.
- No status becomes identifiable only by colour.
- No text gets smaller merely to preserve a screenshot composition.
- Photo crops do not conceal evidence.
- The largest element on each task surface supports the task.
- Original art, third-party rights and font licences are traceable.
- No screen suggests a safety certification or completed expert review.

**Current evidence:** reference palette contrast was calculated. Device screenshots, participant comparison and accessibility results must be recorded by their actual test owner before the design is called validated.
