"""Final whole-garment framing witness for ambiguous candidates. No filename, source ID or grade in a model prompt."""
import base64
from acquire import pixels
from closed_roles import choose
from overview import overview_score

def complete_garment(image,category):
    jpeg=base64.b64encode(pixels(image,640)).decode()
    if category=="pants":
        q="Ignore what the pockets look like. Does this full frame show the waistband AND two distinct complete legs from crotch to both cuffs, with continuous fabric visible between? A rear waistband folded into shorts, a folded single leg, or a cropped seat cannot meet this definition."
        choices=[("complete","yes, both complete legs and their cuffs are separately visible"),("partial","no, cropped, folded, one leg, label, single patch or unclear")]
    else:
        q="Is the jacket torso presented square to the camera, with both left and right torso edges, both shoulders, entire bottom hem and collar simultaneously visible? The torso should not be turned, partly covered by a folded body, or shown side on. Sleeves can be laid behind the body."
        choices=[("complete","yes, square complete torso from collar to whole hem, both sides broadly visible"),("partial","no, one side dominates or the jacket is folded or cropped")]
    return choose(jpeg,q,choices)
def bilateral_pair(rows,prior,category,load):
    scores={};result=dict(prior)
    for view in ("front","back"):
        ranking=sorted([(overview_score(x["role"],x["landmarks"],view),x) for x in rows if x["role"].get("frame") not in ("tag","id_card")],key=lambda x:(-x[0],x[1]["sha"]))
        choices=[(v,row) for v,row in ranking if v>=.12][:4]
        if len(choices)<2 or choices[0][0]-choices[1][0]>.23:continue
        weighted=[]
        for v,row in choices:
            sha=row["sha"]
            if sha not in scores:scores[sha]=complete_garment(load(sha),category)
            both=scores[sha]["distribution"].get("complete",0)
            pose=row["landmarks"]["pose"]["distribution"].get(view,0)
            landmark=row["landmarks"]["landmark"]["distribution"].get(view,0)
            # Independent full/landmark cues dominate a broad intake-role classifier when it calls a side a front.
            weighed=(v*.3+.7*(pose**.7)*(.15+.85*landmark)**.5)*(.15+.85*both)
            weighted.append((weighed,sha))
        weighted.sort(reverse=True)
        if weighted[0][0]>weighted[1][0]*1.13 and weighted[0][0]>.2:result[view]=weighted[0][1]
    return (result if len(set(result.values()))==len(result) else prior),scores
