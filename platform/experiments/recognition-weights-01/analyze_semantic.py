"""Analyze paired task and sham weights on the frozen publisher/garment reserve and external data."""

from collections import Counter, defaultdict
import json, sys
from pathlib import Path
import numpy as np

ARMS = ("base", "semantic", "control")


def read(path):
    return json.loads(path.read_text(encoding="utf8"))


def lines(path):
    return [json.loads(l) for l in path.read_text(encoding="utf8").splitlines() if l.strip()]


def retained(folder):
    events = lines(folder / "telemetry.jsonl")
    started = {}
    for e in events:
        if e["event"] == "begin":
            started[e["key"]] = e["at"]
    complete = {
        e["key"] for e in events if e["event"] == "complete" and e["at"] >= started[e["key"]]
    }
    kept = {}
    for r in lines(folder / "scores.jsonl"):
        k = f'{r["block"]}/{r["arm"]}/{str(r["repeat"]).lower()}'
        if k in complete and r["at"] >= started[k]:
            kept[r["key"]] = r
    expected = read(folder / "cases.json")["cases"]
    if len([r for r in kept.values() if not r["repeat"]]) != len(expected) * 3:
        raise ValueError("Incomplete paired evaluation")
    for c in expected:
        for arm in ARMS:
            if kept[f'main/{arm}/{c["id"]}']["normalizedSha256"] != c["normalizedSha256"]:
                raise ValueError("Rendition changed")
    return kept, expected, events


def p(row, k):
    return row["answers"].get(k, {}).get("p")


def auc(y, values):
    if not len(y) or len(set(y)) != 2:
        return None
    pos = np.array(values)[np.array(y) == True]
    neg = np.array(values)[np.array(y) == False]
    comp = np.subtract.outer(pos, neg)
    return float(((comp > 0) + 0.5 * (comp == 0)).mean())


def round6(x):
    return None if x is None else round(float(x), 6)


def build_table(group, scored, positive, keys):
    rows = []
    missing = []
    for c in group:
        r = scored[c["id"]]
        vals = [p(r, k) for k in keys]
        if any(v is None for v in vals):
            missing.append(c["id"])
            continue
        margin = vals[0] if len(vals) == 1 else vals[0] - vals[1]
        rows.append(
            {
                "id": c["id"],
                "item": c.get("item", c["id"]),
                "y": positive(c),
                "score": margin,
                "group": c["group"],
            }
        )
    return rows, missing


def table(group, raw, positive, keys):
    kept, missing = build_table(group, raw, positive, keys)
    return {
        "n": len(kept),
        "positive": sum(r["y"] for r in kept),
        "auc": round6(auc([r["y"] for r in kept], [r["score"] for r in kept])),
        "missing": missing,
    }


def paired_boot(data, other, unit_key):
    # Resample whole item/source units with replacement, within each represented class.
    index = defaultdict(list)
    for i, r in enumerate(data):
        index[(bool(r["y"]), r[unit_key])].append(i)
    rng = np.random.default_rng(94118)
    keys = [[k for k in index if k[0] == y] for y in [True, False]]
    if not all(keys):
        return None
    bootstrap = []
    arr_y = [r["y"] for r in data]
    a = [r["score"] for r in data]
    b = [r["score"] for r in other]
    for _ in range(1000):
        idx = [
            i for ids in keys for v in rng.integers(0, len(ids), len(ids)) for i in index[ids[v]]
        ]
        ys = [arr_y[i] for i in idx]
        bootstrap.append(auc(ys, [b[i] for i in idx]) - auc(ys, [a[i] for i in idx]))
    return [round6(v) for v in np.percentile(bootstrap, [2.5, 97.5])]


def main():
    folder = Path(sys.argv[1])
    raw, cases, events = retained(folder)
    spec = read(folder / "protocol.json")
    is_ext = spec["studyType"] == "external"
    armraw = {a: {c["id"]: raw[f'main/{a}/{c["id"]}'] for c in cases} for a in ARMS}
    groups = {}
    results = {}
    detail = {}
    if not is_ext:
        for name, filter_, pos in [
            (
                "fabric",
                lambda c: c["cohort"].startswith("fabric_"),
                lambda c: c["cohort"] == "fabric_positive",
            ),
            (
                "transfer",
                lambda c: c["cohort"] in ("transfer_damaged", "transfer_clean"),
                lambda c: c["cohort"] == "transfer_damaged",
            ),
        ]:
            g = [c for c in cases if filter_(c)]
            groups[name] = (g, pos)
            if name == "fabric":
                for sess in sorted({r["group"] for r in g}):
                    groups[name + "/" + sess] = ([r for r in g if r["group"] == sess], pos)
    else:
        for mode in ["whole", "region"]:
            group = [r for r in cases if r["source"] == "wargon" and r["mode"] == mode]
            groups["wargon/" + mode] = (group, lambda r: r["class"] == "holes")
            groups["wargon/sharedDates/" + mode] = (
                [r for r in group if r["sharedDate"]],
                lambda r: r["class"] == "holes",
            )
    for name, (g, pos) in groups.items():
        results[name] = {}
        detail[name] = {}
        for arm in ARMS:
            ar = armraw[arm]
            results[name][arm] = {
                "margin": table(g, ar, pos, ["breach", "continuous"]),
                "breachOnly": table(g, ar, pos, ["breach"]),
            }
            results[name][arm]["stockBrokenQuestion"] = table(g, ar, pos, ["broken"])
            detail[name][arm] = build_table(g, ar, pos, ["breach", "continuous"])[0]
        if len(detail[name]["base"]) == len(detail[name]["semantic"]) == len(g) and g:
            unit = "group" if name == "transfer" else "item"
            results[name]["conditionalBootstrapDelta95"] = paired_boot(
                detail[name]["base"], detail[name]["semantic"], unit
            )
    if not is_ext:
        sessions = [k for k in results if k.startswith("fabric/")]
        primary = {
            a: round6(np.mean([results[s][a]["margin"]["auc"] for s in sessions])) for a in ARMS
        }
        stockq = {
            a: round6(np.mean([results[s][a]["stockBrokenQuestion"]["auc"] for s in sessions]))
            for a in ARMS
        }
        transfer = groups["transfer"][0]
        bands = {}
        for arm in ARMS:
            bands[arm] = {}
            for c in transfer:
                r = armraw[arm][c["id"]]
                v = [p(r, k) for k in ("broken", "road_contact")]
                bands[arm][c["id"]] = (
                    "missing"
                    if None in v
                    else "clear" if max(v) < 0.078 else "block" if max(v) >= 0.255 else "review"
                )
        shifts = {
            arm: [
                {
                    "id": c["id"],
                    "cohort": c["cohort"],
                    "from": bands["base"][c["id"]],
                    "to": bands[arm][c["id"]],
                }
                for c in transfer
                if bands["base"][c["id"]] != bands[arm][c["id"]]
            ]
            for arm in ("semantic", "control")
        }
        result = {
            "primaryMeanWithinSessionAuc": primary,
            "sameCohortOriginalBrokenQuestionMeanAuc": stockq,
            "transferBandChanges": shifts,
        }
    else:
        rise = [c for c in cases if c["source"] == "rise"]
        by_item = defaultdict(list)
        for c in rise:
            by_item[c["item"]].append(c)
        result = {"riseItemLevel": {}}
        for arm in ARMS:
            scores = []
            truth = []
            missing = []
            legacy = []
            for item, views in by_item.items():
                if {c["view"] for c in views} != {"front", "back"}:
                    raise ValueError("Missing physical view")
                margins = []
                for c in views:
                    r = armraw[arm][c["id"]]
                    a, b = p(r, "breach"), p(r, "continuous")
                    if a is not None and b is not None:
                        margins.append(a - b)
                if len(margins) != 2:
                    missing.append(item)
                    continue
                scores.append(max(margins))
                truth.append(views[0]["class"] == "holes")
                old = [p(armraw[arm][v["id"]], "broken") for v in views]
                legacy.append(None if None in old else max(old))
            result["riseItemLevel"][arm] = {
                "n": len(scores),
                "positive": sum(truth),
                "auc": round6(auc(truth, scores)),
                "stockBrokenAuc": round6(auc(truth, legacy)) if None not in legacy else None,
                "missing": missing,
            }
        result["nativeBoxPixels"] = {
            k: [
                round6(x)
                for x in np.percentile(
                    [
                        c["nativeBoxLongPixels"]
                        for c in cases
                        if c["source"] == "wargon" and c["mode"] == "region" and c["class"] == k
                    ],
                    [0, 50, 100],
                )
            ]
            for k in ("holes", "spots")
        }
    result["groups"] = results
    result["failureCount"] = {
        arm: sum(bool(r["failures"]) for r in armraw[arm].values()) for arm in ARMS
    }
    result["rawAndMatchedRows"] = [len(lines(folder / "scores.jsonl")), len(raw)]
    result["operationalEvents"] = [e for e in events if e["event"] in ("start", "stop")]
    result["repeatMaxDelta"] = []
    for r in raw.values():
        if r["repeat"]:
            ref = armraw["base"][r["id"]]
            diff = [
                abs(p(r, k) - p(ref, k))
                for k in ("breach", "continuous")
                if p(r, k) is not None and p(ref, k) is not None
            ]
            result["repeatMaxDelta"].append(
                {"id": r["id"], "delta": round6(max(diff)) if diff else None}
            )
    (folder / "semantic-results.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf8"
    )
    print(
        json.dumps(
            {
                k: v
                for k, v in result.items()
                if k not in ("groups", "operationalEvents", "repeatMaxDelta")
            }
        )
    )
    for name, v in results.items():
        print(name, {a: v[a]["margin"]["auc"] for a in ARMS})


if __name__ == "__main__":
    main()
