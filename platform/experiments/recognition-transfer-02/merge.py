"""Fold exactly the published vision-block LoRA directions into existing GGUF matrices."""

from pathlib import Path
import hashlib, json, math, os, shutil, struct, sys
import numpy as np

sys.path.insert(0, str(Path.cwd() / "experiments/recognition-weights-01"))
from prepare_weights import ProjectorHeader, file_sha
from semantic_weights import bf16_round, emit_variant

GG = {
    "attn.proj": "attn_out",
    "attn.qkv": "attn_qkv",
    "mlp.linear_fc1": "ffn_up",
    "mlp.linear_fc2": "ffn_down",
}


def main(out):
    s = json.loads((out / "protocol.json").read_bytes())
    if (out / "weight-manifest.json").exists():
        raise ValueError("This run already has frozen weights")
    donor = out / "donor.safetensors"
    expected = s["donorSha"]
    if not donor.exists():
        donor = out / "vision-blocks.safetensors"
        expected = "e86d1cd80c518cb64fde62d83ac6e414070380b49bb6bba6760f9d07a04a418e"
    assert file_sha(donor) == expected
    cfg = json.loads((out / "adapter_config.json").read_bytes())
    assert (
        cfg["r"] == cfg["lora_alpha"] == 16
        and not any(
            cfg.get(k)
            for k in [
                "fan_in_fan_out",
                "use_dora",
                "use_rslora",
                "rank_pattern",
                "alpha_pattern",
                "modules_to_save",
            ]
        )
        and cfg["bias"] == "none"
    )
    blob = donor.read_bytes()
    n = struct.unpack("<Q", blob[:8])[0]
    head = json.loads(blob[8 : 8 + n])

    def tensor(name):
        row = head[name]
        a, b = row["data_offsets"]
        arr = memoryview(blob)[8 + n + a : 8 + n + b]
        dt = row["dtype"]
        if dt == "BF16":
            v = (np.frombuffer(arr, "<u2").astype("<u4") << 16).view("<f4")
        else:
            v = np.frombuffer(arr, {"F16": "<f2", "F32": "<f4"}[dt]).astype("<f4")
        return v.reshape(row["shape"])

    sources = Path(".cache/ollama/blobs")
    raw = (sources / ("sha256-" + s["referenceDigest"])).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == s["referenceDigest"]
    m = json.loads(raw)
    store = out / "model-store"
    blobs = store / "blobs"
    blobs.mkdir(parents=True, exist_ok=True)
    for it in [m["config"], *m["layers"]]:
        dg = it["digest"].split(":")[1]
        f = sources / ("sha256-" + dg)
        assert f.stat().st_size == it["size"] and file_sha(f) == dg
        shutil.copyfile(f, blobs / f.name)
    proj = blobs / ("sha256-" + s["originalProjector"])
    lang = blobs / ("sha256-" + s["languageBlob"])
    size = proj.stat().st_size + lang.stat().st_size
    npars = sum(s["parameters"].values())
    assert size <= s["maxLearnedBytes"] and npars <= s["maxParameters"]
    anchors = json.loads((out / "anchors.json").read_bytes())
    with proj.open("rb") as f:
        ph = ProjectorHeader(f)
    inventory = []
    with proj.open("rb") as f:
        for layer in range(24):
            for hn, gn in GG.items():
                hf = f"visual.blocks.{layer}.{hn}.weight"
                gg = f"v.blk.{layer}.{gn}.weight"
                dims, dt, off = ph.tensors[gg]
                shape = tuple(reversed(dims))
                assert dt == 30
                prefix = "base_model.model.model." + hf.removesuffix(".weight")
                a = prefix + ".lora_A.weight"
                b = prefix + ".lora_B.weight"
                assert head[a]["shape"] == [16, shape[1]] and head[b]["shape"] == [shape[0], 16]
                if hf in anchors["anchors"]:
                    anchor = anchors["anchors"][hf]
                    assert list(shape) == anchor["shape"]
                    f.seek(off + anchor["byteOffset"])
                    assert f.read(64).hex() == anchor["bytes"], "Base coordinates differ: " + hf
                inventory.append((gg, off, shape, a, b))
    assert (
        sum(1 for h in head if ".visual.blocks." in h and ".lora_A." in h) == len(inventory) == 96
    )
    report = {
        "protocolSha256": file_sha(out / "protocol.json"),
        "donor": s["donor"],
        "donorSha256": s["donorSha"],
        "donorInputSha256": expected,
        "upstreamBase": anchors["base"],
        "upstreamBaseRevision": anchors["revision"],
        "coordinateChecks": len(anchors["anchors"]),
        "parameterCounts": s["parameters"],
        "totalParameters": npars,
        "learnedBytesPerArm": size,
        "arms": {},
        "tensors": {},
    }
    for arm, weight in s["arms"].items():
        man = json.loads(raw)
        dg = s["originalProjector"]
        target = proj
        if weight:
            target = out / (arm + ".gguf")
            shutil.copyfile(proj, target)
            edits = []
            with target.open("r+b") as dst, proj.open("rb") as src:
                subset = s.get("branches", {}).get(arm, list(GG))
                chosen = [
                    x
                    for x in inventory
                    if any(("." + sub + ".lora_A.weight") in x[3] for sub in subset)
                ]
                assert len(chosen) == len(subset) * 24
                for gg, off, shape, a, b in sorted(chosen, key=lambda x: x[1]):
                    length = math.prod(shape) * 2
                    src.seek(off)
                    data = src.read(length)
                    stock = np.frombuffer(data, "<u2").reshape(shape)
                    w = (stock.astype("<u4") << 16).view("<f4")
                    delta = tensor(b) @ tensor(a)
                    assert np.isfinite(delta).all()
                    edited = bf16_round(w + weight * delta)
                    dst.seek(off)
                    dst.write(edited.tobytes())
                    edits.append(
                        {
                            "tensor": gg,
                            "offset": off,
                            "bytes": length,
                            "changedValues": int(np.count_nonzero(edited != stock)),
                            "deltaFrobenius": float(np.linalg.norm(delta)),
                        }
                    )
            with target.open("rb") as dst, proj.open("rb") as src:
                end = 0
                for e in edits:
                    gap = e["offset"] - end
                    assert gap >= 0 and dst.read(gap) == src.read(gap)
                    end = e["offset"] + e["bytes"]
                    dst.seek(end)
                    src.seek(end)
                assert dst.read() == src.read()
            assert target.stat().st_size == proj.stat().st_size and all(
                e["changedValues"] > 0 for e in edits
            )
            dg = file_sha(target)
            dest = blobs / ("sha256-" + dg)
            os.replace(target, dest)
            target = dest
            entry = next(
                l for l in man["layers"] if l["digest"] == "sha256:" + s["originalProjector"]
            )
            entry["digest"] = "sha256:" + dg
            report["tensors"][arm] = edits
        report["arms"][arm] = emit_variant(store, man, raw, target, dg, arm)
    (out / "weight-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(
        json.dumps(
            {
                k: [
                    v["manifestDigest"],
                    sum(e["changedValues"] for e in report["tensors"].get(k, [])),
                ]
                for k, v in report["arms"].items()
            }
        )
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
