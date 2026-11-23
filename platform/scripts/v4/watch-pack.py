"""Monitor only the cited clauses on three pinned public sources. This command never changes active Relay rules."""
import argparse,datetime,hashlib,html,json,os,re,ssl,time
import urllib.error,urllib.parse,urllib.request,urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];DEFAULT=Path(os.environ.get('RELAY_REFERENCE_DIR',ROOT/'reference-packs'))
UA='Relay-Fact-Monitor/0.1'
SOURCES={
 'ca-leather':{'url':'https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/02/ch42-eng.html','publisher':'Canada Border Services Agency','jurisdiction':'CA','weight':'customs tariff','anchor':'Tariff item 4203.10.00 including MFN and preferential-treatment columns','fact':'leather-apparel-duty','freshDays':30,'cadence':'weekly and on new tariff editions'},
 'knox-purchase':{'url':'https://www.planet-knox.com/maintain-motorcycle-body-armour-upgrades/','publisher':'Knox','jurisdiction':'maker-specific','weight':'manufacturer statement','anchor':'Purchase-clock sentence in the impact-protector user instructions','fact':'knox-purchase','freshDays':90,'cadence':'monthly'},
 'usps-ca':{'url':'https://pe.usps.com/text/dmm300/Notice123.htm','publisher':'US Postal Service','jurisdiction':'US','weight':'published retail rate','anchor':'Priority Mail International retail parcels, Canada price group 1, first twelve weight bands','fact':'US-to-CA-retail-postage','freshDays':30,'cadence':'weekly and announced price changes'}
}
def plain(t):return re.sub(r'\s+',' ',html.unescape(t)).strip()
def sha(text):return hashlib.sha256(text.encode('utf-8')).hexdigest()
class Doc(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True);self.tables=[];self.table=None;self.row=None;self.cell=None;self.text=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        if tag=='table' and self.table is None:self.table={'before':plain(' '.join(self.text[-120:]))[-1600:],'rows':[]}
        if tag=='tr' and self.table is not None:self.row=[]
        if tag in ('td','th') and self.row is not None:self.cell=[]
    def handle_endtag(self,tag):
        if tag in ('script','style') and self.skip:self.skip-=1
        if tag in ('td','th') and self.cell is not None:
            self.row.append(plain(' '.join(self.cell)));self.cell=None
        if tag=='tr' and self.row is not None:
            self.table['rows'].append(self.row);self.row=None
        if tag=='table' and self.table is not None:self.tables.append(self.table);self.table=None
    def handle_data(self,data):
        v=plain(data)
        if self.skip or not v:return
        self.text.append(v)
        if self.cell is not None:self.cell.append(v)

def cited(key,raw):
    doc=Doc();doc.feed(raw)
    if key=='ca-leather':
        rows=[r for t in doc.tables for r in t['rows'] if r and r[0]=='4203.10.00']
        general=[r for r in rows if len(r)>4 and not r[1]]
        if len(general)!=1:raise ValueError('general tariff row missing or ambiguous')
        row=general[0];duty=next((v for v in row if re.fullmatch(r'\d+(?:\.\d+)?%',v)),None)
        if not duty:raise ValueError('MFN column missing')
        return '\n'.join(plain(' | '.join(r)) for r in rows),{'tariffItem':row[0],'mfn':duty,'statisticalSubrows':len(rows)-1}
    if key=='knox-purchase':
        body=plain(' '.join(doc.text));match=re.findall(r'[^.!?]{0,90}\b(?:use|replace)\b[^.!?]{0,75}\b(?:years?|months?)\b[^.!?]{0,35}\bdate of purchase\b[^.!?]{0,10}[.!?]',body,re.I)
        if len(match)!=1:raise ValueError('purchase-clock clause missing or ambiguous')
        words=plain(match[0]);period=re.search(r'\b(\d+)\s+(years?|months?)\b',words,re.I)
        if not period:raise ValueError('service interval unavailable')
        return words,{'interval':int(period[1]),'unit':period[2].lower(),'from':'date of purchase'}
    tables=[]
    for i,t in enumerate(doc.tables):
        heads=plain(' '.join(' '.join(r) for r in t['rows'][:4]))
        if 'Weight Not Over' not in heads or 'Canada' not in heads or not i:continue
        prev=doc.tables[i-1];section=prev['before'];retail=re.search(r'Priority Mail International.{0,60}Retail.{0,30}Large Envelopes.{0,12}Parcels',section,re.I)
        if not retail:continue
        values=[]
        for r in t['rows']:
            if len(r)>1 and r[0].isdigit() and 1<=int(r[0])<=12:
                money=re.fullmatch(r'\$?([\d,.]+)',r[1])
                if not money:raise ValueError('Canada retail rate unavailable')
                values.append([int(r[0]),round(float(money[1].replace(',',''))*100)])
        if len(values)==12:tables.append(values)
    if len(tables)!=1:raise ValueError('retail Canada table missing or ambiguous')
    return json.dumps(tables[0],separators=(',',':')),{'currency':'USD','canadaRetailCentsByPound':tables[0]}

class Pinned(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        old=urllib.parse.urlsplit(req.full_url);new=urllib.parse.urlsplit(newurl)
        if new.scheme!='https' or old.hostname!=new.hostname:raise ValueError('official host changed')
        return super().redirect_request(req,fp,code,msg,headers,newurl)
client=urllib.request.build_opener(Pinned(),urllib.request.HTTPSHandler(context=ssl.create_default_context()))
def fetch(url,headers=None,limit=4000000):
    req=urllib.request.Request(url,headers={'User-Agent':UA,**(headers or {})})
    with client.open(req,timeout=12) as res:
        byte=res.read(limit+1)
        if len(byte)>limit:raise ValueError('source size limit')
        charset=res.headers.get_content_charset() or 'utf-8'
        return byte.decode(charset,errors='replace'),res.headers
def robots(url):
    u=urllib.parse.urlsplit(url);rurl=u.scheme+'://'+u.netloc+'/robots.txt'
    rp=urllib.robotparser.RobotFileParser(rurl)
    try:raw,_=fetch(rurl,limit=550000);rp.parse(raw.splitlines())
    except urllib.error.HTTPError as e:
        if e.code in (404,410):return True
        return False
    return rp.can_fetch(UA,url)
def write(path,data):
    tmp=path.with_name(path.name+'.tmp');tmp.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8');tmp.replace(path)
def run():
    p=argparse.ArgumentParser();p.add_argument('--initialize',action='store_true');p.add_argument('--output',type=Path,default=DEFAULT);args=p.parse_args()
    out=args.output;out.mkdir(parents=True,exist_ok=True);base=out/'baseline.json'
    if args.initialize and base.exists():raise ValueError('Baseline exists. Changes require review.')
    old=json.loads(base.read_text(encoding='utf-8')) if base.exists() else {}
    if not args.initialize and not old:raise ValueError('Initialize a reviewed baseline once.')
    now=datetime.datetime.now(datetime.timezone.utc);results={};new={}
    for key,src in SOURCES.items():
        result={'source':src,'checked':now.isoformat(),'activeRulesChanged':False};prior=old.get(key,{})
        try:
            if not robots(src['url']):raise ValueError('robots policy prevents this fetch')
            h={}
            if prior.get('etag'):h['If-None-Match']=prior['etag']
            if prior.get('modified'):h['If-Modified-Since']=prior['modified']
            try:raw,meta=fetch(src['url'],h)
            except urllib.error.HTTPError as e:
                if e.code==304 and prior.get('anchorSha'):
                    result.update({'status':'unchanged_304','anchorSha':prior['anchorSha'],'values':prior['values']});results[key]=result;continue
                raise
            anchor,values=cited(key,raw);digest=sha(anchor)
            status='captured_for_review' if not prior else 'unchanged' if prior.get('anchorSha')==digest else 'anchor_changed_review_required'
            result.update({'status':status,'wholeDocumentSha':sha(raw),'anchorSha':digest,'values':values})
            new[key]={'source':src,'anchorSha':digest,'wholeDocumentSha':sha(raw),'values':values,'etag':meta.get('ETag'),'modified':meta.get('Last-Modified'),'checked':now.isoformat(),'freshUntil':(now+datetime.timedelta(days=src['freshDays'])).isoformat()}
        except Exception as e:result.update({'status':'unverified','reason':str(e)[:160]})
        results[key]=result
    if args.initialize and len(new)==len(SOURCES):write(base,new)
    write(out/('initial-run.json' if args.initialize else 'latest-run.json'),results)
    for k,r in results.items():print(k,r['status'],r.get('values',r.get('reason')))
    if any(r['status']=='unverified' for r in results.values()):return 2
    return 0
if __name__=='__main__':raise SystemExit(run())
