"""Paired physical-item comparison of learned, centered, and annotation-supplied detail."""

import json, sys
from pathlib import Path
from collections import Counter, defaultdict
import numpy as np
from analyze_semantic import auc, round6, lines, read


def main():
    folder = Path(sys.argv[1])
    cases = read(folder / "cases.json")["cases"]
    raw = lines(folder / "scores.jsonl")
    events = lines(folder / "telemetry.jsonl")
    starts = {e["key"]: e["at"] for e in events if e["event"] == "begin"}
    closed = {e["key"] for e in events if e["event"] == "complete" and e["at"] >= starts[e["key"]]}
    eff = {}
    for r in raw:
        block = f'{r["block"]}/{r["arm"]}/{str(r["repeat"]).lower()}'
        if block in closed and r["at"] >= starts[block]:
            eff[r["key"]] = r
    items = defaultdict(dict)
    missing = []
    for c in cases:
        row = eff["main/base/" + c["id"]]
        assert row["normalizedSha256"] == c["normalizedSha256"]
        answer = row["answers"].get("broken")
        if answer is None:
            missing.append(c["id"])
            continue
        e = items[c["item"]]
        e[c["mode"]] = answer["p"]
        e["class"] = c["class"]
        if c["mode"] == "proposed":
            e["proposedCoversMark"] = c["containsMarkCenter"]
            e["proposedSide"] = c["geometry"]["side"]
        if c["mode"] == "centered":
            e["centeredCoversMark"] = c["containsMarkCenter"]
            e["centeredSide"] = c["geometry"]["side"]
    ready = [
        v
        for v in items.values()
        if all(k in v for k in ("whole", "oracle", "proposed", "centered"))
    ]
    if not ready:
        raise ValueError("No complete paired items")
    for v in ready:
        assert v["proposedSide"] == v["centeredSide"]
        for k in ("oracle", "proposed", "centered"):
            v["full_plus_" + k] = max(v["whole"], v[k])
    keys = (
        "whole",
        "proposed",
        "centered",
        "oracle",
        "full_plus_proposed",
        "full_plus_centered",
        "full_plus_oracle",
    )
    vals = {k: np.array([v[k] for v in ready]) for k in keys}
    y = np.array([v["class"] == "holes" for v in ready])
    pa = np.flatnonzero(y)
    na = np.flatnonzero(~y)

    def paired_counts(a, b):
        A = np.sign(np.subtract.outer(a[pa], a[na]))
        B = np.sign(np.subtract.outer(b[pa], b[na]))
        return {
            "improvedPairs": int(np.sum(B > A)),
            "worsenedPairs": int(np.sum(B < A)),
            "tiedComparisons": int(np.sum(B == A)),
        }

    boot = {k: [] for k in ("whole", "full_plus_centered")}
    rng = np.random.default_rng(151118)
    for _ in range(1500):
        ix = np.r_[rng.choice(pa, len(pa), replace=True), rng.choice(na, len(na), replace=True)]
        cand = auc(y[ix], vals["full_plus_proposed"][ix])
        for k in boot:
            boot[k].append(cand - auc(y[ix], vals[k][ix]))
    repeats = []
    for r in eff.values():
        if not r["repeat"]:
            continue
        a = eff["main/base/" + r["id"]]["answers"].get("broken")
        b = r["answers"].get("broken")
        repeats.append(abs(a["p"] - b["p"]) if a and b else None)
    report = {
        "n": len(ready),
        "positive": int(y.sum()),
        "missing": missing,
        "auc": {k: round6(auc(y, vals[k])) for k in keys},
        "paired": {
            k: {
                **paired_counts(vals[k], vals["full_plus_proposed"]),
                "delta95": [round6(z) for z in np.percentile(boot[k], [2.5, 97.5])],
            }
            for k in boot
        },
        "markedCenterCoverage": {
            cl: {
                m: sum(bool(v[m + "CoversMark"]) for v in ready if v["class"] == cl)
                for m in ("proposed", "centered")
            }
            for cl in ("holes", "spots")
        },
        "repeats": repeats,
        "retainedRows": len(eff),
        "items": items,
    }
    (folder / "unguided-results.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf8"
    )
    print(json.dumps({k: v for k, v in report.items() if k != "items"}))


if __name__ == "__main__":
    main()
