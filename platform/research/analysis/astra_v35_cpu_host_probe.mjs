/** CPU-only capacity check. Measures the actual V3.5 planner with stock weights and the production question deadlines. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';import {setTimeout as wait} from 'node:timers/promises';import {randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
import sharp from 'sharp';
import {inspectionScorer} from '../../packages/vision/v2/inspection-model.ts';
import {InspectionLane} from '../../packages/vision/v2/inspection-lane.ts';
import {PlannedScorer} from '../../packages/vision/v2/plan.ts';
import {ScorerChain} from '../../packages/vision/v2/scorer-chain.ts';
import {GARMENT_QUESTIONS} from '../../packages/vision/v2/battery.ts';
import {createAppV2} from '../../server/app-v2.ts';
const [outArg,threadsArg='2']=process.argv.slice(2),threads=Number(threadsArg),root=process.cwd();
if(![2,4,8].includes(threads))throw Error('Choose a declared CPU thread count.');
const out=path.resolve(outArg);fs.mkdirSync(out,{recursive:true});const file=path.join(out,'cpu-'+threads+'.json');if(fs.existsSync(file))throw Error('Choose fresh output.');
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const base='http://127.0.0.1:'+port,ctl=new AbortController();let child,app;const guard=()=>{if(os.freemem()<2*2**30)throw Error('Low free RAM');const list=execFileSync('nvidia-smi',['--query-compute-apps=pid,process_name','--format=csv,noheader'],{encoding:'utf8',windowsHide:true});if(/\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(list))throw Error('Gaming workload');};
let phase='startup';const calls=[],result={cpu:os.cpus()[0].model,threads,engine:'3.5',runtime:'',model:'qwen3.5:4b',gpuBytes:null,calls,views:[],scope:'One local CPU-only three-view fixture. Thread cap applies to the language runner; OS CPU and memory bandwidth are not identical to cloud vCPUs. No paid fallback.'};
const interval=setInterval(()=>{try{guard();}catch(e){ctl.abort(e);child?.kill();}},3500);
const deadline=setTimeout(()=>{ctl.abort(Error('Study deadline'));child?.kill();},300000);
const json=async(u,opts={})=>{const v=await fetch(u,{...opts,signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(120000)])});if(!v.ok)throw Error('HTTP '+v.status);return v.json();};
const f=async(u,o)=>{const t=performance.now();let b;if(o?.body){b=JSON.parse(o.body);if(b.messages){b.options={...b.options,num_gpu:0,num_thread:threads};o={...o,body:JSON.stringify(b)};}}try{const resp=await fetch(u,{...o,signal:AbortSignal.any([ctl.signal,o?.signal??new AbortController().signal])});if(b?.messages){const d=await resp.clone().json();calls.push({phase,status:resp.status,ms:Math.round(performance.now()-t),tokens:d.prompt_eval_count,promptMs:Math.round((d.prompt_eval_duration??0)/1e6)});}return resp;}catch(e){if(b?.messages)calls.push({phase,failure:e.name,ms:Math.round(performance.now()-t)});throw e;}};
try{
 guard();const env={...process.env,OLLAMA_HOST:'127.0.0.1:'+port,OLLAMA_MODELS:path.resolve('.cache/ollama'),OLLAMA_NO_CLOUD:'1',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',LLAMA_ARG_CACHE_RAM:'0',CUDA_VISIBLE_DEVICES:'-1',GGML_VK_VISIBLE_DEVICES:'-1'};delete env.OPENAI_API_KEY;
 child=spawn('ollama.exe',['serve'],{cwd:root,env,windowsHide:true,stdio:'ignore'});
 let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw Error('Local runner exited');try{result.runtime=(await json(base+'/api/version')).version;ready=true;break;}catch{}await wait(160);}assert(ready);
 const model=await inspectionScorer(base,f),read=p=>JSON.parse(fs.readFileSync(p)),th=read('packages/core/v2/thresholds.json'),lo=read('packages/core/v2/thresholds.cascade512.json'),cfg=read('packages/core/v2/policy.config.json');
 th.perScorer.local_logprob.models=[model.model,model.model+' cascade'];const plan=new PlannedScorer(model,id=>th.perScorer[id],id=>lo.perScorer[id]);const chain=new ScorerChain([new InspectionLane(25,()=>model.unload()).wrap(plan)]);
 const warm=await sharp({create:{width:256,height:256,channels:3,background:'#6b6b6b'}}).jpeg().toBuffer();phase='warm';await model.score({jpeg:warm},GARMENT_QUESTIONS.filter(q=>q.key==='road_contact'),ctl.signal);
 const ps=await json(base+'/api/ps');result.gpuBytes=ps.models[0]?.size_vram;result.residentBytes=ps.models[0]?.size;assert.equal(result.gpuBytes,0,'Expected pure CPU inference');
 app=createAppV2({chain,config:cfg,thresholds:th,workingEdge:1600,lowEdge:512,planned:true,signingKey:randomBytes(32).toString('hex')});
 const photos=[],signedScores=[],assessmentId='cpu-host-fixture';const start=performance.now();
 for(const [view,fixture] of [['front','leather-jacket'],['back','armour-jacket'],['label','backpack-label']]){
  phase=view;const b=await sharp(path.join('assets/fixtures',fixture+'.jpg')).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).toColourspace('srgb').jpeg({quality:82}).toBuffer();const t=performance.now();
  const v=await app.inject({method:'POST',url:'/v2/photos/score',payload:{schemaVersion:'2.0',assessmentId,photoId:view,view,base64:b.toString('base64')}});
  const x=v.json();result.views.push({view,status:v.statusCode,ms:Math.round(performance.now()-t),reason:x.error?.code??null});
  if(v.statusCode!==200){result.failure='The unchanged production scorer could not finish this view';break;}
  photos.push(x.photo);signedScores.push(x.signed);
 }
 if(photos.length===3){const v=await app.inject({method:'POST',url:'/v2/assess',payload:{schemaVersion:'2.0',assessmentId,photos,signedScores,disclosures:['crash','protective_damage','protective_repair'].map(question=>({id:question,question,answer:'no',recordedAt:'2026-11-20T00:00:00.000Z'})),closeUpsRequested:0}});result.outcome=v.json().decision?.outcome;result.intakeMs=Math.round(performance.now()-start);}
}catch(e){result.failure=String(e.message).slice(0,180);}
finally{clearInterval(interval);clearTimeout(deadline);if(app)await app.close();if(child&&child.exitCode===null){const end=new Promise(r=>child.once('exit',r));child.kill();await Promise.race([end,wait(3000)]);}fs.writeFileSync(file,JSON.stringify(result,null,2));console.log(JSON.stringify({threads,gpuBytes:result.gpuBytes,views:result.views,intakeMs:result.intakeMs,failure:result.failure}));}
