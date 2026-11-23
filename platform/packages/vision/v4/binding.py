"""V4 visual-continuity edges. Repeated logos, tabletop, hands and colour alone cannot vote for attachment."""
import cv2
import numpy as np
from PIL import Image

VERSION="v4.binding.sift.1"
cv2.setNumThreads(1)
cv2.setRNGSeed(4256)
SIFT=cv2.SIFT_create(nfeatures=1400,contrastThreshold=.025)
FLANN=cv2.FlannBasedMatcher(dict(algorithm=1,trees=3),dict(checks=36))


def masks(image, *, border_only=False):
    """Foreground proposals from border colours and spatially coherent components. Err towards missing links."""
    rgb=np.asarray(image.convert("RGB"))
    h,w=rgb.shape[:2]
    rw=max(20,round(w*300/max(w,h)));rh=max(20,round(h*300/max(w,h)))
    small=cv2.resize(rgb,(rw,rh),interpolation=cv2.INTER_AREA)
    lab=cv2.cvtColor(small,cv2.COLOR_RGB2LAB).astype(np.int32)
    sy=max(2,rh//12);sx=max(2,rw//12)
    border=np.vstack([lab[:sy].reshape(-1,3),lab[-sy:].reshape(-1,3),lab[:,:sx].reshape(-1,3),lab[:,-sx:].reshape(-1,3)])
    quant=(border//16).clip(0,15)
    counts=np.bincount(quant[:,0]*256+quant[:,1]*16+quant[:,2],minlength=4096)
    inds=np.argsort(counts)[::-1][:8]
    centres=np.array([np.median(border[(quant[:,0]*256+quant[:,1]*16+quant[:,2])==idx],axis=0) for idx in inds if counts[idx]>=len(border)*.016]).astype(np.float32)
    if not len(centres):return np.zeros((h,w),np.uint8)
    distances=np.min(np.sum((lab[:,:,None,:]-centres[None,None,:,:])**2,axis=3),axis=2)
    mask=(distances>23**2).astype(np.uint8)*255
    if border_only:
        # Expose the existing scene-border pixel evidence before contours fill holes.
        return cv2.resize(mask,(w,h),interpolation=cv2.INTER_NEAREST)
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((5,5),np.uint8),iterations=1)
    cs,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    valid=np.zeros_like(mask)
    for c in sorted(cs,key=cv2.contourArea,reverse=True)[:4]:
        x,y,a,b=cv2.boundingRect(c)
        if cv2.contourArea(c)<rw*rh*.017 or x+a<rw*.18 or x>rw*.82: continue
        cv2.drawContours(valid,[c],-1,255,-1)
    valid=cv2.erode(valid,np.ones((5,5),np.uint8))
    valid[:max(1,rh//18)]=0;valid[-max(1,rh//18):]=0
    valid[:,:max(1,rw//16)]=0;valid[:,-max(1,rw//16):]=0
    return cv2.resize(valid,(w,h),interpolation=cv2.INTER_NEAREST)


def features(image):
    image=image.convert("RGB");image.thumbnail((1050,1050),Image.Resampling.LANCZOS)
    rgb=np.asarray(image);h,w=rgb.shape[:2]
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    mask=masks(image)
    # Skin, timber and bright gold/red surfaces are deliberately unavailable as anchors.
    warm=((hsv[:,:,0]<=30)&(hsv[:,:,1]>=45)&(hsv[:,:,2]>=75))
    mask[warm]=0
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    kp,desc=SIFT.detectAndCompute(gray,mask)
    xy=np.asarray([p.pt for p in kp],np.float32).reshape(-1,2)
    return {"points":xy,"desc":np.empty((0,128),np.float32) if desc is None else desc,"size":np.array([w,h],np.float32)}


def ratios(a,b):
    if len(a)<20 or len(b)<20:return {}
    matches=FLANN.knnMatch(a,b,k=2)
    return {m.queryIdx:m.trainIdx for pair in matches if len(pair)==2 for m,n in [pair] if m.distance<.72*n.distance}


def geometric_edge(a,b,label=False):
    forward=ratios(a["desc"],b["desc"])
    if len(forward)<18:return None
    back=ratios(b["desc"],a["desc"])
    pairs=[(i,j) for i,j in forward.items() if back.get(j)==i]
    if len(pairs)<18:return None
    src=np.float32([a["points"][i] for i,j in pairs]);dst=np.float32([b["points"][j] for i,j in pairs])
    H,m=cv2.findHomography(src,dst,cv2.RANSAC,3.2,maxIters=1400,confidence=.995)
    if H is None or m is None:return None
    keep=m.ravel().astype(bool);n=int(keep.sum());ratio=n/len(pairs)
    if n<18 or ratio<.37:return None
    src,dst=src[keep],dst[keep]
    low,high=np.quantile(src/a["size"],[.1,.9],axis=0)
    lo2,hi2=np.quantile(dst/b["size"],[.1,.9],axis=0)
    if min(high-low)<.09 or min(hi2-lo2)<.035:return None
    med=np.median(src,axis=0)
    cells=((src[:,0]>med[0]).astype(int)+2*(src[:,1]>med[1]).astype(int))
    if sum(np.bincount(cells,minlength=4)>=3)<3:return None
    # A valid label bridge needs context beyond the central text/logo block.
    if label:
        xy=src/a["size"]
        context=(xy[:,0]<.28)|(xy[:,0]>.72)|(xy[:,1]<.31)|(xy[:,1]>.73)
        if int(context.sum())<8:return None
    unit=np.float32([med,med+[10,0],med+[0,10]]).reshape(-1,1,2)
    q=cv2.perspectiveTransform(unit,H).reshape(-1,2)
    jac=np.stack([(q[1]-q[0])/10,(q[2]-q[0])/10],axis=1)
    scales=np.linalg.svd(jac,compute_uv=False)
    if np.linalg.det(jac)<=0 or scales[-1]<.05 or scales[0]>15 or scales[0]/scales[-1]>4:return None
    return {"method":VERSION,"inliers":n,"paired":len(pairs),"ratio":round(ratio,4),"source_extent":[round(float(x),3) for x in high-low],"target_extent":[round(float(x),3) for x in hi2-lo2]}
