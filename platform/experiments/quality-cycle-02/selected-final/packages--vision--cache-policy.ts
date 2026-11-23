/** Process-local cache metadata. Kept outside the public observation/schema and model output. */
const incomplete = new WeakSet<object>();
export function markIncompleteObservation<T extends object>(observation: T): T {
  incomplete.add(observation);
  return observation;
}
export function observationMayBeCached(observation: object): boolean {
  return !incomplete.has(observation);
}
