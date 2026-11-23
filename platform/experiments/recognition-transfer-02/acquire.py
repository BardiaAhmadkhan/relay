"""Select fresh public garments by original item identity, ignoring all predictions."""

import concurrent.futures as cf
import hashlib
import json
from pathlib import Path
import re
import sys
from urllib.parse import quote

root = Path.cwd()
sys.path.insert(0, str(root / "experiments/recognition-weights-01"))
from fetch_external import request, sha


def main(out):
    protocol = (out / "protocol.json").read_bytes()
    spec = json.loads(protocol)
    salt = lambda s: sha((spec["salt"] + "/" + s).encode())
    reference = json.loads(
        (root / "experiments/recognition-weights-01/external-protocol.json").read_bytes()
    )["wargon"]
    previous = [
        json.loads((root / "benchmarks/recognition-weights-01" / g / "sources.json").read_bytes())
        for g in ["external", "trained-head"]
    ]
    banned = {
        m["item"] for study in previous for m in study["members"] if m["source"] == "wargon"
    } | {"20260224_083835_396d6123", "20260216_134522_1e5653f3"}
    if spec.get("excludeManifestSha256"):
        extra = (out / "excluded.json").read_bytes()
        assert sha(extra) == spec["excludeManifestSha256"]
        banned.update(m["item"] for m in json.loads(extra)["members"])
    groups, urls, all_ids = {}, {}, {}
    for tag in ["holes", "spots"]:
        repo = "wargoninnovation/Garment_condition_" + tag
        rev = reference[tag + "Rev"]
        info = json.loads(
            request("https://huggingface.co/api/datasets/" + repo + "/revision/" + rev, 3000000)
        )
        assert info["sha"] == rev and info["cardData"]["license"] == "cc-by-4.0"
        urls[tag] = "https://huggingface.co/datasets/" + repo + "/resolve/" + rev + "/"
        groups[tag] = {}
        all_ids[tag] = set()
        for row in info["siblings"]:
            name = row["rfilename"]
            m = re.fullmatch(r"([^/]+)/labels/(\d{8}_\d{6}_[a-f0-9]+)_.*\.txt", name)
            if m:
                all_ids[tag].add(m[2])
                if m[1] == "train":
                    groups[tag].setdefault(m[2], []).append(name)
    banned |= all_ids["holes"] & all_ids["spots"]
    common = {i[:8] for i in groups["holes"] if i not in banned} & {
        i[:8] for i in groups["spots"] if i not in banned
    }
    raw = out / "raw"
    raw.mkdir(exist_ok=True)

    def acquire(record):
        tag, item = record
        for label in sorted(groups[tag][item], key=salt):
            base = urls[tag]
            lu = base + quote(label)
            data = request(lu, 200000)
            boxes = []
            for line in data.decode().splitlines():
                v = [float(x) for x in line.split()]
                if not v or v[0] != 0 or not all(0 <= x <= 1 for x in v[1:]):
                    continue
                if len(v) == 5:
                    x, y, w, h = v[1:]
                elif len(v) >= 7 and len(v) % 2 == 1:
                    xx, yy = v[1::2], v[2::2]
                    w, h = max(xx) - min(xx), max(yy) - min(yy)
                    x, y = min(xx) + w / 2, min(yy) + h / 2
                else:
                    continue
                if w > 0 and h > 0:
                    boxes.append([x, y, w, h])
            if not boxes:
                continue
            image = label.replace("train/labels/", "train/images/")[:-4] + ".jpg"
            u = base + quote(image)
            content = request(u, 8000000)
            uid = "w-" + tag + "-" + item
            (raw / (uid + ".jpg")).write_bytes(content)
            return dict(
                id=uid,
                item=item,
                date=item[:8],
                sharedDate=item[:8] in common,
                source="wargon",
                sourcePath=image,
                sourceUrl=u,
                sourceSha256=sha(content),
                labelUrl=lu,
                labelSha256=sha(data),
                box=max(boxes, key=lambda b: (b[2] * b[3], -b[0], -b[1])),
                countBoxes=len(boxes),
                license="CC BY 4.0",
                **{"class": tag},
            )

    members = []
    with cf.ThreadPoolExecutor(max_workers=5) as pool:
        for tag, items in groups.items():
            ordered = sorted(set(items) - banned, key=salt)
            count = 0
            for start in range(0, len(ordered), 8):
                batch = ordered[start : start + min(8, spec["perClass"] - count)]
                for m in pool.map(acquire, [(tag, i) for i in batch]):
                    if m:
                        m["partition"] = "A" if count < spec["perClass"] // 2 else "B"
                        members.append(m)
                        count += 1
                if count == spec["perClass"]:
                    break
                # An empty/invalid publisher annotation consumes its predetermined position.
            if count != spec["perClass"]:
                raise ValueError((tag, count))
    assert len({m["item"] for m in members}) == len(members)
    (out / "sources.json").write_text(
        json.dumps(
            dict(
                protocolSha=sha(protocol),
                excludedPriorAndCrossClassIds=sorted(banned),
                members=members,
            ),
            indent=2,
        )
        + "\n",
        encoding="utf8",
    )
    print(
        "Selected",
        len(members),
        "distinct items; common acquisition dates",
        sorted(common),
        flush=True,
    )


if __name__ == "__main__":
    main(Path(sys.argv[1]).resolve())
