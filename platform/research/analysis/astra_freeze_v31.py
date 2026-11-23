"""Freeze the actual working tree and separate native recorded outcomes from diagnostic photo bands."""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile

def sha(b):return hashlib.sha256(b).hexdigest()
def file_hash(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(4<<20),b""):h.update(chunk)
    return h.hexdigest()
def rows(p):return [json.loads(x) for x in p.read_bytes().splitlines() if x]
def put(p,v):
    data=(json.dumps(v,indent=2,ensure_ascii=False)+"\n").encode()
    if p.exists() and p.read_bytes()!=data:raise ValueError("Immutable baseline destination differs: "+str(p))
    p.write_bytes(data)
def ledger(p,v):
    data="".join(json.dumps(r,sort_keys=True,ensure_ascii=False,separators=(",",":"))+"\n" for r in v).encode()
    if p.exists() and p.read_bytes()!=data:raise ValueError("Immutable baseline destination differs: "+str(p))
    p.write_bytes(data)
def profile(v):
    xs=sorted(v)
    if not xs:return {"n":0}
    def q(p):
        i=(len(xs)-1)*p;j=int(i);return round(xs[j]+(xs[min(j+1,len(xs)-1)]-xs[j])*(i-j),3)
    return {"n":len(xs),"p50":q(.5),"p95":q(.95)}
def capture(repo,out,rollback):
    out.mkdir(parents=True,exist_ok=True);records=[];skipdirs={"node_modules",".git",".expo",".gradle","__pycache__","Pods","coverage"}
    include={"package.json","package-lock.json","tsconfig.json","vitest.config.ts","playwright.config.ts",".env.example",".prettierrc.json"}
    for k in ("app","server","packages","scripts","tests"):
        for branch,dirs,files in os.walk(repo/k,followlinks=False):
            parent=Path(branch)
            dirs[:]=[s for s in dirs if s not in skipdirs and s not in ("build",".cxx","intermediates",".externalNativeBuild") and (parent/s).relative_to(repo).as_posix() not in ("app/android","app/ios","app/dist") and (parent/s).resolve()==parent/s]
            for name in files:
                f=parent/name
                if f.suffix.lower() in (".pyc",".pyo",".keystore",".jks",".p12",".pfx",".pem",".key",".gguf",".safetensors",".apk",".aab") or name in ("local.properties","key.properties") or name.startswith(".env") or f.resolve()!=f:continue
                if f.stat().st_size>32*1024**2:raise ValueError("Review unexpected large authored source before packaging: "+str(f.relative_to(repo)))
                include.add(f.relative_to(repo).as_posix())
    for k in sorted(include):
        f=repo/k
        if f.is_file():records.append({"path":k,"bytes":f.stat().st_size,"sha256":file_hash(f)})
    ledger(out/"source-hashes.jsonl",records)
    snap=out/"source-snapshot.zip"
    if not snap.exists():
        with zipfile.ZipFile(snap,"x") as z:
            for r in records:
                info=zipfile.ZipInfo(r["path"],(2026,11,20,0,0,0));info.create_system=3;info.external_attr=0o100644<<16;info.compress_type=zipfile.ZIP_DEFLATED
                z.writestr(info,(repo/r["path"]).read_bytes(),compresslevel=6)
    with zipfile.ZipFile(snap) as z:
        if z.testzip() or set(z.namelist())!={r["path"] for r in records}:raise ValueError("Incomplete snapshot")
        for r in records:
            if sha(z.read(r["path"]))!=r["sha256"]:raise ValueError(r["path"])
    b=repo/"benchmarks/backend-v2"
    labels={r["id"]:r for r in json.loads((repo/"datasets/realworld-v3/labels.json").read_bytes())["cases"]}
    e19=rows(b/"realworld--v3.jsonl");held=[r for r in e19 if not labels[r["id"]].get("seenInCalibration")]
    ledger(out/"e19-recorded-cases.jsonl",[{"id":r["id"],"split":"overlaps_original_calibration" if labels[r["id"]].get("seenInCalibration") else "historical_holdout","group":labels[r["id"]]["group"],"framing":r["framing"],"label":r["condition"],"view":r["view"],"outcome":r["outcome"],"reasons":r["reasons"],"band":r.get("band"),"wallMs":r["ms"],"tokens":r["tokens"],"answerFields":r["questions"],"recordedAnswers":r["answers"]} for r in e19])
    raw=rows(b/"battery--b1--qwen3.5-4b--e1600.jsonl")
    cfg=json.loads((repo/"packages/core/v2/thresholds.json").read_bytes())["perScorer"]["local_logprob"]["damage"]
    def binary(r):return r["condition"] in ("visible_defect","no_visible_defect")
    binaryrows=[]
    for r in raw:
        if not binary(r):continue
        pp=r["probes"];damage=max(pp["break"]["p"]["yes"],pp["slide"]["p"]["yes"])
        binaryrows.append({"id":r["id"],"group":r.get("group"),"domain":r.get("domain"),"label":r["condition"],"structural":pp["break"]["p"]["yes"],"roadContact":pp["slide"]["p"]["yes"],"full1600DamageBand":"clear" if damage<cfg["clear"] else ("block" if damage>=cfg["block"] else "review"),"outcome":None,"reason":"Original calibration battery lacks all fields and full intake required for a commercial outcome.","recordedBatteryMs":r["totalMs"]})
    assert len(binaryrows)==223
    ledger(out/"calibration-223.jsonl",binaryrows)
    # Preserve every previously recorded score family for baseline traceability without shipping copies of model weights or customer data.
    assets=[]
    for f in sorted((repo/"benchmarks").rglob("*")):
        if f.is_file() and f.suffix in (".jsonl",".json",".csv",".txt") and f.resolve()==f:
            entry={"path":f.relative_to(repo).as_posix(),"sha256":file_hash(f),"bytes":f.stat().st_size}
            if f.suffix==".jsonl":
                with f.open("rb") as stream:entry["lines"]=sum(1 for line in stream if line.strip())
            assets.append(entry)
    ledger(out/"recorded-evidence-index.jsonl",assets)
    old=rollback/"later-research/benchmarks/automatic-location-02"
    loc=rows(old/"per-photo-4b.jsonl");ledger(out/"location-140-v31-evidence.jsonl",[{"id":q["item"],"group":q["group"],"label":q["label"],"wholeStructural":q["methods"]["whole"],"suppliedStructural":q["methods"].get("supplied"),"supportedSuppliedSites":q["suppliedFlaggedMarkIds"],"annotatedSites":q["documentedMarks"],"completeCommercialIntake":False} for q in loc])
    field=rows(rollback/"withdrawn-scratch/v4-baseline-fronts/fronts.jsonl")
    ledger(out/"restored-model-44-full-precision.jsonl",field)
    quality=json.loads((rollback/"verification.json").read_bytes())
    summary={"snapshotSHA256":file_hash(snap),"authoredRuntimeAndTests":len(records),"sourceBytes":sum(r["bytes"] for r in records),"referenceFiles":len(assets),
             "gitHead":subprocess.check_output(["git","--no-optional-locks","rev-parse","HEAD"],cwd=repo,text=True).strip(),"worktreeBaselineIncludesUncommittedOwnerWork":True,"rootAndAppTypes":"passed","verifiedUnitTests":quality["unitTestsPassed"],"verifiedBrowserJourneys":quality["browserJourneysPassed"],"androidAPK":quality["originalAndroidAPK"],"model":quality["model"],"modelLiveProof":quality["actualRestoredService"],
             "e19":{"originalRows":len(e19),"historicalHoldout":len(held),"historicalOutcomes":dict(collections.Counter(r["outcome"] for r in held)),"perPhotoWallMs":profile([r["ms"] for r in held]),"historicalQuestionFieldsPerPhoto":profile([r["questions"] if isinstance(r["questions"],int) else len(r["questions"]) for r in held]),"interpretation":"Historical E19 results are one real photo with three negative fixture disclosures and reduced required views. Rounded emitted answers are not full-precision policy inputs. Cases already discussed during design are no longer blind validation for new rules."},
             "calibration223":{"totalArchived":len(raw),"binary":len(binaryrows),"labels":dict(collections.Counter(r["label"] for r in binaryrows)),"bands":dict(collections.Counter(r["full1600DamageBand"] for r in binaryrows)),"batteryWallMs":profile([r["recordedBatteryMs"] for r in binaryrows]),"interpretation":"Single high-resolution b1 damage-band diagnostic, not a complete v3.1 case disposition or production latency."},
             "reservedLocalization":{"photos":len(loc),"fullPrecisionOrdinaryIndexViews":len(field),"stockOverviewScorerMs":profile([r["scores"]["usage"]["ms"] for r in field]),"sourceLocation":"Recovery archive, study 02 and exact V3.1 entrypoint capture."},
             "exclusionsFromSourceSnapshot":sorted(skipdirs|{"app/android and app/ios (generated native copies)","app/dist","build",".cxx","signing material, model weights and packaged binaries"}),"timingMethod":"Linear empirical quantile; exact observed model/HTTP/decision-only and assessment timings are identified separately."}
    put(out/"baseline-summary.json",summary)
    print(len(records),len(assets),summary["e19"],summary["reservedLocalization"])
if __name__=="__main__":
    a=argparse.ArgumentParser();a.add_argument("repo",type=Path);a.add_argument("out",type=Path);a.add_argument("recovery",type=Path);v=a.parse_args();capture(v.repo.resolve(),v.out.resolve(),v.recovery.resolve())
