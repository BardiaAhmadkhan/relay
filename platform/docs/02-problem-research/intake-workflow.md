# Used-gear intake: evidence, workflow and decision ownership

Research checkpoint: 2026-10-26. This is an experimental service design informed by public primary sources and the supplied challenge. It is not a description of Moto Reloaded's private purchasing process. No retailer or rider interview, field observation, physical inspection or time-and-motion study has been conducted for this project.

## The practical problem

The useful unit of work is a reviewable intake case: one item, its components, what its owner knows, the photographs that support observations, and the unanswered questions. Recognizing a brand is helpful only if it reduces work without turning a resemblance into a purchase decision.

There is a safety reason to preserve that distinction. A 212-rider observational study found associations between protective clothing and reduced injury/hospitalization, while also identifying garment failures. It was not a used-item inspection study or a validation of image-based safety judgements. The result supports treating protective function seriously; it supplies no image classifier threshold. [de Rome et al., 2011](https://pubmed.ncbi.nlm.nih.gov/21819816/)

## What public operators actually disclose

| Primary evidence | Observed process or concern | Transferable lesson | Boundary |
| --- | --- | --- | --- |
| [Moto Guild intake directions](https://www.motoguild-sf.com/pages/used-gear-for-sale) | Requests descriptions, prices, photos and clearly linked components; explains that mixed-up liners and similar items delay intake. Its acceptance list includes condition restrictions and excludes helmets. | Keep photos and removable components attached to one case; make missing details visible before handoff. | One US operator's policy; not a universal gear rule or Moto Reloaded policy. |
| [ReGear FAQ](https://regearaustin.com/pages/faq) | Requests photos, brand, size and condition for purchase interest. It identifies brand, age, condition, market value and demand as pricing factors. It evaluates some crashed items individually. | Capture identification and condition separately from a future valuation function. | Its crashed-item policy conflicts with this challenge and must not be adopted. |
| [REV'IT! Rider Protection Plan](https://revitsport.com/en-us/pages/rider-protection-plan) | Its support process starts with evidence/photos and moves to an in-person inspection before a final repair/replacement outcome. | An image-assisted first stage and a physical decision stage are operationally plausible. | This is a manufacturer support programme with its own terms, not resale acceptance evidence. |
| [Dainese shoulder-plate service](https://www.dainese.com/us/en/thermoformed-shoulder-plate-replacement-single-4040010220.html?cgid=motorbike-services) | Technicians determine feasibility after receiving the garment; some condition, age and unauthorized alterations prevent service. | Photographing a modification can identify an unresolved question; it cannot settle structural suitability. | Repair is outside this challenge. A manufacturer's ability to repair never overrides the event's repaired-protective-area exclusion. |

These examples establish concrete information requirements and workflow patterns. They do not prove that a proposed app saves a measured number of minutes, increases conversion, or is preferred by riders. Those are hypotheses for testing.

## Stakeholders and authority

| Actor | Information available | Work supported by the app | Decision boundary |
| --- | --- | --- | --- |
| Rider/current holder | Their own usage and acquisition history; accessible item and labels | Disclose history, show an item, correct transcription, explain uncertainty | Their statement remains a statement; they cannot verify a previous owner's full history by assertion alone |
| Intake assistant | Capture coverage, visible details, recorded declarations | Assemble a consistent case, request an informative next view, apply explicit exclusions | Cannot certify protection, authenticate by appearance, or invent retailer policy |
| Expert assessor | Physical item, domain experience, relevant manufacturer documentation | Resolve ambiguous locations/components, assess condition within their competence, record reasons | A physical inspection still does not constitute laboratory certification or guarantee future performance |
| Authorized buyer | Confirmed business policy, stock needs and commercial authority | Consider an offer only after applicable gates | Owns valuation and any actual offer |
| Future buyer | Disclosed history, item condition, fit needs | Outside the hackathon journey | No implied downstream safety warranty |

## Proposed journey, with reasons to stop early

The steps below are design decisions to validate. The organizer has not prescribed a fixed number of screens or photographs.

1. **Orient.** Explain that the app helps prepare used gear for a human assessment. Avoid a "safety score" or price teaser. Let the rider start without an account or contact details.
2. **Disclose before uploading.** Ask three short independent questions: whether the item has been worn in a crash; whether a protective part has been damaged; whether a protective part has been repaired. Each has yes, no and not sure. Explain protective parts with plain examples without pretending the examples exhaust every structural area. Ask about an alteration separately when needed to clarify a feature; do not automatically turn every modification into a proven protective-area repair.
3. **Apply the exclusion immediately.** A positive reported exclusion returns "Not eligible for an offer in this challenge" with the reason. Do not spend paid inference or demand six photos to rediscover it. Preserve an accessible correction route for mistakes.
4. **Identify the category.** Ask or suggest jacket, trousers, suit, gloves, boots, standalone protector, helmet, airbag or other. The initial experimental flow may support jackets only. Unsupported categories must get an explicit supported route, not fall through to jacket rules.
5. **Capture a minimal useful set.** Start with the full front, full back and identification label. Keep a capture progress view; show which image supports which task. Request the interior/protectors or a specific concern only when that information can change the next action.
6. **Check image utility locally where possible.** Framing, decoded dimensions, exposure and blur can trigger a retry suggestion. Thresholds are measured image heuristics, not proof of inspection quality. Never turn a bright sharp photo into "damage absent."
7. **Extract observations.** The vision service proposes category, visible text and localised findings in a validated structure. A label with illegible text stays illegible. A possible repair is a concern, not an established fact.
8. **Reconcile.** Show plain evidence chips such as "You reported: no known crash" and "Photo: stitching differs near left elbow." Ask for the smallest useful clarification. Contradiction increases review needs.
9. **Return a useful state.** Tell the rider what is known, why the case stopped or moved forward, and the next action. A preliminary result does not issue an offer.
10. **Create the review packet.** Keep images, component links, declarations, uncertain findings and required physical checks together. Label any export or local preview clearly; do not show "sent to assessor" unless delivery actually occurred.

## Decision states and precedence

These are domain semantics. The implementation may use different enum names but must preserve their meaning and precedence.

| State | Trigger | Suitable wording | What it never means |
| --- | --- | --- | --- |
| Ineligible for offer | Reported/established crash, protective-area damage or repair | "An offer cannot be recommended because a crash was reported." | A diagnosis of the item's exact residual protection |
| More information needed | Required disclosure unanswered, missing view, unreadable identity evidence, failed analysis | "We still need a clear label photo." | "Probably acceptable" |
| Human inspection required | Possible structural defect, uncertain repair location, contradictory history/evidence, unsupported equipment, unresolved completeness | "An assessor needs to inspect this area." | An automatic offer or hidden positive recommendation |
| Ready for preliminary consideration | Required evidence present; no exclusion reported/established; no unresolved concern that requires an earlier state | "Ready for a human assessment before any offer." | Certified, safe to ride, accepted for purchase, or guaranteed price |

Apply a known exclusion before evaluating favourable appearance. If there is no exclusion, evaluate unresolved concerns before selecting a positive preliminary state. All paths retain the "not sure" distinction. Unknown history should remain review-required in the experimental policy unless the organizer supplies a different permissible rule.

If a reported exclusion is corrected, record the original and new answer and the reason. An explicit correction can be handled by the policy; a cosmetic retake cannot erase history. For a production workflow, a correction of a known exclusion should require review before positive consideration.

## Capture plan and uncertainty reduction

| View | Information it can contribute | Adaptive instruction | What stays unresolved |
| --- | --- | --- | --- |
| Full front | Category, overall construction, front closure, obvious discontinuities | Lay the item flat; include all edges; avoid a person in the frame | Back, interior, unseen seams and history |
| Full back | Additional coverage; visible back/shoulder surface concerns | Turn the same item over; keep sleeves visible | Protector presence and condition |
| Brand/model/size label | Readable markings and a candidate identifier | Fill the frame with the label without cutting its edges; avoid glare | Authenticity and exact catalogue match |
| Standards label | Standard number, edition and class as printed | Capture the whole label separately from a logo | Present protective performance |
| Interior and component view | Liner/pocket structure, visible inserts, component labels | Show accessible components; follow the manufacturer instructions | Hidden layers and correct performance |
| Concern close-up plus wider context | The local visual feature and its position on the item | One close image and one context image; do not cover the concern | Whether it is a structural repair or cosmetic detail |

Do not ask users to cut seams, stretch damaged fabric, dismantle airbags or perform a load test. Physical handling should remain non-destructive and within manufacturer instructions. A photograph sequence is not a complete physical inspection.

## Physical review packet

Proposed packet sections:

- **Identity:** submitted category; observed brand/model/size text; candidate match, if any; exact supporting photo references.
- **History:** crash/damage/repair answers; ownership-history knowledge; claimed age and storage/care history only if useful to the assessor.
- **Components:** expected configuration is unverified until matched to the model; visible and reported inserts/liners listed separately.
- **Concerns:** location, observation, evidence provenance, unresolved questions and whether the rule is a hard exclusion or a review trigger.
- **Physical tasks:** inspect seams and closures; inspect accessible protector condition; check configuration against documentation; evaluate fit when relevant. These are review prompts, not a certification checklist.
- **Decision record:** policy version, outcome, reasons, reviewed evidence, reviewer identity if a real review occurs, timestamp and any explicitly unresolved facts.
- **Commercial decision:** absent until authorized policy and buyer exist; never generated from brand prestige or label class alone.

Alpinestars' garment instructions describe post-impact protector inspection even where the outer garment shows no damage. That is a concrete reason to leave hidden condition unresolved in a remote case. [Official garment manual, 2024, Maintenance section](https://cdn.shopify.com/s/files/1/0649/5430/2690/files/GARMENT_EN17092_EN1621-1_Moto_App.v1.2_p2024_G501744_XWEB.pdf?v=1749133128)

## Evidence conflict examples

| Scenario | Correct disposition | Failure to test against |
| --- | --- | --- |
| Clean-looking jacket; rider reports a low-speed crash | Ineligible under event rule | Model says "excellent condition" and unlocks consideration |
| Rider reports no crash; image shows possible elbow abrasion | Human inspection required, with the concern shown | App silently rewrites the rider's history as a crash |
| Rider cannot establish prior history | Record unknown; human review | Default unanswered field becomes no |
| Jacket label says AA; a protector label says level 2 | Record two different markings | App displays "AA safety certified by this scan" |
| A patch covers an elbow seam, but purpose unknown | Possible alteration; review | Patch automatically labelled cosmetic or automatically treated as proven repair |
| Missing liner and missing impact protector | Record separate components | Treat them as equivalent aesthetic accessories |
| Worn size label, familiar logo | Candidate identity only | Exact model, price or age fabricated |
| External service unavailable | Retry or retain pending case | Fixture silently substituted and presented as live analysis |

## Testable workflow hypotheses

Before making claims about friction, compare the proposed flow with a simple fixed capture checklist using the same consented gear set.

| Hypothesis | Measurement | Evidence needed to accept |
| --- | --- | --- |
| Disclosure first avoids unnecessary work | Captures/calls after an exclusion; rider completion time | Zero unnecessary paid calls for explicit hard exclusions; no confusion about why intake ended |
| Adaptive capture reduces effort | Median and tail number of views; recapture rate; assessor completeness | Fewer views without a material increase in missed concerns or requests from assessors |
| Evidence-linked results improve understanding | Ask participants what the app knows and whether it issued an offer | Participants distinguish declarations, observations and unresolved facts |
| Component linkage helps review | Assessor time and misassociation errors | Less searching and no cross-item/component confusion |
| Unknown options improve honest intake | Uncertain-history scenarios and think-aloud sessions | Participants can proceed without inventing an answer; no pressure toward a positive outcome |

All thresholds beyond the hard safety invariants should be set before a study and reported with sample size, scenario mix and uncertainty. There are currently no measured rider preference, conversion, inspection-time or cost-saving results in this document.

## Open business questions

Moto Reloaded must supply acceptable categories/brands, component requirements, evidence expectations, handling of unknown history, hygiene and storage criteria, age/manufacturer guidance, recall procedures, review ownership, commercial valuation and retention policy. Treat these as configuration and human operating procedures, not facts inferred from another shop's website.

The observation vocabulary is in [observation-taxonomy.md](../03-motorcycle-gear-research/observation-taxonomy.md). Privacy choices that affect capture and case retention are in [privacy-research.md](../14-security-and-privacy/privacy-research.md).
