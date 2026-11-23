"""Seekable, validated byte ranges for one public Zenodo ZIP. Never downloads the full archive."""

import io
import json
import re
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

URL = "https://zenodo.org/api/records/13788681/files/clothing_v3.zip/content"
SIZE = 26812054849


class ZenodoRanges(io.RawIOBase):
    def __init__(self, cache):
        self.cache = Path(cache)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.position = 0
        self.calls = 0
        self.downloaded = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = (
            offset if whence == 0 else self.position + offset if whence == 1 else SIZE + offset
        )
        if self.position < 0:
            raise OSError("Negative offset")
        return self.position

    def retrieve(self, start, end):
        if end <= start:
            return b""
        if end - start > 60 * 1024**2:
            raise OSError("Oversized range")
        f = self.cache / f"{start}-{end}.bin"
        if not f.exists():
            # Identity query only isolates intermediaries' per-range caches.
            q = urllib.request.Request(
                URL + f"?relay_range={start}-{end}",
                headers={
                    "Range": f"bytes={start}-{end-1}",
                    "Accept-Encoding": "identity",
                    "User-Agent": "Relay-Research/1.0",
                },
            )
            with urllib.request.urlopen(q, timeout=40) as r:
                expected = f"bytes {start}-{end-1}/{SIZE}"
                if r.status != 206 or r.headers.get("Content-Range") != expected:
                    raise OSError(f"Unverified range {r.status} {r.headers.get('Content-Range')}")
                data = r.read(end - start + 1)
                if len(data) != end - start:
                    raise IOError("Incomplete range")
            f.write_bytes(data)
            self.calls += 1
            self.downloaded += len(data)
        return f.read_bytes()

    def read(self, n=-1):
        end = SIZE if n < 0 else min(SIZE, self.position + n)
        b = self.retrieve(self.position, end)
        self.position += len(b)
        return b


if __name__ == "__main__":
    cache = Path(sys.argv[1])
    r = ZenodoRanges(cache)
    with zipfile.ZipFile(r) as z:
        entries = z.infolist()
        gold = [a for a in entries if "/test100/" in ("/" + a.filename)]
        print("entries", len(entries), "gold entries", len(gold), "network", r.calls, r.downloaded)
        print("top", [(a.filename, a.file_size, a.header_offset) for a in entries[:5]])
        print("gold", [(a.filename, a.file_size, a.header_offset) for a in gold[:13]])
        print(
            "range of gold",
            min((a.header_offset for a in gold), default=0),
            max((a.header_offset + a.compress_size for a in gold), default=0),
        )
        print("json examples", [a.filename for a in entries if a.filename.endswith(".json")][:3])
