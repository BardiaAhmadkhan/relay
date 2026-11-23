import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash,randomBytes} from 'node:crypto';import assert from 'node:assert/strict';
const [candidate,output]=process.argv.slice(2),root=process.cwd(),engine=path.resolve(candidate),load=f=>import(pathToFileURL(path.join(engine,f)).href);
const [{createAppV2},{signScores,ScorerChain},{stubScorer,CLEAN_ITEM},{prepareImages},{measureFocus,withFocus}]=await Promise.all([load('server/app-v2.ts'),load('packages/vision/v2/scorer-chain.ts'),load('server/stub-scorer.ts'),load('server/images.ts'),load('server/focus.ts')]);
const read=f=>JSON.parse(fs.readFileSync(f,'utf8')),lines=f=>fs.readFileSync(f,'utf8').trim().split(/\r?\n/).map(JSON.parse),hash=b=>createHash('sha256').update(b).digest('hex');
const cases=read('research/analysis/r2-replay-output.json').results.filter(c=>c.routedR2),recorded=new Map(lines('benchmarks/backend-v2/realworld--v3.jsonl').map(r=>[r.id,r])),labels=new Map(read('datasets/realworld-v3/labels.json').cases.map(r=>[r.id,r]));
const measured=new Map(lines('research/analysis/fallback-results/e19--gpt-6.2-sol.jsonl').map(r=>[r.id,r]));
const thresholds=read('packages/core/v2/thresholds.json'),config={...read('packages/core/v2/policy.config.json'),requiredViews:['front']};
const model='qwen3.5:4b@d8b0f5e9760c cascade';thresholds.perScorer.local_logprob.models=[model,model.replace(' cascade','')];
const key=randomBytes(32).toString('hex'),out=[];
for(const c of cases){
 const r=recorded.get(c.id),official=measured.get(c.id),source=labels.get(c.id);assert(official?.ok);
 const req={id:c.id,view:r.view,base64:fs.readFileSync(source.file).toString('base64')};
 const main=await prepareImages([req],1600),sub=await prepareImages([req],1024),quality=withFocus(main.photos[0].quality,await measureFocus(sub.images[0].jpeg)),sha256=main.photos[0].sha256;
 assert.equal(sha256,official.imageSha256);assert.deepEqual(quality.warnings,r.warnings,c.id);
 const answers={};for(const [k,v] of Object.entries(r.answers)){
 if(k==='category'){const [choice,n]=v.split(':');answers[k]={type:'choice',choice,probabilities:{[choice]:Number(n)}};}
 else if(k==='wear')answers[k]={type:'level',score:v,probabilities:[1,0,0,0]};
 else if(typeof v==='number')answers[k]={type:'yesno',p:({gear:r.gear,single_item:r.singleItem,usable:r.usable,label_legible:r.labelLegible}[k]??v)};
 }
 const score={photoId:c.id,view:r.view,sha256,scorer:{id:'local_logprob',model},batteryVersion:'gear-2',usage:{inputTokens:r.tokens,ms:r.ms},scoredAt:'2026-11-20T00:00:00.000Z',answers};
 const payload={schemaVersion:'2.0',assessmentId:'e19-'+c.id,disclosures:['crash','protective_damage','protective_repair'].map(question=>({id:c.id+'-'+question,question,answer:'no',recordedAt:score.scoredAt})),photos:[{id:c.id,view:r.view,sha256,quality}],signedScores:[signScores(score,key)],closeUpsRequested:0};
 let calls=0;
 const app=createAppV2({chain:new ScorerChain([stubScorer({answers:CLEAN_ITEM})]),workingEdge:1600,planned:true,config,thresholds,signingKey:key,countReview:{async read(x){calls++;assert.equal(x.sha256,official.imageSha256);assert.equal(hash(x.jpeg),official.imageSha256);return official.labels.item_count;}}});
 const post=async(extra={})=>{const v=await app.inject({method:'POST',url:'/v2/assess',payload:{...payload,...extra}});assert.equal(v.statusCode,200,v.body);return v.json();};
 try{const before=await post(),after=await post({countCheck:{notice:'terms',photoId:c.id,base64:req.base64}});assert.equal(calls,1,c.id);
 const pass=['one','matched_pair'].includes(official.labels.item_count),expected=pass?c.countPass:c.before;
 const slim=d=>({outcome:d.outcome,category:d.category,grade:d.grade,reasons:d.reasons.map(z=>z.code),requestPhoto:d.requestPhoto});
 assert.deepEqual(slim(before.decision),c.before);assert.deepEqual(slim(after.decision),expected);assert.equal(!!after.countReceipt,pass);
 if(pass){const repeat=await post({countReceipt:after.countReceipt});assert.deepEqual(repeat.decision,after.decision);assert.equal(calls,1);}
 out.push({id:c.id,count:c.countLabel,existingProviderAnswer:official.labels.item_count,verifiedJPEG:sha256,ordinary:slim(before.decision),integrated:slim(after.decision),mockCalls:calls,receiptReused:pass});
 }finally{await app.close();}
}
const folder=path.resolve(output);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'integrated-e19.json'),JSON.stringify({model:'gpt-6.2-sol',n:out.length,externalCallsMadeByThisReplay:0,matchedPrivacyPreservingImageHashes:out.length,context:'Recorded E19 single-photo protocol. All ten cases traversed the real candidate HTTP schema, receipt signatures, eligibility gate, image handling, model-independent policy and optional count acceptance. Used previously recorded model labels injected without network. This is not a field offer rate.',cases:out},null,2));console.log(JSON.stringify(out.map(r=>[r.id,r.ordinary.outcome,r.integrated.outcome,r.integrated.reasons])));