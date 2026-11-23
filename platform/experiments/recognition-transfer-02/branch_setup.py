"""Predeclare branch-restricted transfer after the first study and before any new score."""

import json, sys, shutil, hashlib
from pathlib import Path


def main(first, out):
    s = json.loads((first / "protocol.json").read_bytes())
    summ = json.loads((first / "results.json").read_bytes())
    assert len(summ["metrics"]["region"]["pooled"]) == 3
    s.update(
        version="relay-visual-attention-versus-mlp-02",
        salt="relay-vision-branch-fresh-11807",
        arms={"base": 0, "attention": 0.5, "mlp": 0.5},
        primary="attention",
        branches={
            "attention": ["attn.qkv", "attn.proj"],
            "mlp": ["mlp.linear_fc1", "mlp.linear_fc2"],
        },
        excludeManifestSha256=hashlib.sha256((first / "sources.json").read_bytes()).hexdigest(),
        motivation="Prior all-vision half edit recovered 5 holes and lost one at p>=0.5; overall rank was unchanged and whole context worsened. Isolate learned attention routing from learned MLP features on new original items. Primary attention at the previous half-strength, MLP is the mechanism comparator. Weight edits are candidates for a marked branch only.",
        promotion="Freeze attention as primary before scores: region AUC gain >0 in both new halves, positive paired bootstrap lower bound, no introduced missed holes or spot false alarms at diagnostic 0.5, no incomplete answers. Whole-view score measured as a collateral stress test; require no decrease for a general deployment. Neither arm can clear a real item without separate field qualification.",
    )
    out.mkdir(exist_ok=False)
    (out / "protocol.json").write_text(json.dumps(s, indent=2) + "\n", encoding="utf8")
    for name in ["donor.safetensors", "adapter_config.json", "anchors.json"]:
        shutil.copyfile(first / name, out / name)
    shutil.copyfile(first / "sources.json", out / "excluded.json")


if __name__ == "__main__":
    main(*(Path(a) for a in sys.argv[1:]))
