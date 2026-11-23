"""Two real worker processes, no GPU calls. Confirm mutual exclusion and crash release."""
import json,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'packages/vision/v4'))
from gpu_slot import gpu_slot
if len(sys.argv)>1:
    directory=Path(sys.argv[1]);who=sys.argv[2]
    with gpu_slot(directory/'slot',directory/(who+'.started')):
        (directory/(who+'.start')).write_text(str(time.monotonic()))
        time.sleep(float(sys.argv[3]))
        (directory/(who+'.end')).write_text(str(time.monotonic()))
    raise SystemExit
def wait_file(file):
    until=time.monotonic()+8
    while not file.exists():
        if time.monotonic()>until:raise RuntimeError(str(file.name)+' timed out')
        time.sleep(.015)
with tempfile.TemporaryDirectory(prefix='relay-gpu-slot-') as dest:
    d=Path(dest)
    def worker(who,seconds):return subprocess.Popen([sys.executable,__file__,str(d),who,str(seconds)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    a=worker('a',.8);wait_file(d/'a.start');b=worker('b',.15)
    time.sleep(.18);assert not (d/'b.start').exists()
    assert a.wait(8)==0 and b.wait(8)==0
    assert float((d/'b.start').read_text())>=float((d/'a.end').read_text())
    c=worker('c',15);wait_file(d/'c.start');e=worker('e',.05);time.sleep(.15);assert not (d/'e.start').exists()
    c.kill();c.wait(8);assert e.wait(8)==0
    result={'simultaneousWorkers':2,'overlap':False,'terminatedOwnerReleased':True,'paidCalls':0,'gpuCalls':0}
    target=ROOT/'collab/vision/gpu-queue-verification.json';target.write_text(json.dumps(result,indent=2),encoding='utf8');print(result)
