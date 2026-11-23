"""Research-only appearance contradiction. A shortfall of evidence never proves a foreign garment."""
import re
import cv2
import numpy as np
from acquire import native_tag_box
from binding import masks

VERSION="v4.refutation.1"
# Manufacturer aliases are generic knowledge, not per-item labels. A foreign brand alone cannot refute a tag.
ALIASES={"ROKKER":r"\b(?:ROKKER|ROXKER|ROKER|ROКKER)\b|ROKKERTECH","FUEL":r"\bFUEL\b|FUELMOTORCYCLES",
"OLYMPIA":r"\bOLYMPIA\b|OLYMPIAMOTOSPORTS","PANDO":r"\bPANDO\b|PANDOMOTO","SAINT":r"\bSA[1I]NT\b",
"BELSTAFF":r"\bBELSTAFF\b","JOE ROCKET":r"\bJOE\s*ROCKET|JOEROCKET"}
def appearance(im,is_label):
    v=im.convert("RGB");v.thumbnail((360,360))
    rgb=np.asarray(v);h,w=rgb.shape[:2]
    m=masks(v)>0
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    m &= ~((hsv[:,:,0]<31)&(hsv[:,:,1]>44)&(hsv[:,:,2]>75))
    m &= ~((hsv[:,:,1]<25)&(hsv[:,:,2]>212))
    if is_label:
        box=native_tag_box(v)
        if box:
            l,t,r,b=box;m[int(t*h):int(b*h),int(l*w):int(r*w)]=False
    lab=cv2.cvtColor(rgb,cv2.COLOR_RGB2LAB).astype(float)
    if m.sum()<400:return []
    # Multimodal palette and local contrast; no central skin, table or printed tag voting required.
    texture=cv2.absdiff(cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY),cv2.GaussianBlur(cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY),(5,5),0))
    vals=lab[m];tex=texture[m]
    qt=(vals//16).astype(np.int32)
    ids=qt[:,0]*256+qt[:,1]*16+qt[:,2]
    counts=np.bincount(ids,minlength=4096)
    return [([*map(float,np.median(vals[ids==i],axis=0)),float(np.median(tex[ids==i]))],float(counts[i])/len(vals))
            for i in np.argsort(counts)[::-1][:8] if counts[i]>=len(vals)*.035]

def distance(a,b):
    if not a or not b:return None
    av=np.array([v for v,p in a]);bv=np.array([v for v,p in b])
    diff=(av[:,None,:]-bv[None,:,:])*np.array([.7,1,1,1.5])
    ds=np.sqrt(np.sum(diff*diff,axis=2)).min(axis=1)
    weights=np.array([p for v,p in a])
    return float(np.average(ds,weights=weights))

def brands(text):
    return {b for b,p in ALIASES.items() if re.search(p,text.upper())}

def identifiers(text):
    cleaned=re.sub(r"[^A-Z0-9]+"," ",text.upper())
    # Shared garment model phrases/codes. Generic care language, standards, addresses and sizes cannot vote.
    stop=set("CARE WASH WASHING DO NOT CLEAN DRY BLEACH MADE IN REMOVE PROTECTORS BEFORE FABRIC COTTON POLYESTER LINING MOTORCYCLES WWW EN AAA AA CE UKCA US UK EU OUTER INNER SHELL THE AND HAND WATER COMPANY SIZE IRON MACHINE NYLON PADDING POLYAMIDE LEATHER INSTRUCTIONS BESPOKE BARCELONA SPAIN PLEASE ORIGIN INSIDE OUTSIDE USE PROFESSIONAL GARMENT REINFORCED OUT MOTOR COOL ONLY IS TO THIS A".split())
    tokens=cleaned.split()
    garment_terms=set("PANT PANTS JACKET DENIM STRAIGHT SLIM LADY WOMAN JEAN JEANS BLACK GREY SAND MODEL STYLE ART CHINO EDITION".split())
    result=set()
    for i in range(len(tokens)):
        for n in (2,3,4):
            span=tokens[i:i+n]
            if len(span)!=n or any(t in stop or t.isdigit() and len(t)>2 for t in span):continue
            if not any(t in garment_terms for t in span):continue
            if not any(len(t)>=4 and t not in garment_terms and t not in ALIASES for t in span):continue
            result.add(" ".join(span))
    return result

def refute(photo,source,scope,other):
    """scope/other provide reference contexts. Other can be empty for an independent single-rider intake."""
    bs=brands(photo["text"]);tags=identifiers(photo["text"])
    if not bs:return {"status":"not determinable","why":"no independently recognizable garment maker"}
    # A local garment maker with an attached identity should not be called a conflict.
    if not scope["brands"] or not bs.isdisjoint(scope["brands"]):
        return {"status":"not determinable","why":"no independent maker contradiction"}
    srcds=[d for c in scope["fabrics"] if (d:=distance(source,c)) is not None]
    if not srcds:return {"status":"not determinable","why":"no reliable garment textile modes"}
    target=min(srcds)
    for alt in other:
        if not bs.intersection(alt["brands"]):continue
        for anchor in alt["tags"]:
            if not tags.intersection(identifiers(anchor["text"])):continue
            d=distance(source,anchor["palette"])
            if d is not None and target>=17 and d<=11 and target-d>=8:
                return {"status":"conflict","why":"independent maker and model continuity with materially closer alternate fabric","own_distance":round(target,2),"alternate_distance":round(d,2)}
    return {"status":"not determinable","why":"no strong physical and identity contradiction","own_distance":round(target,2)}
