"""Display-only source validation. Nothing from this module enters garment eligibility."""
import hashlib,json,math,os
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageOps
from acquire import region_pixels
from zones import garment_mask
from binding import masks

def display_evidence(images,paths,dest):
    dest=Path(dest);region_dir=dest/'regions';region_dir.mkdir(parents=True,exist_ok=True)
    rows={}
    for photo in images:
        pid=photo['photoId']; source=paths.get(pid)
        records={r['regionHash']:r for r in photo.get('areaChecks',[])+photo.get('findings',[]) if r.get('regionHash')}
        if not records or source is None:continue
        with Image.open(source) as raw:
            upright=ImageOps.exif_transpose(raw)
            thumb=upright.convert('RGB');thumb.thumbnail((430,430),Image.Resampling.LANCZOS)
            mask=garment_mask(thumb);border=masks(thumb,border_only=True)>0;h,w=mask.shape
            for digest,r in records.items():
                l,t,rr,b=r['box'];x=max(0,min(w-1,math.floor(l*w)));y=max(0,min(h-1,math.floor(t*h)))
                xx=max(x+1,min(w,math.ceil(rr*w)));yy=max(y+1,min(h,math.ceil(b*h)))
                grab=mask[y:yy,x:xx]>0;border_patch=border[y:yy,x:xx]
                patch=np.ascontiguousarray((grab & border_patch).astype(np.uint8)*255)
                ga=float(grab.mean());ba=float(border_patch.mean());overlap=float((grab & border_patch).mean())
                disagreement=float((grab != border_patch).mean())
                tier=lambda value: 2 if value>=.60 else 1 if value>=.25 else 0
                agreed=tier(ga)==tier(ba)==tier(overlap) and disagreement<=.25
                fraction=overlap if agreed else 0.0
                contours,_=cv2.findContours(patch,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
                outlines=[]
                for contour in sorted(contours,key=cv2.contourArea,reverse=True)[:3]:
                    if cv2.contourArea(contour)<max(3,patch.size*.015):continue
                    poly=cv2.approxPolyDP(contour,.025*cv2.arcLength(contour,True),True)
                    if len(poly)>=3:outlines.append([[round(float(v[0][0])/max(1,patch.shape[1]-1),4),round(float(v[0][1])/max(1,patch.shape[0]-1),4)] for v in poly])
                roi=region_pixels(upright,r['box'],1050)
                match=hashlib.sha256(roi).hexdigest()==digest
                if match:
                    f=region_dir/(digest+'.jpg')
                    if not f.is_file():f.write_bytes(roi)
                rows[pid+':'+digest]={'photo':pid,'source':photo['workingHash'],'region':digest,'box':r['box'],'width':max(1,round((rr-l)*upright.width)),'height':max(1,round((b-t)*upright.height)),'fraction':round(fraction,6),'grabcutFraction':round(ga,6),'borderFraction':round(ba,6),'overlap':round(overlap,6),'disagreement':round(disagreement,6),'agreed':agreed,'outlines':outlines,'exact':match}
    value={'version':1,'entries':rows}
    target=dest/'zone-display.json';tmp=dest/('zone-display-'+str(os.getpid())+'.tmp');tmp.write_text(json.dumps(value,separators=(',',':')),encoding='utf8');tmp.replace(target)
    return value
