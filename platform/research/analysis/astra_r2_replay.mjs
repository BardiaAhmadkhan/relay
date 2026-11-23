/** Counterfactual on the recorded E19 single-photo protocol, with only the binding count answer changed. */
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {decide2} from '../../packages/core/v2/policy.ts';
const [, , output,requested]=process.argv,out=path.resolve(output),read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const rows=fs.readFileSync('benchmarks/backend-v2/realworld--v3.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse);
const labels=new Map(read('datasets/realworld-v3/labels.json').cases.map(c=>[c.id,c]));
const thresholds=read('packages/core/v2/thresholds.json'),config=read('packages/core/v2/policy.config.json');
const model='qwen3.5:4b@d8b0f5e9760c cascade';
thresholds.perScorer.local_logprob.models=[model,model.replace(' cascade','')];
let ids=null;if(requested){const v=read(requested);const input=Array.isArray(v)?v:v.rows??v.cases??v.ids;assert(Array.isArray(input));ids=new Set(input.map(x=>typeof x==='string'?x:x.id));}
const selected=rows.filter(r=>!labels.get(r.id)?.seenInCalibration && (ids?ids.has(r.id):r.reasons.length===1&&r.reasons[0]==='multiple_items'&&['boots','gloves'].includes(r.category)&&r.singleItem<.5));
function input(r,end){
 const a={};
 for(const [k,v] of Object.entries(r.answers)){
  if(k==='category'){const [choice,number]=v.split(':');a[k]={type:'choice',choice,probabilities:{[choice]:Math.min(1,Math.max(0,Number(number)+end*.0005))}};}
  else if(k==='wear'){a[k]={type:'level',score:Math.max(0,v+end*.0005),probabilities:[1,0,0,0]};}
  else if(typeof v==='number'){
    const exact={gear:r.gear,single_item:r.singleItem,usable:r.usable,label_legible:r.labelLegible}[k];
    a[k]={type:'yesno',p:exact??Math.max(0,Math.min(1,v+end*.00005))};
  }
 }
 const sha256=createHash('sha256').update(r.id).digest('hex'),quality={warnings:r.warnings,width:1600,height:1000,brightness:120,sharpness:r.soft?.001:.1};
 return {disclosures:['crash','protective_damage','protective_repair'].map(question=>({id:r.id+'-'+question,question,answer:'no',recordedAt:'2026-11-18T00:00:00.000Z'})),photos:[{id:r.id,view:r.view,sha256,quality}],scores:[{photoId:r.id,view:r.view,sha256,batteryVersion:'gear-2',scorer:{id:'local_logprob',model},scoredAt:'2026-11-18T00:00:00.000Z',usage:{inputTokens:r.tokens,ms:r.ms},answers:a}],closeUpsRequested:0,thresholds,config:{...config,requiredViews:[r.view]}};
}
const compact=d=>({outcome:d.outcome,category:d.category,grade:d.grade,reasons:d.reasons.map(r=>r.code),requestPhoto:d.requestPhoto});
const results=selected.map(r=>{
 const inputs=[-1,0,1].map(e=>input(r,e));const before=inputs.map(i=>compact(decide2(i)));for(const b of before){assert.equal(b.outcome,r.outcome,r.id);assert.deepEqual(b.reasons,r.reasons,r.id);}
 const after=inputs.map(i=>{i.scores[0].answers.single_item={type:'yesno',p:.5};return compact(decide2(i));});
 const stable=after.every(a=>JSON.stringify(a)===JSON.stringify(after[1]));
 return {id:r.id,framing:r.framing,categoryHead:r.category,previousCountProbability:r.singleItem,before:before[1],countPass:after[1],roundingEndpointsAgree:stable};});
if(ids)assert.equal(results.length,ids.size);
fs.mkdirSync(out,{recursive:true});const file=path.join(out,'counterfactual.json');assert(!fs.existsSync(file));
fs.writeFileSync(file,JSON.stringify({kind:'CPU-only E19 count-pass counterfactual',n:results.length,limitations:'E19 uses one real view, negative fixture disclosures and a reduced required-view set. The replay preserves the recorded quality warnings and the full-precision gear/count/usability/label fields. Other heads were rounded in E19; endpoint results are reported. Other category probabilities are unavailable and are irrelevant when averaging a single photograph with a known winning label. No provider judgment was inserted, and eligibility is not a real three-view offer.',results},null,2));console.log(JSON.stringify(results.map(r=>[r.id,r.before.outcome,r.countPass.outcome,r.roundingEndpointsAgree])));