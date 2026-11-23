"""D-015. Lock the source bytes, sample and permissions before scoring. No network."""
from pathlib import Path
from collections import defaultdict,Counter
import hashlib,json,math
root=Path.cwd();read=lambda p:json.loads((root/p).read_text(encoding='utf8'));lines=lambda p:[json.loads(x) for x in (root/p).read_text(encoding='utf8').splitlines() if x]
h=lambda b:hashlib.sha256(b).hexdigest()
base='collab/baseline/v31-as-restored/';dst=root/'collab/baseline/v35-activation/hosting/cloud-parity-manifest.json'
field=lines(base+'restored-model-44-full-precision.jsonl');e19={p['id']:p for p in read('datasets/realworld-v3/labels.json')['cases']};attr={p['id']:p for p in read('datasets/quality-cycle-02/attribution.json')['images']}
routed=[p['id'] for p in read('research/analysis/r2-replay-output.json')['results'] if p['routedR2']]
pool=lines(base+'calibration-223.jsonl');strata=defaultdict(list)
for p in pool:
 if p['id'] not in attr:continue
 strata['|'.join([p['domain'],p['label'],p['full1600DamageBand']])].append(p)
assert len(pool)==223 and sum(map(len,strata.values()))==220 and len(field)==44 and len(routed)==10
seed='relay-d015-20261120-v1';rank=lambda v:h((seed+'|'+v).encode())
quota={s:1 for s in strata}
for _ in range(100-sum(quota.values())):
 s=max((s for s in strata if quota[s]<len(strata[s])),key=lambda t:(100*len(strata[t])/220-quota[t],rank(t)));quota[s]+=1
locked=[]
def add(p,source,cohort,view='front',archive=None,stratum=None):
 file=root/source['file'];digest=h(file.read_bytes());assert digest==source['sha256'],p
 lic=source['license'];allow=lic.startswith(('CC BY ','CC BY-SA ','CC0','Public domain'))
 item=dict(id=p,file=source['file'],rawSha256=digest,view=view,cohort=cohort,stratum=stratum,attribution=dict(author=source.get('author'),page=source.get('page') or source.get('source'),license=lic,licenseUrl=source.get('licenseUrl')),cloudUse='cleared_public' if allow else 'requires_rights_review')
 if archive:item.update(archivedSourceBytesMatch=archive['sourceSha256']==digest,archivedMobileSha=archive['mobileEquivalentJpegSha256'],archivedWorkingSha=archive['record']['sha256'])
 locked.append(item)
for p in field:add(p['item'],e19[p['item']],'field44',p['scores']['view'],p,p['group'])
rec={p['id']:p for p in lines('benchmarks/backend-v2/realworld--v3.jsonl')}
for id in routed:add(id,e19[id],'routed10',rec[id]['view'])
for s in sorted(strata):
 for p in sorted(strata[s],key=lambda x:rank(x['group']+'|'+x['id']))[:quota[s]]:add(p['id'],attr[p['id']],'calibration100','front',None,s)
report={'version':1,'seed':seed,'sampling':'All 44 saved field cases and all ten original R2 cases. From 220 attributed calibration rows (3 private user rows excluded), assign one row per domain/reference-label/historical-damage-band stratum, then proportional largest deficits until 100. Within stratum sort by the frozen seed, group and ID hash. No new model output used.','strata':quota,'memberships':len(locked),'uniqueRawImages':len(set(p['rawSha256'] for p in locked)),'rightsReview':sorted(set(p['id'] for p in locked if p['cloudUse']!='cleared_public')),'rows':locked}
b=(json.dumps(report,ensure_ascii=False,indent=2)+'\n').encode()
if dst.exists():assert dst.read_bytes()==b,'Frozen file differs'
else:dst.write_bytes(b)
print(json.dumps({'memberships':len(locked),'uniqueRawImages':report['uniqueRawImages'],'rightsReview':report['rightsReview'],'sha256':h(b)}))
