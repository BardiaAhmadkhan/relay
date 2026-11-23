import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../packages/vision/v2/scorer-chain';
export const hashDocument = (data: unknown) =>
  createHash('sha256').update(canonicalJson(data)).digest('hex');
export type Seal<T> = { value: T; sha256: string; signature: string; purpose: string };
export function seal<T>(purpose: string, value: T, key: string): Seal<T> {
  if (key.length < 32) throw Error('The review signing identity is unavailable');
  // Sign the exact JSON representation that clients and disk will receive. Optional fields are omitted consistently.
  const transported: T = JSON.parse(JSON.stringify(value));
  const sha256 = hashDocument(transported);
  return {
    purpose,
    value: transported,
    sha256,
    signature: createHmac('sha256', key)
      .update('relay.v4\0' + purpose + '\0' + sha256)
      .digest('hex'),
  };
}
export function authentic<T>(record: Seal<T>, purpose: string, key: string): boolean {
  if (
    record.purpose !== purpose ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !/^[a-f0-9]{64}$/.test(record.signature)
  )
    return false;
  const expected = seal(purpose, record.value, key);
  return (
    expected.sha256 === record.sha256 &&
    timingSafeEqual(Buffer.from(expected.signature, 'hex'), Buffer.from(record.signature, 'hex'))
  );
}
