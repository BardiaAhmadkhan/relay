"""Compare two fixed-area region requests without fitting weights or using box locations at inference."""

from collections import Counter, defaultdict
import hashlib, json, sys
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np
from PIL import Image, ImageOps


def monochrome(file):
    with Image.open(file) as im:
        return np.array(ImageOps.exif_transpose(im).convert("L"), dtype=np.float32)


def saliency(img, edge):
    h, w = img.shape
    resized = cv2.resize(
        img,
        (max(3, round(w * edge / max(h, w))), max(3, round(h * edge / max(h, w)))),
        interpolation=cv2.INTER_AREA,
    )
    padded = np.pad(resized, 12, mode="reflect")
    spectrum = np.fft.fft2(padded)
    amplitude = np.log(np.maximum(np.abs(spectrum), 1e-9))
    smooth = cv2.blur(amplitude, (3, 3))
    residual = amplitude - smooth
    power = np.abs(np.fft.ifft2(np.exp(residual + 1j * np.angle(spectrum)))) ** 2
    result = cv2.GaussianBlur(power, (0, 0), 2)[12:-12, 12:-12]
    return result / max(float(result.mean()), 1e-12)


def crop_box(c):
    x, y = c
    r = 1 / 6
    return [x - r, y - r, x + r, y + r]


CENTER = (0.5, 0.5)
GRID = [
    (1 / 6 + i / 6, 1 / 6 + j / 6) for j in range(5) for i in range(5) if i in (0, 4) or j in (0, 4)
]


def select(img, photo_id):
    small = saliency(img, 80)
    big = saliency(img, 160)
    mapped = (
        cv2.resize(small, (big.shape[1], big.shape[0]), interpolation=cv2.INTER_LINEAR) + big
    ) * 0.5
    h, w = mapped.shape

    def score(c):
        x1, y1, x2, y2 = crop_box(c)
        return float(
            np.quantile(mapped[round(y1 * h) : round(y2 * h), round(x1 * w) : round(x2 * w)], 0.9)
        )

    adaptive = max(GRID, key=score)
    idx = int.from_bytes(
        hashlib.sha256(("relay-area-control/" + photo_id).encode()).digest()[:8], "big"
    ) % len(GRID)
    return {"center": [CENTER], "coverage": [CENTER, GRID[idx]], "adaptive": [CENTER, adaptive]}


def hit(c, b):
    return b[0] <= c[0] <= b[2] and b[1] <= c[1] <= b[3]


def evaluate(crops, truth):
    boxes = [(x - w / 2, y - h / 2, x + w / 2, y + h / 2) for _, x, y, w, h in truth]
    return {
        "covered": any(hit((x, y), crop_box(c)) for c in crops for _, x, y, w, h in truth),
        "pointing": any(hit(c, b) for c in crops for b in boxes),
    }


def main():
    cv2.setNumThreads(1)
    out = Path(sys.argv[1])
    cases = []
    for c in json.loads(Path("datasets/quality-audit-01/labels.json").read_text(encoding="utf-8"))[
        "cases"
    ]:
        boxes = [r for r in c.get("publisherBoxes", []) if r[0] >= 1]
        if c["condition"] == "visible_defect" and boxes:
            cases.append((c["id"], "archive", c["group"], Path(c["file"]), boxes))
    for c in json.loads((out / "semantic/cases.json").read_text(encoding="utf-8"))["cases"]:
        if c["cohort"] == "fabric_positive":
            truths = [
                list(map(float, line.split()))
                for line in Path(c["annotation"]).read_text().splitlines()
                if line.strip()
            ]
            cases.append((c["id"], "fresh_material", c["group"], Path(c["sourcePath"]), truths))
    rows = []
    for cid, cohort, group, f, boxes in cases:
        gray = monochrome(f)
        t = perf_counter()
        proposals = select(gray, cid)
        rows.append(
            {
                "id": cid,
                "cohort": cohort,
                "group": group,
                "ms": round(1000 * (perf_counter() - t), 3),
                "selected": proposals,
                "metrics": {k: evaluate(c, boxes) for k, c in proposals.items()},
            }
        )

    def stats(group):
        out = {"n": len(group)}
        for k in ("center", "coverage", "adaptive"):
            out[k] = {g: sum(r["metrics"][k][g] for r in group) for g in ("covered", "pointing")}
        out["adaptiveOnly"] = sum(
            r["metrics"]["adaptive"]["covered"] and not r["metrics"]["coverage"]["covered"]
            for r in group
        )
        out["coverageOnly"] = sum(
            r["metrics"]["coverage"]["covered"] and not r["metrics"]["adaptive"]["covered"]
            for r in group
        )
        out["centerMisses"] = sum(not r["metrics"]["center"]["covered"] for r in group)
        out["medianComputeMs"] = round(float(np.median([r["ms"] for r in group])), 3)
        return out

    groups = defaultdict(list)
    for r in rows:
        groups[r["cohort"]].append(r)
        groups[r["cohort"] + "/" + r["group"]].append(r)
    summary = {k: stats(v) for k, v in groups.items()}
    (out / "location-results.json").write_text(
        json.dumps(
            {
                "protocolSha": hashlib.sha256(
                    (Path(__file__).with_name("location-protocol.json")).read_bytes()
                ).hexdigest(),
                "summary": summary,
                "rows": rows,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps({k: summary[k] for k in ("archive", "fresh_material")}))


if __name__ == "__main__":
    main()
