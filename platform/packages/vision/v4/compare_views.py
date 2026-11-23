"""Second-stage whole-photo comparison. Stable source digests and two opposite orders; never receives a case ID."""
import base64,io
from PIL import Image,ImageDraw,ImageFont,ImageOps
from acquire import pixels
from closed_roles import choose
from overview import overview_score

def compare_shortlist(rows,prior,open_view):
    result=dict(prior);audit={}
    for view in ('front','back'):
        ranked=sorted([(overview_score(x['role'],x['landmarks'],view),x['sha']) for x in rows if x['role'].get('frame') not in ('tag','id_card')],key=lambda x:(-x[0],x[1]))
        top=[(s,h) for s,h in ranked if s>=.12][:4]
        if len(top)<2 or top[0][0]-top[1][0]>.22:
            audit[view]={'status':'no competing view'};continue
        ordered=sorted(h for _,h in top);votes=[]
        for seq in (ordered,list(reversed(ordered))):
            sheet=Image.new('RGB',(800,800),'white')
            draw=ImageDraw.Draw(sheet)
            for i,h in enumerate(seq):
                x=(i%2)*400;y=(i//2)*400
                im=open_view(h);im=im.convert('RGB');im.thumbnail((375,363))
                sheet.paste(im,(x+(400-im.width)//2,y+22))
                draw.text((x+12,y+5), 'ABCD'[i],fill='black')
            encoded=base64.b64encode(pixels(sheet,800)).decode()
            names=['upper-left','upper-right','lower-left','lower-right'][:len(seq)]
            options=[(h,'the photograph in the '+names[i]+' cell') for i,h in enumerate(seq)]
            question=('Select the best complete exterior '+view+' inventory photograph in this contact sheet. '+
                      ('Look for the center fly/front fastening or chest pockets. ' if view=='front' else 'Look for the back pockets/yoke, without the front fastening. ')+
                      'Require the entire garment to be visible from the collar or waistband down to the hem and both cuffs, lying flat, straight on, not folded, side-on, close-up, inside-out or partly covered. Prefer the whole garment even if another cell shows the correct fabric.')
            response=choose(encoded,question,options);votes.append(response)
        if votes[0]['choice']==votes[1]['choice'] and votes[0]['choice'] in ordered and min(max(v['distribution'].values(),default=0) for v in votes)>=.48:
            result[view]=votes[0]['choice']
        audit[view]={'shortlist':top,'votes':votes,'selected':result.get(view)}
    if len(set(result.values()))!=len(result):return prior,audit
    return result,audit
