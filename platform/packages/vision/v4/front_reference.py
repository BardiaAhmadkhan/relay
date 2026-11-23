"""A reference front grounds the ambiguous reverse view in the item's actual material and silhouette."""
import base64
from PIL import Image,ImageDraw
from closed_roles import choose
from acquire import pixels
from overview import overview_score

def resolve_back(rows,previous,earlier,category,load):
    front=previous.get('front');back=previous.get('back')
    index={r['sha']:r for r in rows}
    if not front or not back:return previous,{}
    role=index[back]['role']['frame']
    if role not in ('inner_zone','inner_overview','outer_zone','pocket') or back==earlier.get('back'):return previous,{}
    candidates=sorted([(overview_score(r['role'],r['landmarks'],'back'),r['sha']) for r in rows if r['sha']!=front and r['role']['frame'] not in ('tag','id_card')],reverse=True)
    selected=[h for _,h in candidates[:5]];support={}
    for h in selected:
        votes=[]
        for reverse in (False,True):
            seq=[front,h] if not reverse else [h,front]
            sheet=Image.new('RGB',(800,500),'white')
            for i,sha in enumerate(seq):
                im=load(sha).convert('RGB');im.thumbnail((388,470));sheet.paste(im,(400*i+(400-im.width)//2,18+(470-im.height)//2))
            ref='right' if reverse else 'left';test='left' if reverse else 'right'
            q=('The '+ref+' photo is the known outside FRONT. Is the '+test+' photo the whole same '+category+' laid out from the rear? Compare the same shell texture and both complete legs/sleeves. Racing trousers may have no rear pockets. Reject a folded seat, a side view, or turned-out mesh/pocket bags.')
            res=choose(base64.b64encode(pixels(sheet,800)).decode(),q,[('yes','whole rear exterior of the same item'),('no','an inner, side, folded or incomplete view')])
            votes.append(res['distribution'].get('yes',0))
        support[h]=min(votes)
    ranked=sorted([(v,h) for h,v in support.items()],reverse=True)
    result=dict(previous)
    if len(ranked)>1 and ranked[0][0]>=.54 and ranked[0][0]-ranked[1][0]>=.08:result['back']=ranked[0][1]
    return result,support
