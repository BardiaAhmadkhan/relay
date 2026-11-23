from pathlib import Path
import json,hashlib,time
import onnx
import onnxruntime as ort
from onnxruntime.transformers.float16 import convert_float_to_float16
from onnxruntime.transformers.onnx_model import OnnxModel
import numpy as np
from PIL import Image,ImageEnhance
import io
root=Path(__file__).resolve().parents[1];base=root/'experiments/mobile-specialists';out=base/'cycle-04b';out.mkdir(exist_ok=True)
plan={'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'factor':'Half-precision weight storage instead of failed int8 activation quantization; float input/output contract retained. Original head unchanged.','gate':'No lost correct baseline decision on originals or quality variants, unchanged encoder/head contract. Speed is measured independently and may regress.','testProtocol':'../cycle-03/protocol.json','scope':'Inactive research-only artifact; does not repair known routing or damage limitations.'}
with (out/'protocol.json').open('x',encoding='utf8') as f:json.dump(plan,f,indent=2)
model=convert_float_to_float16(onnx.load(str(base/'shared-encoder.onnx')),keep_io_types=True);modelpath=out/'shared-encoder-fp16.onnx';OnnxModel(model).topological_sort();onnx.save(model,str(modelpath));onnx.checker.check_model(model)
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
encoder=ort.InferenceSession(str(modelpath),sess_options=opts,providers=['CPUExecutionProvider']);head=ort.InferenceSession(str(base/'jacket-routing-head.onnx'),sess_options=opts,providers=['CPUExecutionProvider']);baseline=json.loads((base/'cycle-03/report.json').read_text())['candidates'][0]
rows=[]
for r in baseline['rows']:
 im=Image.open(root/r['file']).convert('RGB')
 if r['variant']=='jpeg35':
  buf=io.BytesIO();im.save(buf,format='JPEG',quality=35);buf.seek(0);im=Image.open(buf).convert('RGB')
 elif r['variant']=='dim70':im=ImageEnhance.Brightness(im).enhance(.7)
 elif r['variant']=='small224':
  s=224/max(im.size);im=im.resize((round(im.width*s),round(im.height*s)),Image.Resampling.BILINEAR)
 x=np.asarray(im.resize((224,224),Image.Resampling.BILINEAR),dtype=np.float32)/255;x=(x-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32);x=np.transpose(x,(2,0,1))[None].copy()
 features=encoder.run(None,{'rgb':x})[0];logits=head.run(None,{'embedding':features})[0][0];prediction=int(np.argmax(logits))
 rows.append({**r,'prediction':prediction,'correct':prediction==r['label'],'logits':logits.tolist(),'predictionUnchanged':prediction==r['prediction'],'maxLogitDifference':float(max(abs(logits-np.array(r['logits']))))})
regressions=[{'group':r['group'],'variant':r['variant']} for b,r in zip(baseline['rows'],rows) if b['correct'] and not r['correct']];changes=[{'group':r['group'],'variant':r['variant']} for r in rows if not r['predictionUnchanged']]
report={'plan':plan,'bytes':modelpath.stat().st_size,'sha256':hashlib.sha256(modelpath.read_bytes()).hexdigest(),'baselineBytes':baseline['bytes'],'sizeReduction':1-modelpath.stat().st_size/baseline['bytes'],'rows':rows,'changedPredictions':changes,'regressions':regressions,'pairedGate':not regressions,'activation':'research-only'}
(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8');print(json.dumps({k:v for k,v in report.items() if k not in ['rows','plan']}))
