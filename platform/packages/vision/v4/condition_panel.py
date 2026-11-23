"""Plan distinct native regions and check a suspected break against its exact wider source."""
import base64,hashlib,io,math
from PIL import Image,ImageDraw
from acquire import pixels,region_pixels
from closed_roles import choose
from zones import read_condition

STRUCTURAL={'open_damage','hardware_damage','repair_like'}

def polygon_area(points):
    if not points:return 0.
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1])))/2

def plan_regions(zones,details):
    selected={}
    for z in zones:
        key=(z['layer'],z['zone']);l,t,r,b=z['box'];area=(r-l)*(b-t)
        if area<=0:continue
        fill=min(1.,polygon_area(z.get('polygon',[]))/area)
        src=z.get('nativeSourceSize',[1,1]);footprint=area*src[0]*src[1]
        # After ~1 MP there is little extra benefit on this 1050 px prompt; prefer an actual filled garment contour.
        rank=(fill*min(1.,math.sqrt(footprint)/900),fill,min(footprint,1200000),z['photo'])
        if key not in selected or rank>selected[key][0]:selected[key]=(rank,z)
    out=[{**v[1],'purpose':'area'} for k,v in sorted(selected.items())]
    for d in details:out.append({**d,'purpose':'detail','layer':'detail','zone':'unknown','box':[.10,.12,.90,.88]})
    return out

def contextual_observation(image,box,first):
    raw=region_pixels(image,box,1050)
    crop=Image.open(io.BytesIO(raw)).convert('RGB');crop.thumbnail((535,535))
    original=image.convert('RGB');original.thumbnail((365,535));l,t,r,b=box
    draw=ImageDraw.Draw(original);draw.rectangle((l*original.width,t*original.height,r*original.width,b*original.height),outline='#ffb100',width=3)
    sheet=Image.new('RGB',(920,570),'#efefed');sheet.paste(original,((370-original.width)//2,(555-original.height)//2));sheet.paste(crop,(375+(535-crop.width)//2,(555-crop.height)//2))
    q=('The right panel is the exact rectangle in the wider left photograph. Identify the physical feature responsible for the apparent opening or damage. A dark cavity, pocket mouth, panel edge, quilt stitching, designed vent slot, fold or a gap beside the garment is not itself a broken material edge. Choose uncertainty if no specific physical feature is visible.')
    choices=[('textile_break','torn textile, broken seam or exposed stuffing with discontinuous fibres'),('hardware_break','a fractured or displaced piece of hardware distinct from a designed opening'),('repair_evidence','aftermarket repair stitching or patch distinct from factory construction'),('constructed','a continuous folded or sewn edge, ordinary pocket opening or normal manufactured vent'),('background','a surface outside the garment is visible along its intact silhouette'),('uncertain','the physical distinction cannot be made from this photo')]
    result=choose(base64.b64encode(pixels(sheet,920)).decode(),q,choices)
    return {'choice':result['choice'],'distribution':result['distribution'],'mass':result['mass'],'method':'native crop + source overview; same local reader','sourceCropSha256':hashlib.sha256(raw).hexdigest()}

def observe(image,region):
    obs=read_condition(image,region['box'])
    context=contextual_observation(image,region['box'],obs) if obs['state'] in STRUCTURAL else None
    return {**region,**obs,'contextRead':context}
