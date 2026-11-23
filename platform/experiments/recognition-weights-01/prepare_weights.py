"""Build isolated, fixed-size variants of the cached Relay 2B visual encoder.

Run from the Relay checkout. The destination is a NEW private study directory or an
existing directory containing protocol.json. The source model store is read only.
"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct

import numpy as np


def file_sha(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class ProjectorHeader:
    formats = {
        0: "B",
        1: "b",
        2: "H",
        3: "h",
        4: "I",
        5: "i",
        6: "f",
        7: "?",
        10: "Q",
        11: "q",
        12: "d",
    }

    def __init__(self, stream):
        self.stream = stream
        if stream.read(4) != b"GGUF" or self.number("I") != 3:
            raise ValueError("Expected a little-endian GGUF v3 projector")
        count, fields = self.number("Q"), self.number("Q")
        self.meta = {}
        for _ in range(fields):
            key = self.string()
            self.meta[key] = self.value(self.number("I"))
        tensors = []
        for _ in range(count):
            name = self.string()
            dimensions = tuple(self.number("Q") for _ in range(self.number("I")))
            tensors.append((name, dimensions, self.number("I"), self.number("Q")))
        align = self.meta.get("general.alignment", 32)
        base = (stream.tell() + align - 1) // align * align
        self.tensors = {n: (dims, kind, base + offset) for n, dims, kind, offset in tensors}

    def number(self, fmt):
        return struct.unpack("<" + fmt, self.stream.read(struct.calcsize("<" + fmt)))[0]

    def string(self):
        return self.stream.read(self.number("Q")).decode("utf-8")

    def value(self, kind):
        if kind in self.formats:
            return self.number(self.formats[kind])
        if kind == 8:
            return self.string()
        if kind == 9:
            element, length = self.number("I"), self.number("Q")
            return [self.value(element) for _ in range(length)]
        raise ValueError(f"Unsupported GGUF value type {kind}")


def check_unedited_regions(original, candidate, spans):
    end = original.stat().st_size
    cursor = 0
    with original.open("rb") as a, candidate.open("rb") as b:
        for offset, length in sorted(spans) + [(end, 0)]:
            if offset < cursor or offset + length > end:
                raise ValueError("Tensor bounds exceed file")
            a.seek(cursor)
            b.seek(cursor)
            remaining = offset - cursor
            while remaining:
                size = min(4 * 1024 * 1024, remaining)
                if a.read(size) != b.read(size):
                    raise ValueError("A byte outside a selected tensor changed")
                remaining -= size
            cursor = offset + length


def edit(source, output, tensors, gain):
    shutil.copyfile(source, output)
    spans, audits = [], []
    with source.open("rb") as original, output.open("r+b") as dest:
        header = ProjectorHeader(original)
        if (
            header.meta["clip.vision.patch_size"] != 16
            or header.meta["clip.projector_type"] != "qwen3vl_merger"
        ):
            raise ValueError("Unexpected visual encoder")
        for name in tensors:
            dims, kind, offset = header.tensors[name]
            if dims != (16, 16, 3, 1024) or kind != 0:
                raise ValueError(f"Unexpected layout for {name}")
            size = int(np.prod(dims)) * 4
            original.seek(offset)
            buf = original.read(size)
            weights = np.frombuffer(buf, dtype="<f4").reshape(dims[::-1]).astype(np.float64)
            mean = weights.mean(axis=(-1, -2), keepdims=True)
            changed = (mean + gain * (weights - mean)).astype("<f4")
            error = float(
                np.max(
                    np.abs(
                        changed.sum(axis=(-2, -1), dtype=np.float64) - weights.sum(axis=(-2, -1))
                    )
                )
            )
            if error > 1e-4 or not np.isfinite(changed).all():
                raise ValueError("Constant-patch response or finite-value check failed")
            encoded = changed.tobytes()
            dest.seek(offset)
            dest.write(encoded)
            spans.append((offset, size))
            audits.append(
                {
                    "tensor": name,
                    "ggufDimensions": dims,
                    "storage": "F32",
                    "offset": offset,
                    "bytes": size,
                    "valuesChanged": int(np.count_nonzero(changed != weights)),
                    "maxPerFilterDcSumDelta": error,
                    "sourceSha": hashlib.sha256(buf).hexdigest(),
                    "editedSha": hashlib.sha256(encoded).hexdigest(),
                }
            )
    if source.stat().st_size != output.stat().st_size:
        raise ValueError("Projector grew")
    check_unedited_regions(source, output, spans)
    return audits


def compact(obj):
    return json.dumps(obj, separators=(",", ":")).encode()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workspace", type=Path)
    ap.add_argument("--protocol", type=Path, default=Path(__file__).with_name("protocol.json"))
    args = ap.parse_args()
    dst = args.workspace.resolve()
    origin = Path(".cache/ollama").resolve(strict=True)
    if dst == origin or origin in dst.parents or dst in origin.parents:
        raise ValueError("Study store must be separate from the source")
    spec = json.loads(args.protocol.read_text("utf-8"))
    if sum(spec["parameters"].values()) > spec["maxParameters"]:
        raise ValueError("Parameter ceiling exceeded")
    store = dst / "model-store"
    store.mkdir(parents=True, exist_ok=False)
    blobs = store / "blobs"
    blobs.mkdir()
    source_blob = lambda h: origin / "blobs" / ("sha256-" + h)
    base_digest = spec["referenceDigest"]
    base_file = source_blob(base_digest)
    if file_sha(base_file) != base_digest:
        raise ValueError("Base manifest mismatch")
    baseline = json.loads(base_file.read_bytes())
    bundle = [baseline["config"], *baseline["layers"]]
    for item in bundle:
        digest = item["digest"].removeprefix("sha256:")
        src = source_blob(digest)
        if src.stat().st_size != item["size"] or file_sha(src) != digest:
            raise ValueError(f"Source blob mismatch {digest}")
        shutil.copyfile(src, blobs / src.name)
    projection = next(
        i for i, x in enumerate(baseline["layers"]) if x["mediaType"].endswith(".projector")
    )
    visual = baseline["layers"][projection]
    if visual["digest"] != "sha256:" + spec["originalProjector"]:
        raise ValueError("Unexpected projector")
    language = next(x for x in bundle if x["mediaType"].endswith(".model"))
    if language["digest"] != "sha256:" + spec["languageBlob"]:
        raise ValueError("Unexpected language model")
    total_weights = language["size"] + visual["size"]
    if total_weights > spec["maxLearnedBytes"]:
        raise ValueError("Weight-byte ceiling exceeded")
    report = {
        "runtimeStore": "isolated",
        "baseManifest": base_digest,
        "learnedBytesPerArm": total_weights,
        "parameterCounts": spec["parameters"],
        "totalParameters": sum(spec["parameters"].values()),
        "arms": {},
    }
    tag_dir = store / "manifests/registry.ollama.ai/library/relay-inspection"
    tag_dir.mkdir(parents=True)
    list_dir = store / "manifests-v2/ollama.com/library/relay-inspection"
    list_dir.mkdir(parents=True)
    for arm, gain in spec["arms"].items():
        original = source_blob(spec["originalProjector"])
        manifest = json.loads(base_file.read_bytes())
        audits = []
        if gain == 1:
            component = spec["originalProjector"]
            raw = base_file.read_bytes()
        else:
            tmp = store / (arm + ".partial")
            audits = edit(original, tmp, spec["tensors"], gain)
            component = file_sha(tmp)
            tmp.rename(blobs / ("sha256-" + component))
            manifest["layers"][projection]["digest"] = "sha256:" + component
            raw = compact(manifest)
        digest = hashlib.sha256(raw).hexdigest()
        (blobs / ("sha256-" + digest)).write_bytes(raw)
        single = {
            "mediaType": manifest["mediaType"],
            "digest": "sha256:" + digest,
            "runner": "llamacpp",
            "format": "gguf",
        }
        index = {
            "schemaVersion": 2,
            "mediaType": "application/vnd.ollama.manifest.list.v2+json",
            "manifests": [single],
        }
        index_data = compact(index)
        index_digest = hashlib.sha256(index_data).hexdigest()
        (blobs / ("sha256-" + index_digest)).write_bytes(index_data)
        (list_dir / arm).write_bytes(index_data)
        legacy = dict(manifest)
        legacy["layers"] = manifest["layers"] + [
            {
                "mediaType": index["mediaType"],
                "digest": "sha256:" + index_digest,
                "size": len(index_data),
            },
            {"mediaType": manifest["mediaType"], "digest": "sha256:" + digest, "size": len(raw)},
        ]
        (tag_dir / arm).write_bytes(compact(legacy))
        report["arms"][arm] = {
            "model": "relay-inspection:" + arm,
            "manifestDigest": digest,
            "projectorDigest": component,
            "projectorBytes": visual["size"],
            "languageBlob": spec["languageBlob"],
            "gain": gain,
            "audit": audits,
        }
    if file_sha(source_blob(spec["originalProjector"])) != spec["originalProjector"]:
        raise ValueError("Original projector integrity failed")
    (dst / "weight-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v["manifestDigest"] for k, v in report["arms"].items()}))


if __name__ == "__main__":
    main()
