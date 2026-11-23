import { checkCancelled } from './inspection';
/** Return control promptly while the owner keeps the native task in its serial queue. */
export function abortableResult<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  checkCancelled(signal);
  return new Promise<T>((resolve, reject) => {
    const cancel = () => {
      signal.removeEventListener('abort', cancel);
      reject(Object.assign(new Error('Analysis cancelled.'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', cancel, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener('abort', cancel);
        if (signal.aborted) cancel();
        else resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', cancel);
        reject(error);
      },
    );
  });
}
