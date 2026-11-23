"""Run deterministic acquisition/planning and the installed 4B on an arbitrary directory of still images.
Caches are keyed on actual raw digests. An optional reusable study cache can supply identical prior instrument reads.
Never reads the human catalogue, expected labels or filenames as evidence. One GPU job at a time.
"""
import argparse,base64,hashlib,json,os,sys,time
from datetime import datetime,timezone
from pathlib import Path
from PIL import Image,ImageOps
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/vision/v4'))
from acquire import check_model,chat,pixels,region_pixels,TRANSCRIPT_PROMPT
from zone_display import display_evidence
from gpu_slot import gpu_slot
from closed_roles import classify_closed,overview_evidence
from view_selection import select_views,VERSION as VIEW_VERSION
from zones import locate
from condition_panel import plan_regions,observe
from condition_fusion import priority_regions,qualify,signature
from inner_view import inspect_inner
from local_fields import recover_origins,alternate as alternative_tag,confirm as confirm_origin
from runtime_support import API, http, safe, sample, atom, guard_event

_pinned=False
def safe_gpu(fn):
    global _pinned
    if not _pinned:check_model();_pinned=True
    for _ in range(80):
        resource=sample()
        if not safe(resource):
            print("hardware_guard",flush=True);raise SystemExit(23)
        if resource["temp_c"]<=72:break
        time.sleep(1)
    else:
        print("cooldown_timeout",flush=True);raise SystemExit(23)
    guard=guard_event()
    try:return fn()
    finally:guard.set()

def getjson(p,default=None):
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else default

def sha_file(p):
    d=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):d.update(block)
    return d.hexdigest()

def run(args,folder,shop):
    if not folder.is_dir():raise ValueError("input folder unavailable")
    paths=sorted((i for i in folder.iterdir() if i.suffix.lower() in ('.jpg','.jpeg','.webp','.png')),key=lambda p:p.name)
    if not 1<=len(paths)<=160:raise ValueError("Supply a folder with 1–160 photos")
    hashes={sha_file(p):p for p in paths};group=folder.name if 0<len(folder.name)<=80 and all(c.isascii() and (c.isalnum() or c in '-_') for c in folder.name) else 'case-'+hashlib.sha256(str(folder).encode()).hexdigest()[:12]
    folder_id=hashlib.sha256(' '.join(sorted(hashes)).encode()).hexdigest()
    os.environ['RELAY_V4_CASE']=group
    initial=time.monotonic()
    out=args.output/group;out.mkdir(parents=True,exist_ok=True);(out/'photos').mkdir(exist_ok=True)
    # Version the complete local acquisition contract. An old role, geometry or policy cannot silently
    # survive a code or threshold change. Study artifacts have their own explicit digest checks below.
    dependencies=[Path(__file__),*sorted((ROOT/'packages/vision/v4').glob('*.py')),ROOT/'packages/core/v2/thresholds.json',ROOT/'packages/core/v2/policy.config.json',ROOT/'packages/core/v2/policy.ts',ROOT/'server/app-v2.ts']
    try:
        health=http(API+'/v2/health',timeout=5)
        basis_id='|'.join(str(health.get(k,'')) for k in ('engineRelease','scoreContext','policyVersion','thresholdsVersion'))
    except Exception:basis_id='unavailable'
    config_hash=hashlib.sha256((' '.join(sha_file(p) for p in dependencies)+basis_id).encode()).hexdigest()
    reuse=getjson(out/'run.json',{})
    if not args.cache and reuse.get('cacheReady') and reuse.get('inputSetHash')==folder_id and reuse.get('acquisitionVersion')==config_hash:
        prior=getjson(out/'input.json',{});base=getjson(out/'foundation.json',{})
        intact=all((out/'photos'/(im['workingHash']+'.jpg')).is_file() and sha_file(out/'photos'/(im['workingHash']+'.jpg'))==im['workingHash'] for im in prior.get('images',[]))
        if prior.get('id')==group and len(prior.get('images',[]))==len(hashes) and base.get('decisions') and intact:
            if not (out/'zone-display.json').is_file():
                try:display_evidence(prior['images'],{p['photoId']:hashes[p['sourceHash']] for p in prior['images']},out)
                except Exception as error:
                    atom(out/'zone-display.json',{'version':1,'entries':{},'unavailable':type(error).__name__})
            prior['at']=args.at;atom(out/'input.json',prior)
            atom(out/'run.json',{**reuse,'fullAcquisitionCacheHit':True,'wall_s':round(time.monotonic()-initial,4)})
            print(group,len(hashes),'verified acquisition cache',flush=True);return
    # A cache may be reused only by source digest + filename-independent instrument version.
    casedir=args.cache/folder.name if args.cache else None
    oldidx=getjson(casedir.parent.parent/'index.json',{}) if casedir else {}
    refset={x['sha256'] for x in oldidx.get(folder.name,[])}
    exact=bool(refset) and refset==set(hashes)
    cached_base=(getjson(casedir/'foundation-final.json') or getjson(casedir/'foundation-verified.json')) if casedir and exact else None
    cached_zones=getjson(casedir/'zones-v4.json') if casedir and exact else None
    cached_conditions=getjson(casedir/'native-conditions-qualified.json') if casedir and exact else None
    incumbent=getjson(casedir/'native-conditions-v3.json') if casedir and exact else None
    images=[];familyvotes=[];landmark_rows=[];start=initial;complete_reads=True;foundation_times=[]
    root_by_id={};score_ranks={};region_covered=set()
    for n,(sha,p) in enumerate(sorted(hashes.items())):
        pid='p-'+sha[:18];root_by_id[pid]=p
        already=getjson(casedir/(sha+'-closed_roles.json')) if casedir else None
        cache=out/(sha+'-closed_roles.json')
        already=already or getjson(cache)
        if already and 'error' in already:already=None
        with Image.open(p) as src:
            if src.width*src.height>50_000_000:raise ValueError("50 MP source limit")
            im=ImageOps.exif_transpose(src);jpeg=pixels(im,1600)
            smallsha=hashlib.sha256(jpeg).hexdigest()
            photoPath=out/'photos'/(smallsha+'.jpg')
            if not photoPath.exists():photoPath.write_bytes(jpeg)
            with Image.open(photoPath) as normalized:pw,ph=normalized.size
            if not already:
                os.environ['RELAY_V4_STAGE']='photo-role'
                try:already=safe_gpu(lambda:classify_closed(im))
                except Exception as e:already={'frame':'unknown','error':type(e).__name__}
                if 'error' not in already:atom(cache,already)
            if not already.get('family'):complete_reads=False
            role=already.get('frame','unknown');text=''
            landmark=getjson(casedir/(sha+'-overview.json')) if casedir else None
            if not landmark:
                landmark=getjson(out/(sha+'-overview.json'))
                if not landmark:
                    os.environ['RELAY_V4_STAGE']='overview-landmarks'
                    try:landmark=safe_gpu(lambda:overview_evidence(im))
                    except Exception:landmark={}
                    if landmark:atom(out/(sha+'-overview.json'),landmark)
            if not landmark.get('pose') or not landmark.get('landmark'):complete_reads=False
            landmark_rows.append({'sha':sha,'role':already,'landmarks':landmark})
            if role=='tag':
                local=getjson(casedir/(sha+'-routed_single.json')) if casedir else None
                local=local or getjson(out/(sha+'-routed_single.json'))
                if not local:
                    try:
                        os.environ['RELAY_V4_STAGE']='tag-transcription'
                        txt,why=safe_gpu(lambda:chat(jpeg,TRANSCRIPT_PROMPT,limit=450))
                        local={'whole':txt,'stop':why};atom(out/(sha+'-routed_single.json'),local)
                    except Exception:local={}
                text=local.get('whole','')
                if not text:complete_reads=False
            hints=getjson(casedir/(sha+'-roles.json'),{}) if casedir else {}
            g=hints.get('garment','unknown')
            if g in ('jacket','pants'):familyvotes.append(g)
            photo={'photoId':pid,'sourceHash':sha,'workingHash':smallsha,'width':pw,'height':ph,'role':role,'roleBasis':'local','garment':g,'metadataChecked':True,'label':text,'attachment':'unresolved','regions':[],'findings':[],'areaChecks':[]}
            if casedir and exact and role=='tag' and args.measured_tags:
                v=getjson(args.measured_tags/(sha+'.json'),{})
                if v.get('status')=='completed' and v.get('sourceHash')==sha and v.get('group')==folder.name:
                    photo['acceptedLabel']=v['text'];photo['acceptedLabelCrop']={'hash':v['cropHash'],'rect':v['region']}
                    maker=getjson(args.measured_tags.parent/'v4-maker-recovery'/(sha+'.json'),{})
                    if maker.get('status')=='completed' and maker.get('sourceHash')==sha and maker.get('group')==group and maker.get('cropHash')==v['cropHash'] and maker.get('text'):
                        photo['verifiedMakerRead']={'text':maker['text'],'cropHash':v['cropHash'],'rect':v['region']}
            fdist=(already.get('family') or {}).get('distribution',{});sdist=(already.get('specific') or {}).get('distribution',{})
            legibility=0 if len(text.strip())<12 or text.strip().lower()=='[illegible]' else min(.8,len(text)/700)
            score_ranks[pid]=fdist.get('tag',0)+.45*legibility if role=='tag' else fdist.get('outer',0)*sdist.get(role,0)
            images.append(photo)
    allids={p['sourceHash']:p for p in images}
    pair_file=out/'view-selection.json'
    stored=getjson(casedir/'shape-review.json') if casedir and exact else None
    if not stored:
        local_pair=getjson(pair_file,{})
        if local_pair.get('version')==VIEW_VERSION and local_pair.get('sourceSet')==sorted(hashes):
            stored=local_pair
    def open_view(sha):
        photo=allids[sha]
        with Image.open(out/'photos'/(photo['workingHash']+'.jpg')) as source:return source.copy()
    os.environ['RELAY_V4_STAGE']='whole-view-selection'
    if stored and stored.get('sourceSet')==sorted(hashes):
        pair=stored['selection'];how=stored.get('trace',{});shape_category=stored.get('category')
    else:
        category=max(set(familyvotes),key=lambda c:(familyvotes.count(c),c)) if familyvotes else None
        pair,how,shape_category=select_views(landmark_rows,open_view,safe_gpu,category)
    if shape_category in ('jacket','pants'):familyvotes.append(shape_category)
    atom(pair_file,{'version':VIEW_VERSION,'selection':pair,'trace':how,'sourceSet':sorted(hashes),'category':shape_category})
    for image in images:
        if image['role'] in ('outer_front','outer_back'):image['role']='outer_zone'
    for view,sha in pair.items():
        allids[sha]['role']='outer_'+view
        score_ranks[allids[sha]['photoId']]=2.
    if cached_base and {s['assigned']:s['source'] for s in cached_base['slots'] if s['assigned'] in ('front','back')}!=pair:cached_base=None
    if cached_base:
        base=cached_base
    else:
        scores=[];assessment='v4-'+folder_id[:25]
        for kind,role in [('front','outer_front'),('back','outer_back'),('label','tag')]:
            pics=[i for i in images if i['role']==role]
            if not pics:continue
            im=max(pics,key=lambda i:(score_ranks[i['photoId']],i['sourceHash']))
            raw=(out/'photos'/(im['workingHash']+'.jpg')).read_bytes()
            try:
                tick=time.monotonic()
                resp=safe_gpu(lambda:http(API+'/v2/photos/score',{'schemaVersion':'2.0','assessmentId':assessment,'photoId':'v4-'+kind,'view':kind,'base64':base64.b64encode(raw).decode(),'consent':{'externalProvider':False}},timeout=75))
                scores.append({'source':im['sourceHash'],'assigned':kind,'photo':resp['photo'],'signed':resp['signed']})
                foundation_times.append({'view':kind,'requestWall_s':round(time.monotonic()-tick,5),'scorerReported_ms':resp['signed']['scores']['usage']['ms']})
            except Exception:complete_reads=False;continue
        decisions={}
        for mode,ans in [('unreported','unknown'),('declared_clear_scenario','no'),('declared_crash_scenario','yes')]:
            ds=[{'id':'v4-'+q,'question':q,'answer':'no' if ans=='yes' and q!='crash' else ans,'recordedAt':args.at} for q in ('crash','protective_damage','protective_repair')]
            try:decisions[mode]=http(API+'/v2/assess',{'schemaVersion':'2.0','assessmentId':assessment,'disclosures':ds,'photos':[s['photo'] for s in scores],'signedScores':[s['signed'] for s in scores],'closeUpsRequested':0})['decision']
            except Exception:decisions[mode]={'outcome':'pending','summary':'Visible-condition service unavailable.','grade':None}
        base={'slots':scores,'decisions':decisions}
    for slot in base.get('slots',[]):
        answer=slot['signed']['scores']['answers'].get('category',{}).get('choice')
        if answer in ('jacket','trousers'):familyvotes.extend([('pants' if answer=='trousers' else answer)]*12)
    garment=max(set(familyvotes),key=lambda k:(familyvotes.count(k),k)) if familyvotes else 'unknown'
    orientations={}
    for photo in images:
        if photo['role'] not in ('inner_overview','inner_zone','pocket'):continue
        sha=photo['sourceHash']
        inside=getjson(casedir/(sha+'-inner-coverage.json')) if casedir and exact else None
        local=out/(sha+'-inner-coverage.json');inside=inside or getjson(local)
        if not inside:
            os.environ['RELAY_V4_STAGE']='interior-coverage'
            try:
                inside=safe_gpu(lambda:inspect_inner(open_view(sha),garment));atom(local,inside)
            except Exception:complete_reads=False;inside={'whole':False,'orientation':None}
        if inside['whole']:photo['role']='inner_overview'
        elif photo['role']=='inner_overview':photo['role']='inner_zone'
        orientations[sha]=inside['orientation']
    if cached_zones is None or cached_conditions is None or incumbent is None:
        computed=[];details=[];observed={}
        for photo,knowledge in zip(images,landmark_rows):
            role=photo['role'];sha=photo['sourceHash']
            if role in ('outer_front','outer_back','inner_overview'):
                with Image.open(root_by_id[photo['photoId']]) as original:
                    im=ImageOps.exif_transpose(original);areas=locate(im,garment,role,orientations.get(sha))
                    computed.extend({'photo':sha,**a} for a in areas)
            support=knowledge['role'].get('family',{}).get('distribution',{}).get('detail',0)
            if role=='defect_detail' or role in ('inner_zone','outer_zone','pocket') and support>=.25:
                details.append((role!='defect_detail',-support,sha,{'photo':sha}))
        def read_region(region):
            nonlocal complete_reads
            k=signature(region)
            if k in observed:return observed[k]
            os.environ['RELAY_V4_STAGE']='native-region-and-context'
            try:
                with Image.open(hashes[region['photo']]) as raw:
                    result=safe_gpu(lambda:observe(ImageOps.exif_transpose(raw),region))
            except Exception:
                complete_reads=False;result={**region,'state':'unresolved','status':'unavailable'}
            observed[k]=result;return result
        planned=plan_regions(computed,[r[3] for r in sorted(details)[:2]])
        # Preserve every input to the pre-expansion condition policy, including an unresolved or
        # region-hash-less response. Supplemental broad coverage never withdraws an earlier finding.
        if incumbent is None:
            before=[];seen_layers=set()
            for photo in sorted(images,key=lambda im:(im['role']!='defect_detail',im['sourceHash'])):
                role=photo['role'];sha=photo['sourceHash'];areas=[z for z in computed if z['photo']==sha]
                target=None
                if role=='defect_detail':target={'photo':sha,'layer':'detail','zone':'unknown','box':[.10,.12,.90,.88],'purpose':'detail'}
                elif areas:
                    area=next((a for a in areas if a['layer'] not in seen_layers),None)
                    if area:target={**area,'purpose':'priority'}
                if target:
                    seen_layers.add(target['layer']);before.append(read_region(target))
            incumbent={'outputs':before}
        first=[read_region(q) for q in planned]
        primary=[{**read_region(q),'purpose':'priority','priorityRead':True} for q in priority_regions(computed)]
        results=qualify(computed,first,primary,read_region)
        cached_zones=cached_zones or {'candidates':computed};cached_conditions=cached_conditions or {'outputs':results}
    for z in cached_zones['candidates']:
        if z['photo'] in allids:allids[z['photo']]['regions'].append({k:z[k] for k in ('zone','layer','box','polygon','status')})
    for z in incumbent['outputs']:
        if z['photo'] in allids:
            allids[z['photo']]['findings'].append({'state':z['state'],'layer':z['layer'],'zone':z['zone'],'box':z['box'],'method':'uncalibrated native crop','regionHash':z.get('regionSHA256')})
    for z in cached_conditions['outputs']:
        if z['photo'] in allids:
            context=z.get('contextRead') or {};other=z.get('corroboration')
            entry={'state':z['state'],'layer':z['layer'],'zone':z['zone'],'box':z['box'],'method':'uncalibrated native crop','regionHash':z.get('regionSHA256'),
                'decisionUse':z.get('decisionUse','observation'),'firstSupport':(z.get('wordMass') or {}).get('distribution',{}).get(z['state']),
                'context':context.get('choice'),'contextSupport':context.get('distribution',{}).get(context.get('choice')),
                'otherSource':other['photo'] if other else None,'otherState':other['state'] if other else None}
            if not entry['regionHash']:entry.pop('regionHash')
            allids[z['photo']]['areaChecks'].append(entry)
            existing=allids[z['photo']]['findings']
            if entry['decisionUse']=='review' and entry['state'] in ('open_damage','hardware_damage','repair_like') and not any(f['box']==entry['box'] and f['state']==entry['state'] for f in existing):existing.append(dict(entry))
    for i in images:
        for f in i['findings']:
            if f.get('regionHash') is None:f.pop('regionHash',None)
    # Presentation placement may abstain; it is never a policy feature.
    try:display_evidence(images,root_by_id,out)
    except Exception as error:
        atom(out/'zone-display.json',{'version':1,'entries':{},'unavailable':type(error).__name__})
    origin_result=getjson(casedir/'missing-origin-v1.json') if casedir and exact else None
    if origin_result is None:
        def one_read(photo,kind):
            nonlocal complete_reads
            path=out/(photo['sourceHash']+'-local-origin-'+kind+'.json')
            prior=getjson(path)
            if prior is not None:return prior['text']
            try:
                os.environ['RELAY_V4_STAGE']='local-origin-'+kind
                fn=alternative_tag if kind=='alternate' else confirm_origin
                text=safe_gpu(lambda:fn(open_view(photo['sourceHash'])));atom(path,{'text':text});return text
            except Exception:complete_reads=False;return ''
        accepted,trace=recover_origins(images,open_view,lambda p:one_read(p,'alternate'),lambda p:one_read(p,'confirmation'))
        origin_result={'accepted':dict(accepted),'tested':trace}
    for sha,phrase in origin_result.get('accepted',{}).items():
        if sha in allids:allids[sha]['localOriginRead']={'text':phrase,'method':'two local explicit made-in reads'}
    dec=base['decisions']['unreported']
    record={'id':group,'category':garment,'at':args.at,'images':images,'history':'unknown','damage':'unknown','repair':'unknown','foundation':dec['outcome'],'foundationReason':dec['summary'],'foundationGrade':dec.get('grade'),'foundationReceipt':hashlib.sha256(json.dumps(base['decisions'],sort_keys=True).encode()).hexdigest(),'custody':None}
    atom(out/'input.json',record);atom(out/'foundation.json',base)
    atom(out/'run.json',{'inputSetHash':folder_id,'sources':len(hashes),'wall_s':round(time.monotonic()-start,3),'identicalSourceInstrumentCache':bool(cached_base),'fullAcquisitionCacheHit':False,'cacheReady':complete_reads and basis_id!='unavailable' and not args.cache and all(b.get('outcome')!='pending' for b in base['decisions'].values()),'acquisitionVersion':config_hash,'foundationTiming':foundation_times,'source':'uploaded group, independent of visual reference'})
    print(group,len(images),'ready',flush=True)

def main():
    p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--cache',type=Path);p.add_argument('--measured-tags',type=Path);p.add_argument('--all',action='store_true');p.add_argument('--at',default=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'))
    a=p.parse_args()
    with gpu_slot(ROOT/'.cache'/'relay-v4-model.lock',a.output/'.gpu-started'):
        for f in sorted(x for x in a.input.iterdir() if x.is_dir()) if a.all else [a.input]:
            if a.all and not any(p.is_file() and p.suffix.lower() in ('.png','.jpg','.jpeg','.webp') for p in f.iterdir()):continue
            run(a,f,False)
if __name__=='__main__':main()
