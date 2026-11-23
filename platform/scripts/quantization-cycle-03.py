"""Quantization-only experiment. Calibration uses original training groups, never test photos."""
from pathlib import Path
import json,hashlib,time,io
import numpy as np
import onnxruntime as ort
from onnxruntime.quantization import CalibrationDataReader,quantize_static,QuantType,QuantFormat,CalibrationMethod
from PIL import Image,ImageEnhance
root=Path(__file__).resolve().parents[1];base=root/'experiments/mobile-specialists';out=base/'cycle-03';out.mkdir(exist_ok=True)
source=json.loads((base/'routing-training-protocol.json').read_text())
plan={'frozenAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'factor':'Encoder quantization only; original routing head frozen.','calibrationGroups':sorted(set(c['group'] for c in source['cases'] if c['split']=='train')),'cases':source['cases'],'candidates':['qdq-int8-tensor','qdq-int8-channel'],'gate':'No changed category predictions versus float encoder on every original and paired quality variant. Then measure native latency and size separately. Passing is engineering parity only, not accuracy or release approval.','variants':['original','jpeg35','dim70','small224'],'limitations':'Tiny exposed development dataset, baseline routing already wrong on armour and a close-up. Calibration not a representative production sample.'}
with (out/'protocol.json').open('x',encoding='utf8') as f:json.dump(plan,f,indent=2)
def pixels(im):
 x=np.asarray(im.resize((224,224),Image.Resampling.BILINEAR),dtype=np.float32)/255
 x=(x-np.array([.485,.456,.406],dtype=np.float32))/np.array([.229,.224,.225],dtype=np.float32)
 return np.transpose(x,(2,0,1))[None].copy()
calibration=[];evaluation=[]
for c in source['cases']:
 im=Image.open(root/c['file']).convert('RGB')
 if c['split']=='train':
  for gain in [.75,1,1.25]:
   v=ImageEnhance.Brightness(im).enhance(gain)
   calibration.extend([{'rgb':pixels(v)},{'rgb':pixels(v.transpose(Image.Transpose.FLIP_LEFT_RIGHT))}])
 else:
  buf=io.BytesIO();im.save(buf,format='JPEG',quality=35);buf.seek(0);s=224/max(im.size)
  vs=[('original',im),('jpeg35',Image.open(buf).convert('RGB')),('dim70',ImageEnhance.Brightness(im).enhance(.7)),('small224',im.resize((round(im.width*s),round(im.height*s)),Image.Resampling.BILINEAR))]
  evaluation.extend([(c,name,pixels(v)) for name,v in vs])
class Reader(CalibrationDataReader):
 def __init__(self):self.rows=iter(calibration)
 def get_next(self):return next(self.rows,None)
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
head=ort.InferenceSession(str(base/'jacket-routing-head.onnx'),sess_options=opts,providers=['CPUExecutionProvider'])
report={'plan':plan,'calibrationSamples':len(calibration),'candidates':[]}
for name in ['float',*plan['candidates']]:
 model=base/'shared-encoder.onnx' if name=='float' else out/(name+'.onnx')
 if name!='float':quantize_static(str(base/'shared-encoder.onnx'),str(model),Reader(),quant_format=QuantFormat.QDQ,activation_type=QuantType.QUInt8,weight_type=QuantType.QInt8,per_channel=name.endswith('channel'),calibrate_method=CalibrationMethod.MinMax)
 session=ort.InferenceSession(str(model),sess_options=opts,providers=['CPUExecutionProvider']);rows=[]
 for c,variant,x in evaluation:
  f=session.run(None,{'rgb':x})[0];logits=head.run(None,{'embedding':f})[0][0];prediction=int(np.argmax(logits))
  rows.append({'group':c['group'],'file':c['file'],'split':c['split'],'variant':variant,'label':c['label'],'prediction':prediction,'correct':prediction==c['label'],'logits':logits.tolist()})
 # warm repeated identical input for a separately marked desktop throughput diagnostic.
 timings=[]
 for i in range(35):
  start=time.perf_counter();f=session.run(None,{'rgb':evaluation[0][2]})[0];head.run(None,{'embedding':f});elapsed=(time.perf_counter()-start)*1000
  if i>=5:timings.append(elapsed)
 row={'id':name,'bytes':model.stat().st_size,'sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'rows':rows,'desktopMedianMs':float(np.median(timings)),'desktopP95Ms':float(np.percentile(timings,95)),'desktopTimingBoundary':'CPU only, 2 threads, preprocessed tensors, 30 warm runs; host may be busy. Not phone timing.'}
 report['candidates'].append(row)
for c in report['candidates']:
 c['changedPredictions']=[{'group':r['group'],'variant':r['variant'],'wasCorrect':b['correct'],'nowCorrect':r['correct']} for b,r in zip(report['candidates'][0]['rows'],c['rows']) if b['prediction']!=r['prediction']]
 c['pairedGate']=not c['changedPredictions'];c['activation']='research-only'
(out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf8')
print(json.dumps([{k:c[k] for k in ['id','bytes','desktopMedianMs','desktopP95Ms','changedPredictions','pairedGate']} for c in report['candidates']]))
