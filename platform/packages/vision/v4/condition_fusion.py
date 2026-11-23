"""Distinguish an uncalibrated visual cue from a source-supported reason to route a case to the desk."""
from condition_panel import STRUCTURAL,plan_regions
def signature(r):return (r['photo'],tuple(round(x,6) for x in r['box']))
def concordant(a):
    return (a['state'],(a.get('contextRead') or {}).get('choice')) in {('open_damage','textile_break'),('hardware_damage','hardware_break'),('repair_like','repair_evidence')}
def priority_regions(zones):
    out=[]
    for layer in ('interior','exterior'):
        rows=[r for r in zones if r['layer']==layer]
        if rows:
            def footprint(r):
                l,t,b,c=r['box'];w,h=r['nativeSourceSize'];return (b-l)*(c-t)*w*h
            out.append({**max(rows,key=lambda r:(footprint(r),r['photo'])),'purpose':'priority'})
    return out
def qualify(zones,planned,old,read):
    # Every deliberate close-up and every incumbent priority cue is carried forward on its own source.
    # The larger coverage screen supplies additional evidence without turning every low-confidence cell
    # into a distinct veto. A new structural cue needs separate photographic support to enter that lane.
    merged={}
    for record in planned:
        merged[signature(record)]={**record,'priorityRead':record.get('purpose')=='detail' or record.get('priorityRead',False)}
    for record in old:
        k=signature(record)
        if k in merged:merged[k]['priorityRead']=True;continue
        merged[k]={**record,'priorityRead':True}
    def alternative(r):
        options=[z for z in zones if z['zone']==r['zone'] and z['layer']==r['layer'] and z['photo']!=r['photo']]
        if not options:return None
        best=plan_regions(options,[])[0];k=signature(best)
        if k not in merged:merged[k]={**read(best),'purpose':'corroboration','priorityRead':False}
        return merged[k]
    for k in list(merged):
        r=merged[k];r['decisionUse']='observation';r['corroboration']=None
        if r.get('state') not in STRUCTURAL:continue
        if r.get('layer')=='detail':r['decisionUse']='review';continue
        if r.get('inferredZoneSupportedBySelectedView') is False:
            r['decisionUse']='unplaced';continue
        ctx=(r.get('contextRead') or {}).get('choice')
        if r['priorityRead'] or concordant(r):
            alt=alternative(r)
            if alt:r['corroboration']={'photo':alt['photo'],'box':alt['box'],'state':alt['state'],'context':(alt.get('contextRead') or {}).get('choice')}
            # A second photograph of the broad area can inform a reviewer. The geometric study
            # did not authenticate the same physical spot, so it cannot clear an original cue.
            if r['priorityRead'] or alt and concordant(r) and concordant(alt):
                r['decisionUse']='review'
            else:r['decisionUse']='screening_cue'
        else:r['decisionUse']='screening_cue'
    # A secondary source can independently corroborate a primary physical break.
    for r in merged.values():r.setdefault('decisionUse','screening_cue' if r['state'] in STRUCTURAL else 'observation')
    return list(merged.values())
