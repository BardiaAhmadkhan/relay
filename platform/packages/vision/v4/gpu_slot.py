"""An OS-owned slot shared by every local event worker, including CLI runs. No stale PID lease."""
import os,time
from contextlib import contextmanager
from pathlib import Path

@contextmanager
def gpu_slot(file, started=None):
    file=Path(file);file.parent.mkdir(parents=True,exist_ok=True)
    with file.open('a+b') as handle:
        if os.fstat(handle.fileno()).st_size==0:
            handle.write(b'1');handle.flush()
        if os.name=='nt':
            import msvcrt
            def take():
                handle.seek(0)
                msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
            def release():
                handle.seek(0);msvcrt.locking(handle.fileno(),msvcrt.LK_UNLCK,1)
        else:
            import fcntl
            def take():fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
            def release():fcntl.flock(handle.fileno(),fcntl.LOCK_UN)
        announced=False
        while True:
            try:take();break
            except OSError as exc:
                if exc.errno not in (11,13,35,36) and getattr(exc,'winerror',None) not in (32,33):raise
                if not announced:print('waiting_for_event_gpu',flush=True);announced=True
                time.sleep(.35)
        try:
            if started is not None:
                p=Path(started);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(str(os.getpid()),encoding='ascii')
            yield
        finally:release()
