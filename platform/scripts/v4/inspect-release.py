"""Verify artifacts and record their exact hashes; Windows cannot sign or launch an iOS app."""
import argparse,hashlib,json,os,re,subprocess,zipfile
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as src:
        for chunk in iter(lambda:src.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()
def main():
    cmd=argparse.ArgumentParser();cmd.add_argument('apk',type=Path);args=cmd.parse_args();apk=args.apk.resolve()
    out=ROOT/'artifacts/relay-v4-event'
    if apk.parent!=out or not apk.is_file():raise ValueError('Choose the actual event APK artifact.')
    with zipfile.ZipFile(apk) as z:
        names=z.namelist()
        assert z.testzip() is None and 'assets/index.android.bundle' in names
        forbidden=[s for s in names if s.lower().endswith(('.gguf','.onnx','.tflite','.safetensors')) or 'libllama' in s.lower() or 'libggml' in s.lower()]
        if forbidden:raise ValueError('Unexpected handset model weights or model runtime')
    tools=ROOT/'.tooling/android-sdk/build-tools/36.0.0';env={**os.environ,'JAVA_HOME':str(ROOT/'.tooling/jdk/jdk-21.0.12.1+1')};
    aapt=subprocess.check_output([str(tools/'aapt.exe'),'dump','badging',str(apk)],encoding='utf-8',errors='replace',env=env)
    pkg=re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",aapt)
    assert pkg and pkg[1]=='ca.relaygearlab.fielddesk' and pkg[3]=='4.0.0'
    assert 'android.permission.INTERNET' in aapt and 'arm64-v8a' in aapt and 'x86_64' in aapt
    jar=tools/'lib/apksigner.jar';java=Path(env['JAVA_HOME'])/'bin/java.exe'
    sig=subprocess.check_output([str(java),'-jar',str(jar),'verify','--verbose','--print-certs',str(apk)],encoding='utf-8',errors='replace')
    cert=re.search(r'certificate SHA-256 digest:\s*([a-fA-F0-9]+)',sig);assert cert and 'Verified using v2 scheme (APK Signature Scheme v2): true' in sig
    ios=out/'ios-export';meta=json.loads((ios/'metadata.json').read_text(encoding='utf-8'))['fileMetadata']['ios'];hbc=ios/meta['bundle'];assert hbc.is_file() and hbc.stat().st_size>100000
    assets=[ios/str(r['path']).replace('\\','/') for r in meta['assets']];assert all(a.is_file() for a in assets)
    sourceKit=out/'Relay-Field-Desk-iOS-Source.zip'
    with zipfile.ZipFile(sourceKit) as kit:assert kit.testzip() is None and 'BUILD.md' in kit.namelist() and 'package-lock.json' in kit.namelist()
    sourceDirs=['app/src/v4','packages/core/v4','packages/vision/v4','server/v4','scripts/v4']
    sources=[f for d in sourceDirs for f in (ROOT/d).rglob('*') if f.is_file() and f.suffix in ('.ts','.tsx','.mjs','.py','.ps1','.mts')]
    sources.extend(ROOT/p for p in ('app/App.tsx','app/app.config.js','app/metro.config.js'))
    composite=hashlib.sha256()
    for f in sorted(sources):composite.update((f.relative_to(ROOT).as_posix()+' '+digest(f)+'\n').encode())
    report={'builtFor':'Relay event API client, local exhibition release','verifiedAt':datetime.now(timezone.utc).isoformat(),'sourceTreeSha256':composite.hexdigest(),'sourceFiles':len(sources),
        'android':{'file':apk.name,'bytes':apk.stat().st_size,'sha256':digest(apk),'applicationId':pkg[1],'versionCode':pkg[2],'versionName':pkg[3],'abis':['arm64-v8a','x86_64'],'networkPermission':True,'bundledVisionWeightsOrLlamaRuntime':False,'apkSignatureV2Verified':True,'certificateSha256':cert[1].lower(),'signing':'Local Android demonstration signing; not a Play Store submission.'},
        'ios':{'bundle':hbc.relative_to(out).as_posix(),'bytes':hbc.stat().st_size,'sha256':digest(hbc),'assetCount':len(assets),'macSourceKit':sourceKit.name,'macSourceKitSha256':digest(sourceKit),'sourceKitBytes':sourceKit.stat().st_size,'delivery':'Expo iOS Hermes bundle and assets; no signed IPA, simulator or physical iPhone test on this Windows host.'},
        'operatorGuide':'../README.md'}
    (out/'release.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'sdk':pkg[1],'apkBytes':apk.stat().st_size,'apkSha256':report['android']['sha256'],'iOSBundleBytes':hbc.stat().st_size,'certificate':bool(cert),'onDeviceModels':False}))
if __name__=='__main__':main()
