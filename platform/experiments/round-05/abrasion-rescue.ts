import sharp from 'sharp';
import {z} from 'zod';
import {type PhotoInspectionSchema} from '../../packages/core/schema';
import {VERIFICATION_PROMPT} from '../../packages/vision/verification-prompt';
type PhotoInspection=z.infer<typeof PhotoInspectionSchema>;
export const ABRASION_RESCUE_VERSION='low-detail-abrasion-1';
const Verification=z.strictObject({supported:z.array(z.number().int().min(0).max(5)).max(6),uncertain:z.array(z.number().int().min(0).max(5)).max(6),crashPattern:z.enum(['consistent_with_sliding','not_observed','unclear'])});
const Envelope=z.object({model:z.string(),done:z.literal(true),done_reason:z.literal('stop'),message:z.object({content:z.string().max(6000)}),prompt_eval_count:z.number().int().nonnegative().optional(),eval_count:z.number().int().nonnegative().optional()});
export async function rescueAbrasion(input:{verified:PhotoInspection;extracted:PhotoInspection;jpeg:Uint8Array;model:string;url:string;fetcher:typeof fetch;signal?:AbortSignal}){
 const unchanged=(state:string,usage={inputTokens:0,outputTokens:0})=>({photo:input.verified,state,usage});
 if(input.verified.findings.length)return unchanged('existing-finding');
 const candidates=input.extracted.findings.filter(f=>f.kind==='abrasion');
 if(!candidates.length)return unchanged('no-abrasion-candidate');
 input.signal?.throwIfAborted();
 let usage={inputTokens:0,outputTokens:0};
 try{
  const metadata=await sharp(input.jpeg,{limitInputPixels:24_000_000}).metadata();const width=metadata.width??0,height=metadata.height??0;
  if(Math.max(width,height)>=480||Math.min(width,height)<96||Math.max(width,height)/Math.min(width,height)>4)return unchanged('outside-detail-window');
  const scale=Math.sqrt((1024*32*32)/(width*height));const targetWidth=Math.ceil(width*scale/32)*32,targetHeight=Math.ceil(height*scale/32)*32;
  const enlarged=await sharp(input.jpeg,{limitInputPixels:24_000_000}).resize(targetWidth,targetHeight,{fit:'fill',kernel:sharp.kernel.linear}).png({compressionLevel:1}).toBuffer();
  const deadline=AbortSignal.timeout(4000);const signal=input.signal?AbortSignal.any([input.signal,deadline]):deadline;
  const response=await input.fetcher(input.url+'/api/chat',{method:'POST',signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({model:input.model,stream:false,think:false,format:z.toJSONSchema(Verification),messages:[{role:'system',content:VERIFICATION_PROMPT},{role:'user',content:'Check these candidates (zero-based indices): '+JSON.stringify(candidates.map((f,index)=>({index,...f}))),images:[enlarged.toString('base64')]}],options:{temperature:0,seed:42,num_ctx:8192,num_predict:180},keep_alive:'30m'})});
  if(!response.ok)return unchanged('rescue-unavailable');
  const raw=Envelope.parse(await response.json());if(raw.model!==input.model)return unchanged('rescue-invalid-model');
  usage={inputTokens:raw.prompt_eval_count??0,outputTokens:raw.eval_count??0};const checked=Verification.parse(JSON.parse(raw.message.content));const indices=[...checked.supported,...checked.uncertain];
  if(indices.some(i=>i>=candidates.length)||new Set(indices).size!==indices.length)return unchanged('rescue-invalid-index',usage);
  // A different rendering is not independent evidence. Preserve identity/material,
  // recover only supported abrasion, mark it possible and never upgrade the mechanism.
  const findings=checked.supported.map(i=>({...candidates[i]!,clarity:'possible' as const}));
  if(!findings.length)return unchanged('rescue-not-supported',usage);
  return {photo:{...input.verified,findings,crashPattern:'unclear' as const},state:'abrasion-recovered',usage};
 }catch{
  input.signal?.throwIfAborted();
  // Failure in this optional bounded pass cannot invalidate the original result.
  return unchanged('rescue-unavailable',usage);
 }
}
