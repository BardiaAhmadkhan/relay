"""Choose a second region using only the photo and the learned textile head."""

from pathlib import Path
import argparse, json
import cv2
import numpy as np
from trained_head import schema, session, letterbox, sigmoid, sha


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("donor", type=Path)
    ap.add_argument("workspace", type=Path)
    args = ap.parse_args()
    src = args.donor
    out = args.workspace
    out.mkdir(parents=True, exist_ok=True)
    cv2.setNumThreads(1)
    manifest = json.loads((src / "head-manifest.json").read_text("utf8"))
    weights = src / "contrast.onnx"
    if sha(weights.read_bytes()) != manifest["candidateSha256"]:
        raise ValueError("Different learned head")
    rt, output = session(weights, schema())
    cases = json.loads((src / "cases.json").read_text("utf8"))["cases"]
    rows = []
    for c in cases:
        if c["mode"] != "whole":
            continue
        f = src / "normalized" / (c["id"] + ".jpg")
        if sha(f.read_bytes()) != c["normalizedSha256"]:
            raise ValueError("Input changed")
        pixels, (left, top, rw, rh) = letterbox(f)
        outputs, logits = rt.run(["output0", output], {"images": pixels})
        outputs = outputs[0].astype(np.float64)
        logits = logits[0].astype(np.float64)
        h = sigmoid(logits[0] + logits[1])
        stain = sigmoid(logits[1])
        energy = np.maximum(h, stain)
        x = (outputs[0] - left) / rw
        y = (outputs[1] - top) / rh
        w = outputs[2] / rw
        hbox = outputs[3] / rh
        valid = (x >= 0) & (x <= 1) & (y >= 0) & (y <= 1) & (w > 0) & (hbox > 0)
        if not valid.any():
            raise ValueError("No valid proposal")
        idx = int(np.argmax(np.where(valid, energy, -np.inf)))
        x1 = max(0.0, x[idx] - w[idx] / 2)
        x2 = min(1.0, x[idx] + w[idx] / 2)
        y1 = max(0.0, y[idx] - hbox[idx] / 2)
        y2 = min(1.0, y[idx] + hbox[idx] / 2)
        rows.append(
            {
                "id": c["id"],
                "item": c["item"],
                "inputSha": c["normalizedSha256"],
                "box": [(x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1],
                "donorHole": float(h[idx]),
                "donorStain": float(stain[idx]),
            }
        )
    protocol = Path(__file__).with_name("unguided-protocol.json").read_bytes()
    (out / "proposal-list.json").write_text(
        json.dumps(
            {"protocolSha": sha(protocol), "modelSha": manifest["candidateSha256"], "rows": rows},
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    print(len(rows), "image-only proposals")


if __name__ == "__main__":
    main()
