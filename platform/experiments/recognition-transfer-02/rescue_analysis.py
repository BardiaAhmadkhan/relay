import json, hashlib, sys
from pathlib import Path
import numpy as np

out = Path(sys.argv[1])
load = lambda f: json.loads((out / f).read_bytes())
protocol = (out / "protocol.json").read_bytes()
cases = load("cases.json")
assert cases["protocolSha256"] == hashlib.sha256(protocol).hexdigest()
tele = [json.loads(x) for x in (out / "telemetry.jsonl").read_text().splitlines()]
assert tele[-1]["event"] == "stop" and tele[-1]["failure"] is None
rows = [json.loads(x) for x in (out / "scores.jsonl").read_text().splitlines()]
sc = {(x["id"], x["arm"]): x for x in rows if not x["repeat"]}
idx = {(x["item"], x["mode"]): x for x in cases["cases"]}
members = load("sources.json")["members"]
report = {}
log = []
assert len(sc) == len(cases["cases"]) * 2
for mode, other in [("centre", "shift"), ("shift", "centre")]:
    data = []
    for m in members:
        item = m["item"]
        u = idx[item, mode]
        v = idx[item, other]

        def get(c, arm):
            row = sc[c["id"], arm]
            assert row["normalizedSha256"] == c["normalizedSha256"] and not row["failures"]
            return row["answers"]["broken"]

        x, y, z = get(u, "base"), get(u, "vision-half"), get(v, "base")
        p, e, q = x["p"], y["p"], z["p"]
        trigger = 0.20 <= p < 0.50 and u["nativeCrop"]["side"] >= 96
        b = p >= 0.50
        rules = dict(
            stock=b,
            edited=e >= 0.50,
            thresholdOnly=p >= 0.20,
            rescue=b or trigger and e >= 0.50,
            otherView=b or trigger and q >= 0.50,
            concordant=b or trigger and e >= 0.50 and q >= 0.50,
        )
        row = dict(
            item=item,
            mode=mode,
            part=m["partition"],
            truth=m["class"],
            p=p,
            edit=e,
            other=q,
            trigger=trigger,
            samePixels=u["normalizedSha256"] == v["normalizedSha256"],
            side=u["nativeCrop"]["side"],
            baseMs=x["ms"],
            extraMs=y["ms"] if trigger else 0,
            baseTokens=x["tokens"],
            extraTokens=y["tokens"] if trigger else 0,
            rules=rules,
        )
        data.append(row)
        log.append(row)
    report[mode] = {}
    for part in ["A", "B", "all"]:
        group = [d for d in data if part == "all" or d["part"] == part]
        cols = {}
        budget = sum(d["rules"]["rescue"] for d in group)
        best = {d["item"] for d in sorted(group, key=lambda d: (-d["p"], d["item"]))[:budget]}
        for rule in [*group[0]["rules"], "sameBudgetStock"]:
            yes = lambda d: d["item"] in best if rule == "sameBudgetStock" else d["rules"][rule]

            def n(tag, cond):
                return sum(cond(d) for d in group if d["truth"] == tag)

            cols[rule] = dict(
                tp=n("holes", yes),
                fp=n("spots", yes),
                recoveredHoles=n("holes", lambda d: yes(d) and not d["rules"]["stock"]),
                lostHoles=n("holes", lambda d: d["rules"]["stock"] and not yes(d)),
                newSpotAlarms=n("spots", lambda d: yes(d) and not d["rules"]["stock"]),
            )
        triggers = [d for d in group if d["trigger"]]
        report[mode][part] = dict(
            n=len(group),
            holes=sum(d["truth"] == "holes" for d in group),
            spots=sum(d["truth"] == "spots" for d in group),
            rendersSame=sum(d["samePixels"] for d in group),
            triggered=len(triggers),
            extraTokenFraction=sum(d["extraTokens"] for d in group)
            / sum(d["baseTokens"] for d in group),
            meanExtraInferenceMsPerMarkedView=sum(d["extraMs"] for d in group) / len(group),
            warmExtraMedianMs=float(np.median([d["extraMs"] for d in triggers])) if triggers else 0,
            result=cols,
        )
gates = {
    "stockPositivePreserved": all(
        a["all"]["result"]["rescue"]["lostHoles"] == 0 for a in report.values()
    ),
    "noNewFalseAlarmsBothPositions": all(
        report[m][s]["result"]["rescue"]["newSpotAlarms"] == 0 for m in report for s in ["A", "B"]
    ),
    "recoveriesBothHalvesAndPositions": all(
        report[m][s]["result"]["rescue"]["recoveredHoles"] > 0 for m in report for s in ["A", "B"]
    ),
    "beatsStockAtSameReviewBudget": report["centre"]["all"]["result"]["rescue"]["tp"]
    > report["centre"]["all"]["result"]["sameBudgetStock"]["tp"],
}
repeat = [
    abs(x["answers"]["broken"]["p"] - sc[x["id"], x["arm"]]["answers"]["broken"]["p"])
    for x in rows
    if x["repeat"]
]
result = dict(
    items=len(members),
    mainRows=len(sc),
    repeats=len(repeat),
    repeatMaximum=max(repeat),
    hardware=tele[-1]["health"],
    comparison=report,
    gates=gates,
    passesProxyGate=all(gates.values()),
    timingBoundary="Measured conditional warm inference only; transfer/switching, queuing, decoding and API latency excluded.",
)
(out / "results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
(out / "paired-cases.jsonl").write_text("".join(json.dumps(x) + "\n" for x in log), encoding="utf8")
print(json.dumps({m: report[m]["all"] for m in report}))
print(gates)
