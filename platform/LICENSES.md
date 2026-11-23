# Ownership and third-party material
The owner has published the original Relay source for inspection. No blanket license for the original application has been selected. Third-party licenses are identified below.

Original source, Relay monogram and vector jacket were created for this project. No Tiercord source or assets were copied.

- Fixture photographs: each source, author, license, original/derivative status and hash is recorded in assets/fixtures/manifest.json and ATTRIBUTION.md. CC BY-SA derivatives retain their applicable share-alike terms.
- Fonts: DM Sans and Instrument Serif distributed through @expo-google-fonts, with package license notices retained in dependencies. Import only selected weights. Verify font/package notices before redistributing a binary.
- CLIP: upstream MIT notice and converted-model provenance are documented; conversion-weight redistribution permission is not independently established. Runtime cache is gitignored.
- SigLIP conversion: Apache-2.0 as documented by the model card, with pinned source/tokenizer revisions.
- Transformers.js, ONNX runtime, React Native, Expo, Sharp and other dependencies have their own licenses. The installed Sharp Windows native package declares Apache-2.0 AND LGPL-3.0-or-later; see dependency-review.md. Do not assume all bundled binaries share one permissive license.
- Download/cache model weights locally for research rather than committing or redistributing them with this repository until applicable terms are verified.

No competition dataset, private rider image, provider secret or external paid subscription is included.

## Rounds 03-04 research material

User-provided photographs are local-only under assets/fixtures/round-03, with hashes/provenance in experiments/round-03/user-fixtures.json. Permission to test locally is not a redistribution license. Result screenshots that contain them are also local-only.

Qwen3.5 4B, Qwen3.5 9B, Qwen3-VL and Gemma experiment weights stay in the ignored local runtime cache. The selected Qwen digest and prompt version are recorded; no model weights are published. Torchvision MobileNetV3 weights, derived encoder exports and trained routing heads are separate local research artifacts. Training-data source/license records remain in the original fixture manifests; no blanket redistribution or commercial-training clearance is asserted.

The editorial jacket image is generated artwork, visibly labelled illustrative in the app, never an inspection fixture for real-gear accuracy. Tool: built-in imagegen. Source: app/assets/editorial-jacket.png. Runtime derivative: app/assets/editorial-jacket.jpg (71,269 bytes). Brief: premium studio product photograph of an unbranded black leather riding jacket, dark charcoal backdrop, tactile grain, silver zip and subtle cream shoulder piping; no text, logos, people or interface overlays; full jacket in square composition. The JPEG is a compression derivative of that generated image. It was created earlier in this session; all actual gear-image inference remained local.

Round 05 adds five source photographs with their original declarations, author credits, hashes and transformations in [the round 05 attribution record](assets/fixtures/round-05/ATTRIBUTION.md). The two worn-detail views are correlated with an existing garment. All user-photo derivatives remain local-only.

## Quality audit 01 image corpus

The local audit corpus contains 94 individually attributed Commons images, 80 original images from Osamah N. Neamah's Fabric Defects Object Detection Dataset (CC BY 4.0; DOI 10.6084/m9.figshare.25546465.v2), and 20 images from Jiachao Wang's Leather defect detection Raw Dataset (CC BY 4.0; DOI 10.6084/m9.figshare.25012643.v1). Per-image author, source, licence URL and transformations are recorded in datasets/quality-audit-01/attribution.json and labels.json. Raw-source licence metadata, download checksums and excluded acquisitions are retained in experiments/quality-audit-01. No user photograph is included in that downloadable/public-source corpus; the three user-image regression checks reference the existing ignored local fixtures. No corpus publication is authorized or performed.

## Quality cycle 02 validation corpus

The user authorized up to 64 additional licensed Relay validation photographs. The acquired corpus contains 19 individually attributed Commons images and 45 additional fabric samples from the same CC BY 4.0 Neamah dataset cited above. Five Commons photographs are prior-source regression controls. Per-image authors, licences, licence URLs, source URLs, transformations, groups and hashes are in datasets/quality-cycle-02/labels.json and final-holdout-labels.json. These annotations are assistant visual references, not specialist verification or known crash histories. The local review may reference the prior licensed audit photographs as well; their original attribution remains in quality-audit-01. No model weights or private user photos are included in the review package. No corpus publication was performed.


## Standalone Android 0.2

The private standalone APK bundles the selected Qwen3.5 4B GGUF and vision projector, whose exact hashes and source digest are in app/assets/offline/manifest.json. The upstream [Qwen3.5 4B model card](https://huggingface.co/Qwen/Qwen3.5-4B) declares Apache-2.0. The complete Apache licence and provenance notice are packaged under assets/relay-models. This scoped binary distribution supersedes the earlier cache-only restriction for these two verified artifacts; no model or application publication was performed.

MIT notices for llama.rn and llama.cpp, the font OFL notices for DM Sans and Instrument Serif, and core React/React Native/Expo notices are bundled in RUNTIME-LICENSES.txt. The pinned llama.rn source has local Android ABI-selection, guarded x86 SIMD and release-logging patches, recorded in experiments/phone-offline-02/runtime-patches.json and runtime-patches-v2.json and reproducible from scripts/phone-offline-02-prepare-runtime.mjs. The original copyright notices are retained. No user photograph, audit corpus, API credential or trained routing artifact is included in the APK.
