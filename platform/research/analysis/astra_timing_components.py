"""Separate observed per-view CPU/API time, model-wire time and the thermal guard, using only frozen trial rows."""
import json,sys,statistics,math,collections
from pathlib import Path
folder=Path(sys.argv[1]);rows=[json.loads(x) for x in (folder/'intake-trials.jsonl').read_text().splitlines()]
def q(v,p):
 v=sorted(v);t=(len(v)-1)*p;i=int(t);return round(v[i]+(v[min(i+1,len(v)-1)]-v[i])*(t-i),3)
def parts(r):
 cool=sum(v['preViewThermalWaitMs'] for v in r['views'])
 model=sum(f['ms'] for f in r['forwards'])
 return {'wall':r['wallMs'],'thermalWait':cool,'wallWithoutThermalWait':r['wallMs']-cool,'modelWire':model,
   'remainingHttpImageAndApp':r['wallMs']-cool-model,'finalDecisionHttp':r['decisionHttpMs'],
   'modelPromptEval':sum(f['promptMs'] for f in r['forwards'])}
by={a:[r for r in rows if r['arm']==a] for a in ['before','after']}
keys=list(parts(rows[0]));out={}
for k in keys:
 out[k]={a:{'p50':q([parts(r)[k] for r in xs],.5),'p95':q([parts(r)[k] for r in xs],.95)} for a,xs in by.items()}
 pairs=[parts(next(x for x in by['after'] if (x['fixture'],x['repeat'])==(r['fixture'],r['repeat'])))[k]-parts(r)[k] for r in by['before']]
 out[k]['pairedAfterMinusBeforeMs']={'p10':q(pairs,.1),'p50':q(pairs,.5),'p90':q(pairs,.9),'positive':sum(n>0 for n in pairs)}
dst=folder/'latency-components.json';dst.write_text(json.dumps({'n':len(rows),'rows':out,'method':'Thermal waits are the actual, recorded pre-view guard waits included in wall time. Model wire sums the transparent proxy spans. Remaining time is a residual, not a direct CPU measurement. Component medians need not add to the median whole assessment.'},indent=2)+'\n')
print(json.dumps(out))