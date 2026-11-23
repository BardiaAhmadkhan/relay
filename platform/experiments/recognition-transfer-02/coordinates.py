"""Audit physical tensor compatibility between the real research and production checkpoints."""

from pathlib import Path
import sys, hashlib, json
import numpy as np

sys.path.insert(0, str(Path.cwd() / "experiments/recognition-weights-01"))
from prepare_weights import ProjectorHeader, file_sha

blobs = Path(".cache/ollama/blobs")
digests = [
    "5ddf560e34046fd958b2576324f2a9b57d70f297afe6526958d60a23f3bfc20b",
    "e56a899b1540860385465756dd308c84417410b94dbc1c380adffd20a921ca60",
]
paths = [blobs / ("sha256-" + d) for d in digests]
assert [file_sha(f) for f in paths] == digests
rows = []
with paths[0].open("rb") as a, paths[1].open("rb") as b:
    small, live = ProjectorHeader(a), ProjectorHeader(b)
    for layer in range(24):
        for sub in ["attn_qkv", "attn_out", "ffn_up", "ffn_down"]:
            key = f"v.blk.{layer}.{sub}.weight"
            d0, k0, o0 = small.tensors[key]
            d1, k1, o1 = live.tensors[key]
            assert d0 == d1 and k0 == k1 == 30
            nn = int(np.prod(d0))
            a.seek(o0)
            b.seek(o1)
            x = a.read(nn * 2)
            y = b.read(nn * 2)
            v, w = [
                (np.frombuffer(raw, "<u2").astype("<u4") << 16).view("<f4").astype(np.float64)
                for raw in [x, y]
            ]
            rows.append(
                dict(
                    tensor=key,
                    parameters=nn,
                    exactBytes=x == y,
                    cosine=float(np.dot(v, w) / (np.linalg.norm(v) * np.linalg.norm(w))),
                    relativeDistance=float(np.linalg.norm(v - w) / np.linalg.norm(v)),
                )
            )
    mergers = [v.tensors["mm.2.weight"][0] for v in [small, live]]
out = dict(
    projectorSha256=digests,
    tensors=rows,
    identical=sum(r["exactBytes"] for r in rows),
    count=len(rows),
    medianCosine=float(np.median([r["cosine"] for r in rows])),
    rangeCosine=[min(r["cosine"] for r in rows), max(r["cosine"] for r in rows)],
    mergerDimensions=mergers,
    interpretation="A shared layout does not identify an equivalent function; this audit does not authorize a 4B weight change.",
)
Path(sys.argv[1]).write_text(json.dumps(out, indent=2) + "\n", encoding="utf8")
print({k: v for k, v in out.items() if k not in ["tensors", "projectorSha256"]})
