"""Native smoke on a fresh disposable AVD. Never select a physical device or an existing AVD."""
from pathlib import Path
import os,re,sys,time,subprocess,json,shutil,xml.etree.ElementTree as ET,socket
from PIL import Image
root,apk,out,fixture=map(Path,sys.argv[1:5]);out.mkdir(exist_ok=False)
sdk=root/".tooling/android-sdk";emu=sdk/"emulator/emulator.exe";adb=sdk/"platform-tools/adb.exe"
port=5588;aport=5058;serial="emulator-"+str(port)
def unused(p):
    with socket.socket() as s:s.bind(("127.0.0.1",p))
for p in [port,port+1,aport]:unused(p)
home=(Path(sys.argv[5]) if len(sys.argv)>5 else out)/"android";avds=home/"avd";path=avds/"RelayMarks.avd";path.mkdir(parents=True,exist_ok=True)
template=(root/".tooling/android-user/avd/Relay_Offline_Final.avd/config.ini").read_text()
cfg={}
for line in template.splitlines():
    if "=" in line:
        k,v=line.split("=",1);cfg[k]=v
cfg.update({"AvdId":"RelayMarks","avd.ini.displayname":"RelayMarks","hw.cpu.ncore":"2","hw.ramSize":"1536M","hw.lcd.width":"720","hw.lcd.height":"1280","hw.lcd.density":"260","disk.dataPartition.size":"2048M","hw.gpu.enabled":"yes","hw.gpu.mode":"swiftshader_indirect","fastboot.forceColdBoot":"yes","fastboot.forceFastBoot":"no","PlayStore.enabled":"no"})
(path/"config.ini").write_text("\n".join(k+"="+v for k,v in cfg.items())+"\n",encoding="utf8")
(avds/"RelayMarks.ini").write_text("avd.ini.encoding=UTF-8\npath="+str(path)+"\ntarget=android-36\n",encoding="utf8")
env={**os.environ,"ANDROID_HOME":str(sdk),"ANDROID_SDK_ROOT":str(sdk),"ANDROID_USER_HOME":str(home),"ANDROID_AVD_HOME":str(avds),"ANDROID_ADB_SERVER_PORT":str(aport),"ADB_SERVER_SOCKET":"tcp:127.0.0.1:"+str(aport)}
def run(args,**kw):return subprocess.run(list(map(str,args)),env=env,capture_output=True,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0),timeout=kw.pop("timeout",22),**kw)
def device(*a,timeout=22):return run([adb,"-P",aport,"-s",serial,*a],timeout=timeout)
def shell(*a):return device("shell",*a).stdout.decode("utf8","replace").strip()
def tree():
    res=device("shell","uiautomator","dump","/sdcard/relay-state.xml")
    xml=device("shell","cat","/sdcard/relay-state.xml").stdout
    if b"<hierarchy" not in xml:return []
    (out/"last-ui.xml").write_bytes(xml)
    return list(ET.fromstring(xml).iter("node"))
def find(pattern,tries=8,scroll=False):
    rx=re.compile(pattern,re.I)
    for i in range(tries):
        for n in tree():
            if any(rx.search(n.get(attr,"")) for attr in ["text","content-desc","resource-id"]):
                vals=list(map(int,re.findall(r"\d+",n.get("bounds",""))))
                if len(vals)==4 and vals[2]>vals[0] and vals[3]>vals[1]:return vals
        if scroll: shell("input","swipe","350","800" if i%8<4 else "360","350","360" if i%8<4 else "800","280")
        time.sleep(.4)
    raise RuntimeError("Native control unavailable: "+pattern)
def click(pattern,**kw):
    x,y,r,b=find(pattern,**kw);shell("input","tap",str((x+r)//2),str((y+b)//2));time.sleep(.3)
def snap(name): (out/(name+".png")).write_bytes(device("exec-out","screencap","-p").stdout)
proc=None;log=(out/"emulator.log").open("wb");evidence={"apkSHA256":__import__("hashlib").sha256(apk.read_bytes()).hexdigest()}
try:
    run([adb,"-P",aport,"start-server"],check=True)
    proc=subprocess.Popen([str(emu),"-avd","RelayMarks","-port",str(port),"-no-snapshot","-no-window","-no-audio","-no-boot-anim","-gpu","swiftshader_indirect","-memory","1536"],env=env,stdout=log,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,"CREATE_NO_WINDOW",0))
    start=time.monotonic()
    while time.monotonic()-start<150:
        if proc.poll() is not None:raise RuntimeError("Dedicated emulator exited")
        if shell("getprop","sys.boot_completed")=="1":break
        time.sleep(2)
    else:raise TimeoutError("Dedicated emulator did not boot")
    assert shell("getprop","ro.kernel.qemu")=="1"
    device("install","-r",apk,timeout=120,).check_returncode()
    shell("input","keyevent","82")
    shell("mkdir","-p","/sdcard/Pictures");device("push",fixture,"/sdcard/Pictures/relay-large.jpg").check_returncode()
    provider="content://media/external_primary/images/media"
    shell("am","broadcast","-a","android.intent.action.MEDIA_SCANNER_SCAN_FILE","-d","file:///storage/emulated/0/Pictures/relay-large.jpg")
    details=[]
    record=shell("content","insert","--uri",provider,"--bind","_display_name:s:relay-inspection-3200.jpg","--bind","mime_type:s:image/jpeg","--bind","relative_path:s:Pictures/Relay/","--bind","is_pending:i:1")
    details.append(("insert",record))
    query=shell("content","query","--uri",provider,"--projection","_id:_display_name:is_pending")
    details.append(("pending",query))
    match=next((re.search(r"_id=(\\d+)",line) for line in reversed(query.splitlines()) if "relay-inspection-3200.jpg" in line),None)
    if match:
        get=provider+"/"+match[1]
        wr=run([adb,"-P",aport,"-s",serial,"shell","-T","content","write","--uri",get],input=fixture.read_bytes())
        wr.check_returncode()
        details.append(("publish",shell("content","update","--uri",get,"--bind","is_pending:i:0")))
    else:
        details.append(("forcedscan",shell("content","call","--uri","content://media","--method","scan_file","--arg","/storage/emulated/0/Pictures/relay-large.jpg")))
    details.append(("visible",shell("content","query","--uri",provider,"--projection","_id:_display_name:width:height:is_pending")))
    (out/"media-setup.json").write_text(json.dumps(details,indent=2))

    shell("am","start","-n","ca.relaygearlab.experimental/.MainActivity")
    click("Start a gear check|Continue your gear check",tries=15)
    click("Choose a photograph",scroll=True)
    time.sleep(1)
    nodes=tree()
    if any(n.get("text","")=="Allow" for n in nodes):click("^Allow$")
    # The system photo picker exposes its photo tile with a date/content description or thumbnail ID.
    click(r"icon_thumbnail|Photo taken|photo_thumbnail|^Photo,|^Photo [0-9]|Image taken|media_item|thumbnail|^Photo$",tries=10)
    click("Mark an area for inspection",tries=11,scroll=True)
    for attempt in range(14):
        x,y,right,bottom=find("Locate the mark on the photograph",tries=8,scroll=True)
        if bottom-y >= 350:
            shell("input","tap",str((x+right)//2),str((y+bottom)//2));time.sleep(.5);break
        # The fixed action footer starts around y=927. Do not start a scroll in that footer.
        if bottom>900: shell("input","swipe","355","805","355","585","450")
        else: shell("input","swipe","355","446","355","665","450")
    else:raise RuntimeError("Cannot bring whole mark surface into the scroll viewport")
    evidence["directTapBounds"]=[x,y,right,bottom]
    snap("native-touch-position")
    click("^Medium$",scroll=True)
    find("324 source pixels",tries=4,scroll=True);snap("native-mark-source")
    click("Save marked area",scroll=True);find("Adjust marked area",tries=6,scroll=True)
    snap("native-saved-mark");evidence.update(success=True,sourcePixels=324,fixtureWidth=3200)
except Exception as e:
    evidence.update(success=False,error=str(e))
    try:snap("failure");tree()
    except Exception:pass
finally:
    if proc is not None:
        device("emu","kill")
        try:proc.wait(timeout=10)
        except subprocess.TimeoutExpired:proc.kill()
    run([adb,"-P",aport,"kill-server"]);log.close()
    (out/"native-gesture.json").write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf8");print(evidence)
if not evidence.get("success"):sys.exit(1)
