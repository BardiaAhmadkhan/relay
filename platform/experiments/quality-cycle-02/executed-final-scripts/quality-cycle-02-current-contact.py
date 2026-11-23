from pathlib import Path
from PIL import Image,ImageDraw
import json
root=Path(r'.');rows=json.loads((root/'datasets/quality-audit-01/labels.json').read_text(encoding='utf-8'))['cases'];rows=sorted([r for r in rows if r['condition']=='visible_defect'],key=lambda r:r['id']);out=root/'datasets/quality-cycle-02/review';out.mkdir(parents=True,exist_ok=True)
for start in range(0,len(rows),12):
 sheet=Image.new('RGB',(1600,1110),'#f5f2eb');draw=ImageDraw.Draw(sheet)
 for i,c in enumerate(rows[start:start+12]):
  im=Image.open(root/c['file']).convert('RGB');im.thumbnail((390,332));x=(i%4)*400;y=(i//4)*370;sheet.paste(im,(x+5+(390-im.width)//2,y+30+(332-im.height)//2));draw.text((x+6,y+6),c['id'],fill='#111111')
 sheet.save(out/f'current-positive-{start//12+1:02d}.jpg',quality=95)
