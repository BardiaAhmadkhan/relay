import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LocalInspectionAdapter as Original } from '../experiments/quality-cycle-02/original-inspection';
import { LocalInspectionAdapter as Candidate } from '../experiments/quality-cycle-02/focused-context-inspection';
import { prepareImages } from '../server/images';
const digest='d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04';
const labels=JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json','utf8')).cases;
const hard=JSON.parse(await fs.readFile('experiments/round-05/hard-case-protocol.json','utf8')).cases;
const cases=['commons-066','fabric-018'].map(id=>labels.find((c:any)=>c.id===id));const b=hard.find((c:any)=>c.id==='biker-black--small240-jpeg60');cases.push({id:b.id,file:b.inputFile,view:'front'});
const path='benchmarks/quality-cycle-02/paired-repeat.jsonl';await fs.writeFile(path,'',{flag:'wx'});
for(let repeat=1;repeat<=3;repeat++)for(const c of cases){
 const prepared=await prepareImages([{id:'photo',view:c.view,base64:(await fs.readFile(c.file)).toString('base64')}]);const row:any={id:c.id,repeat,pixelHash:prepared.photos[0]!.sha256};
 for(const which of repeat%2?['original','candidate']:['candidate','original']){
  const calls:any[]=[];const fetcher:typeof fetch=async(input,init)=>{const response=await fetch(input,init);if(String(input).endsWith('/api/chat')){const sent=JSON.parse(String(init?.body)),raw=await response.clone().json();calls.push({requestHash:createHash('sha256').update(String(init?.body)).digest('hex'),stage:sent.format.properties.box?'ground':sent.format.properties.supported?'verify':'inspect',response:raw.message?.content,doneReason:raw.done_reason});}return response;};
  const engine=new (which==='original'?Original:Candidate)('qwen3.5:4b',digest,'http://127.0.0.1:11435',fetcher);
  try{const started=performance.now(),result=await engine.analyze(prepared.images,AbortSignal.timeout(60000));row[which]={ms:performance.now()-started,photo:result.inspection!.photos[0],calls};}finally{engine.clearCache();}
 }
 row.samePrimaryRequest=row.original.calls[0].requestHash===row.candidate.calls[0].requestHash;row.samePrimaryOutput=row.original.calls[0].response===row.candidate.calls[0].response;
 await fs.appendFile(path,JSON.stringify(row)+'\n');console.log(JSON.stringify({id:c.id,repeat,samePrimaryRequest:row.samePrimaryRequest,samePrimaryOutput:row.samePrimaryOutput,original:row.original.photo.findings.length,candidate:row.candidate.photo.findings.length}));
}