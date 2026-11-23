import { createRequire } from 'node:module';
import sharp from 'sharp';
const url='https://api.openai.com/v1/responses/input_tokens';
const sample=await sharp({create:{width:128,height:160,channels:3,background:'white'}}).jpeg().toBuffer();
const input=[{role:'user',content:[{type:'input_text',text:'Count this generated blank test frame.'},{type:'input_image',image_url:'data:image/jpeg;base64,'+sample.toString('base64'),detail:'high'}]}];
for(const store of [true,false]){
  const body={model:'gpt-6.2-sol',input,...(store?{store:false}:{})};
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});
  const o=await r.json();const safe=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9_.-]{1,90}$/.test(s)?s:null;
  console.log({synthetic:true,storeParameter:store,status:r.status,object:safe(o.object),input:o.input_tokens??null,type:safe(o.error?.type),code:safe(o.error?.code),param:safe(o.error?.param)});
}
