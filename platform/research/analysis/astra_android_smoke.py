"""Verify the shipped APK on a fresh, disposable Android 36 AVD, without contacting a provider."""
import sys,os,subprocess,time,socket,tempfile,json,re,hashlib,shutil,xml.etree.ElementTree as ET
from pathlib import Path
root,apk,out=map(lambda a:Path(a).resolve(),sys.argv[1:4]);out.mkdir(parents=True,exist_ok=True)
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
 shell('input','keyevent','82');shell('cmd','connectivity','airplane-mode','enable')
 shell('mkdir','-p','/sdcard/Pictures')
 image='/sdcard/Pictures/relay-v35-front.jpg';device('push',root/'assets/fixtures/leather-jacket.jpg',image).check_returncode()
 shell('am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file:///storage/emulated/0/Pictures/relay-v35-front.jpg')
 shell('content','call','--uri','content://media','--method','scan_file','--arg','/storage/emulated/0/Pictures/relay-v35-front.jpg')
 shell('am','start','-n','ca.relaygearlab.experimental/.MainActivity')
 locate('Start a gear check',tries=15);snap('home');click('Start a gear check')
 click('Choose a photograph',tries=10,scroll=True)
 time.sleep(.8)
 if any(n.get('text')=='Allow' for n in tree()):click('^Allow$')
 click(r'icon_thumbnail|Photo taken|photo_thumbnail|^Photo,|^Photo [0-9]|Image taken|media_item|thumbnail|^Photo$',tries=10)
 locate('Front photo captured',tries=12,scroll=True);snap('captured-front');evidence['steps'].append('Imported licensed photo using Android system photo picker.')
 for _ in range(3):
  assert not any(re.search('mark an area for inspection|adjust marked area|save marked area',text,re.I) for n in tree() for text in names(n))
  shell('input','swipe','325','824','325','410','250')
 evidence['steps'].append('No rider selection control in the populated overview.')
 click('Add item history',tries=12,scroll=True)
 click(r'Has it been worn in a crash\?.*Yes',tries=8,scroll=True)
 click(r'Any damage in a protective area\?.*No',tries=8,scroll=True)
 click(r'Any repairs in a protective area\?.*No',tries=8,scroll=True)
 click('See the next step',tries=9,scroll=True);locate('Not eligible for an offer',tries=8,scroll=True)
 snap('reported-crash');evidence['steps'].append('Reported crash returned no offer with the emulator offline.')
 evidence['passed']=True
finally:
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