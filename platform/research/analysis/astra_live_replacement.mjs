/** Stock 4B, real JPEGs and normal score/assess HTTP endpoints. The comparison is a
 * constructed workflow witness, not a physical garment valuation or a field incidence estimate. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import assert from 'node:assert/strict';import {spawn,execFileSync} from 'node:child_process';import {randomBytes,createHash} from 'node:crypto';import{setTimeout as wait}from'node:timers/promises';
const [folder,candidate]=process.argv.slice(2),root=process.cwd(),out=path.resolve(folder);fs.mkdirSync(out,{recursive:true});const pin='d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04',key=randomBytes(32).toString('hex');
const free=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const rtPort=await free(),apiPort=await free(),url=p=>'http://127.0.0.1:'+p;
const runtime=url(rtPort),api=url(apiPort),ctl=new AbortController();let child,server,temp=0,health={samples:0,peakC:0,peakVram:0,minFree:Infinity};
const stop=async p=>{if(p?.exitCode===null){const done=new Promise(r=>p.once('exit',r));p.kill();await Promise.race([done,wait(3000)]);}};
function guard(){const run=a=>execFileSync('nvidia-smi',a,{encoding:'utf8',windowsHide:true,timeout:5000}).trim();
const names=run(['--query-compute-apps=pid,process_name','--format=csv,noheader']);if(/\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(names))throw Error('Game active');
const [t,v]=run(['--query-gpu=temperature.gpu,memory.used','--format=csv,noheader,nounits']).split(',').map(Number),ram=os.freemem()/1048576;
if(![t,v,ram].every(Number.isFinite)||t>=85||v>7000||ram<2048)throw Error('Resource stop');temp=t;health.samples++;health.peakC=Math.max(health.peakC,t);health.peakVram=Math.max(health.peakVram,v);health.minFree=Math.min(health.minFree,Math.floor(ram));}
const safety=setInterval(()=>{try{guard();}catch(e){ctl.abort(e);child?.kill();server?.kill();}},1200);
const http=async(u,body)=>{const r=await fetch(u,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(120000)])});const b=await r.json();if(!r.ok)throw Error(new URL(u).pathname+' '+r.status+' '+(b.error?.code??''));return b;};
const ready=async(u)=>{for(let i=0;i<160;i++){ctl.signal.throwIfAborted();try{return await http(u)}catch{}await wait(120);}throw Error('Readiness failed');};
const start=(exe,args,env)=>spawn(exe,args,{cwd:root,windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
const history=['crash','protective_damage','protective_repair'].map((question,i)=>({id:'h'+i,question,answer:'no',recordedAt:'2026-11-20T00:00:00.000Z'}));
const sources=[['replaced-block','front','datasets/realworld-v3/images/cm-008.jpg'],['replaced-possible','front','datasets/realworld-v3/images/ox-089.jpg'],['new-front','front','datasets/realworld-v3/images/ox-081.jpg'],['kept-back','back','datasets/realworld-v3/images/ox-080.jpg'],['label','label','assets/fixtures/backpack-label.jpg']];
const results={};
try{guard();child=start('ollama.exe',['serve'],{OLLAMA_HOST:'127.0.0.1:'+rtPort,OLLAMA_MODELS:path.join(root,'.cache/ollama'),OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_NO_CLOUD:'1',LLAMA_ARG_CACHE_RAM:'0'});child.stdout.resume();child.stderr.resume();
const tags=await ready(runtime+'/api/tags');assert(tags.models.some(m=>m.name==='qwen3.5:4b'&&m.digest===pin));
for(const arm of ['before','after']){const engine=arm==='before'?root:path.resolve(candidate);let warm=false;
server=start(process.execPath,['--import','tsx',path.join(engine,'server/index-v2.ts')],{RELAY_HOST:'127.0.0.1',RELAY_PORT:String(apiPort),RELAY_SCORERS:'local_logprob',RELAY_SIGNING_KEY:key,RELAY_ALLOW_PAID:'0',RELAY_REVIEW:'0',RELAY_OLLAMA_URL:runtime,RELAY_PLAN:'1',RELAY_CASCADE:'1',RELAY_RECYCLE:'25'});
server.stdout.on('data',s=>{if(s.toString().includes('"event":"scorer_warm"'))warm=true;});server.stderr.resume();
const healthRecord=await ready(api+'/v2/health');for(let i=0;i<600&&!warm;i++){ctl.signal.throwIfAborted();await wait(150);}assert(warm);assert(healthRecord.scorers[0].model.includes(pin.slice(0,12)));
const scored={};const assessmentId='repeated-real-photos';
for(const [id,view,f] of sources){while(temp>64){await wait(400);ctl.signal.throwIfAborted();}const raw=fs.readFileSync(f);const res=await http(api+'/v2/photos/score',{schemaVersion:'2.0',assessmentId,photoId:id,view,base64:raw.toString('base64')});scored[id]={...res,source:f,sourceSha256:createHash('sha256').update(raw).digest('hex')};}
const assess=(group,extra={})=>http(api+'/v2/assess',{schemaVersion:'2.0',assessmentId,photos:group.map(x=>x.photo),signedScores:group.map(x=>x.signed),disclosures:history,closeUpsRequested:0,...extra});
const companions=[scored['kept-back'],scored.label],current=[scored['new-front'],...companions];
const ordinary=await assess(current),cases=[];
for(const id of ['replaced-block','replaced-possible']){const old=scored[id],first=await assess([old,...companions]);
const finding=first.findings?.find(f=>f.finding.photoId===id);
const retained={photoId:id,view:'front',replacementId:'new-front',record:old.photo,signed:old.signed,finding};
const after=await assess(current,{closeUpsRequested:first.decision.requestPhoto?.view==='detail'?1:0,...(arm==='after'?{replacedOverviews:[retained]}:{})});
const retry=await assess(current,{closeUpsRequested:first.decision.requestPhoto?.view==='detail'?1:0,...(arm==='after'?{replacedOverviews:[retained]}:{})});assert.deepEqual(after.decision,retry.decision);
cases.push({id,first:first.decision,after:after.decision,replacements:after.replacements,transitions:after.transitions,retryIdentical:true,hasIssuedFinding:!!finding});
}
results[arm]={ordinary:ordinary.decision,cases,scored:Object.fromEntries(Object.entries(scored).map(([id,v])=>[id,{source:v.source,sourceSha256:v.sourceSha256,record:v.photo,answers:v.signed.scores.answers,model:v.signed.scores.scorer,feedback:v.feedback}]))};
await stop(server);server=null;
}
const parity=Object.keys(results.before.scored).every(k=>JSON.stringify(results.before.scored[k])===JSON.stringify(results.after.scored[k]));
const report={pin,provenance:'Observed on the original 4B through real signed HTTP entry points. The two clean glove photos are different views of the same displayed pair. The comparison substitutes an independent licensed source for the earlier front, and the readable label fixture is from a separate item. This supplies a controlled history, not an observation of a customer replacing their actual garment.',health,ordinaryOutputsIdentical:parity,results};
fs.writeFileSync(path.join(out,'real-4b.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({parity,before:results.before.cases.map(x=>[x.first.outcome,x.after.outcome]),after:results.after.cases.map(x=>[x.first.outcome,x.after.outcome]),health}));
assert(parity);assert.equal(results.before.ordinary.outcome,'offer');assert.deepEqual(results.before.cases.map(x=>x.after.outcome),['offer','offer']);assert.deepEqual(results.after.cases.map(x=>x.after.outcome),['no_offer','offer']);
}finally{clearInterval(safety);await stop(server);await stop(child);}