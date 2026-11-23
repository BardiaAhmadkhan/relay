import argparse
import hashlib
import json
from pathlib import Path
from fetch_external import wargon, sha


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workspace", type=Path)
    ap.add_argument("stage3_sources", type=Path)
    args = ap.parse_args()
    out = args.workspace
    out.mkdir(exist_ok=True, parents=True)
    (out / "raw").mkdir(exist_ok=True)
    protocol = Path(__file__).with_name("trained-head-protocol.json").read_bytes()
    spec = json.loads(protocol)
    (out / "protocol.json").write_bytes(protocol)
    source_spec = json.loads(Path(__file__).with_name("external-protocol.json").read_text("utf8"))[
        "wargon"
    ]
    prior = json.loads(args.stage3_sources.read_text("utf8"))
    excluded = {c["item"] for c in prior["members"] if c["source"] == "wargon"}
    members, stats = wargon(
        out, source_spec, lambda s: sha((spec["salt"] + "/" + s).encode()), excluded
    )
    if any(c["item"] in excluded for c in members) or len({c["item"] for c in members}) != len(
        members
    ):
        raise ValueError("Item-level overlap")
    manifest = {
        "protocolSha": sha(protocol),
        "previousSourceSha": sha(args.stage3_sources.read_bytes()),
        "excludedStage3Items": sorted(excluded),
        "wargon": stats,
        "members": members,
    }
    (out / "sources.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(json.dumps(stats))


if __name__ == "__main__":
    main()
