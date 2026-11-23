"""Select a pair of true outside views from pixels and retain an explicit abstention when cues disagree."""
import base64
from closed_roles import choose
from acquire import pixels
from overview import choose_overviews
from compare_views import compare_shortlist
from whole_view import bilateral_pair
from front_reference import resolve_back
from trouser_shape import shape_consensus

VERSION='whole-pair.2026-11-21.4'
def select_views(rows,load,guard,category=None):
    first=choose_overviews(rows)
    if not first:return {},{'status':'no full exterior candidate','version':VERSION},'unknown'
    compared,board=guard(lambda:compare_shortlist(rows,first,load))
    if category not in ('pants','jacket') and compared.get('front'):
        read=guard(lambda:choose(base64.b64encode(pixels(load(compared['front']),640)).decode(),
              'Which single garment occupies the selected photo?', [('pants','trousers or riding jeans'),('jacket','a jacket or coat'),('unknown','an ambiguous or different item')]))
        category=read['choice']
    if category not in ('pants','jacket'):return compared,{'version':VERSION,'compared':board,'status':'uncertain category'},'unknown'
    complete,bilateral=guard(lambda:bilateral_pair(rows,compared,category,load))
    reference,votes=guard(lambda:resolve_back(rows,complete,compared,category,load))
    selected,shape=shape_consensus(reference,votes,category,load)
    return selected,{'version':VERSION,'compared':board,'bilateral':bilateral,'reference':votes,'geometry':shape},category
