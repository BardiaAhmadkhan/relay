from pathlib import Path
import json,math,html
from PIL import Image,ImageOps,ImageDraw
root=Path(__file__).resolve().parents[1];out=root/'datasets/quality-audit-01/review';out.mkdir(parents=True,exist_ok=True)
records=[]
for name in ['fabric','leather','commons']:
 p=root/f'experiments/quality-audit-01/{name}-acquisition.json'
 if not p.exists():continue
 rows=json.loads(p.read_text())['records'];records.extend(rows)
 for start in range(0,len(rows),12):
  sheet=Image.new('RGB',(1320,1020),'#f4f1e9');draw=ImageDraw.Draw(sheet)
  for index,row in enumerate(rows[start:start+12]):
   image=Image.open(root/row['file']).convert('RGB');image.thumbnail((318,286));x=(index%4)*330;y=(index//4)*340
   sheet.paste(image,(x+6+(318-image.width)//2,y+30+(286-image.height)//2));caption=row['id']+(f" / source class {row['publisherClass']}" if 'publisherClass'in row else '')
   draw.text((x+8,y+8),caption,fill='#171a16')
   draw.text((x+8,y+319),f"{row['width']} x {row['height']}",fill='#50584f')
  sheet.save(out/f'{name}-{start//12+1:02d}.jpg',quality=92)
print(json.dumps({'sourceImages':len(records),'contactSheets':len(list(out.glob('*.jpg')))}))
