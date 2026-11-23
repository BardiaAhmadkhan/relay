"""Resource and transport support for the Relay acquisition worker."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

import psutil
from acquire import MODEL, http as model_http

API = os.environ.get("RELAY_FOUNDATION_URL", "http://127.0.0.1:8788").rstrip("/")
GAME = re.compile(r"\\steamapps\\common\\|\\xboxgames\\|shipping\.exe|\\(?:Civilization[^\\]*|FortniteClient[^\\]*|cs2|dota2|GTA5|eldenring|overwatch|RocketLeague)\.exe", re.I)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http(url, body=None, timeout=65):
    origin, destination = urlsplit(API), urlsplit(url)
    if (destination.scheme, destination.netloc) != (origin.scheme, origin.netloc):
        raise ValueError("Unexpected scoring origin")
    headers = {"Content-Type": "application/json"}
    if token := os.environ.get("RELAY_ACCESS_TOKEN"):
        headers["X-Relay-Token"] = token
    request = Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
    # A redirect from the private scorer must never carry its access token to another host.
    with build_opener(NoRedirect()).open(request, timeout=timeout) as response:
        return json.load(response)


def atom(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=path.name + ".", suffix=".writing", delete=False) as fp:
        temporary = Path(fp.name)
        try:
            json.dump(data, fp, ensure_ascii=False, indent=2)
            fp.write("\n")
        except BaseException:
            fp.close()
            temporary.unlink(missing_ok=True)
            raise
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def sample():
    def query(field):
        return subprocess.check_output(
            ["nvidia-smi", field, "--format=csv,noheader,nounits"],
            timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), text=True
        )
    rows = [tuple(map(int, row.split(","))) for row in
            query("--query-gpu=temperature.gpu,memory.used").strip().splitlines()]
    return {"temp_c": max(row[0] for row in rows), "vram_mib": max(row[1] for row in rows),
            "ram_free_mib": psutil.virtual_memory().available // 1048576,
            "game": bool(GAME.search(query("--query-compute-apps=process_name")))}


def safe(reading):
    return (reading["temp_c"] < 85 and reading["vram_mib"] < 7000
            and reading["ram_free_mib"] >= 2048 and not reading["game"])


def guard_event():
    stop = threading.Event()
    def monitor():
        while not stop.wait(1):
            try:
                if safe(sample()):
                    continue
            except (OSError, ValueError, subprocess.SubprocessError):
                pass
            try:
                model_http("/api/generate", {"model": MODEL, "keep_alive": 0}, timeout=3)
            except Exception:
                pass
            os._exit(23)
    threading.Thread(target=monitor, daemon=True).start()
    return stop
