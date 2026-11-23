from pathlib import Path
import os,json,hashlib,time
root=Path(__file__).resolve().parents[1];os.environ['TORCH_HOME']=str(root/'.cache/torch')
import numpy as np
import torch
import onnxruntime as ort
from PIL import Image,ImageEnhance
# Scope: a research-only jacket-shaped-item routing head, not motorcycle certification or damage.
cases=[
 ('leather','assets/fixtures/leather-jacket.jpg',1,'train'),
 ('armour','assets/fixtures/armour-jacket.jpg',1,'test'),
 ('denim','assets/fixtures/round-02/jean-jacket.jpg',1,'train'),
 ('worn','assets/fixtures/round-02/worn-jacket.jpg',1,'test'),
 ('winter','assets/fixtures/round-02/winter-kit.jpg',1,'train'),
 ('gloves','assets/fixtures/gloves-back.jpg',0,'train'),
 ('gloves','assets/fixtures/gloves-palm.jpg',0,'train'),
 ('racing-boot','assets/fixtures/racing-boot.jpg',0,'train'),
 ('hyod','assets/fixtures/round-02/hyod-a.jpg',0,'test'),
 ('hyod','assets/fixtures/round-02/hyod-b.jpg',0,'test'),
 ('helmet-a','assets/fixtures/round-02/helmet-fullface.jpg',0,'train'),
 ('helmet-b','assets/fixtures/round-02/helmet-black.jpg',0,'test'),
 ('boots-axo','assets/fixtures/round-02/boots-axo.jpg',0,'test'),
 ('boots-alpinestars','assets/fixtures/round-02/boots-alpinestars.jpg',0,'train'),
 ('trousers','assets/fixtures/round-02/salopette.jpg',0,'train'),
 ('sample-01','assets/fixtures/round-03/sample-01.webp',1,'diagnostic'),
 ('sample-02','assets/fixtures/round-03/sample-02.jpg',1,'diagnostic'),
 ('sample-03','assets/fixtures/round-03/sample-03.jpg',1,'diagnostic'),
]
out=root/'experiments/mobile-specialists';out.mkdir(exist_ok=True)
protocol={'task':'jacket-shaped item versus other gear; not certification, damage, crash history or brand','labelBasis':'Primary source categories and visual shape review. Not expert condition labels.','fixedSeed':20261026,'scope':'Separate trained research artifact. Model training excluded by supplied hackathon brief. Not active in Relay.','cases':[{'group':g,'file':f,'label':y,'split':s,'sha256':hashlib.sha256((root/f).read_bytes()).hexdigest()} for g,f,y,s in cases]}
protocolfile=out/'routing-training-protocol.json'
if protocolfile.exists(): raise RuntimeError('Protocol already exists; use a new experiment rather than overwrite it')
protocolfile.write_text(json.dumps(protocol,indent=2),encoding='utf8')
assert not ({g for g,_,_,s in cases if s=='train'} & {g for g,_,_,s in cases if s!='train'})
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
session=ort.InferenceSession(str(out/'shared-encoder.onnx'),sess_options=opts,providers=['CPUExecutionProvider'])
def feature(image):
 x=np.asarray(image.resize((224,224),Image.Resampling.BILINEAR),dtype=np.float32)/255
 x=(x-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
 return session.run(None,{'rgb':np.transpose(x,(2,0,1))[None].copy()})[0][0]
features=[];labels=[];evaluation=[]
for group,file,label,split in cases:
 image=Image.open(root/file).convert('RGB')
 if split=='train':
  for gain in [0.75,1.,1.25]:
   variant=ImageEnhance.Brightness(image).enhance(gain)
   for flipped in [False,True]:
    features.append(feature(variant.transpose(Image.Transpose.FLIP_LEFT_RIGHT) if flipped else variant));labels.append(label)
 else:evaluation.append({'group':group,'file':file,'label':label,'split':split,'feature':feature(image)})
torch.set_num_threads(2);torch.manual_seed(20261026)
x=torch.tensor(np.stack(features));y=torch.tensor(labels,dtype=torch.long)
class Head(torch.nn.Module):
 def __init__(self):
  super().__init__();self.register_buffer('mean',x.mean(0));self.register_buffer('scale',x.std(0).clamp(min=.1));self.layers=torch.nn.Sequential(torch.nn.Linear(576,32),torch.nn.ReLU(),torch.nn.Linear(32,2))
 def forward(self,z):return self.layers((z-self.mean)/self.scale)
head=Head();optim=torch.optim.AdamW(head.parameters(),lr=.002,weight_decay=.05)
started=time.perf_counter()
for _ in range(200):
 optim.zero_grad();loss=torch.nn.functional.cross_entropy(head(x),y);loss.backward();optim.step()
head.eval();path=out/'jacket-routing-head.onnx';torch.onnx.export(head,torch.zeros((1,576)),str(path),input_names=['embedding'],output_names=['logits'],opset_version=17,dynamo=False)
rows=[]
with torch.no_grad():
 for row in evaluation:
  f=row.pop('feature');logits=head(torch.tensor(f[None]));prediction=int(logits.argmax(1));rows.append({**row,'prediction':prediction,'correct':prediction==row['label'],'logits':logits[0].tolist()})
report={'task':protocol['task'],'trainingGroups':len(set(g for g,_,_,s in cases if s=='train')),'trainingImages':sum(s=='train' for *_,s in cases),'augmentedTrainingSamples':len(labels),'trainingSeconds':time.perf_counter()-started,'headParameters':sum(p.numel() for p in head.parameters()),'headBytes':path.stat().st_size,'headSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'testRows':rows,'testCorrect':sum(r['correct'] for r in rows if r['split']=='test'),'testImages':sum(r['split']=='test' for r in rows),'diagnosticCorrect':sum(r['correct'] for r in rows if r['split']=='diagnostic'),'activation':'rejected-insufficient-independent-data','limits':'Tiny routing research only, correlated views reported by group. Does not assess material damage. No decision threshold calibrated. User images never used for training. No production/general-accuracy claim.'}
(out/'routing-training-report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps(report))
