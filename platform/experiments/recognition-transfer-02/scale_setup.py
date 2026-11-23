"""Freeze another independent item set; change scale as well as position."""

import sys, hashlib, json
from pathlib import Path

first, second, third, out = map(Path, sys.argv[1:])
out.mkdir(exist_ok=False)
s = json.loads((third / "protocol.json").read_bytes())
srcs = [json.loads((p / "sources.json").read_bytes()) for p in [first, second, third]]
ex = (
    json.dumps({"members": [m for src in srcs for m in src["members"]]}, indent=2) + "\n"
).encode()
(out / "excluded.json").write_bytes(ex)
s.update(
    version="relay-strong-or-corroborated-scale-04",
    salt="relay-independent-scale-corroboration-11807",
    perClass=64,
    excludeManifestSha256=hashlib.sha256(ex).hexdigest(),
    discovery="The phase 3 extra false alarm was the same publisher spot in centre and shift (edited p .555/.605). A separation near the seam was .904/.875; a second hole was .552. Reserve a strong .80 threshold and a separate tight-crop stock observation for weaker edited evidence. Do not tune these constants on the fresh data.",
    primary="At each simulated tap preserve all stock p>=.50 at the ordinary 3x context. For 0.20<=stock p<.50 and ordinary side>=96, alert additionally only if edit>=.80 OR (edit>=.50 and tight stock>=.50). Tight crop is 1.5x the annotated mark size, at least 64 native pixels. Same tap coordinates as the ordinary crop, including perturbations. All options preserve the same original. Caps/offer policy unchanged.",
    controls="Fixed stock .50, strength-only .80, the earlier weak .50-only rescue, tight stock only, and a single-checkpoint two-scale stock rule; same-count stock ranking as diagnostic. Query regular stock and half-edit at ordinary and tight scale for reproducibility. Tight edited scores exploratory only. Whole-image routes remain stock by construction.",
    promotion="Evaluate on 64 new holes + 64 new spots disjoint from all prior original IDs. Require preservation of every existing positive, no added spot alarms per centred and shifted half, positive recoveries in each half and both positions; beat stock ranked at equal review count on centred items. Prefer single-checkpoint if it matches at lower operational cost. Report margins, transfer and all tradeoffs. Finite non-gear data cannot qualify autonomous offers.",
)
(out / "protocol.json").write_text(json.dumps(s, indent=2) + "\n", encoding="utf8")
m = json.loads((third / "weight-manifest.json").read_bytes())
m["protocolSha256"] = hashlib.sha256((out / "protocol.json").read_bytes()).hexdigest()
(out / "weight-manifest.json").write_text(json.dumps(m, indent=2) + "\n", encoding="utf8")
