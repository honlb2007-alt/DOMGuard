/**
 * Run one Chrome API call. A rejection becomes `fallback` and is not left
 * unhandled, so a failed call does not stop the popup or the service worker.
 */
export function settleChrome<T>(work: Promise<T>, fallback?: T): Promise<T | undefined> {
  return work.then(
    (value) => value,
    () => fallback,
  );
}
