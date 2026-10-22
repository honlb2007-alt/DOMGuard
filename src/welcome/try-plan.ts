/** What Try it may do after the service worker has answered the Pro check. */
export function welcomeTryAction(
  kind: 'scan' | 'picker',
  isPro: boolean | null,
): 'local' | 'upgrade' | 'unavailable' {
  if (kind === 'picker') {
    return 'local';
  }
  if (isPro === true) {
    return 'local';
  }
  if (isPro === false) {
    return 'upgrade';
  }
  return 'unavailable';
}
