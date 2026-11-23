from pathlib import Path
import json,re,hashlib,zipfile
root=Path(r'.').resolve()
report='docs/15-testing-and-qa/quality-cycle-02.md'
files={report,'datasets/quality-cycle-02/review.html','datasets/quality-cycle-02/comparison.csv','datasets/quality-cycle-02/comparison.json','datasets/quality-cycle-02/labels.json','datasets/quality-cycle-02/final-holdout-labels.json','datasets/quality-cycle-02/attribution.json','datasets/quality-audit-01/labels.json','datasets/quality-audit-01/attribution.json'}
for label in ['datasets/quality-audit-01/labels.json','datasets/quality-cycle-02/labels.json','datasets/quality-cycle-02/final-holdout-labels.json']:
 for c in json.loads((root/label).read_text(encoding='utf-8-sig'))['cases']:
  data=(root/c['file']).read_bytes();assert hashlib.sha256(data).hexdigest()==c['sha256'],c['id'];files.add(c['file'])
for target in re.findall(r'\]\(([^)]+)\)',(root/report).read_text(encoding='utf-8-sig')):
 if target.startswith(('https:','http:','#')):continue
 p=(root/report).parent.joinpath(target.split('#')[0]).resolve();assert p.is_relative_to(root);assert p.is_file(),target;files.add(p.relative_to(root).as_posix())
assert not any('assets/fixtures/round-03' in p for p in files)
for p in list(files):
 if p.endswith('.jsonl'):
  for line in (root/p).read_text(encoding='utf-8-sig').splitlines():
   if line:assert 'base64' not in json.loads(line),'image bytes unexpectedly included'
manifest=[{'path':p,'sha256':hashlib.sha256((root/p).read_bytes()).hexdigest(),'bytes':(root/p).stat().st_size}for p in sorted(files)]
out=root/'artifacts'/'Relay-quality-cycle-02-review.zip';out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6)as z:
 z.writestr('START-HERE.txt','Relay quality repair review\n\nExtract the entire ZIP, then open datasets/quality-cycle-02/review.html. It works locally without a model or network. Read docs/15-testing-and-qa/quality-cycle-02.md for methods and limits. The comparison includes 194 old audit photographs and 64 additional licensed validation photographs. Source, author, licence URL, transformations and hashes are in datasets/quality-cycle-02/attribution.json and the original label manifests. No user-provided image pixels or model weights are included. Benchmark captions and local test results are included as evidence; not every recognition failure is solved.\n')
 z.writestr('MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
 for p in sorted(files):z.write(root/p,p)
with zipfile.ZipFile(out)as z:
 assert z.testzip()is None
 for c in manifest:assert hashlib.sha256(z.read(c['path'])).hexdigest()==c['sha256'],c['path']
summary={'file':out.relative_to(root).as_posix(),'bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'files':len(files)+2,'photographs':258,'readbackHashesVerified':len(files),'privateUserImagePixelsIncluded':False}
(root/'benchmarks/quality-cycle-02/review-package.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,indent=2))
