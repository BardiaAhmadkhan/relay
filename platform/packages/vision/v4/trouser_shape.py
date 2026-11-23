"""Independent pixel evidence for a two-legged silhouette; absence of a background gap is inconclusive."""
import cv2
import numpy as np

def _palette(image,mask,k):
    points=image[mask][::3].astype(np.float32)
    if len(points)<k:return None
    cv2.setRNGSeed(413)
    _,__,centers=cv2.kmeans(points,k,None,(cv2.TERM_CRITERIA_EPS|cv2.TERM_CRITERIA_MAX_ITER,16,.35),1,cv2.KMEANS_PP_CENTERS)
    return centers

def _measure(image):
    im=image.convert('RGB');im.thumbnail((230,280))
    rgb=np.asarray(im);height,width=rgb.shape[:2]
    if min(height,width)<65:return {'score':0,'fraction':0,'run':0}
    lab=cv2.cvtColor(cv2.GaussianBlur(rgb,(3,3),0),cv2.COLOR_RGB2LAB).astype(np.float32)
    yy,xx=np.mgrid[:height,:width];x=xx/width;y=yy/height
    # Learn the scene supports at the sides, below the hem and in the top corners.
    # Dark floors, wood, white sheets and bright garments all follow the same procedure.
    background=(x<.065)|(x>.935)|((y>.865)&(y<.96))|((y<.10)&((x<.22)|(x>.78)))
    waist=(x>.33)&(x<.67)&(y>.18)&(y<.38)
    bg=_palette(lab,background,7);fg=_palette(lab,waist,4)
    if bg is None or fg is None:return {'score':0,'fraction':0,'run':0}
    def distance(pal):return np.min(np.sum((lab[:,:,None,:]-pal[None,None,:,:])**2,axis=3),axis=2)
    bgd=distance(bg);fgd=distance(fg)
    garment=((fgd+36)<.86*(bgd+36)).astype(np.uint8)
    garment=cv2.morphologyEx(garment,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
    valid=[]
    for row in range(int(height*.30),int(height*.87)):
        ar=garment[row].copy();ar[:int(width*.07)]=0;ar[int(width*.93):]=0
        edges=np.flatnonzero(np.diff(np.r_[0,ar,0]))
        pieces=[(a,b) for a,b in zip(edges[::2],edges[1::2]) if b-a>=.06*width]
        paired=False
        for (a,b),(c,d) in zip(pieces,pieces[1:]):
            gap=(c-b)/width
            if .022<=gap<=.38 and .27<=(b+c)/(2*width)<=.73 and min(b-a,d-c)>=.26*max(b-a,d-c):
                paired=True;break
        valid.append(paired)
    valid=cv2.morphologyEx(np.asarray(valid,np.uint8).reshape((-1,1)),cv2.MORPH_CLOSE,np.ones((max(3,round(height*.014)),1),np.uint8)).reshape(-1).tolist()
    longest=length=0
    for seen in valid:
        length=length+1 if seen else 0
        longest=max(longest,length)
    fraction=sum(valid)/height;run=longest/height
    return {'score':round(.55*run+.45*fraction,4),'run':round(run,4),'fraction':round(fraction,4)}

def leg_separation(image):
    from PIL import ImageOps,ImageEnhance
    # Test-time exposure brackets and both orientations represent the same shape. A median tolerates
    # clipping at one bracket and changes to palette initialization without privileging a good-looking mask.
    base=image.convert('RGB');base.thumbnail((500,600));readings=[]
    for factor in (2**(-1/3),1,2**(1/3)):
        variant=ImageEnhance.Brightness(base).enhance(factor)
        readings.extend((_measure(variant),_measure(ImageOps.mirror(variant))))
    return {key:round(float(np.median([r[key] for r in readings])),4) for key in readings[0]}

def shape_consensus(previous,votes,category,load):
    if category!='pants' or len(votes)<2:return previous,{}
    shape={h:leg_separation(load(h)) for h in votes}
    ranked=sorted(votes,key=lambda h:(-votes[h],h))
    first=ranked[0]
    # Independent cues must nominate the same candidate. A front-reference disagreement,
    # touching legs or an unsegmentable background cannot by itself switch a source.
    remaining=[shape[h]['score'] for h in ranked[1:]]
    yes=votes[first]>=.54 and shape[first]['run']>=.13 and shape[first]['score']-max(remaining)>=.06
    result=dict(previous)
    if yes and first!=previous.get('front'):result['back']=first
    elif first!=previous.get('back'):result.pop('back',None)
    return result,{'shape':shape,'referenceWinner':first,'decision':'joint view' if yes else 'insufficient separation'}
