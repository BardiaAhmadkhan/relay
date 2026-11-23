"""Freeze the conservative field-of-view comparison before any 4B outputs on these items."""

import json, sys, shutil, hashlib
from pathlib import Path

live, third, fourth, whole, out = map(Path, sys.argv[1:])
out.mkdir(exist_ok=False)
(out / "normalized").mkdir()
s = json.loads((live / "protocol.json").read_bytes())
s.update(
    version="relay-4b-priority-07",
    salt="relay-priority-live-original-07",
    discovery="On first 4B development cohorts, all 64 publisher spots scored below 0.883 on marked regions. Choose rounded 0.90 before a new 4B run, and keep every original stock-whole diagnostic hit. This is an expert attention flag only; 0.50 and 0.90 are not offer thresholds.",
    primary="All 224 items from studies 3/4 have no prior 4B scores. Compare on whole and both centre/shift captures. Stock baseline whole p>=0.50; candidate preserves baseline and additionally flags a marked crop scoring >=0.90. Compare 0.50-on-mark against the primary directly. Require at least one recovered hole in each collection and both locations, no newly flagged spots in any collection/location and zero lost stock detections. If the high threshold fails, disclose whether it reduced errors while retaining gains; do not retune on this test or deploy an automated threshold. The ordinary evidence path and mark ranking are separate.",
)
protocol = (json.dumps(s, indent=2) + "\n").encode()
(out / "protocol.json").write_bytes(protocol)
sha = lambda b: hashlib.sha256(b).hexdigest()
weight = json.loads((live / "weight-manifest.json").read_bytes())
weight["protocolSha256"] = sha(protocol)
(out / "weight-manifest.json").write_text(json.dumps(weight, indent=2) + "\n", encoding="utf8")
cases = []
for group, src, mapping in [
    ("third", third, {"centre": "centre", "shift": "shift"}),
    ("fourth", fourth, {"centre-ordinary": "centre", "shift-ordinary": "shift"}),
    ("whole", whole, {"whole": "whole"}),
]:
    for c in json.loads((src / "cases.json").read_bytes())["cases"]:
        if c["mode"] not in mapping:
            continue
        f = src / "normalized" / (c["id"] + ".jpg")
        data = f.read_bytes()
        assert sha(data) == c["normalizedSha256"]
        mode = mapping[c["mode"]]
        uid = "w-" + c["class"] + "-" + c["item"] + "-" + mode
        dest = out / "normalized" / (uid + ".jpg")
        assert not dest.exists()
        dest.write_bytes(data)
        cases.append(
            {
                **c,
                "id": uid,
                "mode": mode,
                "transferSet": c["transferSet"] if group == "whole" else group,
            }
        )
assert len(cases) == 672 and len({c["item"] for c in cases}) == 224
cases.sort(key=lambda c: sha((s["salt"] + "/" + c["id"]).encode()))
(out / "cases.json").write_text(
    json.dumps(dict(protocolSha256=sha(protocol), cases=cases), indent=2) + "\n", encoding="utf8"
)
print(len(cases), "views frozen")
