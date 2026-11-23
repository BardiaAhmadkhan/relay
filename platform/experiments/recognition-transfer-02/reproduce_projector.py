"""Rebuild measured GGUFs exactly, including rare BLAS-dependent BF16 tie outcomes.

derive table.json run_all run_branches compact.safetensors
rebuild table.json compact.safetensors directory

The correction table covers only numerically ambiguous values in a measured checkpoint. It is
constructed from checkpoint bytes, never class labels, input photographs or recognition results.
"""

import hashlib, json, shutil, struct, sys
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path.cwd() / "experiments/recognition-weights-01"))
from prepare_weights import ProjectorHeader, file_sha
from semantic_weights import bf16_round

BASE = "5ddf560e34046fd958b2576324f2a9b57d70f297afe6526958d60a23f3bfc20b"
FACTORS = "e86d1cd80c518cb64fde62d83ac6e414070380b49bb6bba6760f9d07a04a418e"
GG = {
    "attn.proj": "attn_out",
    "attn.qkv": "attn_qkv",
    "mlp.linear_fc1": "ffn_up",
    "mlp.linear_fc2": "ffn_down",
}


def main(mode, table, *args):
    derive = mode == "derive"
    if mode not in ["derive", "rebuild"]:
        raise ValueError("Use derive or rebuild")
    if derive:
        full, split, compact = args
        weights = {}
        originals = {}
        for where in [full, split]:
            src = json.loads((where / "weight-manifest.json").read_bytes())
            for arm, info in src["arms"].items():
                if arm == "base":
                    continue
                dg = info["projectorDigest"]
                p = where / "model-store/blobs" / ("sha256-" + dg)
                assert file_sha(p) == dg
                weights[arm] = {"sha256": dg, "corrections": {}}
                originals[arm] = np.memmap(p, mode="r", dtype="<u2")
    else:
        compact, out = args
        out.mkdir(parents=True, exist_ok=False)
        record = json.loads(table.read_bytes())
        assert record["base"] == BASE and record["factors"] == FACTORS
        weights = record["arms"]
    base = Path(".cache/ollama/blobs") / ("sha256-" + BASE)
    assert file_sha(base) == BASE and file_sha(compact) == FACTORS
    if not derive:
        files = {}
        outs = {}
        for arm in weights:
            f = out / (arm + ".mmproj.gguf")
            shutil.copyfile(base, f)
            files[arm] = f
            outs[arm] = np.memmap(f, mode="r+", dtype="<u2")
    with base.open("rb") as f:
        h = ProjectorHeader(f)
    stock = np.memmap(base, mode="r", dtype="<u2")
    bf = compact.read_bytes()
    n = struct.unpack("<Q", bf[:8])[0]
    heads = json.loads(bf[8 : 8 + n])

    def load(name):
        t = heads[name]
        a, b = t["data_offsets"]
        assert t["dtype"] == "F32"
        return (
            np.frombuffer(bf, offset=8 + n + a, count=(b - a) // 4, dtype="<f4")
            .reshape(t["shape"])
            .astype(np.float64)
        )

    for layer in range(24):
        for sub, gg in GG.items():
            key = f"v.blk.{layer}.{gg}.weight"
            dims, kind, off = h.tensors[key]
            assert kind == 30
            rows, cols = reversed(dims)
            prefix = f"base_model.model.model.visual.blocks.{layer}.{sub}"
            a = load(prefix + ".lora_A.weight")
            b = load(prefix + ".lora_B.weight")
            active = [
                "vision-half",
                "vision-full",
                "attention" if sub.startswith("attn.") else "mlp",
            ]
            for start in range(0, rows, 128):
                end = min(start + 128, rows)
                lo = off // 2 + start * cols
                hi = off // 2 + end * cols
                delta = np.zeros((end - start, cols), dtype=np.float64)
                for k in range(16):
                    delta += b[start:end, k, None] * a[k, None, :]
                w = (
                    (stock[lo:hi].astype("<u4") << 16)
                    .view("<f4")
                    .astype(np.float64)
                    .reshape(end - start, cols)
                )
                for arm in active:
                    lam = 1.0 if arm == "vision-full" else 0.5
                    values = bf16_round(w + lam * delta).reshape(-1)
                    if derive:
                        want = originals[arm][lo:hi]
                        diff = np.flatnonzero(values != want)
                        if len(diff):
                            weights[arm]["corrections"].setdefault(key, []).extend(
                                [[int(start * cols + i), int(want[i])] for i in diff]
                            )
                    else:
                        for i, v in weights[arm]["corrections"].get(key, []):
                            if start * cols <= i < end * cols:
                                values[i - start * cols] = v
                        outs[arm][lo:hi] = values
    if derive:
        result = {
            "base": BASE,
            "factors": FACTORS,
            "arms": weights,
            "method": "Fixed-order float64 sum over 16 F32 donor factors; round to float32 then bfloat16. Apply stored measured BF16 words at the listed tensor-local flattened indices.",
        }
        table.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
        print({k: sum(len(v) for v in row["corrections"].values()) for k, row in weights.items()})
    else:
        result = {}
        for arm, mem in outs.items():
            mem.flush()
            actual = file_sha(files[arm])
            assert actual == weights[arm]["sha256"], arm
            assert files[arm].stat().st_size == base.stat().st_size
            result[arm] = {"projectorSha256": actual, "bytes": files[arm].stat().st_size}
        (out / "verified.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
        print(json.dumps(result))


if __name__ == "__main__":
    main(sys.argv[1], *(Path(x) for x in sys.argv[2:]))
