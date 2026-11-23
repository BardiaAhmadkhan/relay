"""Geometric comparison of matching garment panels. It cannot identify a material or measure its strength."""
import cv2
import numpy as np
from PIL import Image,ImageOps

def _view(im,box):
    l,t,r,b=box
    area=im.crop((round(l*im.width),round(t*im.height),round(r*im.width),round(b*im.height))).convert('RGB')
    area=ImageOps.fit(area,(192,192),method=Image.Resampling.BILINEAR)
    return np.asarray(area)

def panel_similarity(im,box,other):
    a=_view(im,box);b=np.ascontiguousarray(_view(im,other)[:,::-1]);a=cv2.cvtColor(a,cv2.COLOR_RGB2GRAY);b=cv2.cvtColor(b,cv2.COLOR_RGB2GRAY)
    # Broad structural edges dominate microtexture, printing and the wooden bench. A high signed
    # correlation has to persist across the upper and lower halves of the normalized photograph.
    def grad(q):
        q=cv2.GaussianBlur(q,(7,7),2);gx=cv2.Sobel(q,cv2.CV_32F,1,0,ksize=3);gy=cv2.Sobel(q,cv2.CV_32F,0,1,ksize=3)
        return cv2.resize(np.dstack((gx,gy)),(48,48),interpolation=cv2.INTER_AREA)
    def corr(x,y):
        x=x.reshape(-1);y=y.reshape(-1)
        return float(np.dot(x,y)/max(1e-6,np.linalg.norm(x)*np.linalg.norm(y)))
    x=grad(a);y=grad(b);best=(-1.,0.,0.)
    for shift in (-4,0,4):
        for rise in (-4,0,4):
            u=x[6:42,6:42];v=y[6+rise:42+rise,6+shift:42+shift]
            top=corr(u[:18],v[:18]);bottom=corr(u[18:],v[18:]);avg=corr(u,v)
            if avg>best[0]:best=(avg,top,bottom)
    return {'correlation':round(best[0],4),'upper':round(best[1],4),'lower':round(best[2],4),
      'repeatedContour':best[0]>=.60 and min(best[1:])>=.35}

def mirrored_panel(image,ob,regions):
    zone=ob['zone']
    if not zone.startswith(('left_','right_')):return None
    side,part=zone.split('_',1);opposite=('right' if side=='left' else 'left')+'_'+part
    other=next((r for r in regions if r['photo']==ob['photo'] and r['zone']==opposite and r['layer']==ob['layer']),None)
    if not other:return None
    return {**panel_similarity(image,ob['box'],other['box']),'pairedZone':opposite,'pairedBox':other['box']}
