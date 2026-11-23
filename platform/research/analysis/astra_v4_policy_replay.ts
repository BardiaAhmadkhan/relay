import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {signScores} from '../../packages/vision/v2/scorer-chain';
import {resolveFoundation} from '../../server/v4/foundation';
import {modelFusion} from '../../packages/core/v4/fusion';
const root=process.cwd(),dest=path.resolve(process.argv[2]??'collab/vision/baseline-replay');
if(fs.existsSync(path.join(dest,'whole-decisions.jsonl')))throw Error('Choose an unused verification directory');
const previous=path.resolve('collab/baseline/v35-final/retention-amendment/switch-off-policy');
const raw=fs.readFileSync('research/analysis/astra_policy_cases.mjs','utf8'),anchor='const decision=decide2(input);';
assert.equal(raw.split(anchor).length,2);
const key=randomBytes(32).toString('hex');let cases=0,safetyHolds=0,safetyLoosened=0,allOrdinaryChanged=0;
const permitted:any[]=[];const byReason:Record<string,number>={};
const opts={foundation:'offer' as const,crash:'no' as const,areaDamage:'no' as const,areaRepair:'no' as const,verifiedProtectiveFailure:false,identityConflict:false,unresolvedComponent:false,possibleStructural:false,acquisitionComplete:true,needsSourceView:false};
(globalThis as any).__relayCapture=(id:string,input:any,decision:any)=>{
  cases++;
  const records=new Map(input.photos.map((p:any)=>[p.id,p]));
  const slots=input.scores.map((s:any)=>({source:s.sha256,assigned:s.view,signed:signScores(s,key),photo:records.get(s.photoId)}));
  const noEvidence=resolveFoundation({key,slots,decision,histories:input.disclosures,premises:[]});
  if(noEvidence.decision.outcome!==decision.outcome)allOrdinaryChanged++;
  const eligible=['review','retake'].includes(decision.outcome)&&decision.reasons.length&&decision.reasons.every((r:any)=>['not_recognised_as_gear','label_unreadable'].includes(r.code));
  if(decision.outcome!=='offer'&&!eligible)safetyHolds++;
  const yes=resolveFoundation({key,slots,decision,histories:input.disclosures,premises:[{kind:'garment_identity',verified:true,attachment:'custodial',source:'a'.repeat(64),coverage:'garment'},{kind:'label_legible',verified:true,attachment:'same_frame',source:'b'.repeat(64),coverage:'garment'}]});
  if(yes.resolved){permitted.push({id,from:decision.outcome,to:yes.decision.outcome,reason:decision.reasons.map((r:any)=>r.code)});if(!eligible)safetyLoosened++;}
  const clear=modelFusion({...opts,foundation:decision.outcome});const excl=modelFusion({...opts,foundation:decision.outcome,combinedHistory:'yes'});
  assert(!excl.offerEligible);if(decision.outcome!=='offer')assert(!clear.offerEligible);
  for(const r of decision.reasons)byReason[r.code]=(byReason[r.code]??0)+1;
};
process.argv=[process.execPath,'astra_policy_cases.mjs',dest,root,previous];
await import('data:text/javascript;base64,'+Buffer.from(raw.replace(anchor,anchor+'globalThis.__relayCapture(id,input,decision);')).toString('base64'));
const summary=JSON.parse(fs.readFileSync(path.join(dest,'policy-summary.json'),'utf8'));
assert.equal(summary.changedCases.length,0);assert.equal(cases,7148);assert.equal(safetyLoosened,0);assert.equal(allOrdinaryChanged,0);
const report={cases,sourceHarnessSha256:createHash('sha256').update(raw).digest('hex'),ordinaryFullDecisionChanges:summary.changedCases.length,withoutNewEvidenceChanged:allOrdinaryChanged,safetyHolds,safetyLoosened,permittedResolutionCount:permitted.length,permitted,
  context:'Pinned 7,148 V3.5 synthetic and historical witness contexts. Bound identity is a controlled extra premise used to probe the wrapper, not a newly assessed rider.'};
fs.writeFileSync(path.join(dest,'v4-monotonicity.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,permitted:undefined}));
