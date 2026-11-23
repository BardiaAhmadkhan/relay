import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareImages } from '../server/images';
import { LocalInspectionAdapter } from '../experiments/quality-cycle-02/neutral-inspection';
const labels=JSON.parse(await fs.readFile('datasets/quality-audit-01/labels.json','utf8')).cases;
const base=JSON.parse(await fs.readFile('benchmarks/quality-audit-01/evaluation-full.json','utf8')).rows;
const run=process.argv[2];assert(run&&/^[a-z0-9-]+$/.test(run));const selected=process.argv[3]?.split(',');
const originals=JSON.parse(await fs.readFile('experiments/round-05/hard-case-protocol.json','utf8')).cases.filter((c:any)=>c.variant==='reference'&&c.sourceId.startsWith('user-')).map((c:any)=>({id:c.sourceId,file:c.file,sha256:c.sha256,condition:'visible_defect',view:'front'}));
const cases=[...labels,...originals].filter((c:any)=>!selected||selected.includes(c.id));
const engine=new LocalInspectionAdapter('qwen3.5:4b','d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04');
const path='benchmarks/quality-cycle-02/'+run+'.jsonl';await fs.writeFile(path,'',{flag:'wx'});
for(const [i,c]of cases.entries()){
 const bytes=await fs.readFile(c.file);assert.equal(createHash('sha256').update(bytes).digest('hex'),c.sha256);
 const prepared=await prepareImages([{id:'photo',view:c.view,base64:bytes.toString('base64')}]);
 const start=performance.now();let r:any;
 try{const result=await engine.analyze(prepared.images,AbortSignal.timeout(60000));r={id:c.id,condition:c.condition,result,baseline:base.find((r:any)=>r.id===c.id)?.result.observation,ms:performance.now()-start};}catch(e:any){r={id:c.id,error:e.message,ms:performance.now()-start};}
 await fs.appendFile(path,JSON.stringify(r)+'\n');
 const prior = base.find((row:any)=>row.id===c.id);
 if(c.condition==='visible_defect' && prior?.findingCount > 0 && !r.result?.inspection?.photos[0]?.findings.length){
   await fs.writeFile(path.replace('.jsonl','-gate.json'),JSON.stringify({at:new Date().toISOString(),status:'rejected-early',reason:'A previously positive photograph lost all findings',id:c.id,completed:i+1,planned:cases.length},null,2));
   console.log('Preservation gate failed at '+c.id);break;
 }
 console.log(JSON.stringify({i:i+1,n:cases.length,id:c.id,error:r.error,findings:r.result?.inspection?.photos[0]?.findings,ms:Math.round(r.ms)}));
}
engine.clearCache();