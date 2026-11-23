# Relay design system
Working name; no trademark clearance claimed. See creative directions for alternatives and source-backed reasoning.

## Direction
An inspection desk, carried in a pocket: warm paper, clear ink, garment construction lines and quiet editorial typography. The original vector jacket teaches framing; it is an illustration, not a recognized specimen or a photograph. The monogram and illustration are authored in app/src/design.tsx.

## Tokens and implementation
| Role | Value | Use |
|---|---|---|
| Paper | #F4F1E9 | Main surface |
| Ink | #202822 | Primary text, selected disclosures |
| Secondary | #62695F | Explanations |
| Rule | #D4D5C9 | Separators and outlines |
| Wash | #E9E7DD | Contextual notes |
| Action | #B94E2B | Filled primary action; white text |
| Review / information / exclusion | #375747 / #7A5A19 / #8C3C35 | Explicit labeled states, never a safety grade |
| Display | Instrument Serif Regular | Main headings, 34–52 px, tight but readable lines |
| Interface | DM Sans Regular / Medium / SemiBold | Body16/24, secondary13/20, controls15/22 |
| Gutters | 24 logical units | Screen content; smaller controls follow a consistent rhythm |
| Targets | 48 minimum; primary56 | Touch and keyboard controls |
| Corners | 3–6 units | Precise surfaces; no arbitrary floating card decoration |

Calculated contrast and limitations are in design/creative-directions.md. Orange on paper is not used for normal-size text because it falls just below4.5:1. Color is always accompanied by words. Brand-specific fonts are bundled locally; only used weights are imported.

## Components and behavior
One primary action per stage. Disclosures have no default answer and offer an explicit unknown option. Capture has independently replaceable front/back/label slots and an optional detail slot. Progress counts actual photos; analysis text reflects the current operation, without an invented percentage. Results separate reason, next action and qualified limits. Corrections retain original observations.

The camera preview mounts only while the modal is open. Permission denial exposes photo import and settings recovery. App backgrounding closes the camera. Buttons have pressed/disabled states. Keyboard avoidance is enabled on iOS. Safe areas use react-native-safe-area-context.

## Motion and accessibility
A 180 ms content fade/translation is non-blocking and respects reduced-motion detection. Camera modal transition also respects that preference. Optional selection haptics must never block an action. Native accessibility roles/states and web ARIA checked-state props are provided. Screen-reader, large-font native and haptic quality remain device-validation tasks.

## Reviewed artifacts
output/playwright contains actual browser captures at320/390/430 widths and the core flow. Tests exercise keyboard focus, consent state, photo import, conservative real local inference, correction, recovery and deletion. These are engineering preview checks, not proof of iPhone/Android rendering or rider usability. The rendered-review document records independent findings and their resolution trail.
