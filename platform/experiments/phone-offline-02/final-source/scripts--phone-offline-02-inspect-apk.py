import json, zipfile, hashlib, struct, subprocess, os, pathlib, sys, argparse
root=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(); parser.add_argument('apk',nargs='?',default=str(root/'app/android/app/build/outputs/apk/release/app-release.apk')); parser.add_argument('--diagnostic',action='store_true'); args=parser.parse_args(); apk=pathlib.Path(args.apk)
out=root/('benchmarks/phone-offline-02/apk-inspection-diagnostic.json' if args.diagnostic else 'benchmarks/phone-offline-02/apk-inspection.json')
manifest=json.loads((root/'app/assets/offline/manifest.json').read_text())
def digest(stream):
 h=hashlib.sha256()
 while chunk:=stream.read(4*1024*1024): h.update(chunk)
 return h.hexdigest()
with apk.open('rb') as f: sha=digest(f)
report={'diagnosticOnly':args.diagnostic,'apk':str(apk),'bytes':apk.stat().st_size,'sha256':sha,'models':[],'nativeLibraries':[]}
with zipfile.ZipFile(apk) as z:
 names=z.namelist()
 bundled_manifest=json.loads(z.read('assets/relay-models/manifest.json'))
 assert bundled_manifest==manifest, 'Bundled manifest differs from the selected source profile'
 report['profile']=bundled_manifest['profile']
 for key,name in [('model','vision.gguf'),('projector','projector.gguf')]:
  entry=z.getinfo('assets/relay-models/'+name)
  with z.open(entry) as f: actual=digest(f)
  assert entry.file_size==manifest[key]['bytes'] and actual==manifest[key]['sha256'], 'Bundled model integrity failed'
  report['models'].append({'name':name,'bytes':entry.file_size,'sha256':actual,'compressedBytes':entry.compress_size})
 for name in names:
  if not name.startswith('lib/') or not name.endswith('.so'):continue
  with z.open(name) as f:
   header=f.read(64);assert header[:5]==b'\x7fELF\x02' and header[5]==1
   offset=struct.unpack_from('<Q',header,32)[0];size,count=struct.unpack_from('<HH',header,54)
   f.seek(offset);ph=f.read(size*count)
   align=[struct.unpack_from('<Q',ph,i*size+48)[0] for i in range(count) if struct.unpack_from('<I',ph,i*size)[0]==1]
   assert align and min(align)>=16384, 'Native ELF not 16 KB aligned: '+name
   report['nativeLibraries'].append({'name':name,'minLoadAlignment':min(align)})
 assert any(n.startswith('lib/arm64-v8a/') and 'rnllama' in n for n in names)
 assert any(n.startswith('lib/x86_64/') and 'rnllama' in n for n in names)
 assert not any('fixtures/' in n or 'sample-01' in n or 'round-05' in n for n in names)
 assert 'assets/index.android.bundle' in names
 if not args.diagnostic: assert b'Relay diagnostic raw output' not in z.read('assets/index.android.bundle'), 'Do not deliver a diagnostic build'
 report['nativeLibraries'] = [{**entry,'sha256':hashlib.sha256(z.read(entry['name'])).hexdigest()} for entry in report['nativeLibraries']]
 assert 'assets/relay-models/LICENSE.txt' in names
 manifestText=(root/'app/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml').read_text()
 assert 'android.permission.INTERNET' not in manifestText
 assert 'android:allowBackup="false"' in manifestText
 assert 'android:usesCleartextTraffic="false"' in manifestText
 report['mergedManifestHasInternetPermission']=False
 sdk=root/'.tooling/android-sdk/build-tools/36.0.0'
 badging=subprocess.check_output([str(sdk/'aapt.exe'),'dump','badging',str(apk)],text=True,encoding='utf-8',errors='replace')
 permissions=subprocess.check_output([str(sdk/'aapt.exe'),'dump','permissions',str(apk)],text=True,encoding='utf-8',errors='replace')
 assert 'android.permission.INTERNET' not in permissions
 assert "versionName='0.2.0'" in badging and "versionCode='2'" in badging
 report['badging']=[l for l in badging.splitlines() if l.startswith(('package:','sdkVersion:','targetSdkVersion:','native-code:'))]
 report['permissions']=permissions.splitlines()
 env={**os.environ,'JAVA_HOME':str(root/'.tooling/jdk/jdk-21.0.12.1+1')}
 certs=[]
 for path in [apk,root/'artifacts/relay-round04-android.apk']:
  result=subprocess.run([str(sdk/'apksigner.bat'),'verify','--print-certs',str(path)],env=env,text=True,capture_output=True,check=True)
  certs.append(next(l for l in result.stdout.splitlines() if 'certificate SHA-256 digest:' in l))
 assert certs[0]==certs[1], 'Update certificate changed'
 report['signer']=certs[0];report['sameSignerAsPreviousApk']=True
 subprocess.run([str(sdk/'zipalign.exe'),'-c','-P','16','4',str(apk)],check=True,capture_output=True)
 report['zipAlignment16KiB']=True
out.write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k not in ['nativeLibraries']},indent=2))
