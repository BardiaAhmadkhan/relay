"""Freeze the count witnesses before scoring. Primary two-reader votes take precedence."""
from pathlib import Path
import csv,json,hashlib,collections,sys
r=Path.cwd(); out=Path(sys.argv[1])
def sha(b): return hashlib.sha256(b).hexdigest()
labels=json.loads((r/'datasets/realworld-v3/labels.json').read_bytes())['cases']
kit=r/'collab/labelling/round-1';key=json.loads((r/'.cache/collab-labelling/round-1/key.json').read_bytes())
def sheet(name):
 with (kit/(name+'.csv')).open(encoding='utf-8-sig',newline='') as f:return {x['rid']:x['item_count'] for x in csv.DictReader(f)}
a,b=sheet('astra'),sheet('claude')
agreed={key[k]['id']:(a[k] if a[k]==b[k] else 'unresolved') for k in a}
loc={json.loads(s)['id'] for s in (r/'collab/baseline/v31-as-restored/location-140-v31-evidence.jsonl').read_text().splitlines()}
pair=set('cm-051 cm-527 cm-528 cm-529 cm-532 ox-080 ox-081 ov-005 ov-052 ov-060 ov-061 ov-063 ov-065 ov-066'.split())
one={'ov-048','ov-068'}
several=set('ov-051 cm-013 cm-060 cm-072 cm-109 cm-171 cm-298 cm-319 cm-342 cm-345 cm-431 cm-525 cm-526 cm-530 ox-083 ox-114'.split())
rows=[];seen=set()
def add(id,path,count,origin,framing,source_group,ordinary_view):
 blob=(r/path).read_bytes();h=sha(blob)
 if h in seen:return
 seen.add(h);rows.append(dict(id=id,path=path,sourceSha256=h,count=count,annotation=origin,framing=framing,sourceGroup=source_group,localisationOverlap=id in loc,ordinaryView=ordinary_view))
for c in labels:
 if c['seenInCalibration']:continue
 id=c['id'];f=c['framing']
 if id in agreed:cnt,source=agreed[id],'pre-score independent reviewers'
 elif id in pair:cnt,source='pair','visual count before new inference'
 elif id in one:cnt,source='one','visual count before new inference'
 elif id in several:cnt,source='several','visible gear count before new inference'
 elif f=='several_items':cnt,source='several','archived independent multiple-item framing'
 elif f=='item':cnt,source='one','archived independent single-item framing'
 else:cnt,source='unrated','no reliable count'
 add(id,c['file'],cnt,source,f,c['group'],c['view'])
for id,f,c in [('fixture-mixed','mixed-gear.jpg','several'),('fixture-worn','round-02/mixed-riding-gear.jpg','several'),('fixture-winter','round-02/winter-kit.jpg','one')]:
 add(id,'assets/fixtures/'+f,c,'visually inspected fixture before new inference','fixture',id,'front')
protocol={'control':'does this photograph show exactly one item? A pair of gloves or a pair of boots counts as one item.','candidate':'Is the photographed subject one piece of gear, or one matching left-and-right pair of gloves or boots? Answer no for unmatched pieces, multiple pairs, or additional separate gear items.','cutoff':0.5,'modelImage':'512 px using V3.1 prepareImages directly from the recorded source as E19 did','scope':'Global single_item replacement. Score both questions with the same stock model and probability semantics. Alternate which wording runs first by a fixed hash of source bytes. No fit or retuning. All historical E19 held-out unique sources plus licensed negative controls. Closed views and scenes are diagnostic queries; outcomes must only be claimed for views on which the production planner asks this head. Multiview and duplicated photographs of one physical item are not independent people. A newly accepted multi, a newly rejected definite single/pair, or no additional corrected pairs rejects the change. Unrated flips are listed for review.','counts':dict(collections.Counter(x['count'] for x in rows)),'sources':rows}
out.mkdir(exist_ok=True,parents=True);t=out/'protocol.json'
with t.open('x',encoding='utf-8') as f:json.dump(protocol,f,ensure_ascii=False,indent=2)
print(len(rows),protocol['counts'],sha(t.read_bytes()))