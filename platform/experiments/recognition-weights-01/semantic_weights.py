"""Fold a domain-defined contrast into the existing vision merger. Uses zero images."""

import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np

from prepare_weights import ProjectorHeader, check_unedited_regions, compact, file_sha


def read_axis(language, dictionary):
    with language.open("rb") as f:
        header = ProjectorHeader(f)
        dims, kind, offset = header.tensors["token_embd.weight"]
        if dims != (2048, 248320) or kind != 8:
            raise ValueError("Expected stock 2048-wide Q8_0 vocabulary tensor")
        lookup = {v: i for i, v in enumerate(header.meta["tokenizer.ggml.tokens"])}
        audit = {}

        def centroid(words):
            rows = []
            for word in words:
                idx = lookup[chr(0x120) + word]  # Qwen's byte-level BPE leading space
                f.seek(offset + idx * (2048 // 32) * 34)
                blocks = np.frombuffer(f.read((2048 // 32) * 34), dtype=np.uint8).reshape(-1, 34)
                scales = blocks[:, :2].copy().view("<f2").astype(np.float64)
                values = (blocks[:, 2:].copy().view("i1") * scales).reshape(-1)
                if not np.isfinite(values).all() or not np.linalg.norm(values):
                    raise ValueError(word)
                rows.append(values / np.linalg.norm(values))
                audit[word] = idx
            return np.mean(rows, axis=0)

        direction = centroid(dictionary["plus"]) - centroid(dictionary["minus"])
        return direction / np.linalg.norm(direction), audit


def bf16_to_f64(bits):
    return (bits.astype(np.uint32) << 16).view("<f4").astype(np.float64)


def bf16_round(x):
    v = x.astype("<f4").view("<u4")
    return ((v + 0x7FFF + ((v >> 16) & 1)) >> 16).astype("<u2")


def emit_variant(store, base_manifest, base_raw, projector, digest, arm):
    raw = compact(base_manifest) if arm != "base" else base_raw
    mid = hashlib.sha256(raw).hexdigest()
    blobs = store / "blobs"
    (blobs / ("sha256-" + mid)).write_bytes(raw)
    single = {
        "mediaType": base_manifest["mediaType"],
        "digest": "sha256:" + mid,
        "runner": "llamacpp",
        "format": "gguf",
    }
    index = {
        "schemaVersion": 2,
        "mediaType": "application/vnd.ollama.manifest.list.v2+json",
        "manifests": [single],
    }
    index_bytes = compact(index)
    iid = hashlib.sha256(index_bytes).hexdigest()
    (blobs / ("sha256-" + iid)).write_bytes(index_bytes)
    index_path = store / "manifests-v2/ollama.com/library/relay-inspection"
    legacy_path = store / "manifests/registry.ollama.ai/library/relay-inspection"
    index_path.mkdir(parents=True, exist_ok=True)
    legacy_path.mkdir(parents=True, exist_ok=True)
    (index_path / arm).write_bytes(index_bytes)
    legacy = dict(base_manifest)
    legacy["layers"] = base_manifest["layers"] + [
        {"mediaType": index["mediaType"], "digest": "sha256:" + iid, "size": len(index_bytes)},
        {"mediaType": base_manifest["mediaType"], "digest": "sha256:" + mid, "size": len(raw)},
    ]
    (legacy_path / arm).write_bytes(compact(legacy))
    return {
        "model": "relay-inspection:" + arm,
        "manifestDigest": mid,
        "projectorDigest": digest,
        "projectorBytes": projector.stat().st_size,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workspace", type=Path)
    ap.add_argument(
        "--protocol", type=Path, default=Path(__file__).with_name("semantic-protocol.json")
    )
    args = ap.parse_args()
    dest = args.workspace.resolve()
    origin = Path(".cache/ollama").resolve(strict=True)
    if dest == origin or origin in dest.parents or dest in origin.parents:
        raise ValueError("Separate workspace required")
    dest.mkdir(parents=True, exist_ok=True)
    store = dest / "model-store"
    store.mkdir(exist_ok=False)
    (store / "blobs").mkdir()
    protocol = args.protocol.read_bytes()
    (dest / "protocol.json").write_bytes(protocol)
    spec = json.loads(protocol)
    base_file = origin / "blobs" / ("sha256-" + spec["referenceDigest"])
    if file_sha(base_file) != spec["referenceDigest"]:
        raise ValueError("Manifest changed")
    raw = base_file.read_bytes()
    base = json.loads(raw)
    for item in [base["config"], *base["layers"]]:
        digest = item["digest"].split(":")[1]
        blob = origin / "blobs" / ("sha256-" + digest)
        if file_sha(blob) != digest or blob.stat().st_size != item["size"]:
            raise ValueError("Stock blob integrity")
        shutil.copyfile(blob, store / "blobs" / blob.name)
    lang = store / "blobs" / ("sha256-" + spec["languageBlob"])
    proj = store / "blobs" / ("sha256-" + spec["originalProjector"])
    total = lang.stat().st_size + proj.stat().st_size
    if total > spec["maxLearnedBytes"] or sum(spec["parameters"].values()) > spec["maxParameters"]:
        raise ValueError("Size limit")
    task, vocab = read_axis(lang, spec["taskLexicon"])
    unrelated, control_vocab = read_axis(lang, spec["controlLexicon"])
    with proj.open("rb") as f:
        head = ProjectorHeader(f)
        dims, kind, wo = head.tensors["mm.2.weight"]
        bd, bk, bo = head.tensors["mm.2.bias"]
        if dims != (4096, 2048) or kind != 30 or bd != (2048,) or bk != 0:
            raise ValueError("Vision-to-language shape/format changed")
        f.seek(wo)
        bits = np.frombuffer(f.read(2048 * 4096 * 2), dtype="<u2").reshape(2048, 4096)
        W = bf16_to_f64(bits)
        f.seek(bo)
        b = np.frombuffer(f.read(2048 * 4), dtype="<f4").astype(np.float64)
    A = np.column_stack([W, b])
    gain = spec["arms"]["semantic"] - 1
    magnitude = gain * np.linalg.norm(task @ A)
    report = {
        "runtimeStore": "isolated",
        "baseManifest": spec["referenceDigest"],
        "parameterCounts": spec["parameters"],
        "totalParameters": sum(spec["parameters"].values()),
        "learnedBytesPerArm": total,
        "arms": {},
        "axisCosine": float(task @ unrelated),
        "taskWordIds": vocab,
        "controlWordIds": control_vocab,
    }
    for arm in spec["arms"]:
        manifest = json.loads(raw)
        digest = spec["originalProjector"]
        audit = {}
        if arm != "base":
            u = task if arm == "semantic" else unrelated
            alpha = gain if arm == "semantic" else magnitude / np.linalg.norm(u @ A)
            delta = alpha * np.outer(u, u @ A)
            change = float(np.linalg.norm(delta) / np.linalg.norm(A))
            if not 0 < change < 0.03 or not np.isfinite(delta).all():
                raise ValueError("Change budget")
            new_w = bf16_round(W + delta[:, :-1])
            new_b = (b + delta[:, -1]).astype("<f4")
            actual = np.column_stack([bf16_to_f64(new_w) - W, new_b.astype(np.float64) - b])
            along = u @ actual
            actual_norm = np.linalg.norm(actual)
            tmp = store / (arm + ".partial")
            shutil.copyfile(proj, tmp)
            with tmp.open("r+b") as f:
                f.seek(wo)
                f.write(new_w.tobytes())
                f.seek(bo)
                f.write(new_b.tobytes())
            if tmp.stat().st_size != proj.stat().st_size:
                raise ValueError("Projector grew")
            check_unedited_regions(proj, tmp, [(wo, new_w.nbytes), (bo, new_b.nbytes)])
            digest = file_sha(tmp)
            tmp.rename(store / "blobs" / ("sha256-" + digest))
            next(x for x in manifest["layers"] if x["mediaType"].endswith(".projector"))[
                "digest"
            ] = ("sha256:" + digest)
            audit = {
                "alpha": float(alpha),
                "preRoundRelativeFrobenius": change,
                "preRoundFrobenius": float(np.linalg.norm(delta)),
                "postRoundFrobenius": float(actual_norm),
                "postRoundDirectionEnergyFraction": float(
                    (np.linalg.norm(along) / actual_norm) ** 2
                ),
                "changedBf16Weights": int(np.count_nonzero(new_w != bits)),
                "changedF32Biases": int(np.count_nonzero(new_b != b)),
                "weightOffset": wo,
                "biasOffset": bo,
            }
        report["arms"][arm] = {
            **emit_variant(store, manifest, raw, proj, digest, arm),
            "languageBlob": spec["languageBlob"],
            "audit": audit,
        }
    if file_sha(proj) != spec["originalProjector"] or file_sha(lang) != spec["languageBlob"]:
        raise ValueError("Stock tensors changed")
    (dest / "weight-manifest.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    print(
        json.dumps(
            {
                a: [v["manifestDigest"], v["audit"].get("preRoundRelativeFrobenius")]
                for a, v in report["arms"].items()
            }
        )
    )


if __name__ == "__main__":
    main()
