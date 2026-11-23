"""E12d. The runtime's host prompt cache: memory, time and answers with it on and off.

Usage: py -3 experiments/backend-v2/analyze_cache_ram.py <probe cache on.jsonl> <probe cache off.jsonl>
                                                          <E19 rows.jsonl> <cache-off rows.jsonl>

The probes (probe-ram.mjs, one question per photograph, no unloading) give free RAM and llama-server's
private memory after each photograph. The rows (scripts/v3-realworld.ts) give the full v3.1 engine's answers
and time per photograph for the same ids with the cache on (E19) and off.
"""
import json
import sys

import numpy as np


def rows(path):
    return [json.loads(line) for line in open(path, encoding='utf-8') if line.strip()]


def probe_summary(path, title):
    r = rows(path)
    free = np.array([x['freeRamMiB'] for x in r], dtype=float)
    ls = np.array([x.get('llamaServerPrivateMiB') or np.nan for x in r], dtype=float)
    ms = np.array([x['ms'] for x in r], dtype=float)
    slope_free = np.polyfit(np.arange(len(free)), free, 1)[0]
    slope_ls = np.polyfit(np.arange(len(ls)), ls, 1)[0] if not np.isnan(ls).any() else float('nan')
    print(f'{title}: {len(r)} photographs')
    print(f'  free RAM {free[0]:.0f} -> {free[-1]:.0f} MiB (trend {slope_free:+.0f} MiB per photograph)')
    print(f'  llama-server private {ls[0]:.0f} -> {ls[-1]:.0f} MiB (trend {slope_ls:+.0f} MiB per photograph)')
    print(f'  time per question: median {np.median(ms):.0f} ms')
    return {x['id']: x['yes'] for x in r}


on = probe_summary(sys.argv[1], 'Probe, prompt cache on (default)')
off = probe_summary(sys.argv[2], 'Probe, prompt cache off (LLAMA_ARG_CACHE_RAM=0)')
same = [i for i in on if i in off]
diff = [abs(on[i] - off[i]) for i in same]
print(f'probe answers on the same photographs: {len(same)}, identical {sum(d == 0 for d in diff)}, '
      f'largest difference {max(diff) if diff else 0:.5f}')

if len(sys.argv) > 4:
    a = {x['id']: x for x in rows(sys.argv[3]) if 'error' not in x}
    b = {x['id']: x for x in rows(sys.argv[4]) if 'error' not in x}
    ids = [i for i in b if i in a]
    print()
    print(f'v3.1 engine, same {len(ids)} photographs, cache on (E19) against off:')
    same_outcome = sum(a[i]['outcome'] == b[i]['outcome'] for i in ids)
    same_band = sum(a[i]['band'] == b[i]['band'] for i in ids)
    max_diff = 0.0
    identical = 0
    for i in ids:
        ka, kb = a[i]['answers'], b[i]['answers']
        d = [abs(ka[k] - kb[k]) for k in ka if k in kb and isinstance(ka[k], (int, float)) and isinstance(kb[k], (int, float))]
        same_choice = all(ka[k] == kb[k] for k in ka if k in kb and isinstance(ka[k], str))
        m = max(d) if d else 0.0
        max_diff = max(max_diff, m)
        identical += (m == 0 and same_choice and set(ka) == set(kb))
    print(f'  identical answers {identical}/{len(ids)}, largest answer difference {max_diff:.4f}')
    print(f'  same band {same_band}/{len(ids)}, same outcome {same_outcome}/{len(ids)}')
    ma = np.array([a[i]['ms'] for i in ids])
    mb = np.array([b[i]['ms'] for i in ids])
    print(f'  median ms per photograph: on {np.median(ma):.0f}, off {np.median(mb):.0f} (ratio {np.median(mb / ma):.2f})')
