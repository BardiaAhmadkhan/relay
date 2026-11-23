"""Evaluate high specificity on 224 additional never-before-scored 4B items."""

import json, sys, hashlib
from pathlib import Path

p = Path(sys.argv[1])
cs = json.loads((p / "cases.json").read_bytes())["cases"]
raw = [json.loads(l) for l in (p / "scores.jsonl").read_text().splitlines()]
tel = [json.loads(l) for l in (p / "telemetry.jsonl").read_text().splitlines()]
assert tel[-1]["event"] == "stop" and tel[-1]["failure"] is None
rows = {r["id"]: r for r in raw if not r["repeat"]}
assert len(rows) == len(cs) == 672
idx = {}
ids = {}
for c in cs:
    r = rows[c["id"]]
    assert not r["failures"] and r["normalizedSha256"] == c["normalizedSha256"]
    idx[c["item"], c["mode"]] = r["answers"]["broken"]["p"]
    ids[c["item"]] = (c["class"], c["transferSet"])
report = {}
for loc in ["centre", "shift"]:
    report[loc] = {}
    for grp in ["third", "fourth", "pooled"]:
        y = [
            (cl, idx[i, "whole"], idx[i, loc])
            for i, (cl, g) in ids.items()
            if grp == "pooled" or g == grp
        ]
        ss = {}
        for name, fn in [
            ("whole", lambda w, d: w >= 0.5),
            ("anyHalf", lambda w, d: w >= 0.5 or d >= 0.5),
            ("conservative", lambda w, d: w >= 0.5 or d >= 0.9),
        ]:

            def count(tag, cond):
                return sum(cond(w, d) for cl, w, d in y if cl == tag)

            ss[name] = dict(
                holeFlags=count("holes", fn),
                spotFlags=count("spots", fn),
                newHoleFlags=count("holes", lambda w, d: w < 0.5 and fn(w, d)),
                lostHoleFlags=count("holes", lambda w, d: w >= 0.5 and not fn(w, d)),
                newSpotFlags=count("spots", lambda w, d: w < 0.5 and fn(w, d)),
            )
        report[loc][grp] = dict(
            holes=sum(cl == "holes" for cl, w, d in y),
            spots=sum(cl == "spots" for cl, w, d in y),
            rules=ss,
        )
gates = dict(
    recoveryEveryGroupAndPosition=all(
        report[l][g]["rules"]["conservative"]["newHoleFlags"] > 0
        for l in report
        for g in ["third", "fourth"]
    ),
    zeroNewSpotFlags=all(
        report[l]["pooled"]["rules"]["conservative"]["newSpotFlags"] == 0 for l in report
    ),
    stockPreserved=all(
        report[l]["pooled"]["rules"]["conservative"]["lostHoleFlags"] == 0 for l in report
    ),
)
rep = [
    abs(r["answers"]["broken"]["p"] - rows[r["id"]]["answers"]["broken"]["p"])
    for r in raw
    if r["repeat"]
]
out = dict(
    items=len(ids),
    mainRows=len(rows),
    repeatCount=len(rep),
    repeatMaxDifference=max(rep),
    gates=gates,
    passesPriorityGate=all(gates.values()),
    byLocation=report,
    hardware=tel[-1]["health"],
)
(p / "results.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf8")
print(json.dumps(out))
