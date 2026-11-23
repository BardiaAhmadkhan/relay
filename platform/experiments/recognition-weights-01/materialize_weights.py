"""Pack or apply the two edited tensors. Input/output checkpoints are verified by SHA-256."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np


def sha_file(path):
    value = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def pack(source, candidate, report, archive, license_file):
    if archive.exists():
        raise FileExistsError(archive)
    meta = json.loads(report.read_text("utf8"))
    arm = meta["arms"]["semantic"]
    audit = arm["audit"]
    if (
        sha_file(source) != meta["arms"]["base"]["projectorDigest"]
        or sha_file(candidate) != arm["projectorDigest"]
    ):
        raise ValueError("Projector identities do not match measured run")
    entries = [
        ("mm.2.weight", audit["weightOffset"], 4096 * 2048 * 2),
        ("mm.2.bias", audit["biasOffset"], 2048 * 4),
    ]
    doc = {
        "format": "relay-gguf-xor-v1",
        "inputSha256": sha_file(source),
        "resultSha256": arm["projectorDigest"],
        "unchangedLanguageSha256": arm["languageBlob"],
        "projectorBytes": candidate.stat().st_size,
        "totalParameters": meta["totalParameters"],
        "learnedBytesPerArm": meta["learnedBytesPerArm"],
        "license": "Apache-2.0",
        "components": [],
    }
    with (
        source.open("rb") as a,
        candidate.open("rb") as b,
        zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z,
    ):
        for name, offset, size in entries:
            a.seek(offset)
            b.seek(offset)
            old = np.frombuffer(a.read(size), dtype=np.uint8)
            new = np.frombuffer(b.read(size), dtype=np.uint8)
            blob = np.bitwise_xor(old, new).tobytes()
            member = name + ".xor"
            doc["components"].append(
                {
                    "member": member,
                    "offset": offset,
                    "bytes": size,
                    "sha256": hashlib.sha256(blob).hexdigest(),
                }
            )
            z.writestr(member, blob)
        z.writestr("manifest.json", json.dumps(doc, indent=2) + "\n")
        z.write(license_file, "LICENSE.txt")
        z.writestr(
            "NOTICE.txt",
            "Research modification of Qwen/Qwen3.5-2B and its installed GGUF vision projector. The final vision-to-language affine map was changed for a controlled surface-evidence experiment. All remaining model data is unchanged. No training data was used to make this modification.\n",
        )
    return doc


def apply(source, archive, out):
    if out.exists() or source.resolve() == out.resolve():
        raise FileExistsError(out)
    temp = None
    try:
        with zipfile.ZipFile(archive) as z:
            d = json.loads(z.read("manifest.json"))
            if (
                d["format"] != "relay-gguf-xor-v1"
                or source.stat().st_size != d["projectorBytes"]
                or sha_file(source) != d["inputSha256"]
            ):
                raise ValueError("Wrong source projector")
            # Construct first and publish exclusively only after full-file verification.
            with (
                source.open("rb") as a,
                tempfile.NamedTemporaryFile(
                    prefix=out.name + ".", suffix=".partial", dir=out.parent, delete=False
                ) as b,
            ):
                temp = Path(b.name)
                shutil.copyfileobj(a, b, 4 * 1024 * 1024)
            previous = 0
            with temp.open("r+b") as f:
                for e in sorted(d["components"], key=lambda x: x["offset"]):
                    start, size = e["offset"], e["bytes"]
                    if start < previous or size <= 0 or start + size > d["projectorBytes"]:
                        raise ValueError("Invalid patch span")
                    previous = start + size
                    if z.getinfo(e["member"]).file_size != size:
                        raise ValueError("Patch size mismatch")
                    delta = z.read(e["member"])
                    if hashlib.sha256(delta).hexdigest() != e["sha256"]:
                        raise ValueError("Patch checksum mismatch")
                    f.seek(start)
                    base = np.frombuffer(f.read(size), dtype=np.uint8)
                    f.seek(start)
                    f.write(np.bitwise_xor(base, np.frombuffer(delta, dtype=np.uint8)).tobytes())
            if sha_file(temp) != d["resultSha256"] or temp.stat().st_size != d["projectorBytes"]:
                raise ValueError("Output digest mismatch")
            # Windows rename, or an exclusive hard link on POSIX, never overwrites a competing file.
            import os

            if os.name == "nt":
                temp.rename(out)
            else:
                os.link(temp, out)
                temp.unlink()
            return d["resultSha256"]
    finally:
        if temp is not None and temp.exists():
            temp.unlink()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    subs = ap.add_subparsers(dest="command", required=True)
    build = subs.add_parser("pack")
    for arg in ["source", "candidate", "report", "archive", "license"]:
        build.add_argument(arg, type=Path)
    material = subs.add_parser("apply")
    for arg in ["source", "archive", "out"]:
        material.add_argument(arg, type=Path)
    a = ap.parse_args()
    if a.command == "pack":
        print(pack(a.source, a.candidate, a.report, a.archive, a.license)["resultSha256"])
    else:
        print(apply(a.source, a.archive, a.out))
