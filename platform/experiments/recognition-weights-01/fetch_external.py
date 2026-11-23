"""Select public, physically grouped garment validation examples without looking at any model scores."""

from collections import Counter, defaultdict
import argparse
import datetime
import hashlib
import json
import re
import shutil
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
import zipfile
import zlib

from zenodo_ranges import ZenodoRanges, SIZE


def sha(b):
    return hashlib.sha256(b).hexdigest()


def request(url, limit):
    for attempt in range(3):
        try:
            q = urllib.request.Request(url, headers={"User-Agent": "Relay-Research/1.0"})
            with urllib.request.urlopen(q, timeout=35) as f:
                data = f.read(limit + 1)
            if len(data) > limit:
                raise IOError("Response exceeds explicit bound")
            return data
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or attempt == 2:
                raise
            delay = int(e.headers.get("Retry-After") or 3 * (attempt + 1))
            if delay > 60:
                raise
            time.sleep(delay)


def wargon(out, spec, order, exclude_items=()):
    groups = {}
    total = Counter()
    excluded = {"20260224_083835_396d6123", "20260216_134522_1e5653f3"} | set(exclude_items)
    for tag, rev in [("holes", spec["holesRev"]), ("spots", spec["spotsRev"])]:
        repo = "wargoninnovation/Garment_condition_" + tag
        info = json.loads(
            request("https://huggingface.co/api/datasets/" + repo + "/revision/" + rev, 650000)
        )
        if info["sha"] != rev or info["cardData"]["license"] != "cc-by-4.0":
            raise ValueError("Source revision/license changed")
        ids = defaultdict(list)
        for f in info["siblings"]:
            name = f["rfilename"]
            match = re.match(r"valid/labels/(\d{8}_\d{6}_[a-f0-9]+)_.*\.txt$", name)
            if match:
                ids[match[1]].append(name)
        groups[tag] = (repo, rev, ids)
    shared = set(groups["holes"][2]) & set(groups["spots"][2])
    dates = {k: {i[:8] for i in gs[2]} for k, gs in groups.items()}
    common = dates["holes"] & dates["spots"]
    members = []
    for tag, (repo, rev, ids) in groups.items():
        days = defaultdict(list)
        for item in sorted(set(ids) - shared - excluded, key=order):
            days[item[:8]].append(item)
        common_days = sorted(common, key=order)
        order_days = common_days + sorted(set(days) - common, key=order)
        # Use all shared date strata first, then diversify the other dates in round-robin order.
        sequence = []
        for day in common_days:
            sequence.extend(days.pop(day, []))
        remaining = [d for d in order_days if d in days]
        while any(days[d] for d in remaining):
            for day in remaining:
                if days[day]:
                    sequence.append(days[day].pop(0))
        count = 0
        for item in sequence:
            if count >= 12:
                break
            for label in sorted(ids[item], key=order):
                base = "https://huggingface.co/datasets/" + repo + "/resolve/" + rev + "/"
                data = request(base + urllib.parse.quote(label), 200000)
                rows = [
                    list(map(float, l.split())) for l in data.decode().splitlines() if l.strip()
                ]
                boxes = []
                for coords in rows:
                    if not coords or coords[0] != 0 or any(not 0 <= x <= 1 for x in coords[1:]):
                        total[tag + "InvalidInstances"] += 1
                        continue
                    if len(coords) == 5:
                        box = coords
                    elif len(coords) >= 7 and len(coords) % 2 == 1:
                        xs, ys = coords[1::2], coords[2::2]
                        box = [
                            0,
                            (max(xs) + min(xs)) / 2,
                            (max(ys) + min(ys)) / 2,
                            max(xs) - min(xs),
                            max(ys) - min(ys),
                        ]
                        total[tag + "PolygonInstances"] += 1
                    else:
                        total[tag + "InvalidInstances"] += 1
                        continue
                    if min(box[3:]) > 0:
                        boxes.append(box)
                    else:
                        total[tag + "DegenerateInstances"] += 1
                if not boxes:
                    total[tag + "EmptyVariants"] += 1
                    continue
                box = max(boxes, key=lambda b: (b[3] * b[4], -b[1], -b[2]))
                image = label.replace("valid/labels/", "valid/images/")[:-4] + ".jpg"
                uid = "w-" + tag + "-" + item
                cache_image = out / "hf-member-cache" / (sha((base + image).encode()) + ".jpg")
                cache_image.parent.mkdir(exist_ok=True)
                content = (
                    cache_image.read_bytes()
                    if cache_image.exists()
                    else request(base + urllib.parse.quote(image), 5_000_000)
                )
                if not cache_image.exists():
                    cache_image.write_bytes(content)
                (out / "raw" / (uid + ".jpg")).write_bytes(content)
                members.append(
                    {
                        "id": uid,
                        "item": item,
                        "date": item[:8],
                        "sharedDate": item[:8] in common,
                        "source": "wargon",
                        "class": tag,
                        "sourcePath": image,
                        "sourceUrl": base + urllib.parse.quote(image),
                        "sourceSha256": sha(content),
                        "labelUrl": base + urllib.parse.quote(label),
                        "labelSha256": sha(data),
                        "box": box[1:],
                        "countBoxes": len(boxes),
                        "license": "CC BY 4.0",
                    }
                )
                count += 1
                break
        total[tag + "ItemsSelected"] = count
    return members, dict(total)


def gold(out, cache, order):
    stream = ZenodoRanges(cache)
    with zipfile.ZipFile(stream) as z:
        infos = {
            i.filename: i
            for i in z.infolist()
            if i.filename.startswith("test100/") and not i.is_dir()
        }
    start = min(i.header_offset for i in infos.values())
    end = min(SIZE, max(i.header_offset + i.compress_size + 1200 for i in infos.values()))
    if end - start > 280 * 1024**2:
        raise ValueError("Gold subset exceeds acquisition budget")
    subset = out / "gold-private-range.bin"
    if not subset.exists():
        with subset.with_suffix(".partial").open("wb") as outbuf:
            for pos in range(start, end, 8 * 1024**2):
                outbuf.write(stream.retrieve(pos, min(end, pos + 8 * 1024**2)))
        subset.with_suffix(".partial").replace(subset)
    if subset.stat().st_size != end - start:
        raise ValueError("Incomplete gold byte range")

    def member(info):
        with subset.open("rb") as f:
            f.seek(info.header_offset - start)
            header = struct.unpack("<4s5H3I2H", f.read(30))
            if header[0] != b"PK\x03\x04":
                raise ValueError("Local ZIP header mismatch")
            name = f.read(header[-2]).decode("utf-8")
            f.read(header[-1])
            if name != info.filename:
                raise ValueError("Member name mismatch")
            raw = f.read(info.compress_size)
        if info.compress_type == 8:
            raw = zlib.decompress(raw, -15)
        elif info.compress_type != 0:
            raise ValueError("Unsupported archive compression")
        if (zlib.crc32(raw) & 0xFFFFFFFF) != info.CRC or len(raw) != info.file_size:
            raise ValueError("ZIP member integrity failed")
        return raw

    records = defaultdict(list)
    unmapped = 0
    for name, info in infos.items():
        if not re.search(r"/labels_[^/]+\.json$", name):
            continue
        raw = member(info)
        obj = json.loads(raw.decode("utf-8-sig"))
        note = str(obj.get("comment") or obj.get("comments") or "").strip()
        m = re.fullmatch(r"test[\s#:\-]*(\d{1,3})[.\s]*", note, re.I)
        if not m:
            unmapped += 1
            continue
        g = int(m[1])
        value = str(obj.get("holes", "")).strip().lower()
        if g in (80, 92, 94) or value not in ("none", "minor", "major"):
            continue
        station = name.split("/")[1]
        rater = str(obj.get("annotator") or "").strip().lower()
        # Names and free-text comments are never emitted.
        identity = station + "/" + sha(rater.encode()) if rater else None
        front = re.sub(r"/labels_", "/front_", name)[:-5] + ".jpg"
        back = front.replace("/front_", "/back_")
        records[g].append(
            dict(
                station=station,
                identity=identity,
                positive=value in ("minor", "major"),
                holes=value,
                stained=str(obj.get("stains", "")).strip().lower() in ("minor", "major", "yes"),
                path=name,
                metadataSha=sha(raw),
                pair=[front, back] if front in infos and back in infos else None,
            )
        )
    pool = {"holes": [], "no_holes": []}
    mixed = 0
    single = 0
    for key, rr in records.items():
        if len({r["positive"] for r in rr}) != 1:
            mixed += 1
            continue
        if (
            len({r["station"] for r in rr}) < 2
            and len({r["identity"] for r in rr if r["identity"]}) < 2
        ):
            single += 1
            continue
        candidates = [r for r in rr if r["pair"]]
        if not candidates:
            continue
        row = min(candidates, key=lambda r: order(r["path"]))
        pool["holes" if row["positive"] else "no_holes"].append((key, rr, row))
    count = min(10, len(pool["holes"]), len(pool["no_holes"]))
    members = []
    for tag, entries in pool.items():
        ordered = sorted(
            entries,
            key=lambda q: (
                (0 if tag == "holes" or any(r["stained"] for r in q[1]) else 1),
                order(str(q[0])),
            ),
        )
        for key, rr, row in ordered[:count]:
            iid = f"gold-{key:03d}"
            for side, file in zip(("front", "back"), row["pair"]):
                uid = iid + "-" + side
                content = member(infos[file])
                (out / "raw" / (uid + ".jpg")).write_bytes(content)
                members.append(
                    {
                        "id": uid,
                        "item": iid,
                        "view": side,
                        "source": "rise",
                        "class": tag,
                        "sourcePath": file,
                        "sourceSha256": sha(content),
                        "memberCrc32": f"{infos[file].CRC:08x}",
                        "station": row["station"],
                        "explicitRecords": len(rr),
                        "stations": sorted({r["station"] for r in rr}),
                        "stainReported": any(r["stained"] for r in rr),
                        "metadataMemberSha256": [r["metadataSha"] for r in rr],
                        "license": "CC BY 4.0",
                    }
                )
    return members, {
        "goldIdGroupsWithExplicitVotes": len(records),
        "consensusPools": {k: len(v) for k, v in pool.items()},
        "selectedPerClass": count,
        "mixedGroups": mixed,
        "insufficientIndependentRecords": single,
        "unmappedMetadataFiles": unmapped,
        "goldZipSpanBytes": end - start,
        "fullArchiveBytes": SIZE,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("workspace", type=Path)
    parser.add_argument("range_cache", type=Path)
    parser.add_argument("--source", choices=["all", "gold", "wargon"], default="all")
    args = parser.parse_args()
    out = args.workspace
    out.mkdir(parents=True, exist_ok=True)
    (out / "raw").mkdir(exist_ok=True)
    protocol = Path(__file__).with_name("external-protocol.json").read_bytes()
    (out / "protocol.json").write_bytes(protocol)
    spec = json.loads(protocol)
    order = lambda s: sha((spec["salt"] + "/" + s).encode())
    parts = {}
    for name in ["wargon", "gold"]:
        if args.source not in ("all", name):
            continue
        checkpoint = out / (name + "-metadata.json")
        if checkpoint.exists():
            j = json.loads(checkpoint.read_text("utf-8"))
            if j["protocolSha"] != sha(protocol) or not all(
                sha((out / "raw" / (c["id"] + ".jpg")).read_bytes()) == c["sourceSha256"]
                for c in j["members"]
            ):
                raise ValueError("Checkpoint identity changed")
            parts[name] = (j["members"], j["stats"])
        else:
            rows, stats = (
                wargon(out, spec["wargon"], order)
                if name == "wargon"
                else gold(out, args.range_cache, order)
            )
            checkpoint.write_text(
                json.dumps(
                    {"protocolSha": sha(protocol), "members": rows, "stats": stats}, indent=2
                ),
                encoding="utf8",
            )
            parts[name] = (rows, stats)
        print(name, len(parts[name][0]), parts[name][1], flush=True)
    if args.source != "all":
        return
    hf, hstats = parts["wargon"]
    rg, rstats = parts["gold"]
    result = {
        "atUtc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "protocolSha": sha(protocol),
        "wargon": hstats,
        "rise": rstats,
        "members": hf + rg,
    }
    (out / "sources.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wargon": hstats, "rise": rstats}), flush=True)


if __name__ == "__main__":
    main()
