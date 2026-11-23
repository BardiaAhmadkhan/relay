/** Frozen V3.1 whole-decision witnesses. Run from Relay with --import tsx.
 * A candidate must reproduce every byte of the ordinary decisions. The artificial views
 * and disclosures are explicit experimental controls, never additional labelled riders.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [output, engine=process.cwd(), reference] = process.argv.slice(2);
const root=process.cwd(), base=path.join(root,'collab/baseline/v31-as-restored');
const json=(f)=>JSON.parse(fs.readFileSync(f,'utf8'));
const lines=(f)=>fs.readFileSync(f,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
const hash=(v)=>createHash('sha256').update(v).digest('hex');
const {decide2}=await import(pathToFileURL(path.join(engine,'packages/core/v2/policy.ts')).href);
const thresholds=json(path.join(engine,'packages/core/v2/thresholds.json')),config=json(path.join(engine,'packages/core/v2/policy.config.json'));
const model='qwen3.5:4b@d8b0f5e9760c';
const liveT=structuredClone(thresholds);liveT.perScorer.local_logprob.models=[model,model+' cascade'];
const at='2026-11-20T00:00:00.000Z',questions=['crash','protective_damage','protective_repair'];
const hist=(type)=>type==='missing'?[]:questions.map((question,i)=>({id:'d'+i,question,recordedAt:at,answer:type==='negative'?'no':type==='unknown'?'unknown':type===question?'yes':'no'}));
const histories=['negative','unknown','missing',...questions];
const quality={width:1600,height:1000,brightness:120,sharpness:0.1,warnings:[]};
const record=s=>({id:s.photoId,view:s.view,sha256:s.sha256,quality});
const fixed=(view,id='control-'+view)=>({photoId:id,view,sha256:hash(id),batteryVersion:'gear-2',scorer:{id:'local_logprob',model},scoredAt:at,usage:{inputTokens:0,ms:0},answers:view==='label'?{label_legible:{type:'yesno',p:1},label_ce:{type:'yesno',p:0.2}}:{...Object.fromEntries(['usable','gear','single_item','broken','road_contact','repair'].map((key,i)=>[key,{type:'yesno',p:i<3?1:0}])),category:{type:'choice',choice:'jacket',probabilities:{jacket:1}},wear:{type:'level',score:0,probabilities:[1,0,0,0]}}});
const baseInput=(scores,history='negative',closeUpsRequested=0,opts={})=>({photos:scores.map(record),scores,disclosures:hist(history),closeUpsRequested,thresholds:liveT,config,...opts});
const ledger=[];
function sample(suite,id,input,expected) {const decision=decide2(input);if(expected)assert.deepEqual(decision,expected,id);ledger.push({suite,id,outcome:decision.outcome,inputSha256:hash(JSON.stringify(input)),decisionSha256:hash(JSON.stringify(decision)),decision});return decision;}
const three=['front','back','label'].map(v=>fixed(v));
const set='calib--gear-2--qwen3.5-4b--e1600.scores.jsonl';
for(const row of lines(path.join(root,'benchmarks/backend-v2',set)))for(const h of histories)for(const k of [0,1])for(const complete of [false,true]){
const a=complete?[...three,row]:[row];sample('archived-seven-heads',row.photoId+'/'+h+'/'+k+'/'+Number(complete),baseInput(a,h,k,{thresholds}));}
for(const row of lines(path.join(base,'restored-model-44-full-precision.jsonl')))for(const h of histories)for(const k of [0,1]){const a=[row.scores,three[1],three[2]];sample('index-view-with-controlled-companions',row.item+'/'+h+'/'+k,baseInput(a,h,k,{photos:[row.record,record(a[1]),record(a[2])]}));}
for(const row of lines(path.join(base,'timing/intake-trials.jsonl'))){
const a=row.views.map(v=>({photoId:v.view,view:v.view,sha256:v.normalizedSha256,batteryVersion:'gear-2',scorer:v.scorer,scoredAt:at,usage:v.usage,answers:v.answers})),photos=a.map((s,i)=>({...record(s),quality:row.views[i].quality}));
for(const h of histories)for(const k of [0,1])sample('three-photo-live-4b',row.trial+'/'+h+'/'+k,baseInput(a,h,k,{photos}),h==='negative'&&k===0?row.decision:undefined);}
for(const h of histories)for(const k of [0,1]){sample('controlled-eligible-history',h+'/'+k,baseInput(three,h,k));}
for(const key of Object.keys(three[0].answers)){const a=structuredClone(three);delete a[0].answers[key];const d=sample('interrupted-ordinary-question',key,baseInput(a));assert.notEqual(d.outcome,'offer');}
const baseD=sample('replacement-witness','clean',baseInput(three));assert.equal(baseD.outcome,'offer');
const first=structuredClone(three);first[0].answers.road_contact.p=(liveT.perScorer.local_logprob.damage.clear+liveT.perScorer.local_logprob.damage.block)/2;
const troubled=sample('replacement-witness','before',baseInput(first));assert.equal(troubled.requestPhoto?.view,'detail');
const replacement=[fixed('front','replacement-front'),...three.slice(1)];
const resolved=sample('replacement-witness','after-unmarked-front-replacement',baseInput(replacement,'negative',1));assert.equal(resolved.outcome,'offer');
const keep=sample('replacement-witness','requested-detail-original-retained',baseInput([...first,fixed('detail')],'negative',1));assert.equal(keep.outcome,'review');
const unconfirmed=lines(path.join(base,'location-140-v31-evidence.jsonl'));
for(const r of unconfirmed){if(typeof r.wholeStructural!=='number')continue;const a=structuredClone(three);a[0].answers.broken.p=r.wholeStructural;sample('localisation-only-controlled-other-heads',r.id,baseInput(a));}
const rows=lines(path.join(base,'e19-recorded-cases.jsonl')).filter(r=>r.split==='historical_holdout');const firstCues=rows.filter(r=>r.reasons.some(x=>x.startsWith('possible_')));const friction=Object.fromEntries([...new Set(firstCues.map(r=>r.label))].map(l=>[l,firstCues.filter(r=>r.label===l).length]));
const out=path.resolve(output);fs.mkdirSync(out,{recursive:true});
const name='whole-decisions.jsonl',dst=path.join(out,name);if(fs.existsSync(dst))throw Error('Output already exists');fs.writeFileSync(dst,ledger.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
const summary={suites:{},comparisons:ledger.length,uniqueIds:new Set(ledger.map(r=>r.suite+'|'+r.id)).size,sourcePolicy:hash(fs.readFileSync(path.join(engine,'packages/core/v2/policy.ts'))),changedCases:null,firstE19PossibleReasons:{total:firstCues.length,byRawLabel:friction,ids:firstCues.map(r=>r.id),note:'First recorded decisions only; does not measure whether the rider replaced that view.'},limitations:'The E19 ledger has historical rounded answers and dispositions only. 223 binary calibration photos had seven heads; the larger 261 includes ambiguous/nonassessable rows. The localisation suite substitutes only whole-image structural scores into otherwise synthetic complete contexts; only the 44-view suite and three-view timing fixtures carry full precision ordinary outputs as recorded.'};
assert.equal(summary.uniqueIds,ledger.length);
for(const r of ledger){const group=summary.suites[r.suite]??={};group[r.outcome]=(group[r.outcome]??0)+1;}
if(reference){const prior=lines(path.join(reference,name));assert.equal(prior.length,ledger.length);const changed=ledger.flatMap((r,i)=>{const p=prior[i];assert.equal(r.id,p.id);assert.equal(r.suite,p.suite);assert.equal(r.inputSha256,p.inputSha256);return r.decisionSha256===p.decisionSha256?[]:[{suite:r.suite,id:r.id,before:p.decision,after:r.decision}];});summary.changedCases=changed;process.exitCode=changed.length?1:0;}
fs.writeFileSync(path.join(out,'policy-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));