import {it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createDesk} from '../../server/v4/desk';
import {readPublicVision,hasInternalCopy} from '../../server/v4/public-vision.mjs';

it('serves public vision copy without internal actors and fails closed on editorial contamination',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-public-copy-')),root=path.join(dir,'cases');
  fs.mkdirSync(root);const db=createDesk({root,key:'f'.repeat(40),demo:true,dbPath:path.join(dir,'desk.sqlite')});
  try{
    const reply=await db.app.inject({method:'GET',url:'/v4/presentation/vision'});
    expect(reply.statusCode).toBe(200);expect(reply.json().markdown).toBe(readPublicVision());expect(hasInternalCopy(reply.json().markdown)).toBe(false);
    const offline=fs.readFileSync('scripts/v4/preview.mjs','utf8');expect(offline).toMatch(/vision\(readPublicVision\(\)\)/);
    for(const term of ['Claude','Anthropic','Opus','Astra','OpenAI','GPT','Luna','Sol','Terra','D-033','claude-070','astra-074','Qwen','Ollama']){
      expect(hasInternalCopy('Reviewed by '+term+'.')).toBe(true);
    }
    const candidate=path.join(dir,'editorial.md');fs.writeFileSync(candidate,'Drafted by Claude, D-033.');
    expect(()=>readPublicVision(candidate)).toThrow(/awaiting review/);
    for(const f of fs.readdirSync('app/src/v4').filter(n=>n.endsWith('.tsx')))expect(hasInternalCopy(fs.readFileSync(path.join('app/src/v4',f),'utf8')),f).toBe(false);
  }finally{
    await db.app.close();const resolved=fs.realpathSync(dir);if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('relay-public-copy-'))throw Error('Invalid test directory');fs.rmSync(resolved,{recursive:true,force:true});
  }
});
