"""Paired, item-stratified statistics; no fitting. Run only on the fully frozen run."""

import json, sys, hashlib
from pathlib import Path
import numpy as np


def read(out, name):
    return json.loads((out / name).read_bytes())


def main(out):
    spec = read(out, "protocol.json")
    raw = read(out, "sources.json")
    cases = read(out, "cases.json")
    weights = read(out, "weight-manifest.json")
    digest = hashlib.sha256((out / "protocol.json").read_bytes()).hexdigest()
    assert raw["protocolSha"] == cases["protocolSha256"] == weights["protocolSha256"] == digest
    rows = [json.loads(x) for x in (out / "scores.jsonl").read_text().splitlines()]
    t = [json.loads(x) for x in (out / "telemetry.jsonl").read_text().splitlines()]
    assert t[-1]["event"] == "stop" and t[-1]["failure"] is None
    scores = {}
    repeats = []
    for r in rows:
        if r["repeat"]:
            repeats.append(r)
            continue
        assert r["manifestDigest"] == weights["arms"][r["arm"]]["manifestDigest"]
        scores[r["id"], r["arm"]] = r["answers"].get("broken", {}).get("p", float("nan"))
    members = {m["item"]: m for m in raw["members"]}
    arms = list(spec["arms"])

    def make(items):
        return np.array([[scores[m["id"] + "-" + mode, arm] for arm in arms] for m in items])

    def pairs(h, s):
        return (h[:, None, :] > s[None, :, :]).astype(float) + 0.5 * (
            h[:, None, :] == s[None, :, :]
        )

    result = {}
    gates = {}
    for mode in ["region", "whole"]:
        result[mode] = {}
        for split in ["A", "B", "pooled", "sharedDates"]:

            def subset(tag):
                return [
                    m
                    for m in members.values()
                    if m["class"] == tag
                    and (
                        split == "pooled"
                        or (split == "sharedDates" and m["sharedDate"])
                        or m["partition"] == split
                    )
                ]

            h, s = make(subset("holes")), make(subset("spots"))
            missing = [
                int(np.isnan(h[:, i]).sum() + np.isnan(s[:, i]).sum()) for i in range(len(arms))
            ]
            h = h[~np.isnan(h).any(axis=1)]
            s = s[~np.isnan(s).any(axis=1)]
            pair = pairs(h, s)
            auc = pair.mean(axis=(0, 1))
            totals = pair.sum(axis=(0, 1))
            rng = np.random.default_rng(11807)
            drawh = rng.integers(len(h), size=(5000, len(h)))
            draws = rng.integers(len(s), size=(5000, len(s)))
            entry = {}
            for i, arm in enumerate(arms):
                delta = pair[:, :, i] - pair[:, :, 0]
                boot = delta[drawh[:, :, None], draws[:, None, :]].mean(axis=(1, 2))
                lo, hi = np.quantile(boot, [0.025, 0.975])
                entry[arm] = dict(
                    holes=len(h),
                    spots=len(s),
                    missing=missing[i],
                    auc=float(auc[i]),
                    winsWithHalfTies=float(totals[i]),
                    pairs=len(h) * len(s),
                    ties=int((h[:, None, i] == s[None, :, i]).sum()),
                    aucChange=float(auc[i] - auc[0]),
                    ci95=[float(lo), float(hi)],
                    missedHolesAtHalf=int((h[:, i] < 0.5).sum()),
                    falseAlarmsAtHalf=int((s[:, i] >= 0.5).sum()),
                    introducedHoleMisses=int(((h[:, 0] >= 0.5) & (h[:, i] < 0.5)).sum()),
                    introducedSpotAlarms=int(((s[:, 0] < 0.5) & (s[:, i] >= 0.5)).sum()),
                    recoveredMisses=int(((h[:, 0] < 0.5) & (h[:, i] >= 0.5)).sum()),
                    removedAlarms=int(((s[:, 0] >= 0.5) & (s[:, i] < 0.5)).sum()),
                )
            result[mode][split] = entry
    # Exact comparisons within the same acquisition day; some days lack both classes.
    perdate = {}
    mode = "region"
    for date in sorted({m["date"] for m in members.values()}):
        h, s = [
            make([m for m in members.values() if m["class"] == tag and m["date"] == date])
            for tag in ["holes", "spots"]
        ]
        if not len(h) or not len(s):
            continue
        h = h[~np.isnan(h).any(axis=1)]
        s = s[~np.isnan(s).any(axis=1)]
        if len(h) and len(s):
            perdate[date] = {
                "n": [len(h), len(s)],
                "auc": dict(zip(arms, pairs(h, s).mean(axis=(0, 1)).tolist())),
            }
    prim = spec.get("primary", "vision-half")
    po = result["region"]["pooled"][prim]
    gates = {
        "positiveBothHalves": all(result["region"][s][prim]["aucChange"] > 0 for s in ["A", "B"]),
        "positiveLowerCI": po["ci95"][0] > 0,
        "noNewMisses": po["introducedHoleMisses"] == 0,
        "noNewAlarms": po["introducedSpotAlarms"] == 0,
        "wholeNotWorse": result["whole"]["pooled"][prim]["aucChange"] >= 0,
        "complete": all(
            x["missing"] == 0 for m in result.values() for g in m.values() for x in g.values()
        ),
    }
    repeat = [abs(r["answers"]["broken"]["p"] - scores[r["id"], r["arm"]]) for r in repeats]
    gaps = {}
    mode = "region"
    for arm in arms:
        whole = result["whole"]["pooled"][arm]
        region = result["region"]["pooled"][arm]
        gaps[arm] = region["auc"] - whole["auc"]
    summary = dict(
        items=len(members),
        mainRows=len(scores),
        repeatCount=len(repeat),
        repeatMaxDifference=max(repeat),
        hardware=t[-1]["health"],
        metrics=result,
        withinAcquisitionDate=perdate,
        regionMinusWhole=gaps,
        gates=gates,
        passesPreliminaryGates=all(gates.values()),
    )
    (out / "results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf8")
    print(
        json.dumps(
            {
                "region": result["region"]["pooled"],
                "whole": {k: v["auc"] for k, v in result["whole"]["pooled"].items()},
                "gates": gates,
                "halves": [
                    {a: d["winsWithHalfTies"] for a, d in result["region"][s].items()}
                    for s in ["A", "B"]
                ],
                "noise": max(repeat),
            }
        )
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]))
