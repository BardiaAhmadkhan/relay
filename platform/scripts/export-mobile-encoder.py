import os, json, hashlib, time
from pathlib import Path
root=Path(__file__).resolve().parents[1]
os.environ['TORCH_HOME']=str(root/'.cache/torch')
import torch
from torchvision.models import mobilenet_v3_small, MobileNet_V3_Small_Weights
import onnx
class SharedEncoder(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.features=mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.IMAGENET1K_V1).features
    def forward(self,x):
        spatial=self.features(x)
        return spatial.mean(dim=(2,3))
model=SharedEncoder().eval()
example=torch.zeros((1,3,224,224),dtype=torch.float32)
output=root/'experiments/mobile-specialists/shared-encoder.onnx'
start=time.perf_counter()
torch.onnx.export(model,example,str(output),input_names=['rgb'],output_names=['embedding'],opset_version=17,dynamo=False)
onnx.checker.check_model(str(output))
record={'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'architecture':'MobileNetV3 Small convolutional features with global average pooling','weights':'torchvision MobileNet_V3_Small_Weights.IMAGENET1K_V1','training':'Pretrained weights; no task training in this export','input':[1,3,224,224],'output':[1,576],'rgbNormalization':{'mean':[0.485,0.456,0.406],'std':[0.229,0.224,0.225]},'parameters':sum(p.numel() for p in model.parameters()),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'exportSeconds':time.perf_counter()-start,'torch':torch.__version__,'status':'Feature extractor only. No damage, history, authenticity or protective-performance classifier.'}
(root/'experiments/mobile-specialists/encoder-manifest.json').write_text(json.dumps(record,indent=2),encoding='utf8')
print(json.dumps(record))
