from pathlib import Path
import collections,json,sys
p=Path(sys.argv[1]);rows=[json.loads(x) for x in (p/'4b/rows.jsonl').read_text().splitlines()];out={}
for framing in sorted({r['framing'] for r in rows}):
 group=[r for r in rows if r['framing']==framing]
 for c in ['all','one','pair','several','unresolved','unrated']:
  subset=[r for r in group if c=='all' or r['count']==c]
  if not subset:continue
  out[framing+'/'+c]={'n':len(subset),'oldPass':sum(r['old']['p']>=.5 for r in subset),'candidatePass':sum(r['candidate']['p']>=.5 for r in subset),'becamePass':[r['id'] for r in subset if r['old']['p']<.5<=r['candidate']['p']],'becameFail':[r['id'] for r in subset if r['candidate']['p']<.5<=r['old']['p']]}
dest=p/'4b/framing.json';dest.write_text(json.dumps(out,indent=2)+'\n')
for k,v in out.items():
 if k in ['scene/all','worn/one','worn/pair','item/one','item/pair']:print(k,v['n'],v['oldPass'],v['candidatePass'],len(v['becamePass']),len(v['becameFail']))