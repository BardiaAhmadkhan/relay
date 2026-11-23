from pathlib import Path
import hashlib,json,collections
read=lambda p:json.loads(Path(p).read_text(encoding='utf8'))
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
root=Path('collab/baseline/v35-activation/hosting');main=root/'cloud-parity-manifest.json';overlay=root/'near-threshold-candidates.json'
m=read(main);z=read(overlay);e19={i['id']:i for i in read('datasets/realworld-v3/labels.json')['cases']};attr={i['id']:i for i in read('datasets/quality-cycle-02/attribution.json')['images']}
out=[]
def add(p,identifier,view,kind,stratum):
 d=sha(p['file']);assert d==p['sha256'];assert p['license'] and not identifier.startswith('user-')
 out.append(dict(id=identifier,file=p['file'],rawSha256=d,view=view,cohort=kind,stratum=stratum,attribution=dict(author=p.get('author'),page=p.get('page') or p.get('source') or p.get('sourceUrl'),license=p['license'],licenseUrl=p.get('licenseUrl')),cloudUse='owner_approved_provenance'))
for r in z['rows']:
 p=e19.get(r['id']) or attr[r['id']];assert p['sha256']==r['sourceSha'];add(p,r['id'],r['view'],'margin40',r['selectedBy'])
for p in [e19['cm-084'],next(x for x in read('assets/fixtures/manifest.json')['fixtures'] if x['id']=='backpack-label'),next(x for x in read('assets/fixtures/round-02/acquisition.json')['acquired'] if x['id']=='helmet-label')]:
 add(p,p['id'],'label','labels3','label')
assert len(out)==43 and all(i['attribution']['page'] for i in out);assert len(set(i['attribution']['page'] for i in out if i['view']=='label'))==3
manifest=dict(version=2,kind='D-015 approved close-up/label supplement for noncommercial private hardware testing',primaryManifestSha=sha(main),marginSelectionSha=sha(overlay),memberships=len(out),uniqueRawImages=len(set(i['rawSha256'] for i in out)),viewCounts=dict(collections.Counter(i['view'] for i in out)),rows=out)
buf=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();f=root/'cloud-parity-closeups.json'
if f.exists():assert f.read_bytes()==buf
else:f.write_bytes(buf)
print(json.dumps({'sha':hashlib.sha256(buf).hexdigest(),'views':manifest['viewCounts'],'n':len(out)}))
