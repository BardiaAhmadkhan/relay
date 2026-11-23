import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CountReceipt, CountVerdict } from '../packages/core/v2/count-review';
import type { PhotoRecord } from '../packages/core/v2/schema';
import { canonicalJson } from '../packages/vision/v2/scorer-chain';
import protocol from './count-protocol.json' with { type: 'json' };
type Payload = CountReceipt['check'];
const signature = (p: Payload, key: string) =>
  createHmac('sha256', key).update('relay.count-check.v1\n').update(canonicalJson(p)).digest();
export function signCount(
  assessmentId: string,
  photo: PhotoRecord,
  verdict: CountVerdict,
  key: string,
): CountReceipt {
  const check: Payload = {
    kind: 'count_check',
    assessmentId,
    photoId: photo.id,
    sha256: photo.sha256,
    verdict,
    promptVersion: protocol.version,
  };
  return { check, signature: signature(check, key).toString('hex') };
}
export function matchesCount(
  receipt: CountReceipt,
  assessmentId: string,
  target: PhotoRecord,
  key: string,
) {
  const p = receipt.check;
  return (
    p.assessmentId === assessmentId &&
    p.photoId === target.id &&
    p.sha256 === target.sha256 &&
    p.promptVersion === protocol.version &&
    timingSafeEqual(signature(p, key), Buffer.from(receipt.signature, 'hex'))
  );
}
