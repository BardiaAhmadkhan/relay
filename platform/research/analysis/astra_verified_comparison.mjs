/** Re-run the historical paired experiment after promotion. Both source roots are explicit.
 * Run from the lab root. Snapshot directories can live under its .cache to reuse installed modules.
 */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [mode,refArg,candidateArg,outArg,check]=process.argv.slice(2);
if(!['timing','replacement'].includes(mode)||!refArg||!candidateArg||!outArg)throw Error('Usage: node ... timing|replacement REFERENCE CANDIDATE NEW_OUTPUT [--check-only]');
const root=process.cwd(),reference=path.resolve(refArg),candidate=path.resolve(candidateArg),out=path.resolve(outArg);
assert.notEqual(reference,candidate,'Select different source roots');
const ledger=folder=>fs.readFileSync(path.join(root,'collab/baseline',folder,'source-hashes.jsonl'),'utf8').trim().split(/\r?\n/).map(JSON.parse);
const verify=(dir,list)=>{for(const f of list){const bytes=fs.readFileSync(path.join(dir,f.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);}};
verify(reference,ledger('v31-as-restored'));verify(candidate,ledger('v35-final'));
assert(!fs.existsSync(out),'Choose a fresh output directory');
let filename,oldText,newText;
if(mode==='timing'){
 filename='astra_final_intakes.mjs';oldText="arm === 'before' ? 'server/index-v2.ts' : ";
 newText = "arm === 'before' ? " + JSON.stringify(JSON.stringify(path.join(reference,"server/index-v2.ts"))).slice(1,-1) + " : ";
 process.argv=[process.execPath,filename,out,path.join(root,'.cache/ollama')];process.env.RELAY_COMPARISON_ENGINE=candidate;
}else{
 filename='astra_live_replacement.mjs';oldText="arm==='before'?root:path.resolve(candidate)";
 newText="arm==='before'?"+JSON.stringify(reference)+":path.resolve(candidate)";
 process.argv=[process.execPath,filename,out,candidate];
}
const original=fs.readFileSync(path.join(root,'collab/analysis',filename),'utf8');assert.equal(original.split(oldText).length,2);
const code=original.replace(oldText,newText);if(check==='--check-only'){console.log('Both verified source trees and the intended harness substitution match. No GPU calls.');}
else await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
