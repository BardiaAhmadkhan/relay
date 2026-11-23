"""Replace the manifests of an unscored *private* study with byte-verified reconstructed projectors."""
import json,sys,shutil
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/"experiments/recognition-weights-01"))
from prepare_weights import file_sha
from semantic_weights import emit_variant
out,exact,golden=map(lambda s:Path(s).resolve(),sys.argv[1:])
source=Path(".cache/ollama").resolve()
assert out!=source and source not in out.parents and out not in source.parents and not (out/"scores.jsonl").exists()
spec=json.loads((out/"protocol.json").read_bytes());report=json.loads(golden.read_bytes())
assert report["protocolSha256"]==file_sha(out/"protocol.json") and set(report["arms"])==set(spec["arms"])
store=out/"model-store";blobs=store/"blobs";raw=(source/"blobs"/("sha256-"+spec["referenceDigest"])).read_bytes()
assert file_sha(source/"blobs"/("sha256-"+spec["referenceDigest"]))==spec["referenceDigest"]
for arm,expected in report["arms"].items():
    if arm=="base":continue
    proj=exact/(arm+".mmproj.gguf");dg=file_sha(proj);assert dg==expected["projectorDigest"]
    dest=blobs/("sha256-"+dg)
    if not dest.exists():shutil.copyfile(proj,dest)
    assert file_sha(dest)==dg
    m=json.loads(raw)
    entry=next(l for l in m["layers"] if l["digest"]=="sha256:"+spec["originalProjector"])
    entry["digest"]="sha256:"+dg
    result=emit_variant(store,m,raw,dest,dg,arm)
    assert result==expected
(out/"weight-manifest.json").write_bytes(golden.read_bytes())
print("All private aliases now reproduce the measured manifest digests:", list(report["arms"]))
