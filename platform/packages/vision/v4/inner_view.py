"""Check how much of the inside is actually shown. Visible pocket bags alone do not make a full inside view a close-up."""
import base64
from acquire import pixels
from closed_roles import choose

def inspect_inner(image,garment):
    encoded=base64.b64encode(pixels(image,720)).decode()
    pants=garment=='pants'
    framing=('Start with the extent of the whole garment. Is its interior facing up, with the waistband and both trouser legs through both cuffs visible? An inside-out whole pair may show large pocket bags, knee pockets and exposed seam allowances, and the cloth may have two different colours.' if pants else
        'Start with the extent of the garment. Is the whole opened or turned-out inside torso of the jacket visible, from collar to hem, with the lining, attachment seams or internal construction facing up? The sleeves can lie behind the torso.')
    choices=[('inside','the whole inside '+('pair of trousers including both legs' if pants else 'jacket torso')+' is visible'),
             ('partial','a folded single side, folded seat, single sleeve, close pocket, lining patch or label'),
             ('outside','the exterior face of the garment is showing'),('unknown','unclear or no garment')]
    answer=choose(encoded,framing,choices)
    inside=answer['choice']=='inside' and answer['distribution'].get('inside',0)>=.55
    orientation=None
    if inside:
        orient=choose(encoded,'Which inner panel is facing the camera on this complete inside-out clothing view? Front means inside front closure or two front pocket bags, back means a rear yoke or broad closed seat/back panel. Opened jacket may show both.',[('front','front inside face mainly'),('back','back inside face mainly'),('mixed','both panels or uncertain')])
        if orient['distribution'].get(orient['choice'],0)>=.65:orientation=orient['choice']
    return {'whole':inside,'score':answer,'orientation':orientation,'version':'inside-coverage.1'}
