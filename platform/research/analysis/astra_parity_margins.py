"""Select a deterministic supplementary near-threshold set from earlier score logs.
No inference, network, new images, threshold fitting or change to the primary frozen manifest."""
from pathlib import Path
import json,hashlib,collections,math
rd=lambda p:json.loads(Path(p).read_text(encoding='utf8'))
rows=lambda p:[json.loads(s) for s in Path(p).read_text(encoding='utf8').splitlines() if s.strip()]
root=Path('collab/baseline/v35-activation/hosting')
main=rd(root/'cloud-parity-manifest.json')
e19={r['id']:r for r in rd('datasets/realworld-v3/labels.json')['cases']}
attr={r['id']:r for r in rd('datasets/quality-cycle-02/attribution.json')['images']}
histor=rows('benchmarks/backend-v2/realworld--v3.jsonl')
cal=rows('collab/baseline/v31-as-restored/calibration-223.jsonl')
calL= lambda edge:{r['photoId']:r for r in rows('benchmarks/backend-v2/calib--gear-2--qwen3.5-4b--e'+str(edge)+'.scores.jsonl')}
low=calL(512);full=calL(1600)
targets={'damage_clear':.145,'damage_block':.646,'repair_clear':.30,'repair_block':.85,'single_item':.5,'category_confidence':.6,'detail512_clear':.139,'detail512_block':.552}
candidates={}
def register(p,src,view,features):
 if not src.get('license') or p.startswith('user-'):return
 hits={k:round(abs(t-targets[k]),10) for k,t in features.items() if isinstance(t,(float,int)) and abs(t-targets[k])<=.050000001}
 if hits:candidates[(src['sha256'],view)]={'id':p,'sourceSha':src['sha256'],'view':view,'license':src['license'],'scoreOrigin':src.get('domain','calibration'),'distanceToThreshold':hits}
for r in histor:
 a=r['answers'];cat=a.get('category');conf=float(cat.split(':')[-1]) if isinstance(cat,str) else None
 feats={'damage_clear':r['damage'],'damage_block':r['damage'],'repair_clear':a.get('repair'),'repair_block':a.get('repair'),'category_confidence':conf}
 if r['view'] in ('front','back'):feats['single_item']=r.get('singleItem')
 if r['view']=='detail' and isinstance(a.get('road_contact_low'),(int,float)):
  v=max(a['road_contact_low'],a.get('broken_low') or 0);feats.update(detail512_clear=v,detail512_block=v)
 register(r['id'],e19[r['id']],r['view'],feats)
def yn(heads,k):return heads.get(k,{}).get('p')
for r in cal:
 k=r['id']
 if k not in attr or k not in low or k not in full:continue
 a=full[k]['answers'];b=low[k]['answers']
 score=max(yn(a,'road_contact') or 0,yn(a,'broken') or 0);stage=max(yn(b,'road_contact') or 0,yn(b,'broken') or 0)
 register(k,attr[k],'detail',{'damage_clear':score,'damage_block':score,'repair_clear':yn(a,'repair'),'repair_block':yn(a,'repair'),'detail512_clear':stage,'detail512_block':stage})
sortkey=lambda r,t:(r['distanceToThreshold'][t],hashlib.sha256(('relay-near-line-v1|'+r['sourceSha']+'|'+r['view']).encode()).hexdigest())
queues={t:sorted((r for r in candidates.values() if t in r['distanceToThreshold']),key=lambda r:sortkey(r,t)) for t in targets}
chosen=[];selected=set()
while len(chosen)<40:
 before=len(chosen)
 for t in targets:
  pool=queues[t];r=next((r for r in pool if r['sourceSha'] not in selected),None)
  if r is None:continue
  row={**r,'selectedBy':t,'primarySourceMatches':[i['cohort']+'/'+i['id'] for i in main['rows'] if i['rawSha256']==r['sourceSha']],'primarySameView':[i['cohort']+'/'+i['id'] for i in main['rows'] if i['rawSha256']==r['sourceSha'] and i['view']==r['view']]}
  selected.add(r['sourceSha']);chosen.append(row)
  if len(chosen)==40:break
 if before==len(chosen):break
rep={'method':'Round-robin across eight calibrated lines; take nearest remaining independent source per line within absolute probability 0.05. Source hash and fixed seed break ties. Used pre-existing E19 and calibration heads, which sometimes lack certain observations. No thresholds were fitted.','primaryManifestSha':hashlib.sha256((root/'cloud-parity-manifest.json').read_bytes()).hexdigest(),'sourceViewCandidates':len(candidates),'selected':len(chosen),'overlapSourceCount':sum(bool(r['primarySourceMatches']) for r in chosen),'overlapSourceAndViewCount':sum(bool(r['primarySameView']) for r in chosen),'eligibleByLine':{k:len(v) for k,v in queues.items()},'rows':chosen}
out=root/'near-threshold-candidates.json';buf=(json.dumps(rep,indent=2)+'\n').encode()
if out.exists():assert out.read_bytes()==buf
else:out.write_bytes(buf)
print(json.dumps({k:v for k,v in rep.items() if k not in ('method','rows')},separators=(',',':')))
