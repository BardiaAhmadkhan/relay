import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const [candidate,output,mode='crossed']=process.argv.slice(2),root=process.cwd();
const load=(r,s)=>import(pathToFileURL(path.resolve(r,s)).href);
const {prepareImages:old}=await load(root,'server/images.ts'), {prepareRenditions:next,prepareImages:newBatch}=await load(candidate,'server/images.ts');
const {measureFocus,withFocus}=await load(root,'server/focus.ts');
const {photoFeedback}=await load(root,'packages/core/v2/feedback.ts');
const sharp=createRequire(path.join(root,'package.json'))('sharp'),thresholds=JSON.parse(fs.readFileSync('packages/core/v2/thresholds.json','utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const files=fs.readdirSync('assets/fixtures',{recursive:true}).filter(f=>/\.(jpe?g|png|webp)$/i.test(f)).sort();
const tests=files.map(f=>[f,fs.readFileSync(path.join('assets/fixtures',f))]);
const pattern=Buffer.alloc(311*173*4);for(let i=0;i<pattern.length;i++)pattern[i]=(i*13+(i>>4))%256;
const gen=()=>sharp(pattern,{raw:{width:311,height:173,channels:4}});
for(const [n,b] of [['small-jpeg',await gen().jpeg().toBuffer()],['translucent-png',await gen().png().toBuffer()],['small-webp',await gen().webp().toBuffer()],['oriented-jpeg',await gen().withMetadata({orientation:6}).jpeg().toBuffer()],['mirrored-jpeg',await gen().withMetadata({orientation:2}).jpeg().toBuffer()],['invalid',Buffer.from('this is not an image')],['truncated-jpeg',tests[0][1].subarray(0,47)],['over-byte-limit',Buffer.alloc(4200001)],['prohibited-gif',await gen().gif().toBuffer()]])tests.push([n,b]);
const toInput=(b)=>({id:'frame',view:'front',base64:b.toString('base64')});
async function work(which,inp){
  try{
    let photo,jpegs;
    if(which==='before'){const a=await old([inp],1600);photo=a.photos[0];const focus=await old([inp],1024),low=await old([inp],512);jpegs=[a.images[0].jpeg,focus.images[0].jpeg,low.images[0].jpeg];}
    else {const a=await next(inp,1600,[1024,512]);photo=a.photo;jpegs=[1600,1024,512].map(edge=>a.renditions.get(edge));}
    const q=withFocus(photo.quality,await measureFocus(jpegs[1]));
    return {photo,quality:q,feedback:photoFeedback('front',q,null,thresholds),jpeg256:jpegs.map(hash)};
  }catch(e){if(!e.code||!e.status)throw e;return {error:e.code,status:e.status,message:e.message};}
}
const out=path.resolve(output);fs.mkdirSync(out,{recursive:true});const stat=(a,q)=>{const x=[...a].sort((a,b)=>a-b),p=(x.length-1)*q,i=Math.floor(p);return +(x[i]+(x[Math.min(x.length-1,i+1)]-x[i])*(p-i)).toFixed(3);};
if(mode!=='crossed'){
  assert(['before','after'].includes(mode));
  const selected=tests.slice(0,Math.min(files.length,25));const start=process.memoryUsage().rss;let peak=start,samples=0;const timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);samples++},3);const rows=[];
  try{for(let i=0;i<50;i++){const [name,b]=selected[i%selected.length];const begin=process.memoryUsage().rss;let high=begin;const check=setInterval(()=>high=Math.max(high,process.memoryUsage().rss),3);try{await work(mode,toInput(b));}finally{clearInterval(check);}const end=process.memoryUsage().rss;rows.push({i,name,start:begin,peak:Math.max(high,end),end});}}finally{clearInterval(timer);}
  const summary={mode,frames:rows.length,start,peak,end:process.memoryUsage().rss,sampledPeakDelta:peak-start,processMaxRSSBytes:process.resourceUsage().maxRSS*1024,samples,rows};fs.writeFileSync(path.join(out,mode+'-memory.json'),JSON.stringify(summary));console.log(mode,summary.start,summary.peak,summary.end);process.exit();
}
const observations=[];
for(const [name,b] of tests){const inp=toInput(b),before=await work('before',inp),after=await work('after',inp);assert.deepEqual(after,before,name);observations.push({name,sourceSHA:hash(b),...after});}
const dupe=toInput(tests[0][1]);for(const f of [old,newBatch])await assert.rejects(f([dupe,{...dupe,id:'second',view:'back'}]),e=>e.code==='duplicate_photo'&&e.status===422&&e.message==='Two views contain the same photograph. Replace one with a different view.');
const crossed=[],eligible=tests.slice(0,files.length).filter(([n])=>!observations.find(o=>o.name===n).error),sample=eligible.filter((_,i)=>i%Math.max(1,Math.floor(eligible.length/12))===0).slice(0,12);
for(const order of [0,1,1,0])for(let j=0;j<sample.length;j++){const [name,b]=sample[j],input=toInput(b);const pair={name,order};for(const side of (j+order)%2?['after','before']:['before','after']){const t=performance.now();await work(side,input);pair[side]=performance.now()-t;}crossed.push(pair);}
const diffs=crossed.map(d=>d.before-d.after);
const summary={cases:observations.length,bundled:files.length,errors:observations.filter(o=>o.error).length,mismatches:0,pairedFrames:crossed.length,beforeP50:stat(crossed.map(p=>p.before),.5),afterP50:stat(crossed.map(p=>p.after),.5),beforeP95:stat(crossed.map(p=>p.before),.95),afterP95:stat(crossed.map(p=>p.after),.95),pairDeltaP50:stat(diffs,.5),pairDeltaP10:stat(diffs,.1),pairDeltaP90:stat(diffs,.9),fasterPairs:diffs.filter(d=>d>0).length};
fs.writeFileSync(path.join(out,'cpu.json'),JSON.stringify({summary,observations,crossed},null,2));console.log(JSON.stringify(summary));