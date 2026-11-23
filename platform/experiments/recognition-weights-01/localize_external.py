"""Apply the previously fixed, label-blind region proposal to the two external mark classes."""

from collections import defaultdict
import json, sys
from pathlib import Path
from time import perf_counter
import cv2
from localize import monochrome, select, evaluate

if __name__ == "__main__":
    cv2.setNumThreads(1)
    folder = Path(sys.argv[1])
    sources = json.loads((folder / "sources.json").read_text(encoding="utf8"))["members"]
    rows = []
    for m in sources:
        if m["source"] != "wargon":
            continue
        image = monochrome(folder / "raw" / (m["id"] + ".jpg"))
        started = perf_counter()
        crops = select(image, m["id"])
        boxes = [[0, *m["box"]]]
        rows.append(
            {
                "id": m["id"],
                "class": m["class"],
                "ms": round((perf_counter() - started) * 1000, 3),
                "proposals": crops,
                "metrics": {k: evaluate(v, boxes) for k, v in crops.items()},
            }
        )
    counts = {}
    for cohort in ("holes", "spots", "all"):
        rr = [r for r in rows if r["class"] == cohort or cohort == "all"]
        counts[cohort] = {
            "n": len(rr),
            **{
                m: {k: sum(r["metrics"][m][k] for r in rr) for k in ("covered", "pointing")}
                for m in ("center", "coverage", "adaptive")
            },
        }
    (folder / "location-results.json").write_text(
        json.dumps({"counts": counts, "rows": rows}, indent=2) + "\n", encoding="utf8"
    )
    print(json.dumps(counts))
