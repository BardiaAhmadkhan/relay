import { read } from './storage';
export const personalChannel = () =>
  new URLSearchParams(location.search).get('workspace') === 'rider';
const approved = new Map<string, number>();
export async function grantRider(id: string, known?: string, force = false) {
  if (!personalChannel()) return;
  if (!force && (approved.get(id) ?? 0) > Date.now()) return;
  const stored = await read<{ claim?: string }>('rider:rider:' + id).catch(() => undefined);
  const claim = known ?? stored?.claim;
  if (!claim) return;
  const r = await fetch('/relay-rider/access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, claim }),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!r.ok) throw Error('This device could not reopen that private inspection.');
  approved.set(id, Date.now() + 10 * 60000);
}
export async function personalBriefs(signal?: AbortSignal) {
  const ids = (await read<string[]>('wallet-items:rider').catch(() => undefined)) ?? [];
  for (const id of ids) {
    if (signal?.aborted) throw signal.reason;
    await grantRider(id, undefined, true);
  }
  const r = await fetch('/relay-rider/notebook', {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!r.ok) throw Error('Your inspections could not be opened.');
  return r.json();
}
