"""Acquire the pinned, public adapter and byte anchors for base coordinate verification."""

import json, hashlib, struct, sys
from pathlib import Path
from urllib.request import urlopen, Request


def read(url, region=None):
    headers = {"User-Agent": "Relay-Research/1"}
    if region:
        headers["Range"] = "bytes=%d-%d" % region
    with urlopen(Request(url, headers=headers), timeout=90) as f:
        if region and (
            f.status != 206 or not f.headers["Content-Range"].startswith("bytes %d-%d/" % region)
        ):
            raise IOError("Requested range not honored")
        return f.read(110_000_000 if not region else region[1] - region[0] + 2)


def main(out):
    s = json.loads((out / "protocol.json").read_bytes())
    prefix = "https://huggingface.co/"
    endpoint = prefix + s["donor"] + "/resolve/" + s["donorRevision"] + "/"
    data = read(endpoint + "adapter_model.safetensors?relay-inspect-v=1")
    if hashlib.sha256(data).hexdigest() != s["donorSha"]:
        raise ValueError("donor digest mismatch")
    (out / "donor.safetensors").write_bytes(data)
    config = read(endpoint + "adapter_config.json")
    (out / "adapter_config.json").write_bytes(config)
    model = json.loads(config)["base_model_name_or_path"]
    pinned = "fffbc0d8711cf87df6d1f97938c5e50ef94aadc7"
    api = json.loads(read(prefix + "api/models/" + model + "/revision/" + pinned))
    assert api["sha"] == pinned
    rev = api["sha"]
    p = prefix + model + "/resolve/" + rev + "/"
    files = {f["rfilename"] for f in api["siblings"]}
    index = (
        json.loads(read(p + "model.safetensors.index.json"))["weight_map"]
        if "model.safetensors.index.json" in files
        else {}
    )
    shards = sorted(set(index.values())) if index else ["model.safetensors"]
    anchors = {}
    headers = {}
    suffixes = ["attn.qkv", "attn.proj", "mlp.linear_fc1", "mlp.linear_fc2"]
    for shard in shards:
        url = p + shard

        def chunk(a, b):
            return read(url + "?relay-anchor=%d-%d" % (a, b), (a, b))

        n = struct.unpack("<Q", chunk(0, 7))[0]
        head = json.loads(chunk(8, 7 + n))
        for block in [0, 23]:
            for sub in suffixes:
                target = "visual.blocks.%d.%s.weight" % (block, sub)
                names = [k for k in head if k.endswith(target)]
                if not names:
                    continue
                name = names[0]
                meta = head[name]
                assert meta["dtype"] == "BF16"
                a, b = meta["data_offsets"]
                start = 8 + n + a
                # Sample both an interior row and its elements, not the header or an all-zero bias.
                off = (meta["shape"][1] * 17 + 19) * 2
                anchors[target] = {
                    "shape": meta["shape"],
                    "byteOffset": off,
                    "bytes": chunk(start + off, start + off + 63).hex(),
                    "shard": shard,
                }
    if len(anchors) != 8:
        raise ValueError(("unverified base", anchors.keys()))
    (out / "anchors.json").write_text(
        json.dumps(dict(base=model, revision=rev, anchors=anchors), indent=2) + "\n",
        encoding="utf8",
    )
    print("Verified download, collected", len(anchors), "base tensor anchors")


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
