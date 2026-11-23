/** Execute the frozen timing protocol, crossing the original and candidate in every fixture pair.
 * The source fingerprint prevents accidental protocol drift. The two APIs take turns using a
 * single private warmed runtime. Separate API processes prevent accidental cache hits.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const candidate=path.resolve(process.env.RELAY_COMPARISON_ENGINE??'.cache/collab-v35/candidate');
const f=path.resolve('research/analysis/astra_intake_timing.mjs');
let protocol=fs.readFileSync(f,'utf8');
assert.equal(createHash('sha256').update(protocol).digest('hex'),'1255a6f36497aae2fba34645f0858e14a5277c22daeb6fcf8743e926eeee3179');
function edit(a,b){assert.equal(protocol.split(a).length,2,a);protocol=protocol.replace(a,b);}
edit("  repeats: 2,","  repeats: 2,\n  arms: ['before','after'],\n  order: 'Both versions of each fixture in alternating order; second pass reverses both fixture order and each fixture own arm order. Each fixture has both treatment orders.',");
edit('      const i = rep ?', '      for(let armOrder=0;armOrder<2;armOrder++) {\n      const arm=((rep ? cases.length-1-idx : idx)+armOrder+rep)%2 ? "after" : "before";\n      const i = rep ?');
edit("trial = rep + '-' + i;","trial = rep + '-' + i + '-' + arm;");
edit("['--import', 'tsx', 'server/index-v2.ts'],","['--import', 'tsx', arm === 'before' ? 'server/index-v2.ts' : "+JSON.stringify(path.join(candidate,'server/index-v2.ts'))+"],");
edit('        repeat: rep,','        repeat: rep,\n        arm,');
edit('  const trials = read(file),','  }\n  const trials = read(file),');
edit('trials.length !== cases.length * 2','trials.length !== cases.length * 4');
edit("  lastFrame = null,","  sampleState = null,\n  lastFrame = null,");
edit("const [t, v] = (","const [t, v, smClock] = (");
edit("--query-gpu=temperature.gpu,memory.used","--query-gpu=temperature.gpu,memory.used,clocks.current.sm");
edit("    heat = t;","    sampleState = {temperatureC:t,smClockMHz:smClock,vramMiB:v,freeMiB:Math.floor(ram),sampleUTC:new Date().toISOString()};\n    heat = t;");
edit("        phase = view;","        phase = view;\n        const startState = sampleState;");
edit("          sourceSha256: source,","          sourceSha256: source,\n          startState,endState:sampleState,");
await import('data:text/javascript;base64,'+Buffer.from(protocol).toString('base64'));
const out=path.resolve(process.argv[2]);
const samples=fs.readFileSync(path.join(out,'intake-trials.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const quant=(arr,q)=>{const v=[...arr].sort((a,b)=>a-b),p=(v.length-1)*q,i=Math.floor(p);return +(v[i]+(v[Math.min(v.length-1,i+1)]-v[i])*(p-i)).toFixed(3);};
const stats=rows=>Object.fromEntries([['assessmentMs',rows.map(r=>r.wallMs)],['photoMs',rows.flatMap(r=>r.views.map(v=>v.wallMs))],['modelCalls',rows.map(r=>r.modelForwards)],['inputTokens',rows.map(r=>r.totalInputTokens)]].map(([k,vs])=>[k,{p50:quant(vs,.5),p95:quant(vs,.95)}]));
const before=samples.filter(s=>s.arm==='before'),after=samples.filter(s=>s.arm==='after');
const {isDeepStrictEqual:eq}=await import('node:util');
const pairs=before.map(b=>{const a=after.find(v=>v.repeat===b.repeat&&v.fixture===b.fixture);
  const inputs=r=>r.forwards.map(f=>[f.view,f.questionSHA256,f.jpegSHA256,f.promptTokens,f.status]);
  const scores=r=>r.views.map(v=>[v.view,v.quality,v.normalizedSha256,v.answers,v.scorer]);
  return {fixture:b.fixture,repeat:b.repeat,msSaved:b.wallMs-a.wallMs,sameDecision:eq(b.decision,a.decision),sameModelInputs:eq(inputs(b),inputs(a)),sameScores:eq(scores(b),scores(a))};});
const summary={before:stats(before),after:stats(after),pairs,medianPairedMsSaved:quant(pairs.map(p=>p.msSaved),.5),pairDeltaP10:quant(pairs.map(p=>p.msSaved),.1),pairDeltaP90:quant(pairs.map(p=>p.msSaved),.9),fasterPairs:pairs.filter(p=>p.msSaved>0).length,decisionDifferences:pairs.filter(p=>!p.sameDecision).length,modelInputDifferences:pairs.filter(p=>!p.sameModelInputs).length,scoreDifferences:pairs.filter(p=>!p.sameScores).length};
fs.writeFileSync(path.join(out,'crossed-comparison.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,pairs:pairs.length}));