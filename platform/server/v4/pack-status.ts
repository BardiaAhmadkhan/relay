import fs from 'node:fs';
import path from 'node:path';
type Checked = {
  status: string;
  checked: string;
  anchorSha?: string;
  source: { url: string; freshDays: number; fact: string };
};
export type WatchedKey = 'ca-leather' | 'knox-purchase' | 'usps-ca';
export function freshness(
  key: WatchedKey,
  now = Date.now(),
  directory = path.resolve(process.env.RELAY_REFERENCE_DIR ?? 'reference-packs'),
) {
  try {
    const base = JSON.parse(fs.readFileSync(path.join(directory, 'baseline.json'), 'utf8'))[key];
    const last = JSON.parse(fs.readFileSync(path.join(directory, 'latest-run.json'), 'utf8'))[
      key
    ] as Checked;
    if (!base?.anchorSha || !last?.checked || !last.source) throw Error('No source record');
    const checked = Date.parse(last.checked),
      expires = checked + last.source.freshDays * 86400000;
    const status =
      !['unchanged', 'unchanged_304'].includes(last.status) || last.anchorSha !== base.anchorSha
        ? 'review_pending'
        : !Number.isFinite(checked) || now > expires
          ? 'stale'
          : 'verified';
    return {
      key,
      status,
      checked: last.checked,
      freshUntil: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
      anchor: base.anchorSha as string,
      source: last.source.url,
      fact: last.source.fact,
    };
  } catch {
    return {
      key,
      status: 'unverified',
      checked: null,
      freshUntil: null,
      anchor: null,
      source: null,
      fact: null,
    };
  }
}
