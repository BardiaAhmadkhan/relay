import { read } from './storage';
export const personalChannel = () =>
  new URLSearchParams(location.search).get('workspace') === 'rider';

const approved = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
let sessionWrite: Promise<unknown> = Promise.resolve();

// The first successful grant sets an HttpOnly cookie. Serialize session writes so two
// simultaneous record reads cannot replace one another's newly-created session.
function inSession<T>(action: () => Promise<T>): Promise<T> {
  const next = sessionWrite.then(action, action);
  sessionWrite = next.catch(() => undefined);
  return next;
}
function requestAccess(body: unknown) {
  return fetch('/relay-rider/access', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
}
const remember = (id: string) => approved.set(id, Date.now() + 10 * 60000);
const ticket = (id: string) => read<{ claim?: string }>('rider:rider:' + id);
export async function grantRider(id: string, known?: string, force = false) {
  if (!personalChannel() || (!force && (approved.get(id) ?? 0) > Date.now())) return;
  const existing = pending.get(id);
  if (existing) return existing;
  const result = inSession(async () => {
    const claim = known ?? (await ticket(id).catch(() => undefined))?.claim;
    if (!claim) return;
    const response = await requestAccess({ id, claim });
    if (!response.ok) throw Error('This device could not reopen that private inspection.');
    remember(id);
  }).finally(() => pending.delete(id));
  pending.set(id, result);
  return result;
}
export async function personalBriefs(signal?: AbortSignal) {
  let deviceUnavailable = false;
  const stored = await read<string[]>('wallet-items:rider').catch(() => {
    deviceUnavailable = true;
    return [];
  });
  const ids = [...new Set(stored ?? [])];
  let missing = 0;
  for (let start = 0; start < ids.length; start += 24) {
    signal?.throwIfAborted();
    const saved = await Promise.all(
      ids.slice(start, start + 24).map(async (id) => ({
        id,
        claim: (
          await ticket(id).catch(() => {
            deviceUnavailable = true;
            return undefined;
          })
        )?.claim,
      })),
    );
    const tickets = saved.filter((t) => t.claim);
    if (!tickets.length) continue;
    await inSession(async () => {
      signal?.throwIfAborted();
      const response = await requestAccess({ tickets });
      // Earlier workshop gateways accept one receipt per request. During a rolling
      // upgrade they reject the unrecognized batch without granting a session.
      if (response.status === 403) {
        for (const t of tickets) {
          signal?.throwIfAborted();
          const single = await requestAccess(t);
          if (single.ok) remember(t.id);
          else if (single.status === 403) missing++;
          else throw Error('Your device could not restore its inspection receipts.');
        }
        return;
      }
      if (!response.ok) throw Error('Your device could not restore its inspection receipts.');
      const { granted }: { granted: string[] } = await response.json();
      granted.forEach(remember);
      missing += tickets.length - granted.length;
    });
  }
  const response = await fetch('/relay-rider/notebook', {
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw Error('Your inspections could not be opened.');
  const result = await response.json();
  return { ...result, unavailable: (result.unavailable ?? 0) + missing, deviceUnavailable };
}
