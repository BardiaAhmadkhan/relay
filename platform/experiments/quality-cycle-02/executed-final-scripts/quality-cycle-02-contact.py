from pathlib import Path
from PIL import Image,ImageDraw
import json
root=Path(r'.');r=json.loads((root/'experiments/quality-cycle-02/fresh-acquisition.json').read_text(encoding='utf-8'))['records'];out=root/'datasets/quality-cycle-02/review';out.mkdir(parents=True,exist_ok=True)
for start in range(0,len(r),10):
 sheet=Image.new('RGB',(1500,720),'#f5f2eb');draw=ImageDraw.Draw(sheet)
 for i,c in enumerate(r[start:start+10]):
  im=Image.open(root/c['file']).convert('RGB');im.thumbnail((290,308));x=(i%5)*300;y=(i//5)*360;sheet.paste(im,(x+5+(290-im.width)//2,y+30+(308-im.height)//2));draw.text((x+6,y+6),c['id'],fill='#111111')
 sheet.save(out/f'fresh-{start//10+1:02d}.jpg',quality=94)
print(len(r),'images, contact sheets ready')