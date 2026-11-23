import hashlib
import io
import json
import sys
from pathlib import Path
import tempfile
import unittest

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages/vision/v4"))
from acquire import pixels
from runtime_support import atom, http, safe


class AcquisitionTest(unittest.TestCase):
    def test_source_pixels_are_reencoded_without_metadata(self):
        picture = Image.new("RGB", (380, 210), "navy")
        picture.info["comment"] = b"test metadata"
        first = pixels(picture, 128)
        with Image.open(io.BytesIO(first)) as out:
            self.assertEqual(out.size, (128, 71))
            self.assertFalse(out.getexif())
        self.assertNotIn(b"test metadata", first)
        self.assertEqual(hashlib.sha256(first).digest(), hashlib.sha256(pixels(picture, 128)).digest())

    def test_guard_boundaries(self):
        baseline = dict(temp_c=72, vram_mib=5700, ram_free_mib=4096, game=False)
        self.assertTrue(safe(baseline))
        for change in ({"temp_c":85}, {"vram_mib":7000}, {"ram_free_mib":2047}, {"game":True}):
            self.assertFalse(safe({**baseline, **change}))

    def test_atomic_receipt_and_origin(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "new" / "receipt.json"
            atom(target, {"step":1})
            atom(target, {"step":2})
            self.assertEqual(json.loads(target.read_text()), {"step":2})
            self.assertEqual(list(target.parent.iterdir()), [target])
        with self.assertRaises(ValueError):
            http("https://unrelated.invalid/score", {"unused":True})
