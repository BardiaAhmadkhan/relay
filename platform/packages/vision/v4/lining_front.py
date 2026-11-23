"""Absolute evidence for a complete inside FRONT of trousers. A two-photo set must not force a winner."""
import base64
from acquire import pixels
from closed_roles import choose

def witness(image):
    def ask(im,prompt,options):
        return choose(base64.b64encode(pixels(im,720)).decode(),prompt,options)
    whole=ask(image,'Does this one photograph show the whole INSIDE FRONT of a pair of trousers laid flat, both hip areas and the central front fly exposed together? A one-leg side fold, a rear seat, the outside, or fabric close-up is insufficient.',
        [('yes','whole inner front, two separate hip areas and centre fly facing the camera'),('no','rear, folded to one side, exterior, or only part of the trousers'),('unclear','cannot establish front and both sides')])
    w,h=image.size
    waist=image.crop((round(.13*w),round(.04*h),round(.87*w),round(.61*h)))
    landmark=ask(waist,'Identify the FRONT/BACK landmark visible on the INSIDE of this waistband region. The answer needs the actual front fly placket or zipper and distinct front pocket-bag construction to either side, not just a centre seam. If these are absent or cropped say unclear.',
        [('front','front fly or its placket with front pocket-bag construction on both hips'),('back','rear seat, yoke, rear pockets or continuous rear waistband'),('unclear','a single folded side, outside only, or not enough diagnostic detail')])
    okay=whole['choice']=='yes' and whole['distribution'].get('yes',0)>=.55 and landmark['choice']=='front' and landmark['distribution'].get('front',0)>=.55
    return {'supported':okay,'whole':whole,'landmark':landmark,'version':'pelvis-front.1'}
