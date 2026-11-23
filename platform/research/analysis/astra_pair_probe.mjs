import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {LocalLogprobScorer} from '../../packages/vision/v2/scorer-local.ts';
import {GARMENT_QUESTIONS} from '../../packages/vision/v2/battery.ts';
import {prepareImages} from '../../server/images.ts';
const [dir,store,size]=process.argv.slice(2),pins={'2b':['relay-inspection:base','0689d44085e06d165161a8a9a1731344278cfb5aade63a3c3dbdb48ab54b130a'],'4b':['qwen3.5:4b','d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04']};
assert(pins[size]);const [model,digest]=pins[size];
const hash=b=>createHash('sha256').update(b).digest('hex'),buf=fs.readFileSync(path.join(dir,'protocol.json'));
assert.equal(hash(buf),'f8d13df2d53e8b0ccc0654d9ebfac2898a09bf65cac5850e140791d36a39d297');
const protocol=JSON.parse(buf),out=path.join(dir,size);fs.mkdirSync(out,{recursive:true});
const file=path.join(out,'rows.jsonl');const rows=fs.existsSync(file)?fs.readFileSync(file,'utf8').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse):[];
const done=new Set(rows.map(r=>r.id));let hot=0,rt,lastCheck=0,inGuard=false;
const abort=new AbortController(),exec=promisify(execFile),health={maxTemp:0,maxVramMiB:0,minFreeMiB:Infinity,samples:0};
async function guard(){if(inGuard)return;inGuard=true;try{const run=async(args)=>(await exec('nvidia-smi',args,{windowsHide:true,timeout:5000})).stdout.trim();
if(Date.now()-lastCheck>10000){const apps=await run(['--query-compute-apps=pid,process_name','--format=csv,noheader']);if(/\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe/i.test(apps))throw Error('Game active');lastCheck=Date.now();}
const [t,v]=(await run(['--query-gpu=temperature.gpu,memory.used','--format=csv,noheader,nounits'])).split(',').map(Number),ram=os.freemem()/1048576;
if(![t,v,ram].every(Number.isFinite)||t>=85||v>7000||ram<2048)throw Error('Resource guard '+JSON.stringify({t,v,ram}));
hot=t;health.maxTemp=Math.max(health.maxTemp,t);health.maxVramMiB=Math.max(health.maxVramMiB,v);health.minFreeMiB=Math.min(health.minFreeMiB,Math.floor(ram));health.samples++;
}catch(e){abort.abort(e);rt?.kill();}finally{inGuard=false;}}
const timer=setInterval(()=>void guard(),900);
try{await guard();abort.signal.throwIfAborted();
const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
const url='http://127.0.0.1:'+port,env={...process.env,OLLAMA_HOST:'127.0.0.1:'+port,OLLAMA_MODELS:path.resolve(store),OLLAMA_NO_CLOUD:'1',OLLAMA_CONTEXT_LENGTH:'8192',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',LLAMA_ARG_CACHE_RAM:'0'};
delete env.LLAMA_ARG_CTX_CHECKPOINTS;delete env.LLAMA_ARG_CHECKPOINT_MIN_SPACING_NT;
rt=spawn('ollama.exe',['serve'],{env,windowsHide:true,stdio:'ignore'});let tag;
for(let i=0;i<120&&!tag;i++){abort.signal.throwIfAborted();if(rt.exitCode!==null)throw Error('runtime exited');try{tag=(await (await fetch(url+'/api/tags')).json()).models.find(m=>m.name===model);}catch{}if(!tag)await sleep(150);}
assert.equal(tag?.digest,digest);const engine=new LocalLogprobScorer(model,digest,url,fetch,90000),control=GARMENT_QUESTIONS.find(q=>q.key==='single_item');
assert.equal(control.question,protocol.control);const alternate={...control,key:'matched_pair_count',question:protocol.candidate};
const cases=protocol.sources.filter(c=>size==='4b'||!['unrated','unresolved'].includes(c.count));
let processed=0;
for(const c of cases){if(done.has(c.id))continue;abort.signal.throwIfAborted();if(hot>=71)while(hot>63){abort.signal.throwIfAborted();await sleep(350);}
const bytes=fs.readFileSync(c.path);assert.equal(hash(bytes),c.sourceSha256);const img=(await prepareImages([{id:c.id,view:'front',base64:bytes.toString('base64')}],512)).images[0];
const order=parseInt(c.sourceSha256[0],16)%2?[control,alternate]:[alternate,control];const values={};
for(const q of order){const t=performance.now();try{const res=await engine.score(img,[q],abort.signal);values[q.key]={p:res.answers[q.key].p,tokens:res.inputTokens,ms:performance.now()-t};}catch(e){abort.signal.throwIfAborted();values[q.key]={error:e.code??e.message,ms:performance.now()-t};}}
const row={id:c.id,count:c.count,framing:c.framing,ordinaryView:c.ordinaryView,sourceGroup:c.sourceGroup,overlap:c.localisationOverlap,preparedSha256:hash(img.jpeg),order:order.map(q=>q.key),old:values.single_item,candidate:values.matched_pair_count};rows.push(row);fs.appendFileSync(file,JSON.stringify(row)+'\n');done.add(c.id);if(++processed%25===0){await engine.unload();console.log(size,done.size,'of',cases.length);}
}
await engine.unload();const flips=rows.filter(r=>r.old.p!=null&&r.candidate.p!=null&&(r.old.p>=.5)!==(r.candidate.p>=.5));
const summary={model,digest,rows:rows.length,expected:cases.length,health,errors:rows.filter(r=>r.old.error||r.candidate.error).map(r=>r.id),byCount:{},flips:flips.map(r=>({id:r.id,count:r.count,view:r.ordinaryView,framing:r.framing,old:r.old.p,candidate:r.candidate.p}))};
for(const c of [...new Set(rows.map(r=>r.count))]){
 const sub=rows.filter(r=>r.count===c);summary.byCount[c]={n:sub.length,wasPass:sub.filter(r=>r.old.p>=.5).length,nowPass:sub.filter(r=>r.candidate.p>=.5).length,becamePass:sub.filter(r=>r.old.p<.5&&r.candidate.p>=.5).length,becameFail:sub.filter(r=>r.old.p>=.5&&r.candidate.p<.5).length};}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,flips:flips.length}));
}finally{clearInterval(timer);if(rt?.exitCode===null){const stopped=new Promise(r=>rt.once('exit',r));rt.kill();await Promise.race([stopped,sleep(3000)]);}fs.writeFileSync(path.join(out,'health.json'),JSON.stringify({health,stop:abort.signal.reason?.message??null}));}