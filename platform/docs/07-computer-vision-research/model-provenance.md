# Pretrained model provenance and reproducibility

Recorded 2026-10-26 UTC. No model training, fine-tuning or hosted inference calls were performed.

| Runtime component | Exact selection |
|---|---|
| Transformers.js | Installed `@huggingface/transformers` 4.3.1; Node 24.12.0 |
| Execution | Node CPU; quantized q8; intra-op threads 2, inter-op threads 1 |
| Cache | Project-local `.cache/models/`, excluded by the repository .gitignore |
| CLIP conversion | `Xenova/clip-vit-base-patch32` revision `d15189d7028b43f1d3e65039190477f6af591c2a` |
| CLIP tokenizer/processor | Same repository and revision |
| SigLIP conversion | `onnx-community/siglip-base-patch16-224-ONNX` revision `9f0328bdd0eb4f62d0f6c10625f43d882b32102b` |
| SigLIP tokenizer | `google/siglip-base-patch16-224` revision `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed` |
| SigLIP processor | Same ONNX conversion repository and revision |
| Runtime API | `AutoModel`, `AutoTokenizer`, `AutoProcessor`, `ZeroShotImageClassificationPipeline` |
| Interface | `createLocalAdapter(kind)` returns `VisionAdapter`; `analyze(images, signal)` returns validated `Observation` |

Hub metadata was read from the public model APIs. Exact downloaded file sizes and SHA-256 values are recorded in each complete benchmark's `cacheFiles` array. That record, the fixture-manifest hash, installed lockfile and the script revision identify the experiment. The models' mutable `main` branches are not used for inference.

Sources: [CLIP conversion](https://huggingface.co/Xenova/clip-vit-base-patch32/tree/d15189d7028b43f1d3e65039190477f6af591c2a), [SigLIP conversion](https://huggingface.co/onnx-community/siglip-base-patch16-224-ONNX/tree/9f0328bdd0eb4f62d0f6c10625f43d882b32102b), [SigLIP tokenizer](https://huggingface.co/google/siglip-base-patch16-224/tree/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed).

## Actual integration finding

The SigLIP ONNX repository has model/config files but no tokenizer. A naive pipeline call against it is incomplete. The adapter explicitly loads the original Google tokenizer at a pinned revision and the conversion processor/model at another pinned revision. Both models loaded and ran successfully in this environment. No guessed fallback model or silently substituted weights were used.

The current Transformers.js zero-shot pipeline applies softmax to CLIP image-text logits and independent sigmoid to SigLIP logits. Raw values are preserved only in research artifacts. The adapter does not publish a confidence percentage or compare score thresholds between architectures.

## Licence boundary

The official CLIP repository has an MIT licence. The conversion's model card identifies its upstream origin but did not expose a standalone licence field in Hub metadata. Keep the upstream licence and conversion provenance when using it; redistribution of conversion weights has not been independently cleared by this research. Weights remain in the ignored runtime cache, not the deliverable source tree.

The SigLIP conversion and original Google model metadata explicitly identify Apache-2.0. Transformers.js is Apache-2.0. Retain applicable licences/notices with any future distribution. The licences do not guarantee model accuracy, ownership of depicted brands, or fitness for protective-performance decisions. [CLIP licence](https://github.com/openai/CLIP/blob/main/LICENSE), [Google SigLIP](https://huggingface.co/google/siglip-base-patch16-224), [ONNX SigLIP](https://huggingface.co/onnx-community/siglip-base-patch16-224-ONNX), [Transformers.js](https://github.com/huggingface/transformers.js).

## Adapter behavior

- Receives decoded/transmitted JPEG bytes; no image URL or user image is sent to Hugging Face.
- Public model/tokenizer files download to the local computer on first use. Subsequent cache use does not itself prove a completely offline process; verify a network-disabled run before making that claim.
- Every non-label view is processed. Label views are intentionally excluded from category classification.
- Two predefined prompt templates must agree on a view's top category; all relevant views must agree, and at least one front/back overview must exist. Otherwise category is unknown.
- Solid frames are rejected by a narrow decoded-channel standard-deviation heuristic. This is not a general quality or authenticity model.
- The result always has category-only coverage, empty attributes and empty concerns.
- A cancellation signal is checked before/after model stages. An already-running native ONNX call cannot be forcibly interrupted by this adapter; no cancelled result is returned as success.
- A per-adapter queue serializes inference. The enclosing service must bound concurrent requests and its waiting queue.
- Pipeline errors propagate; they do not become a positive assessment.
- `evaluateForBenchmark` exposes detailed per-view rankings for research. It must not be used as the public/mobile response contract.

## Reproduce

From the project root, after the pinned dependency install:

```powershell
node --import tsx scripts/fetch-fixtures.ts
node --import tsx scripts/benchmark-vision.ts
```

The fixture fetcher verifies an existing complete set before reusing it. Explicit `--refresh` refreshes sources. One label original was rate-limited; the server-recommended 960px Commons thumbnail was used and labelled. The other seven originals were verified against Commons SHA-1 metadata. All source representations and application derivatives have independent SHA-256 values.

The benchmark evaluates both models against identical bytes, records two repetitions, preserves individual failures and writes a timestamped record plus `benchmarks/vision-latest.json`. Existing timestamped results remain unchanged.

The reproducible edge-case harness is `node --import tsx benchmarks/vision-adapter-checks.mjs`; its latest recorded run passed 14/14 checks across both models. Focused TypeScript verification of the adapter and both scripts passed with strict/noUncheckedIndexedAccess enabled. Whole-project verification is owned by the integrating agent.
