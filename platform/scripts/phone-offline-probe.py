from pathlib import Path
import os,json,time,hashlib,sys
root=Path(__file__).resolve().parents[1]
os.environ['HF_HUB_OFFLINE']='1';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
import numpy as np
import torch
from PIL import Image
from transformers import CLIPModel,CLIPTokenizerFast
from tokenizers import Tokenizer
out=root/'experiments/phone-offline-01';protocol=json.loads((out/'probe-protocol.json').read_text())
torch.set_num_threads(2)
device='cuda' if torch.cuda.is_available() else 'cpu'
for model_id in protocol['models']:
 metadata=json.loads((root/'.cache/phone-models'/f'{model_id}.json').read_text());folder=metadata['folder']
 model=CLIPModel.from_pretrained(folder,local_files_only=True,attn_implementation='eager').eval().to(device)
 tokenizer=Tokenizer.from_file(str(Path(folder)/'tokenizer.json'))
 texts=[];groups=[]
 for head,labels in protocol['heads'].items():
  for name,phrases in labels.items():
   indexes=[]
   for phrase in phrases:
    for template in protocol['templates']:
     indexes.append(len(texts));texts.append(template.format(phrase))
   groups.append({'head':head,'label':name,'indices':indexes})
 encoded=tokenizer.encode_batch(texts);longest=max(len(e.ids) for e in encoded)
 ids=torch.tensor([e.ids+[0]*(longest-len(e.ids)) for e in encoded],device=device)
 masks=torch.tensor([[1]*len(e.ids)+[0]*(longest-len(e.ids)) for e in encoded],device=device)
 with torch.inference_mode():
  tf=model.get_text_features(input_ids=ids,attention_mask=masks);tf=tf/tf.norm(dim=-1,keepdim=True)
  vectors=torch.stack([tf[g['indices']].mean(0) for g in groups]);vectors=vectors/vectors.norm(dim=-1,keepdim=True)
 rows=[]
 for case in protocol['cases']:
  start=time.perf_counter();image=Image.open(root/case['inputFile']).convert('RGB');w,h=image.size
  regions=[{'x':0,'y':0,'width':1,'height':1},*case['regions']]
  tensors=[]
  for region in regions:
   left=round(region['x']*w);top=round(region['y']*h);right=min(w,left+round(region['width']*w));bottom=min(h,top+round(region['height']*h))
   crop=image.crop((left,top,right,bottom)).resize((224,224),Image.Resampling.BILINEAR)
   rgb=np.array(crop,dtype=np.float32)/255
   rgb=(rgb-np.array([.48145466,.4578275,.40821073],dtype=np.float32))/np.array([.26862954,.26130258,.27577711],dtype=np.float32)
   tensors.append(rgb.transpose(2,0,1))
  with torch.inference_mode():
   f=model.get_image_features(pixel_values=torch.tensor(np.stack(tensors),device=device));f=f/f.norm(dim=-1,keepdim=True)
   scores=(f@vectors.T).cpu().numpy()
  views=[]
  for region,score in zip(regions,scores):
   rankings={head:sorted([{'label':g['label'],'score':float(score[i])} for i,g in enumerate(groups) if g['head']==head],key=lambda r:-r['score']) for head in protocol['heads']}
   views.append({'region':region,'rankings':rankings})
  rows.append({'id':case['id'],'expectedDamage':case.get('expectedDamage'),'inputFile':case['inputFile'],'ms':(time.perf_counter()-start)*1000,'views':views})
  if case.get('variant')=='reference':print(json.dumps({'model':model_id,'id':case['id'],'item':views[0]['rankings']['item'][0],'surface':[v['rankings']['surface'][:2] for v in views]}),flush=True)
 with (out/(model_id+'-probe.json')).open('x',encoding='utf8') as f:json.dump({'model':metadata,'scope':protocol['task'],'rows':rows},f,indent=2)
 np.savez(out/(model_id+'-heads.npz'),vectors=vectors.cpu().numpy(),labels=np.array([g['label'] for g in groups]),heads=np.array([g['head'] for g in groups]))
 del model
 if device=='cuda':torch.cuda.empty_cache()
