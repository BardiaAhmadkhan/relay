#!/usr/bin/env bash
# Unattended experiment queue A. Each step resumes from its own JSONL, so re-running is safe.
# Run from the repository root after the reference battery (b1, qwen3.5:4b, edge 1600) has finished.
set -u
cd "$(dirname "$0")/../.."
run() { echo "=== $(date +%H:%M:%S) $*"; "$@" || echo "!!! step failed: $*"; }

# 1. One generation per image, scores read from the value tokens; then the five-level verbal variant.
run node experiments/backend-v2/run-onecall.mjs
run node experiments/backend-v2/run-onecall.mjs --mode verbal

# 2. Image-size sweep on the two exclusion questions (the cost lever).
for edge in 1024 768 512 384; do
  run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge $edge --scored
done

# 3. Localisation on the fabric images that carry publisher boxes, then overlays for the local-only photos.
run node experiments/backend-v2/run-locate.mjs
run node experiments/backend-v2/run-locate.mjs --ids sample-01,sample-02,sample-03,commons-031,commons-093,commons-037 --overlay --tag gear

# 4. Capture-gate calibration: Gaussian blur at the 1024 px working size.
for blur in 1.5 3 6; do
  run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge 1024 --blur $blur --scored
done

# 5. Stability under a second JPEG pass and under dimming.
run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge 1024 --quality 55 --scored
run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --edge 1024 --brightness 0.55 --scored

# 6. Model-size sweep at the reference edge (longest step, so last).
# qwen3.5:9b removed on 2026-11-17: the laptop lost power twice within two minutes of starting it
# (experiment report E11). Do not run it on this machine.
for model in qwen3.5:2b qwen3.5:0.8b gemma4:e2b; do
  run node experiments/backend-v2/run-battery.mjs --battery b1 --only break,slide --model $model --scored
done
echo "=== $(date +%H:%M:%S) queue A finished"
