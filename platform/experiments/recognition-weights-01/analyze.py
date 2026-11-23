"""Paired research analysis. Report every failure and compare against the unedited 2B."""

import argparse
from collections import Counter
import json
from pathlib import Path

import numpy as np


def read_lines(f):
    return [json.loads(x) for x in f.read_text(encoding="utf-8").splitlines() if x]


def summary(cases, scores, limits):
    rows = []
    for case in cases:
        r = scores[case["id"]]
        a = r["answers"]
        keys = ("broken", "road_contact")
        value = max(a[k]["p"] for k in keys) if all(k in a for k in keys) else None
        band = (
            "missing"
            if value is None
            else (
                "clear"
                if value < limits["clear"]
                else "block" if value >= limits["block"] else "review"
            )
        )
        rows.append(dict(case, value=value, band=band, answers=a, failures=r["failures"]))
    return rows


def is_pos(r):
    return r["condition"] in ("damaged", "visible_defect")


def ranked(rows, multiplicity=None, equal_groups=True):
    rr = [
        r
        for r in rows
        if r["value"] is not None and (not multiplicity or multiplicity[r["group"]] > 0)
    ]
    pos = [r for r in rr if is_pos(r)]
    neg = [r for r in rr if not is_pos(r)]
    if not pos or not neg:
        return None

    def weights(items):
        n = Counter(r["group"] for r in items)
        a = np.array(
            [
                (multiplicity[r["group"]] if multiplicity is not None else 1)
                / (n[r["group"]] if equal_groups else 1)
                for r in items
            ]
        )
        return a / a.sum()

    compared = np.subtract.outer([r["value"] for r in pos], [r["value"] for r in neg])
    return float(weights(pos) @ ((compared > 0) + (compared == 0) * 0.5) @ weights(neg))


def eligible(rows):
    return [
        r
        for r in rows
        if r["cohort"]
        in (
            "damaged",
            "wear",
            "other_clean",
            "transfer_damaged",
            "transfer_clean",
            "fabric_positive",
            "fabric_negative",
        )
    ]


def rates(rows):
    return {
        name: dict(Counter(r["band"] for r in rows if is_pos(r) == positive))
        for name, positive in [("positive", True), ("negative", False)]
    }


def differences(a, b):
    assert [r["id"] for r in a] == [r["id"] for r in b]
    return [
        {
            "id": x["id"],
            "cohort": x["cohort"],
            "from": x["band"],
            "to": y["band"],
            "group": x["group"],
        }
        for x, y in zip(a, b)
        if x["band"] != y["band"]
    ]


def number(x):
    return None if x is None else round(x, 6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workspace", type=Path)
    args = ap.parse_args()
    folder = args.workspace
    spec = json.loads((folder / "protocol.json").read_text(encoding="utf-8"))
    casefile = json.loads((folder / "cases.json").read_text(encoding="utf-8"))
    cases = casefile["cases"]
    limits = casefile["fit"]
    arms = list(spec["arms"])
    raw = read_lines(folder / "scores.jsonl")
    telemetry = read_lines(folder / "telemetry.jsonl")
    # Retain only the latest successful, complete attempt of each block.
    starts = {}
    for ev in telemetry:
        if ev["event"] == "begin":
            starts[ev["key"]] = ev["at"]
    complete = {
        e["key"] for e in telemetry if e["event"] == "complete" and e["at"] >= starts[e["key"]]
    }
    kept = {}
    for r in raw:
        block = f'{r["block"]}/{r["arm"]}/{str(r["repeat"]).lower()}'
        if block in complete and r["at"] >= starts[block]:
            kept[r["key"]] = r
    if len([x for x in kept.values() if not x["repeat"]]) != len(cases) * len(arms):
        raise ValueError("Incomplete matched run")
    natural = lambda rows: [
        r for r in eligible(rows) if r["cohort"] not in ("fabric_positive", "fabric_negative")
    ]
    hist = {r["id"]: r for r in read_lines(Path("benchmarks/backend-v2/realworld--v3.jsonl"))}
    audit = {}
    for line in Path("datasets/realworld-v3/audit.txt").read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#"):
            bits = line.split()
            audit[bits[0]] = bits[1]
    byarm = {}
    full = {}
    for arm in arms:
        active = {r["id"]: r for r in kept.values() if r["arm"] == arm and not r["repeat"]}
        if not all(active[c["id"]]["normalizedSha256"] == c["normalizedSha256"] for c in cases):
            raise ValueError("Input hash mismatch")
        full[arm] = summary(cases, active, limits)
        natural_cases = natural(full[arm])
        ngr = [r for r in natural_cases if not r.get("e14Photographer", False)]
        needles = [r for r in full[arm] if r["cohort"].startswith("needle_")]
        fabric = [r for r in full[arm] if r["cohort"].startswith("fabric_")]
        correct = []
        for r in natural_cases:
            if r["subject"] not in (
                "helmet",
                "jacket",
                "trousers",
                "gloves",
                "boots",
                "suit",
                "armour",
            ):
                continue
            pick = r["answers"].get("category", {}).get("choice")
            correct.append([r["id"], pick == r["subject"]])
        byarm[arm] = {
            "naturalN": len(natural_cases),
            "posGroups": len({r["group"] for r in natural_cases if is_pos(r)}),
            "negGroups": len({r["group"] for r in natural_cases if not is_pos(r)}),
            "naturalBands": rates(natural_cases),
            "macroAuc": number(ranked(natural_cases)),
            "imageAuc": number(ranked(natural_cases, equal_groups=False)),
            "withoutE14Groups": {
                "n": len(ngr),
                "positive": sum(map(is_pos, ngr)),
                "macroAuc": number(ranked(ngr)),
                "bands": rates(ngr),
            },
            "needleBands": rates(needles),
            "fabricBands": rates(fabric),
            "fabricAuc": number(ranked(fabric)),
            "categoryCorrect": sum(v for _, v in correct),
            "categoryN": len(correct),
            "categoryRows": correct,
            "anyQuestionFailure": [[r["id"], r["failures"]] for r in full[arm] if r["failures"]],
            "commonQuestionMedianMs": round(
                float(
                    np.median(
                        [
                            r["answers"][k]["ms"]
                            for r in full[arm]
                            for k in ("broken", "road_contact", "repair")
                            if k in r["answers"]
                        ]
                    )
                ),
                2,
            ),
        }
        audited = [dict(r, condition=audit.get(r["id"], r["condition"])) for r in natural_cases]
        audited = [r for r in audited if r["condition"] != "ambiguous"]
        byarm[arm]["postAudit"] = {
            "n": len(audited),
            "macroAuc": number(ranked(audited)),
            "bands": rates(audited),
        }
    paired = {}
    for arm in arms:
        if arm == "base":
            continue
        x = natural(full["base"])
        y = natural(full[arm])
        paired_rows = differences(x, y)
        group_list = sorted({r["group"] for r in x})
        rng = np.random.default_rng(20261118)
        boot = []
        for _ in range(1500):
            count = Counter(rng.choice(group_list, len(group_list), replace=True).tolist())
            v1 = ranked(x, count)
            v2 = ranked(y, count)
            if v1 is not None and v2 is not None:
                boot.append(v2 - v1)
        base_categories = dict(byarm["base"]["categoryRows"])
        cand_categories = dict(byarm[arm]["categoryRows"])
        paired[arm] = {
            "macroAucDelta": number(ranked(y) - ranked(x)),
            "groupBootstrap95": [number(z) for z in np.percentile(boot, [2.5, 97.5])],
            "bootstrapValid": len(boot),
            "naturalBandChanges": paired_rows,
            "needleBandChanges": differences(
                [r for r in full["base"] if r["cohort"].startswith("needle_")],
                [r for r in full[arm] if r["cohort"].startswith("needle_")],
            ),
            "newlyClearedPositives": [
                d["id"]
                for d in paired_rows
                if d["cohort"] in ("damaged", "transfer_damaged") and d["to"] == "clear"
            ],
            "newCleanBlocks": [
                d["id"]
                for d in paired_rows
                if d["cohort"] in ("wear", "other_clean", "transfer_clean") and d["to"] == "block"
            ],
            "lostCorrectCategory": [
                i for i in base_categories if base_categories[i] and not cand_categories[i]
            ],
            "gainedCorrectCategory": [
                i for i in base_categories if not base_categories[i] and cand_categories[i]
            ],
        }
    fwd = [
        r for r in full["base"] if "surface" in r["answers"] and "surface_reverse" in r["answers"]
    ]
    would = []
    susceptible = []
    for r in fwd:
        a = r["answers"]
        if (
            a["road_contact"]["p"] < limits["block"]
            or a["broken"]["p"] >= limits["clear"]
            or a["repair"]["p"] >= 0.30
        ):
            continue
        susceptible.append(r["id"])
        if all(
            a[k]["choice"] == "continuous_wear" and a[k]["probabilities"]["continuous_wear"] >= 0.75
            for k in ("surface", "surface_reverse")
        ):
            would.append([r["id"], r["condition"]])
    repeats = []
    for r in kept.values():
        if not r["repeat"]:
            continue
        ref = kept["main/base/" + r["id"]]
        qs = [
            k
            for k in ("road_contact", "broken", "repair")
            if k in ref["answers"] and k in r["answers"]
        ]
        repeats.append(
            {
                "id": r["id"],
                "maxProbabilityDelta": (
                    number(max(abs(ref["answers"][k]["p"] - r["answers"][k]["p"]) for k in qs))
                    if qs
                    else None
                ),
            }
        )
    common = [r for r in natural(full["base"]) if r["id"] in hist]
    result = {
        "conditionBandDiagnosticOnly": True,
        "arms": byarm,
        "paired": paired,
        "sourceGroups": {c["id"]: c["group"] for c in cases},
        "stockVerifier": {
            "bothOrdersAvailable": len(fwd),
            "matchingTopChoice": sum(
                r["answers"]["surface"]["choice"] == r["answers"]["surface_reverse"]["choice"]
                for r in fwd
            ),
            "eligibleRoadOnlyCases": susceptible,
            "proposedBlockToReview": would,
        },
        "stockRepeats": repeats,
        "historical4bOnSamePhotos": {
            "n": len(common),
            "definition": "Recorded v3.1 age-matched roles, including its detail cascade; separate from controlled fixed-resolution A/B.",
            "bands": rates([dict(r, band=hist[r["id"]]["band"]) for r in common]),
        },
        "startAndStops": [e for e in telemetry if e["event"] in ("start", "stop")],
        "rawRowsIncludingAttempts": len(raw),
        "retainedRows": len(kept),
    }
    (folder / "results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "auc": {k: v["macroAuc"] for k, v in byarm.items()},
                "bands": {k: v["naturalBands"] for k, v in byarm.items()},
                "paired": paired,
                "verifier": result["stockVerifier"],
            }
        )
    )


if __name__ == "__main__":
    main()
