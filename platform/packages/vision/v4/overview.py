"""Pair real exterior fronts/backs by independent shape and landmark evidence. Source names/positions are unused."""
def overview_score(role,landmark,view):
    pose=landmark.get("pose",{}).get("distribution",{})
    sign=landmark.get("landmark",{}).get("distribution",{})
    fam=role.get("family",{}).get("distribution",{});specific=(role.get("specific") or {}).get("distribution",{})
    if (role.get("frame") in ("tag","id_card") and (fam.get("tag",0)+fam.get("id_card",0)>.86)):return 0.
    # Wholeness matters more than e.g. a fly visible on a cropped hip photograph.
    full=pose.get("front",0)+pose.get("back",0)
    if full<.28 or pose.get(view,0)<.16:return 0.
    return (full**.66)*(pose.get(view,0)**.64)*(.12+.88*sign.get(view,0))**.50*(.78+.22*specific.get("outer_"+view,0))

def choose_overviews(rows):
    # Globally select distinct photos for a complementary pair, with stable digest tie-breaking.
    best=None
    for a in rows:
        front=overview_score(a["role"],a["landmarks"],"front")
        if front<.15:continue
        for b in rows:
            if a["sha"]==b["sha"]:continue
            back=overview_score(b["role"],b["landmarks"],"back")
            if back<.15:continue
            q=(front+back+.1*min(front,back),front,back,a["sha"],b["sha"])
            if best is None or q>best[0]:best=(q,a,b)
    if best:return {"front":best[1]["sha"],"back":best[2]["sha"]}
    solo={}
    for view in ("front","back"):
        candidates=sorted([(overview_score(a["role"],a["landmarks"],view),a["sha"]) for a in rows if a["sha"] not in solo.values()],reverse=True)
        if candidates and candidates[0][0]>=.15:solo[view]=candidates[0][1]
    return solo
