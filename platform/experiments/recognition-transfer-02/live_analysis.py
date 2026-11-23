"""Compare 4B/2B location effects on precisely the same photos, stratifying original items."""

import hashlib, json, sys
from pathlib import Path
import numpy as np

first, second, out = map(Path, sys.argv[1:])
ld = lambda p: json.loads(p.read_bytes())
cs = ld(out / "cases.json")
assert cs["protocolSha256"] == hashlib.sha256((out / "protocol.json").read_bytes()).hexdigest()
tele = [json.loads(x) for x in (out / "telemetry.jsonl").read_text().splitlines()]
assert tele[-1]["event"] == "stop" and tele[-1]["failure"] is None


def records(p):
    r = [json.loads(l) for l in (p / "scores.jsonl").read_text().splitlines()]
    return {x["id"]: x for x in r if not x["repeat"] and x["arm"] == "base"}, [
        x for x in r if x["repeat"]
    ]


live, rep = records(out)
small = {**records(first)[0], **records(second)[0]}
assert len(live) == len(cs["cases"]) == len(small) == 256
scores = {}
for c in cs["cases"]:
    id = c["id"]
    sl = small[id]
    lv = live[id]
    assert (
        lv["normalizedSha256"] == sl["normalizedSha256"] == c["normalizedSha256"]
        and not lv["failures"]
        and not sl["failures"]
    )
    scores[(c["item"], c["mode"])] = [lv["answers"]["broken"]["p"], sl["answers"]["broken"]["p"]]
items = {c["item"]: (c["transferSet"], c["class"], c["date"]) for c in cs["cases"]}


def sample(grp, model):
    def get(tag):
        return np.array(
            [
                [scores[i, m][model] for m in ["whole", "region"]]
                for i, (g, t, d) in items.items()
                if t == tag and (g == grp or grp == "pooled")
            ]
        )

    h, s = get("holes"), get("spots")
    con = (h[:, None, :] > s[None, :, :]).astype(float) + 0.5 * (h[:, None, :] == s[None, :, :])
    rng = np.random.default_rng(11807)
    # In pooled evaluation resample items within both original cohorts and both classes.
    if grp == "pooled":

        def strata(tag):
            gs = [g for (g, t, d) in items.values() if t == tag]
            return np.concatenate(
                [
                    rng.choice(np.where(np.array(gs) == g)[0], size=(5000, gs.count(g)))
                    for g in ["first", "second"]
                ],
                axis=1,
            )

        hi, si = strata("holes"), strata("spots")
    else:
        hi = rng.integers(len(h), size=(5000, len(h)))
        si = rng.integers(len(s), size=(5000, len(s)))
    change = con[:, :, 1] - con[:, :, 0]
    delta = change[hi[:, :, None], si[:, None, :]].mean(axis=(1, 2))
    return dict(
        holes=len(h),
        spots=len(s),
        pairCount=len(h) * len(s),
        wholePairs=float(con[:, :, 0].sum()),
        regionPairs=float(con[:, :, 1].sum()),
        wholeAUC=float(con[:, :, 0].mean()),
        regionAUC=float(con[:, :, 1].mean()),
        gain=float(change.mean()),
        gainCI95=np.quantile(delta, [0.025, 0.975]).tolist(),
        diagnosticWholeHoleFlags=int((h[:, 0] >= 0.5).sum()),
        diagnosticRegionHoleFlags=int((h[:, 1] >= 0.5).sum()),
        diagnosticWholeSpotFlags=int((s[:, 0] >= 0.5).sum()),
        diagnosticRegionSpotFlags=int((s[:, 1] >= 0.5).sum()),
    )


res = {
    name: {g: sample(g, idx) for g in ["first", "second", "pooled"]}
    for idx, name in enumerate(["stock4B", "stock2B"])
}
repeat = [abs(r["answers"]["broken"]["p"] - live[r["id"]]["answers"]["broken"]["p"]) for r in rep]
gates = dict(
    positiveInBoth=all(res["stock4B"][g]["gain"] > 0 for g in ["first", "second"]),
    positivePooledLowerBound=res["stock4B"]["pooled"]["gainCI95"][0] > 0,
    complete=len(live) == 256,
    identicalRepeats=max(repeat) == 0,
)
result = dict(
    items=len(items),
    mainRows=len(live),
    repeatCount=len(rep),
    repeatMaxDifference=max(repeat),
    results=res,
    gates=gates,
    passesLocationGate=all(gates.values()),
    hardware=tele[-1]["health"],
)
(out / "results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
print(json.dumps(result))
