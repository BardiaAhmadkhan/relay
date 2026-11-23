"""Controlled research cycle. Fixed image groups; no test-image training or activation."""
from pathlib import Path
import json, hashlib, time, io, copy
import numpy as np
import torch
import onnxruntime as ort
from PIL import Image,ImageEnhance
root=Path(__file__).resolve().parents[1]
base=root/'experiments/mobile-specialists'
out=base/'cycle-02'
out.mkdir(exist_ok=True)
protocol_path=out/'protocol.json'
if protocol_path.exists(): raise RuntimeError('Use a new cycle directory; do not overwrite an experiment')
source=json.loads((base/'routing-training-protocol.json').read_text())
protocol={'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'question':'Do linear regularization and crop augmentation repair close-up routing without losing full-image strengths?', 'sourceProtocolSha256':hashlib.sha256((base/'routing-training-protocol.json').read_bytes()).hexdigest(), 'cases':source['cases'],'seed':20261026,'candidates':[{'id':f'{architecture}-{augmentation}','architecture':architecture,'augmentation':augmentation} for architecture in ['mlp32','linear'] for augmentation in ['brightness-flip','brightness-flip-crops']], 'training':{'epochs':200,'learningRate':.002,'weightDecay':.05,'threads':2}, 'pairedDecision':'A candidate must retain every correct original test/diagnostic result and improve at least one baseline failure. Stress variants reported separately, never counted as independent items. All candidates remain inactive because this tiny exposed development set is inadequate for release.', 'evaluationVariants':['original','jpeg35','dim70','small224'], 'limitations':['Exposed development set; not fresh holdout.','Jacket-shaped routing only, not damage or crash determination.','No probability calibration.','No user image or held-out image used for training.']}
protocol_path.write_text(json.dumps(protocol,indent=2),encoding='utf8')
torch.set_num_threads(2)
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
encoder=ort.InferenceSession(str(base/'shared-encoder.onnx'),sess_options=opts,providers=['CPUExecutionProvider'])
cache={}
def encode(image):
 image=image.resize((224,224),Image.Resampling.BILINEAR)
 key=hashlib.sha256(image.tobytes()).hexdigest()
 if key not in cache:
  x=np.asarray(image,dtype=np.float32)/255
  x=(x-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
  cache[key]=encoder.run(None,{'rgb':np.transpose(x,(2,0,1))[None].copy()})[0][0]
 return cache[key]
def variants(image):
 yield 'original',image
 buf=io.BytesIO();image.save(buf,format='JPEG',quality=35);buf.seek(0)
 yield 'jpeg35',Image.open(buf).convert('RGB')
 yield 'dim70',ImageEnhance.Brightness(image).enhance(.7)
 s=224/max(image.size)
 yield 'small224',image.resize((max(1,round(image.width*s)),max(1,round(image.height*s))),Image.Resampling.BILINEAR)
class Head(torch.nn.Module):
 def __init__(self,x,architecture):
  super().__init__();self.register_buffer('mean',x.mean(0));self.register_buffer('scale',x.std(0).clamp(min=.1))
  self.layers=torch.nn.Sequential(torch.nn.Linear(576,32),torch.nn.ReLU(),torch.nn.Linear(32,2)) if architecture=='mlp32' else torch.nn.Sequential(torch.nn.Linear(576,2))
 def forward(self,z):return self.layers((z-self.mean)/self.scale)
train={};evaluation=[]
for c in protocol['cases']:
 data=(root/c['file']).read_bytes()
 assert hashlib.sha256(data).hexdigest()==c['sha256']
 image=Image.open(io.BytesIO(data)).convert('RGB')
 if c['split']=='train':
  for augmentation in ['brightness-flip','brightness-flip-crops']:
   xx,yy=train.setdefault(augmentation,([],[]))
   regions=[image]
   if augmentation.endswith('-crops'):
    w,h=image.size
    for left,top,right,bottom in [(0,0,.7,.7),(.3,0,1,.7),(0,.3,.7,1),(.3,.3,1,1),(.15,.15,.85,.85)]:
     regions.append(image.crop((round(left*w),round(top*h),round(right*w),round(bottom*h))))
   for region in regions:
    for gain in [.75,1.,1.25]:
     v=ImageEnhance.Brightness(region).enhance(gain)
     for flip in [False,True]:
      xx.append(encode(v.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if flip else v));yy.append(c['label'])
 else:
  for name,v in variants(image):evaluation.append((c,name,encode(v)))
report={'protocol':protocol,'candidates':[]}
for config in protocol['candidates']:
 torch.manual_seed(protocol['seed']);xx,yy=train[config['augmentation']];x=torch.tensor(np.stack(xx));y=torch.tensor(yy,dtype=torch.long)
 head=Head(x,config['architecture']);optimizer=torch.optim.AdamW(head.parameters(),lr=.002,weight_decay=.05)
 start=time.perf_counter()
 for _ in range(200):
  optimizer.zero_grad();loss=torch.nn.functional.cross_entropy(head(x),y);loss.backward();optimizer.step()
 elapsed=time.perf_counter()-start;head.eval();rows=[]
 with torch.no_grad():
  for c,name,f in evaluation:
   logits=head(torch.tensor(f[None]))[0].tolist();prediction=int(np.argmax(logits))
   rows.append({'group':c['group'],'file':c['file'],'split':c['split'],'variant':name,'label':c['label'],'prediction':prediction,'correct':prediction==c['label'],'logits':logits})
 path=out/(config['id']+'.onnx');torch.onnx.export(head,torch.zeros((1,576)),str(path),input_names=['embedding'],output_names=['logits'],opset_version=17,dynamo=False)
 row={**config,'parameters':sum(p.numel() for p in head.parameters()),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'trainingSeconds':elapsed,'augmentedTrainingSamples':len(yy),'rows':rows}
 report['candidates'].append(row)
baseline=report['candidates'][0]['rows']
for c in report['candidates']:
 original=[r for r in c['rows'] if r['variant']=='original']
 c['summary']={'testCorrect':sum(r['correct'] for r in original if r['split']=='test'),'testImages':sum(r['split']=='test' for r in original),'diagnosticCorrect':sum(r['correct'] for r in original if r['split']=='diagnostic'),'diagnosticImages':sum(r['split']=='diagnostic' for r in original),'regressions':[],'repairs':[],'stressRegressions':[],'stressRepairs':[]}
 for b,r in zip(baseline,c['rows']):
  if b['correct']==r['correct']:continue
  key=('' if r['variant']=='original' else 'stress')+('Regressions' if b['correct'] else 'Repairs')
  key=key[0].lower()+key[1:]
  c['summary'][key].append({'group':r['group'],'variant':r['variant']})
 c['pairedGate']=bool(not c['summary']['regressions'] and c['summary']['repairs'])
 c['activation']='research-only-insufficient-independent-data'
report['baselineReproductionMaxLogitError']=max(abs(a-b) for r,old in zip([r for r in baseline if r['variant']=='original'],json.loads((base/'routing-training-report.json').read_text())['testRows']) for a,b in zip(r['logits'],old['logits']))
(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps({'baselineReproductionMaxLogitError':report['baselineReproductionMaxLogitError'],'candidates':[{k:c[k] for k in ['id','parameters','bytes','trainingSeconds','summary','pairedGate']} for c in report['candidates']]}))
