from pathlib import Path
import os,json,time,hashlib
os.environ['HF_HUB_OFFLINE']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
import numpy as np,onnx,onnxruntime as ort
from PIL import Image
from tokenizers import Tokenizer
root=Path(__file__).resolve().parents[1];out=root/'experiments/phone-offline-01'
protocol=json.loads((out/'probe-protocol.json').read_text());source=root/'.cache/models/Xenova/clip-vit-base-patch32/d15189d7028b43f1d3e65039190477f6af591c2a'
image_model=out/'clip-image-q8.onnx';text_model=out/'clip-text-q8.onnx'
if not image_model.exists():onnx.utils.extract_model(str(source/'onnx/model_quantized.onnx'),str(image_model),['pixel_values'],['image_embeds'])
if not text_model.exists():onnx.utils.extract_model(str(source/'onnx/model_quantized.onnx'),str(text_model),['input_ids','attention_mask'],['text_embeds'])
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
image_session=ort.InferenceSession(str(image_model),sess_options=opts,providers=['CPUExecutionProvider']);text_session=ort.InferenceSession(str(text_model),sess_options=opts,providers=['CPUExecutionProvider'])
tokenizer=Tokenizer.from_file(str(source/'tokenizer.json'));texts=[];groups=[]
for head,labels in protocol['heads'].items():
 for name,phrases in labels.items():
  indices=[]
  for phrase in phrases:
   for template in protocol['templates']:
    indices.append(len(texts));texts.append(template.format(phrase))
  groups.append({'head':head,'label':name,'indices':indices})
encoded=tokenizer.encode_batch(texts);longest=max(len(e.ids) for e in encoded)
ids=np.array([e.ids+[0]*(longest-len(e.ids)) for e in encoded],dtype=np.int64);masks=np.array([[1]*len(e.ids)+[0]*(longest-len(e.ids)) for e in encoded],dtype=np.int64)
tf=text_session.run(None,{'input_ids':ids,'attention_mask':masks})[0];tf=tf/np.linalg.norm(tf,axis=-1,keepdims=True)
vectors=np.stack([tf[g['indices']].mean(0) for g in groups]);vectors=vectors/np.linalg.norm(vectors,axis=-1,keepdims=True)
rows=[]
for case in protocol['cases']:
 start=time.perf_counter();image=Image.open(root/case['inputFile']).convert('RGB');w,h=image.size
 regions=[{'x':0,'y':0,'width':1,'height':1},*case['regions']];views=[]
 for region in regions:
  left=round(region['x']*w);top=round(region['y']*h);right=min(w,left+round(region['width']*w));bottom=min(h,top+round(region['height']*h))
  crop=image.crop((left,top,right,bottom)).resize((224,224),Image.Resampling.BILINEAR)
  rgb=np.array(crop,dtype=np.float32)/255;rgb=(rgb-np.array([.48145466,.4578275,.40821073],dtype=np.float32))/np.array([.26862954,.26130258,.27577711],dtype=np.float32)
  f=image_session.run(None,{'pixel_values':rgb.transpose(2,0,1)[None].copy()})[0];f=f/np.linalg.norm(f,axis=-1,keepdims=True);score=(f@vectors.T)[0]
  rankings={head:sorted([{'label':g['label'],'score':float(score[i])} for i,g in enumerate(groups) if g['head']==head],key=lambda r:-r['score']) for head in protocol['heads']}
  views.append({'region':region,'rankings':rankings})
 rows.append({'id':case['id'],'expectedDamage':case.get('expectedDamage'),'inputFile':case['inputFile'],'ms':(time.perf_counter()-start)*1000,'views':views})
 if case.get('variant')=='reference':print(json.dumps({'id':case['id'],'ms':rows[-1]['ms'],'item':views[0]['rankings']['item'][0]['label'],'surface':[v['rankings']['surface'][0]['label'] for v in views]}),flush=True)
with (out/'clip-image-q8-probe.json').open('x',encoding='utf8') as f:json.dump({'source':str(source),'modelBytes':image_model.stat().st_size,'modelSha256':hashlib.sha256(image_model.read_bytes()).hexdigest(),'rows':rows},f,indent=2)
np.savez(out/'clip-image-q8-heads.npz',vectors=vectors,labels=np.array([g['label'] for g in groups]),heads=np.array([g['head'] for g in groups]))
