"""E9. Can the damage be located? Generated box (G1) versus nine scored tiles (G2), against publisher boxes.

Usage: py -3 experiments/backend-v2/analyze_locate.py benchmarks/backend-v2/locate--qwen3.5-4b.jsonl

Truth boxes are the fabric publisher's annotations: [class, cx, cy, w, h], normalised to 0..1.
G1 returns [x1, y1, x2, y2] on a 0..1000 grid. G2 asks the `break` question of nine half-size tiles
(stride a quarter of the frame, rows top to bottom, columns left to right).
Every rate is shown next to a baseline that knows nothing about the photograph, because close-ups
tend to put the defect in the middle and a raw hit rate would flatter any method.
"""
import json, sys
import numpy as np

TILES = [(tx, ty) for ty in (0, 0.25, 0.5) for tx in (0, 0.25, 0.5)]


def boxes(truth):
    return [(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2) for _, cx, cy, w, h in truth]


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def inside(x, y, b):
    return b[0] <= x <= b[2] and b[1] <= y <= b[3]


def main():
    rows = {}
    for line in open(sys.argv[1], encoding='utf-8'):
        if line.strip():
            r = json.loads(line)
            if 'error' not in r:
                rows[r['id']] = r  # a later successful row for the same id wins
    rows = [r for r in rows.values() if r.get('truth')]
    n = len(rows)
    print(f'photographs with publisher boxes and a result: {n}')
    found, ious, point, centre_iou, centre_point = 0, [], 0, [], 0
    g2_hit, g2_chance, contrast, uniform = 0, [], [], 0
    g1ms, g2ms = [], []
    for r in rows:
        truth = boxes(r['truth'])
        g1ms.append(r['g1Ms']); g2ms.append(r['g2Ms'])
        # Baseline for G1: the middle half of the frame, whatever the photograph shows.
        centre = (0.25, 0.25, 0.75, 0.75)
        centre_iou.append(max(iou(centre, t) for t in truth))
        centre_point += any(inside(0.5, 0.5, t) for t in truth)
        if r['g1']['found']:
            found += 1
            x1, y1, x2, y2 = [v / 1000 for v in r['g1']['bbox_2d']]
            b = (min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2))
            ious.append(max(iou(b, t) for t in truth))
            point += any(inside((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, t) for t in truth)
        else:
            ious.append(0.0)
        heat = np.array(r['heat'])
        contrast.append(float(heat.max() - heat.min()))
        uniform += heat.min() >= 0.5  # every tile already answers "broken": the map says nothing
        # A tile "has" the defect when the defect's centre is in the tile, or the tile's centre is on the
        # defect (large defects can contain a tile without their centre falling in it).
        hits = [any(inside((t[0] + t[2]) / 2, (t[1] + t[3]) / 2, (tx, ty, tx + 0.5, ty + 0.5))
                    or inside(tx + 0.25, ty + 0.25, t) for t in truth)
                for tx, ty in TILES]
        g2_hit += hits[int(heat.argmax())]
        g2_chance.append(np.mean(hits))
    ious = np.array(ious)
    print('\n== G1: one generated box ==')
    print(f'  found=true on {found}/{n} damaged photographs')
    print(f'  IoU with the best truth box: median {np.median(ious):.2f}; >= 0.3 in {(ious >= 0.3).sum()}/{n}; >= 0.5 in {(ious >= 0.5).sum()}/{n}')
    print(f'  box centre inside a truth box: {point}/{n}')
    print(f'  baseline (middle half of the frame): median IoU {np.median(centre_iou):.2f}; >= 0.3 in {(np.array(centre_iou) >= 0.3).sum()}/{n}; centre inside {centre_point}/{n}')
    print(f'  median time {np.median(g1ms):.0f} ms (one call, up to 80 output tokens)')
    print('\n== G2: nine scored tiles ==')
    print(f'  hottest tile contains a truth box centre: {g2_hit}/{n}; a random tile would: {np.mean(g2_chance) * n:.1f}/{n}')
    print(f'  heat contrast (max - min): median {np.median(contrast):.2f}; every tile >= 0.5 in {uniform}/{n} photographs')
    print(f'  median time {np.median(g2ms):.0f} ms (nine calls)')


if __name__ == '__main__':
    main()
