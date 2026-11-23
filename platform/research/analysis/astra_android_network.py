"""Verify the shipped APK against the actual private Relay 3.5 service over an isolated ADB reverse connection."""
import sys,os,subprocess,time,socket,tempfile,json,re,hashlib,shutil,xml.etree.ElementTree as ET
from pathlib import Path
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
import urllib.request,urllib.error,sqlite3
root,apk,out=map(lambda a:Path(a).resolve(),sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
assert not (out/'verification.json').exists(), 'Choose fresh native evidence output'
mode=sys.argv[4] if len(sys.argv)>4 else 'pair'
assert mode in ['pair','several']
front='datasets/gear-v2-openverse/images/ov-066.jpg' if mode=='pair' else 'datasets/realworld-v3/images/ox-083.jpg'
observed=[]
class Transport(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def handle_upstream(self):
  try:
   assert self.path in ['/v2/health','/v2/photos/score','/v2/assess','/health']
   length=int(self.headers.get('Content-Length','0')); assert 0<=length<=8_000_000
   data=self.rfile.read(length) if length else None
   req=urllib.request.Request('http://127.0.0.1:8788'+self.path,data=data,method=self.command,headers={'Content-Type':'application/json'})
   try:response=urllib.request.urlopen(req,timeout=95)
   except urllib.error.HTTPError as e:response=e
   with response as r: code=r.status; result=r.read()
   if code==200 and data:
    q=json.loads(data); a=json.loads(result); count=q.get('countCheck'); record={'route':self.path,'view':q.get('view'),'countAttachment':bool(count),'decision':a.get('decision',{}).get('outcome'),'signedCount':bool(a.get('countReceipt'))}
    if self.path.endswith('/score'):
     heads=a['signed']['scores']['answers'];record.update(countProbability=heads.get('single_item',{}).get('p'),category=heads.get('category',{}).get('choice'),normalizedSha=a['photo']['sha256'])
    observed.append(record)
   self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(result)));self.end_headers();self.wfile.write(result)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_POST(self):self.handle_upstream()
 def do_GET(self):self.handle_upstream()
proxy=ThreadingHTTPServer(('127.0.0.1',0),Transport);Thread(target=proxy.serve_forever,daemon=True).start()
ledger=root/'data/relay-r2-local-budget.sqlite'
def metered():
 with sqlite3.connect('file:'+str(ledger).replace('\\\\','/')+'?mode=ro',uri=True) as db:return db.execute('SELECT COUNT(*) FROM count_attempt').fetchone()[0]
starting=metered()
work=Path(tempfile.mkdtemp(prefix='relay-v35-native-')).resolve()
sdk=root/'.tooling/android-sdk';adb=sdk/'platform-tools/adb.exe';emu=sdk/'emulator/emulator.exe'
def available(port):
 try:
  with socket.socket() as s:s.bind(('127.0.0.1',port))
  return True
 except OSError:return False
port=next(p for p in range(5584,5622,2) if available(p) and available(p+1))
with socket.socket() as s:s.bind(('127.0.0.1',0));aport=s.getsockname()[1]
serial=f'emulator-{port}';home=work/'home';avds=home/'avd';avd=avds/'RelayV35.avd';avd.mkdir(parents=True)
cfg=dict(l.split('=',1) for l in (root/'.tooling/android-user/avd/Relay_Offline_Final.avd/config.ini').read_text().splitlines() if '=' in l)
cfg.update({'AvdId':'RelayV35','avd.ini.displayname':'RelayV35','hw.cpu.ncore':'2','hw.ramSize':'1536M','hw.lcd.width':'720','hw.lcd.height':'1280','hw.lcd.density':'260','disk.dataPartition.size':'2048M','hw.gpu.enabled':'yes','hw.gpu.mode':'swiftshader_indirect','fastboot.forceColdBoot':'yes','fastboot.forceFastBoot':'no','PlayStore.enabled':'no'})
(avd/'config.ini').write_text('\n'.join(k+'='+v for k,v in cfg.items())+'\n');(avds/'RelayV35.ini').write_text('avd.ini.encoding=UTF-8\npath='+str(avd)+'\ntarget=android-36\n')
env={**os.environ,'ANDROID_HOME':str(sdk),'ANDROID_SDK_ROOT':str(sdk),'ANDROID_USER_HOME':str(home),'ANDROID_AVD_HOME':str(avds),'ANDROID_ADB_SERVER_PORT':str(aport),'ADB_SERVER_SOCKET':'tcp:127.0.0.1:'+str(aport)}
def run(args,timeout=20,**kwargs):return subprocess.run(list(map(str,args)),env=env,capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW,timeout=timeout,**kwargs)
def device(*args,**kw):return run([adb,'-P',aport,'-s',serial,*args],**kw)
def shell(*a):return device('shell',*a).stdout.decode('utf8','replace').strip()
def snap(name):(out/(name+'.png')).write_bytes(device('exec-out','screencap','-p').stdout)
def tree():
 shell('uiautomator','dump','/sdcard/relay-v35-ui.xml');raw=device('shell','cat','/sdcard/relay-v35-ui.xml').stdout
 if b'<hierarchy' not in raw:return []
 (out/'last-ui.xml').write_bytes(raw);return list(ET.fromstring(raw).iter('node'))
def names(n):return [n.get(a,'') for a in ['text','content-desc','resource-id']]
def locate(pattern,tries=8,scroll=False):
 rx=re.compile(pattern,re.I)
 for i in range(tries):
  for n in tree():
   if any(rx.search(x) for x in names(n)):
    pts=list(map(int,re.findall(r'\d+',n.get('bounds',''))))
    if len(pts)==4 and pts[2]>pts[0] and pts[3]>pts[1]:return pts
  if scroll:shell('input','swipe','320','815' if i%6<3 else '385','320','385' if i%6<3 else '815','270')
  time.sleep(.25)
 raise RuntimeError('Native control unavailable: '+pattern)
def click(pattern,**kw):
 x,y,b,t=locate(pattern,**kw);shell('input','tap',str((x+b)//2),str((y+t)//2));time.sleep(.25)
proc=None;log=(work/'emulator.log').open('wb')
evidence={'apkSha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'serial':serial,'steps':[]}
try:
 run([adb,'-P',aport,'start-server'],check=True)
 proc=subprocess.Popen([str(emu),'-avd','RelayV35','-port',str(port),'-no-snapshot','-no-window','-no-audio','-no-boot-anim','-gpu','swiftshader_indirect','-memory','1536'],env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
 start=time.monotonic()
 while time.monotonic()-start<170:
  if proc.poll() is not None:raise RuntimeError('Dedicated emulator exited')
  if shell('getprop','sys.boot_completed')=='1':break
  time.sleep(1)
 else:raise RuntimeError('Emulator boot timed out')
 assert shell('getprop','ro.kernel.qemu')=='1'
 evidence.update(androidAPI=shell('getprop','ro.build.version.sdk'),abi=shell('getprop','ro.product.cpu.abi'))
 device('install','-r',apk,timeout=150).check_returncode();evidence['steps'].append('Installed final APK.')
 pkg=shell('dumpsys','package','ca.relaygearlab.experimental');assert 'versionName=3.5.0' in pkg and 'versionCode=3 ' in pkg
 shell('input','keyevent','82');device('reverse','tcp:8788','tcp:'+str(proxy.server_port)).check_returncode()
 shell('mkdir','-p','/sdcard/Pictures')
 shell('am','start','-n','ca.relaygearlab.experimental/.MainActivity')
 click('Connection and privacy settings',tries=15)
 click('Save and check connection',tries=12,scroll=True)
 locate('processed by the Relay assessment service under the terms you accepted',tries=12,scroll=True)
 snap('connected');evidence['steps'].append('API 36 APK connected over TCP to the actual stock 4B and displayed its active processing notice.')
 click('Go back',tries=12,scroll=True);click('Start a gear check')
 click('Add item history',tries=12,scroll=True)
 for q in [r'Has it been worn in a crash\?.*No',r'Any damage in a protective area\?.*No',r'Any repairs in a protective area\?.*No']:click(q,tries=12,scroll=True)
 click('Continue to photos',tries=12,scroll=True)
 for i,(view,source) in enumerate([('Front',front),('Back','datasets/realworld-v3/images/cm-107.jpg'),('Label','assets/fixtures/backpack-label.jpg')]):
  name='relay-activation-'+str(i)+'.jpg';img='/sdcard/Pictures/'+name
  device('push',root/source,img).check_returncode()
  shell('touch',img);shell('am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///storage/emulated/0/Pictures/'+name)
  shell('content','call','--uri','content://media','--method','scan_file','--arg','/storage/emulated/0/Pictures/'+name)
  click(r'^'+view+' photo (needed|captured)$',tries=12,scroll=True);click('Choose a photograph',tries=12,scroll=True)
  time.sleep(1)
  if any(n.get('text')=='Allow' for n in tree()):click('^Allow$')
  click(r'icon_thumbnail|Photo taken|photo_thumbnail|^Photo,|^Photo [0-9]|Image taken|media_item|thumbnail|^Photo$',tries=12)
  locate(view+' photo captured',tries=12,scroll=True)
  evidence['steps'].append('Imported '+view.lower()+' via the Android photo picker.')
 click('Allow these photos to be processed by the selected Relay service',tries=15,scroll=True)
 click('Review the evidence',tries=15,scroll=True)
 result=locate(r'^Offer recommended$|^One more photo|^A different photo|^Specialist review|^Not eligible for an offer|^Retake',tries=16,scroll=True)
 snap('native-result')
 texts=[a for n in tree() for a in names(n) if a]
 evidence['visibleResult']=[t for t in texts if re.search(r'Offer recommended|One more photo|A different photo|Specialist review|Not eligible for an offer|Retake',t,re.I)][:5]
 evidence['steps'].append('Completed native camera-roll intake against the active server. The native photo transform can differ from the Node fixture harness.')
 evidence['transport']=observed;evidence['newPaidAttempts']=metered()-starting
 if mode=='several':
  assert any(r['countAttachment'] for r in observed) and evidence['newPaidAttempts']==1 and any(r['decision']=='retake' for r in observed)
 evidence['passed']=True
finally:
 proxy.shutdown();proxy.server_close();evidence['transport']=observed;evidence['newPaidAttempts']=metered()-starting
 if proc:
  if proc.poll() is None:
   try:device('emu','kill',timeout=6)
   except (OSError,subprocess.TimeoutExpired):pass
   try:proc.wait(timeout=12)
   except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=10)
 try:run([adb,'-P',aport,'kill-server'],timeout=8)
 except (OSError,subprocess.TimeoutExpired):pass
 log.close();(out/'verification.json').write_text(json.dumps(evidence,indent=2)+'\n')
 if not evidence.get('passed'):
  (out/'emulator-diagnostic.txt').write_text((work/'emulator.log').read_text(errors='replace')[-9000:])
 assert work.parent==Path(tempfile.gettempdir()).resolve() and work.name.startswith('relay-v35-native-')
 try:shutil.rmtree(work)
 except PermissionError:pass
print(json.dumps(evidence))