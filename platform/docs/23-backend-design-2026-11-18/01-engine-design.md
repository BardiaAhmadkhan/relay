# Relay | Cloud inspection design

**Decision record · 18 November 2026 · Pre-event research.** This is the specification for a proposed successor to the implemented v3.1 engine. Start here, then follow the [build and qualification plan](02-build-and-qualification.md). The [evidence report](03-evidence.md), [machine-readable measurements](measurements.json) and reproduction appendix document the basis for each decision. The print brief is a shorter version for discussion with the shop.

## 1. The decision

Build a phone intake that helps a rider and a shop settle **which item, which part of it, what was observed, and who can decide**. Use the existing multimodal model in a private cloud worker. Make the first investment in connecting a suspected mark in an overview to a useful second observation. A lower score on a different photo cannot resolve an earlier finding by itself.

A rider photographs a scuffed pair of boots. Relay keeps the pair together as one candidate item, identifies which boot needs attention, and asks for one close-up if the rider can locate the mark. The original and the close-up appear together for the shop. If the mark cannot be located, or the rider does not have the boots to hand, the intake can go directly to a person. A reported crash or known protective-area repair ends offer consideration immediately. The five-minute demo should let a judge change a real input and see *why* the route changes.

This direction follows three observations from the running engine and its data:

- A photo labeled as intact, heavily used boots returned **no offer** in both live views. On the overview the scorer stopped after road-contact and category evidence. The photo’s history and physical condition are unknown.
- At the reference whole-image resolution, 45 of 93 synthetic damaged mosaics landed in the clear damage band. The original source photo was in review or block for 42 of those 45. The difference identifies where acquiring detail could help. The original source photo was available to the analyst by construction.
- The existing release can ask for a detail, but the policy retains the original review hit. A clean detail led to specialist review in the paired policy fixture. Preserve the original observation and show exactly what the second view adds. Measure whether it saves a rider or reviewer time before expanding its use. [Evidence and protocols](03-evidence.md)

A fresh whole-image/crop comparison adds a caution. Selecting the helmet in a cluttered frame raised its one-item score from 0.079 to 0.504. Selecting only one scuffed boot still produced a terminal exclusion. All three tested damage bands stayed the same. The proposed improvement is a question the rider or specialist can actually settle, with the original evidence in view. [Natural-photo experiment](03-evidence.md)

## 2. The actual baseline and size contract

**Reference:** current files in the independent Relay checkout, including uncommitted November work. The only historical commit, `e3a6f58`, predates this engine. The design compares against the v2 HTTP contract running the v3.1 question plan. November 18 sources, calibration and selected evidence are fingerprinted in `measurements.json`. The October APK and prior experiments give context for tradeoffs.

| Reference component | Verified value |
| --- | --- |
| Model/runtime | `qwen3.5:4b`, GGUF Q4_K_M, Ollama 0.40.16, digest `d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04` |
| Model weights | `model.gguf` 2,648,593,216 bytes, 4,205,751,296 runtime-reported parameters |
| Vision component | `mmproj.gguf` 675,569,120 bytes, 333,514,240 runtime-reported parameters |
| Learned-weight ceiling | **3,324,162,336 bytes** across the active inference pipeline. Both blob digests were recomputed from disk. The complete model size reported by the registry API is 3,324,173,934 bytes. |
| Conservative parameter ceiling | 4,539,265,536 combined reported parameters. Limit both aggregate parameters and learned bytes, and keep the packaged model at or below the current registry size. A current tensor inventory is the authority for a replacement format. |
| Execution | Local reference for reproducibility. Cloud API is the target for both mobile platforms. Zero model-weight bytes in the mobile bundle, app downloads or offline path. |
| Image routing | Whole views use 1600 px for road contact, broken material, repair and usability. Other overall questions can use 512 px. Detail damage uses a 512 → 1600 cascade. Labels retain the full rendition. |
| Policy | Battery `gear-2`. Full damage review/block boundaries 0.145/0.646. Detail first-stage 0.139/0.552. Repair 0.30/0.85, with zero labeled repairs used to fit it. Existing shop config requires front, back and label, allows one extra close-up, and keeps helmets/armour in specialist review. |

Count every unique learned tensor needed to serve a candidate, including encoders, OCR, detectors, adapters, projectors and external model calls. Count equivalent resident tensors at their deployed precision as well as their shipped bytes, with an inventory of any engine-side conversions. A downloaded FP16 copy or a hidden hosted fallback defeats the budget. Identical replicas change hosting cost and memory consumption. They do not create a larger model. Size the container, peak memory, runtime libraries, temporary tensors, storage, request cost and queue separately. Comparison runs may use isolated reference and candidate workers, each with its own budget. No rider request invokes a beyond-budget pair. [Measurement manifest](measurements.json)

## 3. What each participant does

| Moment | Rider experience | Backend obligation |
| --- | --- | --- |
| Start | Show the item and the purpose of the check. Ask the three short history questions with **yes / no / unsure**. A rider may prepare a draft before choosing cloud processing. | Record disclosure events. Any reported exclusion gives an immediate local result and the same server disposition. Unknown history remains open. GPU demand for a known exclusion is zero. |
| Capture | Show the front, back and label required by the current shop profile. A matching pair of boots or gloves can be one item. Show both together. Let the rider say a label is missing or inaccessible. | Save each accepted capture locally before upload. Track view, item, revision and purpose. An unavailable label has a finite route to a person. Only request what the active policy still needs. |
| Check while capturing | A background upload and checks can overlap the next photo. A short, actionable receipt distinguishes waiting, checked and retry. Keep a local draft or arrange an in-person handoff if cloud processing is declined. | Start inference only after destination-specific consent. Reuse completed work on retry. A missed deadline, service error or canceled view does not become a negative observation. |
| Resolve a mark | If grounded, show the rider the **actual** overview with the relevant area and a single instruction, e.g. “Photograph the outside edge of this boot in even light.” Allow “I can’t show that area” and “Different item in the picture.” | Attach the new view to one finding, source photo, item and requested side. Preserve unrelated views and earlier positive disclosures. An uncertain location gets a generic tap-to-point or a human handoff. |
| Result | Give one next action. An eligible case reaches shop consideration. A known exclusion ends the offer route. Unresolved evidence goes to a person. Keep the item thumbnail and the reason together. | Produce a deterministic, versioned decision with reason and evidence IDs. Treat condition grades as commercial descriptors. Never certify protective performance, authenticity, crash history or resale price from an image. |
| Shop | A staff member sees the specific unresolved question and the linked photo pair. Record their independent observation, then reveal the model cue as needed. The shop can issue the permitted commercial decision. | Distinguish who supplied history, what is visible, and what was confirmed in hand. Preserve disagreements, give the rider an acknowledgment, and avoid repeat submissions masquerading as new work. |

The prior warm-paper, dark green and lime mobile palette already supports this flow. Add a small location cue, a photograph pair and clear language within the existing notebook. Keep it accessible with a text description, tap alternatives, non-colour status, Dynamic Type and TalkBack/VoiceOver. The shop review surface may be a console. Rider capture, recovery and results must work in the native iOS and Android builds. No account, marketplace listing or price quote is needed for the demonstration.

## 4. Architecture and deployment boundary

```text
iOS / Android    camera · local draft · deterministic checks · explicit upload
                         │ TLS / scoped assessment session
                         ▼
Cloud API        Fastify + TypeScript · consent · revisions · upload receipts
                 PostgreSQL: workflow events, jobs, leases and decision revisions
                 private object store: short-lived encrypted photographs
                         │ photo + pinned engine profile
                         ▼
GPU worker       Sharp renditions → foreground/coverage evidence → question planner
                 pinned private Ollama → Qwen text + vision → typed observations
                         │ signed immutable evidence       ↘ bounded detail request
                         ▼
Decision         shared pure TypeScript policy · outcome + next action + evidence IDs
                         ├── native rider result
                         └── specialist review → recorded observation → same policy
```

**Mobile.** Keep Expo/React Native, TypeScript, existing screens, camera, image handling and history UX. Build a cloud client for both OSs. The current Android platform adapter unconditionally selects device v1 and its manifest blocks Internet. Preserve the historical offline artifact as a reference and provide a clean cloud build profile excluding its weights, downloaders and native inference libraries. Configure HTTPS endpoint discovery and secure session storage explicitly. In a network outage, keep capturing and queue locally, offer in-person handoff, and display “Waiting to check photographs.” Changing the provider never silently reuses consent.

**API and state.** Keep Fastify and Zod. Add one small transactional store alongside private blob storage. Stateless score signing is valuable, but a multi-replica shop needs recoverable pending work, acknowledgments and decisions. Use a jobs table with a lease in the same database as the assessment. A separate queue product can wait for measured contention. A worker receives object references and the versioned scoring profile. Only the API handles rider sessions and permissions. The model endpoint is private. Never put a provider token on a phone.

**Worker.** Start with the exact two GGUF blobs, current runtime, question rendering, top-20 log probabilities, seed 42, zero temperature and 8192 scoring context. Preserve the existing answer-token coverage floor of 0.5. Store raw covered mass, raw conditional score and any band remapping separately. A high conditional answer score is a routing signal. The interface must not present it as the probability that a garment was crashed. Pin rendering libraries, hardware profile, input orientation, colour space, crop, interpolation, compression and prompt order. A new profile enters shadow testing with its own manifest.

**Data lifetime.** Proposed starting settings for a shop pilot are a 24-hour expiry on unsubmitted cloud jobs and photos, and an explicit shop-configured, consented period for specialist cases. On successful completion, purge transient renditions promptly. Capture a retention receipt and support deletion across original, crops, queue payload and derived caches. Make deletion idempotent. Confirm event dataset rights, location, provider policy, retention and any sharing terms before real intake. Keep a local-only draft when shared processing is declined. Use separate rider and staff authority, signed short-lived access to thumbnails, and aggregate logs free of images, OCR text and free-form rider notes.

## 5. How the engine should inspect

### Bind every observation to the item being judged

The unit of work is a physical item or matching pair. Represent photo role, side, view, visibility and whether other objects could account for the signal. A hanger, mannequin or a person in the background can explain a high whole-photo score. Ask a closed, fixed-option question on demand using the same weights: single item, one matching pair, several independent items, worn/on person, scene, indeterminate. A coarse rider tap can identify the intended subject in ambiguous photos. It identifies the intended object. A specialist or qualified independent image evidence must associate any mark with it. A tap cannot convert a safety finding to clean.

Preserve the fast disclosure stop. A visual signal with uncertain ownership places the case on hold and can request a cleaner view or a person. A clean replacement view cannot erase a potential exclusion. It can establish that an earlier mark belonged to a different object only under the reconciliation rules below. Test displaced background tears, graphics, mud, snow, gloves sold as a pair, two similar but unrelated objects, and genuine damage on one half of a pair. Do not relax the existing one-item threshold globally. E19 found that would also pass more scenes.

### Keep context and fine detail together

1. Produce a contextual overview at the baseline resolution, a 512 px summary where already supported, and a reversible mapping into the orientation-corrected capture. Preserve enough detail on the phone to furnish a native-pixel crop, subject to a bounded, disclosed local retention policy. The current client stores a 1600 px JPEG at quality 0.82. Enlarging that image cannot restore discarded pixels. If the original is too small or unavailable, ask for a fresh close-up.
2. Propose an area using a rider tap, shop-authored anatomy guide or bounded deterministic tiling. Start with one crop, optionally a second when the first is unusable or an independent audit draw calls for it. Preserve the full frame with every crop and display its source. Never claim an exact location from a whole-photo score or a generic category zone.
3. For validation, include both cheap-stage negatives and above-threshold cases. Run systematic, content-independent sampling on a predeclared fraction of eligible overviews in shadow. This reveals tiny misses that an uncertainty-only branch would never inspect. Mark scores from the same pixels as correlated. A zoom of the overview refines an observation. A physical second photo may supply genuinely new information.
4. Treat dark leather, repeating weave, printed tears, stitching, mirrored views, glare and masks that remove the damage as explicit failure modes. A visible discontinuity, open seam or substrate loss has its own field. Scuff appearance, uncertainty and unreadable territory have their own fields. An intact-looking patch does not establish protective performance. An absent proposal or quiet crop supplies no clearance for an unseen surface.

This is an inference experiment using existing weights. The source-parent comparison supports testing detail, and controlled slicing has helped small-object detection in other domains. Neither result establishes that Relay can find an unknown defect on a garment. [Source-parent experiment](03-evidence.md) · [Slicing Aided Hyper Inference](https://arxiv.org/abs/2202.06934)

### Ask for the least expensive observation that can change the action

Enumerate legal actions per state: use existing detail, ask for one targeted photo, ask a history question, route to the shop or finish. Run deterministic rules first. For example, a reported protective repair makes additional scoring irrelevant. If no permissible next photo can change a decision or make expert review substantially easier, send the existing case directly.

Start with an auditable decision table. Add a value-of-information table only after paired trajectories exist. For each candidate action, estimate the expected reduction in downstream decision loss and reviewer work from *paired, physically matched* cases. Subtract GPU cost, upload/capture delay and measured abandonment burden. Treat the safety rules as hard constraints. Use a lower confidence bound on the net benefit. With insufficient observations use a single bounded capture request or handoff. For a future table, estimate net value as expected loss of stopping now minus expected loss after the action, minus measured action cost. Use a common unit approved by the shop, or compare a Pareto frontier across safety, time and dollars until those weights exist. Count people who never return the requested photo in the action outcome. The shop supplies relative costs, and measured rider behavior supplies time and completion rates.

Count a resolution attempt when a request is explicitly declined or an accepted response image is attached. Save its request ID. Reopening a result or retrying a network request must return the same prompt without consuming another attempt. Separate mandatory views, missing-label handling and the optional diagnostic close-up. Set one optional request per intake for the initial profile. A rider can always hand over the case immediately.

### Make positive, missing and disputed evidence behave differently

| Evidence state | Decision behavior |
| --- | --- |
| Reported crash, protective-area damage or protective-area repair | Exclude from offer consideration immediately. A later negative disclosure, different crop, high model confidence or ordinary reviewer note cannot annul the event. Any dispute goes through an explicit specialist process that preserves the original. |
| Human establishes a crash or protective-area damage/repair | Exclude. Require source, item and area where applicable. No commercial offer, regardless of grade. |
| Suspected visual damage or repair, correctly linked or unlocated | Withhold offer. Ask for one meaningful observation or send to a person. An ambiguous scuff can be described to the rider without asserting a crash. |
| Suspected mark demonstrably belongs to another object or is a factory feature | A specialist may resolve the **specific observation** with scoped evidence. Retain it and record the reason. Recompute remaining exclusions and coverage. Automatic resolution stays off until separately qualified. |
| Missing views, unresolved identity, missing label, unclear history, unsupported category, uncertain repair or unavailable scoring | Recover if the rider can provide the specific missing information. Otherwise send to specialist. Eligibility remains closed while applicable facts are unresolved. |
| All required evidence and history complete, no open holds | A qualified profile may recommend shop consideration under signed shop rules. In the initial field pilot the specialist makes the commercial decision. Save the reason and item revision. No inferred certification or invented amount. |

All high-risk signals from any view remain visible. Missing evidence and skipped questions have distinct statuses: observed, indeterminate, unavailable, unnecessary-for-this-outcome. Use a required-evidence matrix per route. For example, a high road-contact score can validly omit grade on a hold, while a missing repair check cannot satisfy the eligible path. Normalize “in protective area”, “outside protective area” and “zone unresolved” explicitly. Every affirmative decision must satisfy the matrix across the relevant item, views and revision.

### Keep changes to weights as a separate hypothesis

The first build uses the two verified blobs unchanged. Prefer inexpensive deterministic operations for de-duplication hints, orientation, exposure, focus and image coordinates. Question-specific “specialists” can share the same model. A perceptual hash recognized every JPEG recompression in this audit but just 12/363 modest crops. That supports a narrow duplicate hint, not cross-view identity or cleared coverage.

A later candidate may re-quantize the same licensed checkpoint with a fixed per-tensor precision allocation, reserving bytes for sensitive visual/projection tensors by saving bytes elsewhere, or evaluate a smaller replacement with a different projector. Define a hardware-supported precision map before looking at the qualification split, rebuild from the licensed source where appropriate, count tensors and bytes including the projector, and give it a new manifest. Quantization is lossy. Shaving bytes or altering individual weights is not by itself an improvement. Pair-test token coverage, near-threshold band changes, defect location, clean-item holds, GPU cost and subgroup sensitivity. Never fuse an extra deployed encoder that breaks the aggregate ceiling. No model training, leaderboard-driven edits or opaque fallback. Any on-day conversion or reuse is conditional on the agreement. [llama.cpp quantization tools](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)

## 6. Human review as a real product outcome

Give the specialist a short question, the item overview, relevant native detail, owner-reported history and areas left unobserved. Preserve an inspection path that works when no visual mark can be localized. For independent labels, initially hide the model’s recommendation. Record the expert’s first observation, then allow comparison or adjudication. Give the rider a delivery receipt and eventual disposition. Sharing a text brief is distinct from submitting a review case.

The current optional console can save an offer with photo-level damage or repair and a sufficiently long explanatory note when no positive disclosure exists. It lacks a structured field for whether that damage or repair was in a protective area. The proposed console requires the scoped fact, routes uncertain areas to inspection and prevents a confirmed exclusion from being overridden by prose. A false visual suspicion may be reconciled with explicit evidence while a genuine exclusion stays binding. The shop can reach a legitimate yes, hold or no on day one even while statistical evidence for automation is limited. [Policy and review evidence](03-evidence.md)

## 7. What must be true before shipping a change

Keep the current visual path as the paired scientific comparator. Retain exact source profiles for replay. Do not present historical one-photo simulations as completed mobile intakes. A change earns promotion through a defined improvement, service reliability, no observed new severe cases on locked tests, an explicit estimate of remaining uncertainty and a known fallback. With limited data, deploy a candidate in shadow or as an expert aid. Once an unsafe recommendation is found, stop that recommendation path, preserve the case, and return to safe review. Rollback must never reopen an established exclusion. The [build plan](02-build-and-qualification.md) gives ordering, data contracts, numerical gates, costs and event-day decisions.
