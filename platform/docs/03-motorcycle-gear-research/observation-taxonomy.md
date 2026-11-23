# Observation taxonomy for motorcycle protective equipment

Version: research taxonomy 0.1, 2026-10-26. Purpose: define what a visual intake system may record, what it must leave unknown, and which findings affect routing. This is not a protective-performance standard, a physical-inspection certification method or a replacement for item-specific manufacturer instructions.

## Evidence boundary

A model output is an observation candidate until validated against the image and schema. A readable label is evidence of visible text. It is not proof of authenticity, original configuration, current material strength, remaining service life or accident history.

The underlying equipment properties are measured through physical tests. SATRA describes garment tests covering abrasion, seams/closures, tearing and fit; the EN 1621 series concerns specific protectors and impact tests. Their methods do not establish a method to certify a used garment from photographs. The latter conclusion is an inference from the test scopes, consistent with the supplied challenge's express restriction. [SATRA EN 17092](https://www.satra.com/ppe/EN17092.php), [SATRA EN 1621](https://www.satra.com/ppe/EN1621.php)

Do not output a "safe percentage," an abrasion lifetime, a maximum safe crash speed, or an overall safety score. Sharp images are a prerequisite for useful observation, not a performance test.

## Equipment scope and extensions

| Category | Candidate visible information | Additional specialist concerns | Initial policy recommendation |
| --- | --- | --- | --- |
| Jacket | Shell, panels, sleeves, seams, main/cuff closures, labels, visible inserts and pockets | Hidden layers, insert configuration, fit, crash/repair history | Supported first if the implementation and evaluation genuinely cover it |
| Trousers/jeans | Knees, seat, hips, closures, hems, labels and accessible inserts | Garment type cannot be established from denim appearance alone | Separate capture template before support |
| One/two-piece suit | Whole ensemble, joining system, panels and labels | Components must belong to the same suit; coverage is larger | Separate schema and capture coverage |
| Gloves | Both gloves, palm/back, fingertips, cuffs and labels | Small seams and paired-item identity | Separate category rules and benchmark |
| Boots | Both boots, soles, uppers, closures and labels | Flexibility, fastening function, hidden delamination | Physical inspection required |
| Standalone protector | Component shape, coverage marking, labels and visible damage | Intended body area, compatibility, impact history | Component-level record; no garment inference |
| Helmet | Shell/strap/label observations only | Internal damage and history cannot be resolved by outer appearance | Unsupported for offer screening pending explicit organizer policy |
| Airbag system | Brand/model markings and external condition only | Activation history, service status, electronics and manufacturer procedures | Specialist route; no disassembly or activation instructions |
| Casual/rain clothing or unknown | Describe visible item without protective claims | Motorcycle styling does not establish PPE | Clarify scope; never silently treat as a protective jacket |

Gloves and footwear have different standards from garments; SATRA identifies EN 13594:2015 for gloves and EN 13634:2017 for footwear. Airbag standards also have a specific scope: do not apply one generic protector policy to every airbag design. [SATRA motorcycle PPE overview](https://www.satra.com/spotlight/article.php?id=483)

SHARP advises against second-hand helmets and describes how damage after a fall may be externally invisible. This supports a conservative unsupported/specialist state; it is UK guidance, not a newly invented challenge rule. [SHARP buying guidance](https://sharp.dft.gov.uk/frequently-asked-questions/buying-a-new-helmet/), [SHARP replacement guidance](https://sharp.dft.gov.uk/frequently-asked-questions/when-to-replace-a-motorbike-helmet/)

## Markings: retain exact text and scope

| Visible reference | Interpretation permitted for an observation record |
| --- | --- |
| EN 17092-1 | Garment test-method reference; not a standalone performance class |
| EN 17092-2 / AAA | Printed garment class AAA |
| EN 17092-3 / AA | Printed garment class AA |
| EN 17092-4 / A | Printed garment class A |
| EN 17092-5 / B | Printed class B; same abrasion requirements as A without included impact protectors |
| EN 17092-6 / C | Printed class C; protector-holding ensemble, with no minimum abrasion protection |
| EN 1621-1 | Limb-joint protector reference |
| EN 1621-2 | Back-protector reference |
| EN 1621-3 | Chest-protector reference |
| Level 1 / Level 2 on a protector | Protector performance-level marking, distinct from a garment class |
| CE / UKCA | Observed conformity marking; no app authentication |
| T+ / T- on a protector | Record exact optional temperature-test marking if legible; do not infer it from colour or shape |
| prEN / FprEN or an unfamiliar edition | Retain literal draft/edition text; do not silently normalize to a current certificate |

Class mapping is supported by [SATRA EN 17092](https://www.satra.com/ppe/EN17092.php). Protector family distinctions come from [SATRA EN 1621](https://www.satra.com/ppe/EN1621.php). The [Alpinestars limb-protector manual, 2024, Product Marking section](https://cdn.shopify.com/s/files/1/0649/5430/2690/files/Limbs_Protection_CE_Reg425_EN_1621-1_2012_v1.0_p2024_MOTO.pdf?v=1749482797) illustrates body-area, type, level and optional hot/cold markings. These pages are explanatory sources, not a licensed reproduction of all normative clauses. Check the applicable standard edition and product documentation before implementing any compliance-specific claim.

A class/part mismatch is a transcription or documentation concern, not automatic proof of counterfeit gear. A readable label missing from a photo is not the same as a label missing from the garment. An inserted Level 2 pad does not reclassify a jacket as AAA. An EN 1621 label on one insert says nothing about whether the other inserts are present.

## Proposed construction vocabulary

Use these as descriptive categories, with `unknown` supported. They are not a ranked safety scale.

- **Leather-like shell:** visual appearance only until composition is documented. Do not identify animal species, leather grade or thickness from an ordinary phone photo.
- **Textile shell:** visible woven material; fibre chemistry and reinforcement remain unknown unless a readable label or reliable model document supports them.
- **Mesh panels:** record location and coverage; do not infer weakness solely from open texture.
- **Hybrid construction:** multiple visible panel types; record each region rather than declaring the whole garment one material.
- **Reinforced-looking panel:** appearance of an overlay is observable; the material specification and whether it is original are unresolved.
- **Removable thermal/waterproof liner:** record the owner's statement or visible component separately from a protective insert.
- **Protector pocket/insert:** distinguish pocket visible, insert visible, insert reported, not shown, and confirmed missing.

Manufacturer care instructions vary by construction. The [Alpinestars maintenance guide](https://www.alpinestars.com/blogs/blog-post/motorcycle-jacket-maintenance) distinguishes textile, leather, mixed materials and airbag handling, and recommends checking seams, closures and pockets. It does not justify a universal cleaning, repair or resale rule.

## Proposed visual findings and next actions

This vocabulary is an engineering abstraction based on the cited domain evidence. The exact boundary of "protective area" requires organizer and expert confirmation.

| Finding code | What may be recorded | What must not be inferred | Default routing when unresolved |
| --- | --- | --- | --- |
| surface_discontinuity | A local hole, tear-like opening or missing surface is visible | Depth, cause, tested strength remaining | Inspection; if protective damage is reported/established, exclusion |
| abrasion_like_change | Local roughness, loss of finish or scuff-like feature | That a crash certainly happened; that a faint mark is harmless | Context view and inspection if potentially protective |
| seam_irregularity | Separated edge, loose/broken-looking stitches, changed stitch pattern | Seam tensile strength or original construction | Inspection |
| possible_patch_or_repair | Added-looking panel, adhesive trace, stitch pattern mismatch | Whether it is original, cosmetic or structural | Ask history and inspect |
| closure_concern | Visible missing/bent tooth, incomplete closure or displaced fastening | Functional holding force or ability to stay shut | Inspection |
| protector_surface_concern | Visible cracking, chipping, deformation or separation | Internal impact capacity | Inspection; confirmed protective damage excludes |
| component_not_shown | Required evidence view absent | Component is missing | Request view or owner clarification |
| component_reported_missing | Owner reports a missing insert/liner | Which configuration the manufacturer requires | Human configuration review; no automatic acceptance |
| material_deterioration_concern | Visible peeling, cracks, flaking or discolouration | Cause, chemistry, mould species or safe service life | Inspection and manufacturer guidance |
| label_unreadable | Label present but text not reliably readable | Best-guess brand/model/class as fact | Retake or record unresolved |
| identity_conflict | Images/labels appear inconsistent | Dishonesty or ownership fraud | Human review; never accuse |
| no_concern_observed | No specific concern identified in the shown area | Damage absent throughout the item | Preserve coverage and inspection limitations |

Alpinestars' protector instructions identify cracking, chipping, degradation and delamination as replacement concerns and distinguish severe impacts from lesser impacts requiring dealer review. The same source gives manufacturer-specific service-life advice; it is not a universal age cutoff for all gear. [Limb-protector manual, 2024, Maintenance section](https://cdn.shopify.com/s/files/1/0649/5430/2690/files/Limbs_Protection_CE_Reg425_EN_1621-1_2012_v1.0_p2024_MOTO.pdf?v=1749482797)

## Protective areas and location

Use human-readable anatomical and structural locations: left/right shoulder, elbow/forearm, upper/lower back, chest, sleeve, main seam, main closure, cuff restraint, protector pocket; extend appropriately for trousers and other categories. Resolve left/right relative to the wearer's body, and state this in annotation tools. A folded sleeve can make location ambiguous; permit `location_unknown`.

High-exposure locations deserve focused capture, but there is no blanket "cosmetic-only safe zone." Damage to a structural closure or seam may matter even away from a prominent impact area. NSW road-safety guidance specifically identifies coverage, impact protectors, seam construction, secured fasteners and fit as relevant garment attributes. [NSW riding-gear guidance](https://www.nsw.gov.au/driving-boating-and-transport/roads-safety-and-rules/motorcycles-and-scooters/motorcyclist-riding-gear)

Do not copy the numbered zones from one standard into another. A 2014 study examined four EN 13595 zones in 117 crashed riders; it was not a validation of EN 17092's zone definitions or a photograph-only resale rule. The newer garment manual describes three risk-category zones. These are related domain concepts with different definitions. [de Rome et al., 2014](https://pubmed.ncbi.nlm.nih.gov/25142364/), [Alpinestars garment manual, Risk Category Zoning section](https://cdn.shopify.com/s/files/1/0649/5430/2690/files/GARMENT_EN17092_EN1621-1_Moto_App.v1.2_p2024_G501744_XWEB.pdf?v=1749133128)

For the experimental screen, any potentially structural finding with an uncertain location should route for review rather than being classified outside a protective area.

## Nonvisual and physical-verification fields

| Property | Permissible initial source | Why photos do not resolve it |
| --- | --- | --- |
| Crash history | Owner declaration, known records, expert-established facts | A crash can leave no visible surface evidence in the supplied views |
| Repair/alteration history | Owner declaration, manufacturer records, expert examination | Original details and skilled repairs can resemble one another |
| Date of first use and storage | Owner/records, explicitly qualified | Style and model appearance do not establish usage |
| Original configuration | Exact model instructions and component inspection | Similar shells may ship with different inserts and liners |
| Residual seam/material strength | Appropriate physical/laboratory assessment | Appearance is not a load/abrasion measurement |
| Fit and protector retention | Appropriate physical fitting and assessment | Label size alone cannot show retention on a particular wearer |
| Authenticity/recall applicability | Traceable item identity and authoritative records | A recognizable logo is insufficient |
| Odour, dampness and contamination | Owner statement and appropriate in-person assessment | Colour in a photo is ambiguous |
| Airbag service/activation state | Manufacturer-compatible records and specialist inspection | Exterior appearance and a power indicator are insufficient |

For Alpinestars garments, care, wear, environment and accidents influence life, and its 2024 manual recommends a five-year replacement interval from first use. Record this only as manufacturer guidance tied to the relevant product/manual; do not implement "all jackets older than five years fail" or "under five years passes." [Official garment manual, Lifespan section](https://cdn.shopify.com/s/files/1/0649/5430/2690/files/GARMENT_EN17092_EN1621-1_Moto_App.v1.2_p2024_G501744_XWEB.pdf?v=1749133128)

## Evidence record requirements

The implementation's versioned schema is authoritative; the following are semantic requirements, not a second competing schema.

Each observation needs an ID; source type; image IDs; category; visible description; location or unknown; evidence strength as a non-probabilistic label; unresolved questions; and the requested follow-up. Record provider/model/prompt/schema versions at run level, plus image transformation provenance. If a model supplies a bounding box, validate bounds and label it approximate unless independently verified.

Keep these source types separate:

| Source type | Example | Rendering rule |
| --- | --- | --- |
| owner_statement | "I do not know whether the previous owner crashed it." | Never paraphrase as "no crash" |
| image_observation | "Light-coloured irregular line near left elbow." | Tie it to a specific view |
| model_inference | "Possible repair." | Use conditional wording |
| document_reference | Matched manufacturer manual | Preserve model/version-match uncertainty |
| human_finding | Assessor records a protective seam repair | Require actual authorized review and rationale |
| policy_result | Hard exclusion due to that repair | Rule ID and reason, independent of model prose |

Confidence supplied by a model is uncalibrated unless a calibration experiment proves otherwise. Prefer "clear," "uncertain," or "not readable" with evidence over invented percentages. Even a calibrated observation probability would not become a probability that the item is safe.

## Annotation and evaluation protocol

Use consented owned gear or licensed event data. Expert annotators should see each image and the exact task. Label visible findings separately from full-item truth and owner history. Hidden defects discovered in person belong to a distinct physical-ground-truth layer. An image assessor who could not observe a hidden defect should not be scored as having visually confirmed its absence.

Measure at least: category accuracy; exact label-text agreement; missing-view handling; concern recall by location and type; false concern rate; escalation rate; and hard-exclusion leakage. Report garment-level splits so multiple images of one jacket do not leak between development and held-out evaluation. Track dark/light materials, mesh, wrinkles, reflections, patches, labels, backgrounds, budget devices and worn gear.

Counterexamples to include: decorative quilting versus repair; reflective panel versus abrasion; intentional perforation versus hole; original overlay versus patch; empty pocket versus hidden insert; fashionable leather jacket versus protective garment; polished exterior with reported crash; sharp complete photos with unknown history. Annotation disagreements should remain visible and be adjudicated by an expert rather than forced into false certainty.

The taxonomy is ready to guide implementation and annotation; its completeness and real-world recognition accuracy remain unverified until expert review and a representative image/gear evaluation occur.
