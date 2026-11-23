"""Locate candidate anatomical regions on actual pixels. Geometric estimates never verify a garment's condition."""
import numpy as np
import cv2
from binding import masks
from acquire import region_pixels
from closed_roles import choose
import base64

JACKET={"left_shoulder":(.23,.18),"right_shoulder":(.77,.18),"left_elbow":(.13,.51),"right_elbow":(.87,.51),"upper_back":(.50,.31)}
PANTS={"left_hip":(.29,.17),"right_hip":(.71,.17),"left_knee":(.30,.58),"right_knee":(.70,.58),"seat":(.50,.21)}
CONDITION=[("surface","continuous textile or normal design feature"),("open_damage","irregular through-hole, tear, exposed filling or broken seam"),
("hardware_damage","cracked or broken moulded hardware, distinguishing designed slots"),("repair_like","possible patch or repaired structural stitching"),
("surface_change","fuzz, pilling, thinning, scraping or discolouration only"),("unresolved","uncertain, out of focus, or cannot distinguish construction from damage")]

def garment_mask(im):
    rgb=np.asarray(im.convert("RGB"));h,w=rgb.shape[:2]
    if h<40 or w<40:return np.zeros((h,w),np.uint8)
    y,x=np.mgrid[:h,:w];nx=x/w;ny=y/h
    seed=np.full((h,w),cv2.GC_PR_BGD,dtype=np.uint8)
    prior=((nx-.50)/.40)**2+((ny-.51)/.49)**2<1
    seed[prior]=cv2.GC_PR_FGD
    old=masks(im)>0
    seed[old & prior]=cv2.GC_PR_FGD
    seed[(ny<.018)|(ny>.983)|(nx<.015)|(nx>.985)]=cv2.GC_BGD
    seed[(nx>.45)&(nx<.55)&(ny>.26)&(ny<.40)]=cv2.GC_FGD
    # GrabCut fits scene-specific foreground/background mixtures; no fixed table, brand or clothing colour.
    cv2.setRNGSeed(1793)
    try:cv2.grabCut(rgb,seed,None,np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),3,cv2.GC_INIT_WITH_MASK)
    except cv2.error:return old.astype(np.uint8)*255
    result=np.isin(seed,[cv2.GC_FGD,cv2.GC_PR_FGD]).astype(np.uint8)*255
    cs,_=cv2.findContours(result,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    valid=np.zeros_like(result)
    for c in sorted(cs,key=cv2.contourArea,reverse=True)[:3]:
        if cv2.contourArea(c)>h*w*.025:cv2.drawContours(valid,[c],-1,255,-1)
    return valid

def locate(image,garment,frame,interior_orientation=None):
    im=image.convert("RGB");im.thumbnail((430,430))
    mask=garment_mask(im)
    pts=cv2.findNonZero(mask)
    if pts is None:return []
    x,y,w,h=cv2.boundingRect(pts);H,W=mask.shape
    frac=float(np.count_nonzero(mask))/(W*H)
    if not .10<=frac<=.90 or w<.14*W or h<.16*H:return []
    if garment not in ("jacket","pants"):return []
    defs=JACKET if garment=="jacket" else PANTS
    layer="interior" if frame.startswith("inner") else "exterior"
    if frame not in ("outer_front","outer_back","inner_overview"):return []
    # Full fronts invert wearer's left/right. Interior orientation can be ambiguous; polygons remain hypotheses.
    out=[]
    for zone,(ax,ay) in defs.items():
        if zone in ("seat","upper_back") and (frame=="outer_front" or frame=="inner_overview" and interior_orientation!='back'):continue
        if frame=="outer_front":ax=1-ax
        halfw=w*(.19 if garment=="jacket" else .15);halfh=h*.135
        L=max(0,round(x+w*ax-halfw));R=min(W,round(x+w*ax+halfw));T=max(0,round(y+h*ay-halfh));B=min(H,round(y+h*ay+halfh))
        if R-L<8 or B-T<8:continue
        part=mask[T:B,L:R]
        if np.count_nonzero(part)/part.size < .33:continue
        curves,_=cv2.findContours(part,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        if not curves:continue
        c=max(curves,key=cv2.contourArea)
        c=cv2.approxPolyDP(c,.05*cv2.arcLength(c,True),True)
        if len(c)<3:continue
        poly=[[(L+int(pt[0][0]))/W,(T+int(pt[0][1]))/H] for pt in c]
        box=[L/W,T/H,R/W,B/H]
        out.append({"zone":zone,"layer":layer,"polygon":poly,"box":box,"status":"inferred","method":"silhouette-grabcut-template.2","sideVerified":False,"nativeSourceSize":[image.width,image.height]})
    return out

def read_condition(image,rect):
    data=region_pixels(image,rect,1050)
    output=choose(base64.b64encode(data).decode(),"Which directly visible condition best describes this region? Regular mesh, openings of working vents and original factory overlays are construction. Never infer crash history.",CONDITION)
    import hashlib
    return {"state":output["choice"],"wordMass":output,"regionSHA256":hashlib.sha256(data).hexdigest(),"status":"uncalibrated","metadataChecked":True}
