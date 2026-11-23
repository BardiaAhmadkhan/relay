"""Pack only the donor vision-block A/B tensors in their original F32 bytes for lab reproduction."""

import hashlib, json, struct, sys, zipfile
from pathlib import Path
from urllib.request import urlopen


def pack(work, out):
    spec = json.loads((work / "protocol.json").read_bytes())
    data = (work / "donor.safetensors").read_bytes()
    sha = lambda b: hashlib.sha256(b).hexdigest()
    assert sha(data) == spec["donorSha"]
    n = struct.unpack("<Q", data[:8])[0]
    orig = json.loads(data[8 : 8 + n])
    off = 0
    header = {}
    parts = []
    for name in sorted(k for k in orig if ".visual.blocks." in k):
        assert name.endswith((".lora_A.weight", ".lora_B.weight"))
        tensor = orig[name]
        a, b = tensor["data_offsets"]
        v = data[8 + n + a : 8 + n + b]
        parts.append(v)
        header[name] = {**tensor, "data_offsets": [off, off + len(v)]}
        off += len(v)
    assert len(parts) == 192 and off == 25165824
    hb = json.dumps(header, separators=(",", ":")).encode()
    hb += b" " * ((-len(hb)) % 8)
    subset = struct.pack("<Q", len(hb)) + hb + b"".join(parts)
    with urlopen("https://www.apache.org/licenses/LICENSE-2.0.txt", timeout=30) as f:
        license = f.read()
    assert b"Apache License" in license and b"Version 2.0" in license
    hashes = json.loads((work / "weight-manifest.json").read_bytes())
    manifest = dict(
        source=spec["donor"],
        revision=spec["donorRevision"],
        sourceArtifactSHA256=spec["donorSha"],
        visionArtifactSHA256=sha(subset),
        type="Research-only extracted adapter subset; all 192 A/B tensors are byte-identical to their named donor entries. Fold into a copy of the stock 2B projector before inference.",
        rank=16,
        alpha=16,
        bytes=len(subset),
        tensorPayloadBytes=off,
        stockAndMergedManifestDigests={k: v["manifestDigest"] for k, v in hashes["arms"].items()},
        licenseSHA256=sha(license),
    )
    notice = (
        "Original adapter: Intel, qwen3.5-2b-vlm-weld-explainability-lora, "
        + spec["donorRevision"]
        + ".\nApache License 2.0 as identified by the publisher. This distribution selects and repacks the 192 visual-block factors without changing their values. No label, photograph, text weight, serving checkpoint or endorsement is included.\n"
    )
    out.parent.mkdir(exist_ok=True, parents=True)
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=3) as z:
        for name, body in [
            ("vision-blocks.safetensors", subset),
            ("provenance.json", (json.dumps(manifest, indent=2) + "\n").encode()),
            ("LICENSE.txt", license),
            ("NOTICE.txt", notice.encode()),
        ]:
            info = zipfile.ZipInfo(name, (2026, 11, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, body, compresslevel=3)
    with zipfile.ZipFile(out) as z:
        assert (
            z.testzip() is None
            and sha(z.read("vision-blocks.safetensors")) == manifest["visionArtifactSHA256"]
        )
    print(
        json.dumps(
            {**manifest, "archiveBytes": out.stat().st_size, "archiveSha256": sha(out.read_bytes())}
        )
    )


if __name__ == "__main__":
    pack(Path(sys.argv[1]), Path(sys.argv[2]))
