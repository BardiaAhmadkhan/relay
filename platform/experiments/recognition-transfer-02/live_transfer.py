"""Freeze the agreed, native 4B transfer before seeing any 4B scores."""

import hashlib, json, shutil, sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd() / "experiments/recognition-weights-01"))
from prepare_weights import file_sha
from semantic_weights import emit_variant


def main(first, second, out):
    out.mkdir(exist_ok=False)
    store = out / "model-store"
    blobs = store / "blobs"
    blobs.mkdir(parents=True)
    base = "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04"
    spec = dict(
        version="relay-original-4b-transfer-05",
        studyType="unguided",
        arms={"base": 0},
        parameters={"text": 4205751296, "vision": 333514240},
        referenceDigest=base,
        maxParameters=4539265536,
        maxLearnedBytes=3324162336,
        salt="relay-native-4b-crossover-05",
        rationale="The owner clarified that the original model called 4B, including its projector, is the live size ceiling. The fixed 2B studies were faster research. Evaluate the replicated location method on original stock 4B before enabling it in Relay. No weight edit is promoted by this comparison.",
        primary="On the same two disjoint Wargon sets from rounds 1 and 2 (32 holes +32 spots each), compare the original unplanned broken question on the source-mark chip versus the retained whole photo using stock 4B. Require positive region-minus-whole pair-ranking AUC in each independent item set, positive pooled stratified paired bootstrap 95% lower bound (5000 trials, seed 11807), complete scores, and exact stock repeat readback. Do not threshold the mark into an autonomous offer or exclusion. If the conditions fail, keep the mark in research until a new independent qualification. Report the 2B reference on exactly the same hashes and paired class-specific errors at diagnostic 0.50 separately.",
        limits="Ordinary apparel, publisher-supplied locations rather than actual rider taps, and a spot label applies to its annotated region. Whole-frame comparisons are diagnostic. No 2B safetensors may be cross-loaded into the non-identical 4B architecture.",
    )
    (out / "protocol.json").write_text(json.dumps(spec, indent=2) + "\n", encoding="utf8")
    origin = Path(".cache/ollama/blobs")
    f = origin / ("sha256-" + base)
    assert file_sha(f) == base
    raw = f.read_bytes()
    m = json.loads(raw)
    learned = 0
    pd = ""
    for row in [m["config"], *m["layers"]]:
        dg = row["digest"].split(":")[1]
        src = origin / ("sha256-" + dg)
        assert src.stat().st_size == row["size"] and file_sha(src) == dg
        shutil.copyfile(src, blobs / src.name)
        if row.get("mediaType", "").rsplit(".", 1)[-1] in ("model", "projector"):
            learned += row["size"]
        if row.get("mediaType", "").endswith(".projector"):
            pd = dg
    assert (
        learned == spec["maxLearnedBytes"]
        and sum(spec["parameters"].values()) == spec["maxParameters"]
    )
    arm = emit_variant(store, m, raw, blobs / ("sha256-" + pd), pd, "base")
    proto = file_sha(out / "protocol.json")
    (out / "weight-manifest.json").write_text(
        json.dumps(
            dict(
                arms={"base": arm},
                protocolSha256=proto,
                learnedBytesPerArm=learned,
                totalParameters=sum(spec["parameters"].values()),
            ),
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    dest = out / "normalized"
    dest.mkdir()
    cases = []
    for group, path in [("first", first), ("second", second)]:
        src = json.loads((path / "cases.json").read_bytes())["cases"]
        for c in src:
            f = path / "normalized" / (c["id"] + ".jpg")
            assert file_sha(f) == c["normalizedSha256"]
            target = dest / f.name
            assert not target.exists()
            shutil.copyfile(f, target)
            cases.append({**c, "transferSet": group})
    cases.sort(key=lambda c: hashlib.sha256((spec["salt"] + "/" + c["id"]).encode()).hexdigest())
    assert len(cases) == 256 and len({c["item"] for c in cases}) == 128
    (out / "cases.json").write_text(
        json.dumps(dict(protocolSha256=proto, cases=cases), indent=2) + "\n", encoding="utf8"
    )
    print(arm, len(cases))


if __name__ == "__main__":
    main(*(Path(x) for x in sys.argv[1:]))
