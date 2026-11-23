/** Serial, loopback-only paired benchmark. Run from the Relay checkout with node --import tsx. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const output = path.resolve(process.argv[2]);
const specBytes = fs.readFileSync(new URL('protocol.json', import.meta.url));
const spec = JSON.parse(specBytes);
const hashes = JSON.parse(fs.readFileSync(path.join(output, 'weight-manifest.json')));
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'cases.json')));
const sha = x => createHash('sha256').update(x).digest('hex');
if (sha(specBytes) !== manifest.protocolSha256) throw Error('Study protocol changed after selection');
const mod = p => import(pathToFileURL(path.resolve(p)).href);
const { GARMENT_QUESTIONS, LABEL_QUESTIONS, renderOneWord } = await mod('packages/vision/v2/battery.ts');
const { LocalLogprobScorer } = await mod('packages/vision/v2/scorer-local.ts');
const { wordMass } = await mod('packages/vision/v2/scorer.ts');
const sharp = createRequire(path.resolve('package.json'))('sharp');
const original = Object.fromEntries([...GARMENT_QUESTIONS,...LABEL_QUESTIONS].map(q=>[q.key,q]));
const forward = {key:'surface',type:'choice',question:spec.surfaceQuestion,options:spec.surfaceOptions};
const reversed = {...forward,key:'surface_reverse',options:Object.fromEntries(Object.entries(spec.surfaceOptions).reverse())};
const runFile = path.join(output,'scores.jsonl');
const telemetryFile = path.join(output,'telemetry.jsonl');
const append = (file,row)=>fs.appendFileSync(file,JSON.stringify(row)+'\n');
const time = ()=>new Date().toISOString();
const host='127.0.0.1', port=Number(process.env.RELAY_STUDY_PORT??19471), url='http://'+host+':'+port;
const probe=net.createServer();
await new Promise((resolve,reject)=>probe.once('error',reject).listen(port,host,resolve));
await new Promise(resolve=>probe.close(resolve));
const exe=process.env.RELAY_OLLAMA_BIN??'ollama.exe';
const controller=new AbortController();
const pg = spawn(exe,['serve'],{windowsHide:true,env:{...process.env, OLLAMA_HOST:host+':'+port,
 OLLAMA_MODELS:path.join(output,'model-store'),OLLAMA_NO_CLOUD:'1',OLLAMA_NUM_PARALLEL:'1',
 OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_CONTEXT_LENGTH:'8192',LLAMA_ARG_CACHE_RAM:'0'},stdio:['ignore','pipe','pipe']});
const logs=fs.createWriteStream(path.join(output,'private-runtime.log'),{flags:'a'});
pg.stdout.pipe(logs,{end:false});pg.stderr.pipe(logs,{end:false});
pg.on('error',err=>controller.abort(err.message));
const sampleGpu=promisify(execFile);
let sample, polling=false, stopped=false, loaded=null;
const health={peakTemp:0,peakVramMiB:0,minFreeRamMiB:Infinity,peakPowerW:0,samples:0};
async function monitor(){
 if(polling)return;
 polling=true;
 try{
  const {stdout}=await sampleGpu('nvidia-smi',['--query-gpu=temperature.gpu,memory.used,power.draw','--format=csv,noheader,nounits'],{windowsHide:true,timeout:4000});
  const [temp,vram,power]=stdout.trim().split(',').map(Number);
  const free=Math.floor(os.freemem()/1048576);
  if(![temp,vram,power,free].every(Number.isFinite))throw Error('GPU monitor unavailable');
  sample={temp,vram,power,free,at:Date.now()};
  health.peakTemp=Math.max(health.peakTemp,temp);health.peakVramMiB=Math.max(health.peakVramMiB,vram);
  health.peakPowerW=Math.max(health.peakPowerW,power);health.minFreeRamMiB=Math.min(health.minFreeRamMiB,free);health.samples++;
  if(temp>=85 || vram>7000 || free<2048)controller.abort('hardware guard: '+JSON.stringify(sample));
 }catch(e){controller.abort('GPU monitor: '+e.message);}finally{polling=false;}
}
function check(){
 if(controller.signal.aborted)throw Error(String(controller.signal.reason));
 if(pg.exitCode!==null||pg.signalCode!==null)throw Error('Isolated runner exited');
}
async function cool(){
 check();
 if(!sample || Date.now()-sample.at>5000)throw Error('Stale GPU monitor');
 if(sample.temp>=70){do {await sleep(500);check();}while(sample.temp>62);}
}
const monitorTimer=setInterval(()=>{if(!stopped)void monitor();},900);
const json=async(p,body)=>{const r=await fetch(url+p,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,
 body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});if(!r.ok)throw Error('Ollama '+p+' status '+r.status);return r.json();};
const blockSize=15;
const sets=Array.from({length:Math.ceil(manifest.cases.length/blockSize)},(_,i)=>manifest.cases.slice(i*blockSize,(i+1)*blockSize));
const orders=[['base','boost','attenuate'],['boost','attenuate','base'],['attenuate','base','boost']];
const neutral=await sharp({create:{width:256,height:256,channels:3,background:'#777777'}}).jpeg().toBuffer();
let lastCall=null;
const capture=async(endpoint,init)=>{
 const response=await fetch(endpoint,init);
 if(endpoint.endsWith('/api/chat') && response.ok){
  const b=await response.clone().json();
  lastCall={top:b.logprobs?.[0]?.top_logprobs??[],evalTokens:b.prompt_eval_count??0,wallNs:b.total_duration??null};
 }
 return response;
};
async function release(){
 if(!loaded)return;
 const name=loaded;loaded=null;
 try{
  const r=await fetch(url+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:name,keep_alive:0}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Unload '+r.status);
 }catch(e){if(!controller.signal.aborted)throw e;}
}
async function runBlock(arm,cases,block,repeat){
 const id=hashes.arms[arm], model=id.model;
 const evidence=await json('/api/show',{model});
 if(evidence.model_info['general.parameter_count']!==spec.parameters.text || evidence.projector_info['general.parameter_count']!==spec.parameters.vision)throw Error('Loaded parameter count mismatch');
 const scorer=new LocalLogprobScorer(model,id.manifestDigest,url,capture,95000);
 loaded=model;
 await cool();
 const warm=await scorer.score({jpeg:neutral},[original.broken],controller.signal);
 const ps=await json('/api/ps');
 if(warm.inputTokens<=0 || (ps.models??[]).length!==1 || ps.models[0].digest!==id.manifestDigest)throw Error('Real warmup/digest mismatch '+JSON.stringify(ps.models?.map(m=>[m.name,m.digest])));
 append(telemetryFile,{event:'warm',arm,block,repeat,at:time(),digest:ps.models[0].digest,neutral: warm.answers.broken.p,inputTokens:warm.inputTokens});
 for(const c of cases){
  await cool();
  const key=[repeat?'repeat':'main',arm,c.id].join('/');
  const image=fs.readFileSync(path.join(output,'normalized',c.id+'.jpg'));
  if(sha(image)!==c.normalizedSha256)throw Error('Input changed '+c.id);
  const questions=c.cohort==='label'?[original.label_legible]:[original.broken,original.road_contact,original.repair];
  if(!c.cohort.startsWith('needle_') && c.cohort!=='label') questions.push(original.category);
  if(arm==='base' && ['damaged','wear','other_clean','ambiguous'].includes(c.cohort))questions.push(forward,reversed);
  const answers={},failures={};let elapsed=0,inputTokens=0;
  for(const q of questions){
   check();lastCall=null;
   try{
    const response=await scorer.score({jpeg:image},[q],controller.signal);
    const a=response.answers[q.key];
    const mass=wordMass(lastCall.top,renderOneWord(q).words).covered;
    answers[q.key]={...a,covered:mass,ms:response.ms,tokens:response.inputTokens};
    elapsed+=response.ms;inputTokens+=response.inputTokens;
   }catch(e){
    check();
    if(e.code==='invalid_response'){failures[q.key]={code:e.code,message:e.message,covered:lastCall?wordMass(lastCall.top,renderOneWord(q).words).covered:null};}
    else throw e;
   }
  }
  append(runFile,{key,id:c.id,arm,block,repeat,normalizedSha256:c.normalizedSha256,manifestDigest:id.manifestDigest,at:time(),answers,failures,elapsed,inputTokens});
 }
 await release();
 console.log(time(),repeat?'repeat':'main',block,arm,cases.length,'done');
}
let failure=null;
try{
 await monitor();check();
 let ready=false;
 for(let i=0;i<80;i++){
  check();
  try{const tags=await json('/api/tags');if(!Object.values(hashes.arms).every(a=>tags.models.some(x=>x.name===a.model&&x.digest===a.manifestDigest)))throw Error('Study tags/digests differ: '+JSON.stringify(tags.models?.map(x=>[x.name,x.digest])));ready=true;break;}catch(e){if(e.message.includes('Study tags'))throw e;}
  await sleep(250);
 }
 if(!ready)throw Error('Isolated Ollama did not start');
 const v=await json('/api/version');if(v.version!=='0.40.16')throw Error('Runner version changed');
 append(telemetryFile,{event:'start',at:time(),version:v.version,specSha:sha(specBytes),blockSize});
 // A completed block is never rewritten. After interruption, incomplete blocks restart
 // with the same reset/warmup and a new attempt; the analyzer enforces a complete block.
 const prior=fs.existsSync(telemetryFile)?fs.readFileSync(telemetryFile,'utf8').trim().split('\n').map(JSON.parse):[];
 const doBlock=async(arm,cases,num,repeat)=>{
  const k=[num,arm,repeat].join('/');
  if(prior.some(r=>r.event==='complete' && r.key===k))return;
  append(telemetryFile,{event:'begin',key:k,at:time()});
  await runBlock(arm,cases,num,repeat);
  append(telemetryFile,{event:'complete',key:k,at:time()});
 };
 for(let i=0;i<sets.length;i++)for(const arm of orders[i%orders.length])await doBlock(arm,sets[i],i,false);
 await doBlock('base',manifest.cases.filter(x=>['damaged','wear','other_clean','ambiguous'].includes(x.cohort)).slice(0,6),sets.length,true);
}catch(e){failure=e.message;console.error(failure);process.exitCode=1;}
finally{
 stopped=true;clearInterval(monitorTimer);
 try{await release();}catch(e){failure??=String(e.message);process.exitCode=1;}
 pg.kill();logs.end();
 append(telemetryFile,{event:'stop',at:time(),health,failure}); console.log(JSON.stringify({health,failure}));
}

