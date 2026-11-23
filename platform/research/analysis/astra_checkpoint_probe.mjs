/** Run from the lab root with node --import tsx. Four counterbalanced cold runtimes,
 * one GPU lane. This probes the actual production API/template, not a text-only surrogate.
 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import net from 'node:net';
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import {setTimeout as sleep} from 'node:timers/promises';import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import { LocalLogprobScorer } from '../../packages/vision/v2/scorer-local.ts';
import { GARMENT_QUESTIONS } from '../../packages/vision/v2/battery.ts';
import {prepareImages} from '../../server/images.ts';
const [output,store,model='relay-inspection:base']=process.argv.slice(2);
const pins={'relay-inspection:base':'0689d44085e06d165161a8a9a1731344278cfb5aade63a3c3dbdb48ab54b130a','qwen3.5:4b':'d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04'};
if(!pins[model]||!output||!store)throw Error('Need output, stock model store and permitted checkpoint');
const out=path.resolve(output);fs.mkdirSync(out,{recursive:true});
const file=path.join(out,'questions.jsonl');if(fs.existsSync(file))throw Error('Fresh destination required');
const hash=b=>createHash('sha256').update(b).digest('hex'),exec=promisify(execFile);
const questions=['road_contact','broken','gear','single_item'].map(k=>GARMENT_QUESTIONS.find(q=>q.key===k));
const photos=await Promise.all(['leather-jacket','gloves-palm','racing-boot','armour-jacket'].map(async id=>({id,jpeg:(await prepareImages([{id,view:'front',base64:fs.readFileSync('assets/fixtures/'+id+'.jpg').toString('base64')}],512)).images[0].jpeg})));
const profile={model,digest:pins[model],edge:512,arms:['stock','checkpoint','checkpoint','stock'],spacing:64,maximumCheckpoints:8,hostPromptCacheMiB:0,photos:photos.map(p=>[p.id,hash(p.jpeg)]),questions:questions.map(q=>q.key),design:'Within each arm: same-image adjacent questions and alternating images. Reverse photo, question and schedule order for the second comparison. Exclude warm-up. One local runtime and one scoring request at any time. Report observed prompt tokens, duration, probabilities and memory. A pass requires no answer/eligibility change and a repeatable same-image improvement in both order strata that exceeds different-image drift. Otherwise do not move to 4B.'};
fs.writeFileSync(path.join(out,'protocol.json'),JSON.stringify(profile,null,2));
const smi=async a=>(await exec('nvidia-smi',a,{windowsHide:true,timeout:6000})).stdout.trim();const ctl=new AbortController();
let heat=0,health={samples:0,peakTemp:0,peakVRAMMiB:0,minFreeMiB:Infinity},busy=false,lastApps=0,child;
async function guard(){
 if(busy)return;busy=true;
 try{if(Date.now()-lastApps>10000){const apps=await smi(['--query-compute-apps=pid,process_name','--format=csv,noheader']);
 if(/\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(apps))throw Error('Gaming workload active');lastApps=Date.now();}
 const [t,v]=(await smi(['--query-gpu=temperature.gpu,memory.used','--format=csv,noheader,nounits'])).split(',').map(Number),free=os.freemem()/1048576;
 if(![t,v,free].every(Number.isFinite)||t>=85||v>7000||free<2048)throw Error('Resource guard: '+JSON.stringify({t,v,free}));heat=t;health.samples++;health.peakTemp=Math.max(health.peakTemp,t);health.peakVRAMMiB=Math.max(health.peakVRAMMiB,v);health.minFreeMiB=Math.min(health.minFreeMiB,Math.floor(free));
 }catch(e){ctl.abort(e);child?.kill();}finally{busy=false;}}
async function cool(n){while(heat>n){ctl.signal.throwIfAborted();await sleep(300);}}
const stop=async(c)=>{if(c?.exitCode===null){const end=new Promise(r=>c.once('exit',r));c.kill();await Promise.race([end,sleep(4000)]);}};
const records=[];let frame,rt,prev;
const timer=setInterval(()=>void guard(),950);
try{
await guard();ctl.signal.throwIfAborted();
for(const [arm,kind] of profile.arms.entries()){
 const srv=net.createServer();await new Promise(r=>srv.listen(0,'127.0.0.1',r));const port=srv.address().port;await new Promise(r=>srv.close(r));const url='http://127.0.0.1:'+port;
 const env={...process.env,OLLAMA_HOST:'127.0.0.1:'+port,OLLAMA_MODELS:path.resolve(store),OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_NO_CLOUD:'1',OLLAMA_CONTEXT_LENGTH:'8192',LLAMA_ARG_CACHE_RAM:'0'};
 delete env.LLAMA_ARG_CTX_CHECKPOINTS;delete env.LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT;
 if(kind==='checkpoint'){env.LLAMA_ARG_CTX_CHECKPOINTS='8';env.LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT='64';}
 await cool(62);
 rt=spawn('ollama.exe',['serve'],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});child=rt;let matched=[];
 const capture=b=>{for(const s of b.toString().split(/\r?\n/))if(/checkpoint|ctx_checkpoint|prompt cache|recurrent|n_past/i.test(s)&&!/OLLAMA_HOST|server config/i.test(s)&&matched.length<80)matched.push(s.slice(0,450));};
 rt.stdout.on('data',capture);rt.stderr.on('data',capture);
 let tag;for(let i=0;i<120&&!tag;i++){ctl.signal.throwIfAborted();if(rt.exitCode!==null)throw Error('Runtime stopped');try{const r=await fetch(url+'/api/tags');if(r.ok)tag=(await r.json()).models.find(m=>m.name===model);}catch{}if(!tag)await sleep(180);}
 assert.equal(tag?.digest,pins[model]);
 const fetcher=async (u,init)=>{const t=performance.now(),r=await fetch(u,init);const data=await r.clone().json();if(frame)Object.assign(frame,{wireMs:performance.now()-t,promptTokens:data.prompt_eval_count,promptMs:(data.prompt_eval_duration??0)/1e6,loadMs:(data.load_duration??0)/1e6});
 return r;};
 const engine=new LocalLogprobScorer(model,pins[model],url,fetcher,90000);
 frame=null;await engine.score(photos[0],[questions[0]],ctl.signal);
 await cool(62);const img=arm<2?[0,1,2,3]:[3,2,1,0],q=arm<2?[0,1,2,3]:[3,2,1,0];prev=null;
 for(const route of (arm<2?['same','different']:['different','same'])){
  const seq=route==='same'?img.flatMap(i=>q.map(j=>[i,j])):q.flatMap(j=>img.map(i=>[i,j]));
  for(const [i,j] of seq){ctl.signal.throwIfAborted();if(heat>=74)await cool(66);
   frame={arm,kind,route,photo:photos[i].id,key:questions[j].key,sameAsPrevious:prev===i};
   const answer=await engine.score(photos[i],[questions[j]],ctl.signal);
   frame.p=answer.answers[questions[j].key].p;records.push(frame);fs.appendFileSync(file,JSON.stringify(frame)+'\n');prev=i;frame=null;
  }
 }
 fs.writeFileSync(path.join(out,'runner-'+arm+'.json'),JSON.stringify({kind,matched},null,2));
 await engine.unload();await stop(rt);rt=null;child=null;console.log('completed',arm,kind,records.length);
}
const median=a=>{a=[...a].sort((a,b)=>a-b);return (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2;};
const results=[];for(const [a,b] of [[0,1],[3,2]])for(const route of ['same','different']){
 const pre=records.filter(r=>r.arm===a&&r.route===route&&(route==='different'||r.sameAsPrevious)),post=records.filter(r=>r.arm===b&&r.route===route&&(route==='different'||r.sameAsPrevious));
 const pairs=pre.map(r=>[r,post.find(p=>r.key===p.key&&r.photo===p.photo)]);results.push({arms:[a,b],route,n:pairs.length,beforeMs:median(pre.map(r=>r.wireMs)),afterMs:median(post.map(r=>r.wireMs)),pairedMsSaved:median(pairs.map(([x,y])=>x.wireMs-y.wireMs)),medianBeforePrompt:median(pre.map(r=>r.promptMs)),medianAfterPrompt:median(post.map(r=>r.promptMs)),differentScores:pairs.filter(([x,y])=>x.p!==y.p).length,maxAbsDelta:Math.max(...pairs.map(([x,y])=>Math.abs(x.p-y.p)))});
}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({health,results},null,2));console.log(JSON.stringify({health,results}));
}finally{clearInterval(timer);await stop(rt);fs.writeFileSync(path.join(out,'health.json'),JSON.stringify({health,stop:ctl.signal.reason?.message??null}));}