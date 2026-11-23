# Small cooperating specialists

Status: partially executed research, separate from the active inspection service. The user explicitly proposed and authorized training small task-specific networks. The event brief excludes training; this research must not be represented as an approved competition submission.

## Architecture to build toward

1. Deterministic capture checks inspect exposure, resolution, decoding and duplicate content on-device. These are acquisition checks, not damage judgments.
2. A compact shared image encoder produces reusable features. Task heads receive the same versioned features so logo, material and defect tasks do not each run a large backbone.
3. A garment/region locator proposes where to look. A low-confidence routing result must request another view or abstain; it must never prevent a damage specialist from examining a photograph merely because a close-up was misclassified.
4. Separate heads assess visible morphology: broken fibers, missing surface/coating, tears and interrupted seams. Logo/OCR can help product identification but cannot establish authenticity or condition.
5. A spatial mask plus deterministic pixel counting can measure visible affected area within the visible garment region. It cannot measure hidden damage, depth, the fraction of an unseen jacket, or remaining protective strength. The current global pooled encoder cannot produce this mask; a spatial feature export and supervised segmentation data are still needed.
6. A small scheduler runs only relevant heads, caches by image/model/task digest, and requests an informative close-up when evidence is insufficient. Agreement from heads sharing an encoder is correlated; it is not independent corroboration.
7. Deterministic policy combines evidence with preserved history. Known exclusions win; incomplete or conflicting evidence abstains. No model certifies safety or recommends an offer.

The opportunity is shared computation and explicit evidence contracts. Dividing a task into many networks alone does not make it accurate or efficient. More heads can compound errors, consume memory and make latency unpredictable. Each stage needs its own error accounting and an end-to-end check.

## What actually runs

The research encoder is MobileNetV3 Small features plus global pooling: 927,008 parameters, input 1x3x224x224, output 1x576. The initial FP32 ONNX file is 3,716,903 bytes. A 576-to-32-to-2 head has 18,530 trainable parameters and a 79,468-byte ONNX file. It routes jacket-shaped items versus other gear; it does not recognize damage.

Training used eight source groups / nine images, with brightness and flip augmentation producing 54 training rows. The six evaluation images contain five source groups; the three user photographs are diagnostic only and were never training inputs. Original performance: 5/6 evaluation images and 2/3 diagnostic images. The missed armour jacket and close-up make activation inappropriate. These are development counts, not a general accuracy estimate.

A separate native Android application executes encoder then head with ONNX Runtime 1.23.2 and no network permission. It measures preprocessed tensor inference only. The half-precision encoder is 1,885,280 bytes (49.28% smaller); all 36 original/quality-variant predictions matched the FP32 pipeline. Original and compressed logits differ, and the existing classification mistakes remain.

Native emulator comparison: FP32 median 4.09 ms / p95 8.66 ms; FP16-storage median 3.68 ms / p95 7.37 ms, 30 measured runs after three warmups, two CPU threads. The native heap was approximately 42.18 MB versus 42.80 MB. Thus the proven saving is model storage; lower peak memory, power and physical-phone latency are not established. Runtime conversions may be involved; do not describe this as verified native FP16 arithmetic. Cold/load timings are not directly comparable because of caches and run order.

Files: experiments/mobile-specialists contains source, immutable protocols, ONNX artifacts, training reports and Android measurements. The trained models are not used by Relay decisions. The active reference remains local Qwen3.5 4B evidence extraction and verification on the computer.

## Required next data

Create independently reviewed examples of intact/worn/damaged leather, textile and mesh, including ordinary seams, logos, dirt and lighting artifacts as hard negatives. Record garment identity, capture session, source/license/consent, view, material, expert label, ambiguity and precise spatial annotation. Brand and background shortcuts must be represented on both sides of labels.

Split by garment, owner/capture session and source before augmentation. Keep all crops/edits of an item in one split. Reserve a fresh locked test set; the current exposed examples are development data. No self-generated model label becomes expert ground truth. Synthetic defects can test plumbing and augmentation, but cannot establish real-condition accuracy.

Measure damage misses, false alarms, abstentions, localization accuracy and human review burden separately. Use per-item paired regressions and uncertainty intervals; report low-confidence cases rather than hiding them. Candidate acceptance requires preservation of known strengths plus fresh-data improvement, phone p95 latency, peak memory, temperature/power and offline failure recovery. Proposed mobile budgets must remain targets until measured on actual devices.

## Research basis

The [MobileNetV3 paper](https://arxiv.org/abs/1905.02244) and [Torchvision model documentation](https://docs.pytorch.org/vision/main/models/generated/torchvision.models.mobilenet_v3_small.html) support compact feature extraction, not motorcycle damage accuracy. [ONNX Runtime mobile](https://onnxruntime.ai/docs/tutorials/mobile/) supports local deployment. Its [precision guidance](https://onnxruntime.ai/docs/performance/model-optimizations/float16.html) and [quantization guidance](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html) explain why size changes require accuracy and runtime validation. Our two int8 candidates failed those decision-preservation checks.

[WinCLIP](https://arxiv.org/abs/2303.14814) and [Segment Any Anomaly](https://arxiv.org/abs/2305.10724) motivate region/anomaly experiments. Their reported settings do not validate motorcycle gear. Our texture/CLIP region probe did not establish a useful damage discriminator, so it remains outside policy.
