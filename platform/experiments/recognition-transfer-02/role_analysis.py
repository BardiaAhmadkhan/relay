import json, sys, hashlib
from pathlib import Path
import numpy as np

p = Path(sys.argv[1])
cs = json.loads((p / "cases.json").read_bytes())
assert cs["protocolSha256"] == hashlib.sha256((p / "protocol.json").read_bytes()).hexdigest()
raw = [json.loads(l) for l in (p / "scores.jsonl").read_text().splitlines()]
data = {(r["id"], r["arm"]): r for r in raw if not r["repeat"]}
tel = [json.loads(l) for l in (p / "telemetry.jsonl").read_text().splitlines()]
assert tel[-1]["event"] == "stop" and tel[-1]["failure"] is None and len(data) == 448


def samples(tag, group):
    rows = [
        c
        for c in cs["cases"]
        if c["class"] == tag and (group == "pooled" or c["transferSet"] == group)
    ]
    for c in rows:
        for a in ["base", "attention"]:
            assert (
                data[c["id"], a]["normalizedSha256"] == c["normalizedSha256"]
                and not data[c["id"], a]["failures"]
            )
    return rows, np.array(
        [[data[c["id"], a]["answers"]["broken"]["p"] for a in ["base", "attention"]] for c in rows]
    )


res = {}
for g in ["third", "fourth", "pooled"]:
    hr, h = samples("holes", g)
    sr, s = samples("spots", g)
    pair = (h[:, None, :] > s[None, :, :]).astype(float) + 0.5 * (h[:, None, :] == s[None, :, :])
    diff = pair[:, :, 1] - pair[:, :, 0]
    rng = np.random.default_rng(11807)

    def draws(rows):
        keys = np.array([r["transferSet"] for r in rows])
        return np.concatenate(
            [
                rng.choice(np.where(keys == x)[0], size=(5000, (keys == x).sum()))
                for x in sorted(set(keys))
            ],
            axis=1,
        )

    hi, si = draws(hr), draws(sr)
    # Chunk bootstrap so large cohorts don't reserve a 5000 x 112 x 112 float64 array.
    boot = np.concatenate(
        [
            diff[hi[i : i + 100, :, None], si[i : i + 100, None, :]].mean(axis=(1, 2))
            for i in range(0, 5000, 100)
        ]
    )
    res[g] = dict(
        holes=len(h),
        spots=len(s),
        aucs=pair.mean(axis=(0, 1)).tolist(),
        gain=float(diff.mean()),
        ci95=np.quantile(boot, [0.025, 0.975]).tolist(),
        stockHoles=int((h[:, 0] >= 0.5).sum()),
        editHoles=int((h[:, 1] >= 0.5).sum()),
        stockSpots=int((s[:, 0] >= 0.5).sum()),
        editSpots=int((s[:, 1] >= 0.5).sum()),
        newHoleMisses=int(((h[:, 0] >= 0.5) & (h[:, 1] < 0.5)).sum()),
        addedAlarms=int(((s[:, 0] < 0.5) & (s[:, 1] >= 0.5)).sum()),
    )
gates = dict(
    bothPositive=all(res[g]["gain"] > 0 for g in ["third", "fourth"]),
    positiveLowerBound=res["pooled"]["ci95"][0] > 0,
    noMisses=res["pooled"]["newHoleMisses"] == 0,
    noNewAlarms=res["pooled"]["addedAlarms"] == 0,
)
rr = [
    abs(r["answers"]["broken"]["p"] - data[r["id"], r["arm"]]["answers"]["broken"]["p"])
    for r in raw
    if r["repeat"]
]
out = dict(
    mainRows=len(data),
    items=224,
    repeatCount=len(rr),
    repeatMaxDifference=max(rr),
    samples=res,
    gates=gates,
    passesProxyGate=all(gates.values()),
    hardware=tel[-1]["health"],
)
(p / "results.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf8")
print(json.dumps(out))
