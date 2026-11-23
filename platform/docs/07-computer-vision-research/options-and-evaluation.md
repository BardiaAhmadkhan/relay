# Computer vision options and evaluation

Research date: 2026-10-26 UTC. Scope: pretrained inference and evidence extraction. **No training or fine-tuning.** Source capabilities are not benchmark results.

## Recommendation

Begin with two real local category baselines: CLIP and SigLIP, executed in Node through Transformers.js. Keep cloud multimodal adapters optional until credentials, consent and spending authorization exist. Add OCR when label transcription becomes the next measured bottleneck. Use deterministic policy and expert review for the decision.

There are five distinct questions: what object is photographed; what text is visible; what visible concerns might need attention; what history the owner supplies; and whether the shop should progress the item. No single vision score answers all five. Every result needs its task, evidence source and limitations.

The installed Transformers.js package is 4.3.1. Its official repository documents Node inference and pretrained ONNX use. The public documentation's main branch still linked a 3.8.1 stable tutorial during retrieval; the implementation must follow the installed 4.3.1 API and lockfile. [Transformers.js](https://github.com/huggingface/transformers.js), [Node tutorial](https://huggingface.co/docs/transformers.js/tutorials/node)

## Options

| Option | Useful contribution | Key limitation | Decision |
|---|---|---|---|
| CLIP ViT-B/32, pretrained ONNX | Rank a bounded set of gear-category text prompts. Available without credentials; can run on the local computer. | Candidate-relative similarity/softmax is not calibrated probability. No reliable condition, authenticity or protective-performance evidence. | Implement a category-only baseline. |
| SigLIP base patch16/224, pretrained ONNX | An independently pretrained image-text architecture for the same category task. | Its sigmoid scores have different semantics from CLIP softmax; direct numeric comparison is invalid. No condition clearance. | Compare against CLIP on identical images and prompts. |
| OpenAI GPT-6 Luna | Image input and constrained structured text; candidate for visible attributes/concerns after paid evaluation. | Hosted transfer, hallucinations and model drift. Schema adherence cannot establish factual correctness. | Optional, not selected by price alone. |
| Gemini 3.5 Flash-Lite (3.1 as priced alternative) | Multimodal input and structured output; candidate for extracted attributes/concerns. | Free and paid data terms differ; current API schema differs from older tutorials. | Optional paid-tier evaluation only for private user photos. |
| Claude Haiku 5.5 | Vision and structured output; another candidate for bounded extraction. | Different tokenizer/output costs; retention and agreement-specific exceptions. | Research alternative; no live comparison claimed. |
| ML Kit OCR/base image labels | On-device Android/iOS text extraction, geometry, and broad generic labels. | Base labels are not a motorcycle-condition model; custom native bridge/build required for this Expo app. | Native OCR spike after device toolchains exist. |
| Apple Vision OCR | On-device label transcription on Apple platforms. | Separate Android implementation; actual SDK integration untested here. | Candidate iOS OCR adapter. |
| Tesseract.js | Local Node OCR without Python/API keys, with word/text results. | Curved, worn, low-contrast sewn labels remain difficult; no semantic certification. | Next no-key OCR comparator. |
| Pretrained open-vocabulary detector, such as Grounding DINO | Propose object boxes in crowded scenes. | Extra model/runtime; boxes do not prove protective-area damage. | Defer unless mixed-item scenes cause measured failure. |
| Pretrained SAM 2 segmentation | Isolate garment/background regions. | Masks do not identify brands, damage or safety; added pipeline can remove useful context. | Defer; require a measured capture/evidence benefit. |
| Task-specific trained detector/classifier | Could specialize to a labelled task in another project. | Training is explicitly outside this challenge; labels/rules are not yet available. | Excluded. |

Evidence: [CLIP model card](https://huggingface.co/openai/clip-vit-base-patch32), [CLIP conversion](https://huggingface.co/Xenova/clip-vit-base-patch32), [SigLIP conversion](https://huggingface.co/onnx-community/siglip-base-patch16-224-ONNX), [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Gemini model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision), [ML Kit OCR](https://developers.google.com/ml-kit/vision/text-recognition/v2), [ML Kit labels](https://developers.google.com/ml-kit/vision/image-labeling), [Apple OCR](https://developer.apple.com/documentation/vision/recognizing-text-in-images), [Tesseract.js](https://github.com/naptha/tesseract.js), [Grounding DINO](https://github.com/IDEA-Research/GroundingDINO), [SAM 2](https://github.com/facebookresearch/sam2).

These are workload recommendations inferred from documented capabilities. No cross-framework or cross-model accuracy/FPS superiority is claimed.

## Licences and data handling

| Component | Retrieved terms / licence | Operational consequence |
|---|---|---|
| Transformers.js | Apache-2.0 in official repository | Retain applicable notices with distribution. |
| Original OpenAI CLIP | MIT repository licence | Preserve upstream notice and model provenance. |
| Xenova CLIP conversion | Model card identifies original CLIP; Hub metadata did not expose an explicit licence field | Do not claim conversion redistribution independently verified. Keep downloaded weights out of source control; retain provenance and original licence. |
| SigLIP ONNX community conversion | Apache-2.0 model-card metadata | Preserve licence/provenance and pin revision. |
| Tesseract.js | Apache-2.0 repository | Record language-data licences separately if installed. |
| Grounding DINO | Apache-2.0 repository | Verify exact selected checkpoint/conversion before future use. |
| SAM 2 | Repository includes Apache-2.0 and BSD-3-Clause components | Inspect actual files/checkpoint and retain corresponding notices. |
| Ultralytics YOLO distribution | AGPL-3.0 repository licence | Not silently interchangeable with permissively licensed models; not selected. |
| Hosted OpenAI/Gemini/Claude | Service access, not redistributable model weights | Confirm account terms, privacy controls and permitted data before sending photos. |

Sources: [Transformers.js repository](https://github.com/huggingface/transformers.js), [CLIP licence](https://github.com/openai/CLIP/blob/main/LICENSE), [SigLIP card](https://huggingface.co/onnx-community/siglip-base-patch16-224-ONNX), [YOLO licence](https://github.com/ultralytics/ultralytics/blob/main/LICENSE), and model repositories above.

ML Kit documents that image/text inputs and outputs stay on the device, but usage/performance metrics and model updates can involve Google servers. Do not promise that the SDK makes no network connections. [ML Kit terms](https://developers.google.com/ml-kit/terms)

OpenAI API data is not used for training by default; abuse-monitoring retention and application-state storage are distinct. Responses normally stores state unless disabled; use `store:false`, and do not describe that as guaranteed zero retention. Images can have safety-review exceptions. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)

Gemini paid services do not use submitted data to improve products; unpaid services have different terms. Its abuse-monitoring page specifies 55-day logging; guaranteed ZDR requires the documented enterprise route/configuration. Disable optional conversation storage and avoid search grounding for private gear photos. [Terms](https://ai.google.dev/gemini-api/terms), [abuse monitoring](https://ai.google.dev/gemini-api/docs/usage-policies), [ZDR](https://ai.google.dev/gemini-api/docs/zdr)

Anthropic's standard API policy deletes input/output within 30 days, with longer-retention service, policy, legal and agreement exceptions. ZDR is an eligibility/configuration question; structured-schema caching is separate. [Commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data), [API controls](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)

These are technical design inputs, not a representation that the prototype or accounts have been certified compliant.

## Structured outputs and trust boundary

The authoritative runtime types are in `packages/core/schema.ts`. Models produce observations, never the final eligibility state, offer recommendation or protective certification.

| Provider | Retrieved structured-output mechanism | Local enforcement |
|---|---|---|
| OpenAI Responses | `text.format` with `type:"json_schema"`, schema and strict mode | Validate runtime values, handle refusal/incomplete output and require image references. |
| Gemini current Interactions API | `response_format:{type:"text",mime_type:"application/json",schema:...}` | Pin SDK/API; do not paste obsolete field names into this route. |
| Claude Messages | `output_config.format:{type:"json_schema",schema:...}` | Validate values and completion/refusal state. |
| Local CLIP/SigLIP | Deterministic adapter constructs the same observation envelope | `coverage:"category_only"`, empty attributes/concerns, no user-facing raw score. |

Sources: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

Treat image text as data, including instructions printed on labels. Keep the observation prompt separate from policy. Unknown category or unavailable inference remains unknown. A model's missing concern is not evidence that no defect exists. Corrections/disclosures must keep provenance and never be silently overwritten.

## Public fixture candidates

Every candidate below had its description/licence page read. The download script must retain source URL, author, chosen licence URL, revision, hashes, transformations and item grouping. Collection pages alone are not licence evidence.

| Fixture | Author / selected licence | Use and limit |
|---|---|---|
| [Customised Lewis Leathers Rockers.JPG](https://commons.wikimedia.org/wiki/File:Customised_Lewis_Leathers_Rockers.JPG) | Timken Bearing; CC BY-SA 3.0 | Decorated leather jacket category; no condition ground truth. |
| [Herobiker motocross jacket DSCF2203.jpg](https://commons.wikimedia.org/wiki/File:Herobiker_motocross_jacket_DSCF2203.jpg) | Mary Mark Ockerbloom; credit Science History Institute; CC BY-SA 3.0 | Different garment construction and mannequin background. |
| [Dainese racing gloves.jpg](https://commons.wikimedia.org/wiki/File:Dainese_racing_gloves.jpg) | lmnop88a; CC BY 2.0 | Glove category. |
| [Dainese racing glove palms.jpg](https://commons.wikimedia.org/wiki/File:Dainese_racing_glove_palms.jpg) | lmnop88a; CC BY 2.0 | Alternate view of same pair; same item group. |
| [Motorcycle racing boot.jpeg](https://commons.wikimedia.org/wiki/File:Motorcycle_racing_boot.jpeg) | Caederus; CC BY-SA 3.0 | Boot category, not protective rating. |
| [MotoEqipments HelmetBootsJacketAndGloves.jpg](https://commons.wikimedia.org/wiki/File:MotoEqipments_HelmetBootsJacketAndGloves.jpg) | サフィル; CC BY-SA 4.0 | Multiple-item scene, ambiguity/abstention case. |
| [CrashedMotorcyclingRacingShoulderPanel.jpg](https://commons.wikimedia.org/wiki/File:CrashedMotorcyclingRacingShoulderPanel.jpg) | Thermos; CC BY-SA 4.0 | Source caption reports a track crash. Use supplied history for exclusion tests separately from blind visual interpretation. |
| [Cordura - Ticket.JPG](https://commons.wikimedia.org/wiki/File:Cordura_-_Ticket.JPG) | MAx 92; contrast edit A7N8X; CC BY 3.0 | Backpack material label; OCR/negative-domain control, not garment certification. |

CC licences permit reuse subject to their obligations. Preserve attribution, link the licence and disclose changes. Share adapted BY-SA fixture images under the applicable same/compatible licence; avoid representing the author as endorsing the app. Image licensing does not establish trademarks, authenticity or safety. The manifest—not this candidate list—records what was actually downloaded.

## Evaluation protocol

1. Freeze source files, item groups, weak category labels, model revisions, prompt variants and preprocessing before running inference. Keep original downloaded hashes and derivative hashes.
2. Run both local models over exactly the same derivatives. Separate download/model load from per-image inference. Include every failure.
3. Compare two predefined wording templates. This is inference prompting, not model training. Do not select a winning prompt and report the same small set as unseen validation.
4. Evaluate category ranking separately from conservative application output. Record raw scores only in benchmark artifacts and explicitly identify CLIP softmax versus SigLIP sigmoid.
5. Use agreement across templates and views as an abstention heuristic, not calibrated certainty. Conflicting views return unknown. Label-only views cannot establish a garment category.
6. Report per-image outcomes and grouped item counts. Two glove views, crops and transformed images are not independent objects.
7. Add corrupt inputs, label-only evidence, mixed items, blank frames, cancellation, model-load failure and network interruption to integration tests.
8. Evaluate domain exclusions independently with supplied crash/damage/repair facts. Correct policy exclusion does not demonstrate visual damage detection.
9. Build a larger owner-authorized and expert-labelled holdout before general accuracy claims. Include worn textiles, casual clothing, obscured labels, repaired seams, varied backgrounds/lighting, and close-ups. Do not fabricate missing ground truth.
10. On event day, record dataset licence and rubric first; adapt taxonomy and policy configuration without changing exclusion invariants or training models.

On this small convenience corpus, top-one agreement is a descriptive smoke measure only. The sample is biased, may overlap public pretraining data, and lacks verified internal damage or authenticity labels. Do not claim a safety accuracy percentage, high recall for protective damage, or guaranteed real-world recognition.

## Next decisions supported by evidence

The immediate experiment answers whether real pretrained inference works in the actual environment and whether category wording/model choice changes observed failures. It cannot select the best condition-understanding provider without paid, consented tests and expert labels. A local category-only fallback must remain visibly limited and route to human inspection.

## Executed evidence

The first local comparison is complete: [measured report](../../benchmarks/vision-report.md), [raw baseline](../../benchmarks/vision-2026-10-26T06-37-23-456Z.json), [model provenance](model-provenance.md), and [fixture manifest](../../assets/fixtures/manifest.json). Both pinned models ran on all eight images with two fixed wording templates and two repetitions. Fourteen focused adapter checks passed; reproduce them with `node --import tsx benchmarks/vision-adapter-checks.mjs`. These local results do not establish native-phone performance or condition-assessment accuracy.
