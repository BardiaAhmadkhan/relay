# Benchmark interpretation and next validation
Read the raw report at ../../benchmarks/vision-report.md and its linked JSON before using any number in a demo.

The measured set contains eight source images but only six category-scored images, representing five independent scored groups. The two glove views are the same item. The partial crash crop and backpack-label control are diagnostic, not category-accuracy ground truth. CLIP and SigLIP both made substantive errors. A category score is not a probability of safety.

The policy suite is a different kind of evidence: deterministic exclusions can be exhaustively checked over the three-valued disclosure combinations, while photo recognition cannot be proven with a few samples. Never combine those into a single marketing accuracy percentage.

## Next dataset protocol
1. Obtain organizer permission and usage/license terms; keep confidential images local until external processing is permitted.
2. Group all views of one physical item; assign train/tuning/evaluation roles even though no training occurs. Keep the final evaluation groups untouched while prompts are selected.
3. Ask experts to label category, visibly observable concerns, protective-area uncertainty, required further views and actual intake routing. Record disagreement rather than collapsing it into an invented truth.
4. Include clean, dark, reflective, blurred, cropped, cluttered, repaired, damaged, crashed, unsupported and unknown-history cases.
5. Report per-task denominators, abstention/coverage, unsafe recommendation count, routing errors and representative failures. No meaningful defect recall can be reported from category-only fixtures.
6. Compare single overview, guided multi-view and selective additional-view requests on the same items. Measure task completion and comprehension with actual riders.
7. Compare approved cloud candidates only after fixture privacy permissions and spending scope are known. Preserve provider/model/prompt/schema, resolution, token usage and cost.

Provisional safety acceptance: zero disallowed recommendations in all known exclusion scenarios, deterministic policy unchanged by provider results, and every failure/unknown routed without a favorable default. This does not certify the garment or the system.
