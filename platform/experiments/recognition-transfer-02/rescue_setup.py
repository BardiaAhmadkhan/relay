"""Freeze the non-regression rescue comparison before running the new cohort."""

import json, hashlib, sys
from pathlib import Path

first, second, out = map(Path, sys.argv[1:])
out.mkdir(exist_ok=False)
srcs = [json.loads((p / "sources.json").read_bytes()) for p in [first, second]]
x = {"members": [m for src in srcs for m in src["members"]]}
ex = (json.dumps(x, indent=2) + "\n").encode()
(out / "excluded.json").write_bytes(ex)
s = json.loads((first / "protocol.json").read_bytes())
s.update(
    version="relay-stock-preserving-second-look-03",
    salt="relay-conditional-recovery-fresh-20261118",
    perClass=48,
    arms={"base": 0, "vision-half": 0.5},
    excludeManifestSha256=hashlib.sha256(ex).hexdigest(),
    discovery="Five phase-one half-edit gains had stock p between 0.24 and 0.41 and 154-1443 native crop pixels. The one lost stock positive had 64 native pixels. Predeclare rounded bands/geometry as a development choice; never fit against new items.",
    primary="On marked regions, preserve every stock positive p>=0.50. Trigger one second look only for 0.20<=p<0.50 and source side>=96. Add a specialist flag when half-edit p>=0.50. The original and all existing routes are untouched. The cutoff is diagnostic, never an eligibility threshold.",
    controls="Stock p>=0.5, edited-only, stock p>=0.20 (threshold-only), equal-number highest-stock items (retrospective review-budget diagnostic), substitute same stock on a second slightly shifted view (one unchanged checkpoint), and a conservative conjunctive rule requiring the edited response AND the shifted stock response. Jitter +/- one-quarter source crop width horizontally with sign fixed from item hash, clamped. Score centre and shifted crops in identical conditions for all arms. A shifted crop is a perturbation of the same capture, not independent physical evidence.",
    promotion="Require zero additional spot flags on both new halves for both positions, positive recoveries in both halves for centre and shift, and better precision yield at the same review budget than stock on the pooled centred cases; retain all stock positives and compare cost. No false-alarm safety guarantee follows from finite zero counts. A passing proxy can suggest a specialist-facing aid only. Whole/photo decisions are structurally stock. Directly compare raw edit, input-only and concordance alternatives on the same blind items. If a new rule is invented after unsealing, it needs other fresh data.",
)
(out / "protocol.json").write_text(json.dumps(s, indent=2) + "\n", encoding="utf8")
m = json.loads((first / "weight-manifest.json").read_bytes())
m["arms"] = {k: m["arms"][k] for k in s["arms"]}
m["protocolSha256"] = hashlib.sha256((out / "protocol.json").read_bytes()).hexdigest()
(out / "weight-manifest.json").write_text(json.dumps(m, indent=2) + "\n", encoding="utf8")
