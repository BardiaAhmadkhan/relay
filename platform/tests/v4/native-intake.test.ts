import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {expect,it} from 'vitest';
import {createDesk} from '../../server/v4/desk';
import {registerIntake} from '../../server/v4/intake';
import {authentic} from '../../server/v4/seal';
it('keeps native parent/child uploads atomic, counts retryable exposures once and records an honest exclusion without a model call',async()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'relay-v4-intake-')),root=path.join(parent,'cases'),key='v'.repeat(40);
  fs.mkdirSync(root);
  const desk=createDesk({root,key,demo:true,dbPath:path.join(parent,'demo.sqlite')});
  registerIntake(desk,{root,key,python:'unused-for-this-transaction-test'});
  try{
    const create=async(answer:string)=>(await desk.app.inject({method:'POST',url:'/v4/intakes',payload:{exclusionHistory:answer}})).json().id;
    const id=await create('no'),send=(payload:any)=>desk.app.inject({method:'POST',url:'/v4/intakes/'+id+'/photos',payload});
    const red=await sharp({create:{width:280,height:180,channels:3,background:'#ac4231'}}).jpeg().toBuffer();
    const blue=await sharp({create:{width:140,height:90,channels:3,background:'#003cdd'}}).jpeg().toBuffer();
    const withMetadata=await sharp(red).withExif({IFD0:{Artist:'local privacy fixture'}}).jpeg().toBuffer();
    expect((await send({base64:withMetadata.toString('base64')})).statusCode).toBe(422);
    expect((await send({base64:red.toString('base64'),purpose:'attached_label',rect:[.25,.25,.75,.75],nativeRegion:blue.toString('base64')})).statusCode).toBe(422);
    const check=async()=>(await desk.app.inject({method:'GET',url:'/v4/intakes/'+id})).json();
    expect((await check()).photoCount).toBe(0);
    const parentFiles=path.join(parent,'v4-received',id);expect(fs.readdirSync(parentFiles).filter(f=>f.endsWith('.jpg'))).toEqual([]);
    const good={base64:red.toString('base64'),purpose:'attached_label',rect:[.25,.25,.75,.75]};
    const [first,second]=await Promise.all([send(good),send(good)]);
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);expect(first.json().derived).toBe(second.json().derived);
    expect((await check()).photoCount).toBe(1);expect(fs.readdirSync(parentFiles).filter(f=>f.endsWith('.jpg'))).toHaveLength(2);
    const records=desk.db.prepare('SELECT body FROM native_photo WHERE case_id=?').all(id);
    expect(records).toHaveLength(1);const rec=JSON.parse(String(records[0]!.body));expect(authentic(rec,'same-frame-derivation',key)).toBe(true);
    expect(rec.value.parent).toBe(first.json().photo);expect(rec.value.child).toBe(first.json().derived);
    const crash=await create('yes');const finished=(await desk.app.inject({method:'POST',url:'/v4/intakes/'+crash+'/finish',payload:{}})).json();
    expect(finished.state).toBe('complete');const signed=(await desk.app.inject({method:'GET',url:'/v4/items/'+crash})).json();
    expect(authentic(signed,'inspection',key)).toBe(true);expect(signed.value.history).toMatchObject({crash:'unknown',combined:'yes'});expect(signed.value.result.title).toBe('No offer');
  }finally{
    await desk.app.close();const resolved=fs.realpathSync(parent);
    if(path.dirname(resolved)!==fs.realpathSync(os.tmpdir())||!path.basename(resolved).startsWith('relay-v4-intake-'))throw Error('Test-directory boundary changed.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
