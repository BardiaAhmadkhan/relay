"""Direct supervised-feature readout edit, measured against its algebraic no-edit control.

The downloaded ONNX is parsed as protobuf data. Only standard ONNX operators are
accepted. Local CPUExecutionProvider runs both identical-shape export graphs.
"""

import argparse
import ast
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sysconfig
from time import perf_counter
import urllib.request

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps
from localize import CENTER, GRID, crop_box, evaluate
from analyze_semantic import auc, round6


def sha(b):
    return hashlib.sha256(b).hexdigest()


def schema():
    # Use the released protobuf schema; native inference is performed by ONNX Runtime.
    p = Path(sysconfig.get_paths()["purelib"]) / "onnx" / "onnx_ml_pb2.py"
    sp = importlib.util.spec_from_file_location("relay_onnx_wire_schema", p)
    module = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(module)
    return module


def model(raw, wire):
    m = wire.ModelProto()
    m.ParseFromString(raw)
    if any(n.domain not in ("", "ai.onnx") for n in m.graph.node) or any(
        t.external_data for t in m.graph.initializer
    ):
        raise ValueError("Unexpected external component")
    return m


def prepare(out, spec, wire):
    stock = out / "stock.onnx"
    if not stock.is_file():
        url = f'https://huggingface.co/{spec["model"]}/resolve/{spec["revision"]}/model.onnx'
        with urllib.request.urlopen(url, timeout=45) as f:
            blob = f.read(spec["sourceBytes"] + 1)
        if sha(blob) != spec["sha256"]:
            raise ValueError("Publisher checksum failed")
        stock.write_bytes(blob)
    raw = stock.read_bytes()
    if sha(raw) != spec["sha256"] or len(raw) != spec["sourceBytes"]:
        raise ValueError("Different stock weights")
    m = model(raw, wire)
    meta = {p.key: p.value for p in m.metadata_props}
    names = ast.literal_eval(meta["names"])
    if names.get(0) != "hole" or names.get(1) != "stain":
        raise ValueError("Expected trained classes")
    tensors = {t.name: t for t in m.graph.initializer}
    patched = bytearray(raw)
    audit = []
    changed = 0
    for scale in range(3):
        for suffix, width in [("weight", 256), ("bias", 1)]:
            key = f"model.23.cv3.{scale}.2.{suffix}"
            t = tensors[key]
            if tuple(t.dims) not in [(20, 256, 1, 1), (20,)] or t.data_type != 10:
                raise ValueError(key)
            blob = t.raw_data
            offset = raw.find(blob)
            if offset < 0 or raw.find(blob, offset + 1) >= 0:
                raise ValueError("Tensor payload not unique: " + key)
            weights = np.frombuffer(blob, dtype="<f2").reshape(20, width)
            contrast = (weights[0].astype(np.float32) - weights[1].astype(np.float32)).astype("<f2")
            patched[offset : offset + width * 2] = contrast.tobytes()
            changed += int(np.count_nonzero(contrast != weights[0]))
            audit.append(
                {
                    "tensor": key,
                    "row": 0,
                    "sourceRow": 1,
                    "fileOffset": offset,
                    "editedScalars": width,
                }
            )
    output = out / "contrast.onnx"
    output.write_bytes(patched)
    if len(patched) != len(raw):
        raise ValueError("Transferred model grew")
    # Parse again and check every non-target tensor and every unrelated output row byte for byte.
    altered = model(bytes(patched), wire)
    targets = {r["tensor"] for r in audit}
    for t1, t2 in zip(m.graph.initializer, altered.graph.initializer, strict=True):
        if t1.name != t2.name or tuple(t1.dims) != tuple(t2.dims):
            raise ValueError("Tensor layout changed")
        width = 256 if t1.name.endswith(".weight") else 1
        if t1.name not in targets and t1.raw_data != t2.raw_data:
            raise ValueError(t1.name)
        if t1.name in targets and t1.raw_data[width * 2 :] != t2.raw_data[width * 2 :]:
            raise ValueError(t1.name)
    return {
        "sourceSha256": sha(raw),
        "candidateSha256": sha(patched),
        "bytes": len(raw),
        "initializerElementsIncludingConstants": sum(
            math.prod(t.dims) for t in m.graph.initializer
        ),
        "otherTensorsVerified": len(tensors) - len(targets),
        "eligibleScalars": 771,
        "valuesActuallyChanged": changed,
        "edits": audit,
        "fileByteDifferences": int(
            np.count_nonzero(np.frombuffer(raw, "u1") != np.frombuffer(patched, "u1"))
        ),
        "licenseInMetadata": meta.get("license"),
        "modelDescription": meta.get("description"),
    }


def session(p, wire):
    m = model(p.read_bytes(), wire)
    sig = next(n for n in m.graph.node if n.name == "/model.23/Sigmoid")
    # Diagnostic graph output exposes the existing pre-sigmoid tensor. Its working
    # buffer is never saved as a served model and adds no learned parameters.
    extra = m.graph.output.add()
    extra.name = sig.input[0]
    extra.type.tensor_type.elem_type = 10
    for value in ["batch", 20, "anchors"]:
        dim = extra.type.tensor_type.shape.dim.add()
        if isinstance(value, int):
            dim.dim_value = value
        else:
            dim.dim_param = value
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.log_severity_level = 3
    sess = ort.InferenceSession(
        m.SerializeToString(), sess_options=options, providers=["CPUExecutionProvider"]
    )
    return sess, extra.name


def letterbox(path):
    with Image.open(path) as im:
        rgb = np.asarray(ImageOps.exif_transpose(im).convert("RGB"))
    h, w = rgb.shape[:2]
    scale = min(1024 / w, 1024 / h)
    rw, rh = round(w * scale), round(h * scale)
    top, left = (1024 - rh) // 2, (1024 - rw) // 2
    canvas = np.full((1024, 1024, 3), 114, np.uint8)
    canvas[top : top + rh, left : left + rw] = cv2.resize(
        rgb, (rw, rh), interpolation=cv2.INTER_LINEAR
    )
    return np.ascontiguousarray(canvas.transpose(2, 0, 1)[None]).astype(np.float32) / 255, (
        left,
        top,
        rw,
        rh,
    )


def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -80, 80)))


def proposals(centers, scores, box):
    def score(pos):
        x0, y0, x1, y1 = crop_box(pos)
        loc = (centers[0] >= x0) & (centers[0] <= x1) & (centers[1] >= y0) & (centers[1] <= y1)
        return float(scores[loc].max()) if loc.any() else -1

    best = max(GRID, key=score)
    return {"centers": [CENTER, best], **evaluate([CENTER, best], [[0, *box]])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workspace", type=Path)
    ap.add_argument("--prepare-only", action="store_true")
    a = ap.parse_args()
    out = a.workspace
    out.mkdir(parents=True, exist_ok=True)
    spec = json.loads(Path(__file__).with_name("trained-head-protocol.json").read_text("utf8"))
    wire = schema()
    audit = prepare(out, spec, wire)
    (out / "head-manifest.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf8")
    if a.prepare_only:
        print(json.dumps({k: v for k, v in audit.items() if k != "edits"}))
        return
    cv2.setNumThreads(1)
    cases = json.loads((out / "cases.json").read_text("utf8"))["cases"]
    source = {m["id"]: m for m in json.loads((out / "sources.json").read_text("utf8"))["members"]}
    A, ao = session(out / "stock.onnx", wire)
    B, bo = session(out / "contrast.onnx", wire)
    rows = []
    max_identity = 0
    max_untouched = 0
    max_location = 0
    max_rounded_odds = 0
    for c in cases:
        file = out / "normalized" / (c["id"] + ".jpg")
        if sha(file.read_bytes()) != c["normalizedSha256"]:
            raise ValueError("Input drift")
        arr, geo = letterbox(file)
        t = perf_counter()
        aout, z0 = A.run(["output0", ao], {"images": arr})
        ams = (perf_counter() - t) * 1000
        t = perf_counter()
        bout, z1 = B.run(["output0", bo], {"images": arr})
        bms = (perf_counter() - t) * 1000
        aout = aout[0].astype(np.float64)
        bout = bout[0].astype(np.float64)
        z0 = z0[0].astype(np.float64)
        z1 = z1[0].astype(np.float64)
        if (
            z0.shape[0] != 20
            or z0.shape != z1.shape
            or aout.shape[0] != 24
            or not np.isfinite(z0).all()
            or not np.isfinite(z1).all()
        ):
            raise ValueError("Unusable detector output")
        if (
            np.max(np.abs(sigmoid(z0[0]) - aout[4])) > 0.003
            or np.max(np.abs(sigmoid(z1[0]) - bout[4])) > 0.003
        ):
            raise ValueError("Logit layout mismatch")
        hp, sp = aout[4], aout[5]
        stockscore = hp
        # Direct edit and the equivalent independent control using original trained logits.
        physical = sigmoid(z1[0] + z1[1]) * sigmoid(z1[0])
        math_control = sigmoid(z0[0]) * sigmoid(z0[0] - z0[1])
        eps = 1.0e-6
        hp0 = np.clip(hp, eps, 1 - eps)
        sp0 = np.clip(sp, eps, 1 - eps)
        output_control = hp * sigmoid(np.log(hp0 / (1 - hp0)) - np.log(sp0 / (1 - sp0)))
        max_identity = max(max_identity, float(np.max(np.abs(physical - math_control))))
        max_rounded_odds = max(max_rounded_odds, float(np.max(np.abs(physical - output_control))))
        max_untouched = max(max_untouched, float(np.max(np.abs(aout[5:] - bout[5:]))))
        max_location = max(max_location, float(np.max(np.abs(aout[:4] - bout[:4]))))
        row = {
            "id": c["id"],
            "item": c["item"],
            "class": c["class"],
            "mode": c["mode"],
            "stock": float(stockscore.max()),
            "edited": float(physical.max()),
            "noEditLogitControl": float(math_control.max()),
            "noEditProbabilityControl": float(output_control.max()),
            "stockMs": round(ams, 3),
            "editedMs": round(bms, 3),
        }
        if c["mode"] == "whole":
            left, top, rw, rh = geo
            centers = np.stack([(aout[0] - left) / rw, (aout[1] - top) / rh])
            box = source[c["id"][: -len("-whole")]]["box"]
            row["location"] = {
                k: proposals(centers, v, box)
                for k, v in [("stock", stockscore), ("edited", physical)]
            }
        rows.append(row)
    results = {}
    for mode in ("region", "whole"):
        subset = [r for r in rows if r["mode"] == mode]
        y = [r["class"] == "holes" for r in subset]
        results[mode] = {
            k: round6(auc(y, [r[k] for r in subset]))
            for k in ("stock", "edited", "noEditLogitControl", "noEditProbabilityControl")
        }
    for cls in ["holes", "spots"]:
        part = [r for r in rows if r["mode"] == "whole" and r["class"] == cls]
        results[cls + "Location"] = {
            k: sum(r["location"][k]["covered"] for r in part) for k in ["stock", "edited"]
        }
    results["sameBoxMaxAbsoluteDeltaPixels"] = max_location
    results["untouchedClassMaxAbsDelta"] = max_untouched
    results["physicalVsNoEditMaxAbsScore"] = max_identity
    results["physicalVsPublicProbabilitiesMaxAbsScore"] = max_rounded_odds
    results["physicalItemCount"] = len({r["item"] for r in rows})
    (out / "head-results.json").write_text(
        json.dumps({"summary": results, "rows": rows}, indent=2) + "\n", encoding="utf8"
    )
    print(json.dumps(results))


if __name__ == "__main__":
    main()
