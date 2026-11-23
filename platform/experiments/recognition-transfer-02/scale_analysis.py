"""Evaluate the preregistered multi-scale rescue and its single-checkpoint alternatives."""

import hashlib, json, sys
from pathlib import Path

out = Path(sys.argv[1])
load = lambda f: json.loads((out / f).read_bytes())
cases = load("cases.json")
assert cases["protocolSha256"] == hashlib.sha256((out / "protocol.json").read_bytes()).hexdigest()
tele = [json.loads(x) for x in (out / "telemetry.jsonl").read_text().splitlines()]
assert tele[-1]["event"] == "stop" and tele[-1]["failure"] is None
raw = [json.loads(x) for x in (out / "scores.jsonl").read_text().splitlines()]
scores = {(r["id"], r["arm"]): r for r in raw if not r["repeat"]}
assert len(scores) == len(cases["cases"]) * 2
idx = {(c["item"], c["mode"]): c for c in cases["cases"]}


def answer(c, arm):
    r = scores[c["id"], arm]
    assert not r["failures"] and r["normalizedSha256"] == c["normalizedSha256"]
    return r["answers"]["broken"]


report = {}
log = []
for loc in ["centre", "shift"]:
    data = []
    for m in load("sources.json")["members"]:
        i = m["item"]
        a = idx[i, loc + "-ordinary"]
        b = idx[i, loc + "-tight"]
        orig = answer(a, "base")
        edit = answer(a, "vision-half")
        tight = answer(b, "base")
        p, e, q = orig["p"], edit["p"], tight["p"]
        vote = p >= 0.5
        gate = 0.20 <= p < 0.5 and a["nativeCrop"]["side"] >= 96
        strong = e >= 0.80
        weak = e >= 0.50
        needTight = gate and weak and not strong
        rules = dict(
            stock=vote,
            rawEdit=e >= 0.50,
            loose=vote or gate and weak,
            strong=vote or gate and strong,
            twoStock=vote or gate and q >= 0.50,
            primary=vote or gate and (strong or weak and q >= 0.50),
        )
        row = dict(
            item=i,
            truth=m["class"],
            partition=m["partition"],
            location=loc,
            p=p,
            e=e,
            q=q,
            gate=gate,
            tightQueried=needTight,
            extraTokens=(edit["tokens"] if gate else 0) + (tight["tokens"] if needTight else 0),
            baseTokens=orig["tokens"],
            extraMs=(edit["ms"] if gate else 0) + (tight["ms"] if needTight else 0),
            baseMs=orig["ms"],
            rules=rules,
            cropChanged=a["normalizedSha256"] != b["normalizedSha256"],
        )
        data.append(row)
        log.append(row)
    report[loc] = {}
    for part in ["A", "B", "all"]:
        group = [d for d in data if part == "all" or d["partition"] == part]
        n = sum(d["rules"]["primary"] for d in group)
        equal = {d["item"] for d in sorted(group, key=lambda d: (-d["p"], d["item"]))[:n]}
        stats = {}
        for rule in [*group[0]["rules"], "sameBudgetStock"]:
            yes = lambda d: d["item"] in equal if rule == "sameBudgetStock" else d["rules"][rule]

            def count(tag, cond):
                return sum(cond(d) for d in group if d["truth"] == tag)

            stats[rule] = dict(
                tp=count("holes", yes),
                fp=count("spots", yes),
                gained=count("holes", lambda d: yes(d) and not d["rules"]["stock"]),
                lost=count("holes", lambda d: not yes(d) and d["rules"]["stock"]),
                addedAlarms=count("spots", lambda d: yes(d) and not d["rules"]["stock"]),
            )
        report[loc][part] = dict(
            count=len(group),
            holes=count("holes", lambda _: True),
            spots=count("spots", lambda _: True),
            triggered=sum(d["gate"] for d in group),
            tightQueries=sum(d["tightQueried"] for d in group),
            sameScaleRenders=sum(not d["cropChanged"] for d in group),
            extraTokenFraction=sum(d["extraTokens"] for d in group)
            / sum(d["baseTokens"] for d in group),
            meanExtraWarmMs=sum(d["extraMs"] for d in group) / len(group),
            rules=stats,
        )
gates = dict(
    noNewFalseAlarms=all(
        report[l][s]["rules"]["primary"]["addedAlarms"] == 0 for l in report for s in ["A", "B"]
    ),
    everyStockPositivePreserved=all(
        report[l]["all"]["rules"]["primary"]["lost"] == 0 for l in report
    ),
    gainsInBothPartitionsBothLocations=all(
        report[l][s]["rules"]["primary"]["gained"] > 0 for l in report for s in ["A", "B"]
    ),
    beatsStockAtSameCentredBudget=report["centre"]["all"]["rules"]["primary"]["tp"]
    > report["centre"]["all"]["rules"]["sameBudgetStock"]["tp"],
)
repeat = [
    abs(r["answers"]["broken"]["p"] - scores[r["id"], r["arm"]]["answers"]["broken"]["p"])
    for r in raw
    if r["repeat"]
]
summary = dict(
    items=len(load("sources.json")["members"]),
    mainRows=len(scores),
    repeatCount=len(repeat),
    repeatMaxDifference=max(repeat),
    hardware=tele[-1]["health"],
    report=report,
    gates=gates,
    passesProxyGate=all(gates.values()),
)
(out / "results.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf8")
(out / "paired-cases.jsonl").write_text("".join(json.dumps(d) + "\n" for d in log), encoding="utf8")
print(json.dumps({l: r["all"] for l, r in report.items()}))
print(gates)
