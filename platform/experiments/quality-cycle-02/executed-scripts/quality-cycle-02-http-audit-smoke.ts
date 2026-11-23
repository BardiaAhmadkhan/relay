import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareImages } from '../server/images';
import { AnalysisResponseSchema,SCHEMA_VERSION } from '../packages/core/schema';
import { LocalInspectionAdapter as Original } from '../experiments/quality-cycle-02/original-inspection';
const dataset=JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json','utf8'));
const name=process.argv[2]??'current-http-audit';assert(/^[a-z0-9-]+$/.test(name));const selected=process.argv[3]?.split(',');
const cases=[...dataset.cases].filter(c=>!selected||selected.includes(c.id)).sort((a,b)=>createHash('sha256').update('audit-order:'+a.id).digest('hex').localeCompare(createHash('sha256').update('audit-order:'+b.id).digest('hex')));
const url='http://127.0.0.1:8790',log='benchmarks/quality-cycle-02/canary-final-calls.jsonl',out='benchmarks/quality-cycle-02/'+name+'.jsonl';
await fs.writeFile(out,'',{flag:'wx'});const health=await(await fetch(url+'/health')).json();assert(health.model.includes('+evidence-claims-4+focused-tear-context-1'));assert.equal(health.externalProvider,false);
await fs.writeFile(out.replace('.jsonl','-protocol.json'),JSON.stringify({at:new Date().toISOString(),health,cases:cases.length,scope:'Actual full HTTP inference, one first request per image, no retries. Original control is reconstructed by replaying exactly matching recorded model request/response pairs through the frozen original adapter. Optional focus requests are unused by the control. This isolates the change without doubling inference or pretending historical model outputs are current.',sources:await Promise.all(['packages/vision/inspection.ts','packages/vision/focused-tear.ts','packages/vision/evidence-contract.ts','server/app.ts','datasets/quality-audit-01/labels.json','scripts/quality-cycle-02-http-audit.ts'].map(async path=>({path,sha256:createHash('sha256').update(await fs.readFile(path)).digest('hex')})))},null,2)+'\n',{flag:'wx'});
for(const [i,c]of cases.entries()){
 await fetch(url+'/session',{method:'DELETE'});const before=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).length;
 const bytes=await fs.readFile(c.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),c.sha256);
 const input={schemaVersion:SCHEMA_VERSION,assessmentId:'current-'+c.id,disclosures:[],corrections:[],images:[{id:'photo',view:c.view,base64:bytes.toString('base64')}],consent:{processImages:true,externalProvider:false}};
 const started=performance.now();let row:any;
 try{
  const response=await fetch(url+'/assess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(70000)});const raw=await response.json();assert.equal(response.status,200,JSON.stringify(raw));const result=AnalysisResponseSchema.parse(raw);assert.equal(result.decision.offerRecommended,false);assert.equal(result.decision.protectivePerformanceCertified,false);assert.equal(result.assessmentId,input.assessmentId);
  const calls=(await fs.readFile(log,'utf8')).trim().split('\n').filter(Boolean).slice(before).map(s=>JSON.parse(s));const unused=[...calls];let baseline:any=null;let replayCalls=0;
  if(result.observation){
   const fetcher:typeof fetch=async(_url,init)=>{const hash=createHash('sha256').update(String(init?.body)).digest('hex'),index=unused.findIndex(c=>c.requestHash===hash);assert(index>=0,'No exact captured response for original request '+hash);const call=unused.splice(index,1)[0];replayCalls++;if(call.status===null)throw Error('recorded_transport_failure');return new Response(JSON.stringify(call.raw),{status:call.status,headers:{'Content-Type':'application/json'}});};
   const engine=new Original('qwen3.5:4b','d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04','http://127.0.0.1:11435',fetcher);
   try{const prepared=await prepareImages(input.images);assert.equal(prepared.photos[0]!.sha256,result.photos[0]!.sha256);baseline=await engine.analyze(prepared.images);}finally{engine.clearCache();}
  }
  const candidatePhoto=result.observation?.inspection?.photos[0]??null,baselinePhoto=baseline?.inspection?.photos[0]??null;
  const baselineFlag=!!baselinePhoto?.findings.length,candidateFlag=!!candidatePhoto?.findings.length;
  row={id:c.id,condition:c.condition,domain:c.domain,sourceSha256:c.sha256,firstAttemptSucceeded:true,elapsedMs:performance.now()-started,httpMs:result.timing.totalMs,baselinePhoto,candidatePhoto,baselineFlag,candidateFlag,replayCalls,focusCalls:calls.filter(c=>c.stage==='focus-grounding').length,stages:calls.map(c=>c.stage),result};
 }catch(e:any){row={id:c.id,condition:c.condition,error:e.message,elapsedMs:performance.now()-started,firstAttemptSucceeded:false};}
 await fs.appendFile(out,JSON.stringify(row)+'\n');console.log(JSON.stringify({i:i+1,n:cases.length,id:c.id,baseline:row.baselineFlag,candidate:row.candidateFlag,focus:row.focusCalls,ms:Math.round(row.elapsedMs),error:row.error}));
 if(row.error?.includes('No exact captured response'))throw Error(row.error);
}