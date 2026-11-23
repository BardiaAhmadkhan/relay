"""Start the packaged Node backend outside the repository, with a clean runtime dependency install.
The Windows probe exercises the archive, private model, signing and HTTP routes. OCI/Linux and
public network verification are distinct and must be repeated on the selected GPU host."""
from pathlib import Path
import base64,hashlib,json,os,secrets,shutil,socket,subprocess,sys,tarfile,tempfile,time,urllib.request,urllib.error
root=Path.cwd();package=root/'artifacts/relay-v3.5-host';manifest=json.loads((package/'manifest.json').read_text())
archive=package/'relay-v3.5-backend.tar.gz';assert hashlib.sha256(archive.read_bytes()).hexdigest()==manifest['archiveSha256']
work=Path(tempfile.mkdtemp(prefix='relay-oci-verify-')).resolve()
split='--split' in sys.argv
out=root/'collab/baseline/v35-activation/hosting'/('packaged-split-service.json' if split else 'packaged-service.json')
evidence={'platform':sys.platform,'archiveSha256':manifest['archiveSha256'],'files':manifest['fileCount'],'separateNodeModules':True,'realExternalProviderCalls':0}
server=worker=None
try:
 with tarfile.open(archive) as a:
  for entry in manifest['files']:
   name=entry['file'];target=(work/name).resolve();assert target.is_relative_to(work) and a.getmember(name).isfile()
   data=a.extractfile(name).read();assert hashlib.sha256(data).hexdigest()==entry['sha256']
   target.parent.mkdir(exist_ok=True,parents=True);target.write_bytes(data)
 for n in ['package.json','package-lock.json']:shutil.copyfile(work/'deploy'/n,work/n)
 npm=shutil.which('npm.cmd') or shutil.which('npm')
 env={k:v for k,v in os.environ.items() if not any(x in k.upper() for x in ['TOKEN','API_KEY','SIGNING_KEY','PASSWORD','SECRET'])}
 args=[npm,'ci','--omit=dev','--include=optional','--no-audit','--no-fund']
 r=subprocess.run(args,cwd=work,env=env,capture_output=True,timeout=160)
 if r.returncode:raise RuntimeError('Isolated npm ci failed: '+r.stderr.decode('utf8','replace')[-430:])
 evidence['cleanInstall']=True
 with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
 token=secrets.token_hex(32);url='http://127.0.0.1:'+str(port)
 env.update(RELAY_HOST='127.0.0.1',RELAY_PORT=str(port),RELAY_ACCESS_TOKEN=token,RELAY_SIGNING_KEY=secrets.token_hex(36),RELAY_OLLAMA_URL='http://127.0.0.1:11439',RELAY_SCORERS='local_logprob',RELAY_ALLOW_PAID='0')
 if split:
  ports=[]
  while len(ports)<2:
   with socket.socket() as s:s.bind(('127.0.0.1',0));candidate=s.getsockname()[1]
   if candidate!=port and candidate not in ports:ports.append(candidate)
  gt=secrets.token_hex(32);env.update(RELAY_GPU_TOKEN=gt,RELAY_GPU_ORIGIN='http://127.0.0.1:'+str(ports[0]))
 def request(route,auth=True,data=None):
  hdr={'Content-Type':'application/json'}
  if auth:hdr['X-Relay-Token']=token
  req=urllib.request.Request(url+route,data=None if data is None else json.dumps(data).encode(),headers=hdr)
  try:
   with urllib.request.urlopen(req,timeout=80) as res:return res.status,json.load(res)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 server=subprocess.Popen(['node','--import','tsx','server/index-v2.ts'],cwd=work,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
 for i in range(100):
  if server.poll()!=None:raise RuntimeError('Packaged server exited: '+server.stderr.read().decode('utf-8','replace')[-430:])
  try:
   status,health=request('/v2/health');break
  except urllib.error.URLError:time.sleep(.15)
 else:raise RuntimeError('No packaged service ready')
 assert status==200 and health['engineRelease']=='3.5' and 'processingNotice' not in health
 evidence['authenticatedHealth']=status;evidence['unauthenticatedHealth']=request('/v2/health',False)[0];assert evidence['unauthenticatedHealth']==401
 if split:
  # The CPU passes health and authentication before the GPU process exists.
  we={k:v for k,v in env.items() if not k.startswith('RELAY_')};we.update(RELAY_WORKER_HOST='127.0.0.1',RELAY_OLLAMA_URL='http://127.0.0.1:11439',RELAY_GPU_TOKEN=gt,PORT=str(ports[0]),PORT_HEALTH=str(ports[1]))
  worker=subprocess.Popen(['node','--import','tsx','server/gpu-worker.ts'],cwd=work,env=we,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
  for i in range(180):
   if worker.poll() is not None:raise RuntimeError('Packaged GPU worker exited: '+worker.stderr.read().decode('utf8','replace')[-360:])
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(ports[1])+'/ping',timeout=4) as probe:
     if probe.status==200:break
   except urllib.error.URLError:pass
   time.sleep(.2)
  else:raise RuntimeError('Packaged GPU did not become ready')
  evidence.update(cpuApiAndGpuWorkerFromSameArchive=True,workerReadyBeforeScoring=True)
 payload={'schemaVersion':'2.0','assessmentId':'packaged-intake','photoId':'label','view':'label','base64':base64.b64encode((root/'assets/fixtures/backpack-label.jpg').read_bytes()).decode()}
 status,data=request('/v2/photos/score',data=payload);assert status==200 and data.get('signed');evidence['freshSignedScorer']=data['signed']['scores']['scorer']
 intake={'schemaVersion':'2.0','assessmentId':'packaged-intake','disclosures':[{'id':q,'question':q,'answer':'yes' if q=='crash' else 'no','recordedAt':'2026-11-20T00:00:00Z'} for q in ['crash','protective_damage','protective_repair']],'photos':[data['photo']],'signedScores':[data['signed']],'closeUpsRequested':0}
 status,data=request('/v2/assess',data=intake);assert status==200 and data['decision']['outcome']=='no_offer';evidence['crashOutcome']=data['decision']['outcome'];evidence['passed']=True
finally:
 for p in [server,worker]:
  if p and p.poll() is None:p.terminate();p.wait(timeout=10)
 out.write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf8')
 assert work.parent==Path(tempfile.gettempdir()).resolve() and work.name.startswith('relay-oci-verify-')
 shutil.rmtree(work,ignore_errors=True)
print(json.dumps(evidence))
