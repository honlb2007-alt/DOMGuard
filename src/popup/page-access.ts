/**
 * Whether Chrome will refuse an extension on this tab, using only the URL's
 * protocol and host. The popup can read that URL through activeTab while it
 * is open. No tabs permission is required.
 *
 * A PDF opened in the built-in viewer usually keeps its own http(s) or file
 * address, so this check cannot see the viewer itself.
 */

const BLOCKED_PROTOCOLS = new Set([
  'about:',
  'brave:',
  'chrome:',
  'chrome-extension:',
  'chrome-search:',
  'chrome-untrusted:',
  'devtools:',
  'edge:',
  'opera:',
  'view-source:',
  'vivaldi:',
]);

const STORE_HOSTS = new Set(['chrome.google.com', 'chromewebstore.google.com']);

export function isBlockedPageUrl(url: string, ownExtensionId?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (
    parsed.protocol === 'chrome-extension:' &&
    typeof ownExtensionId === 'string' &&
    ownExtensionId.length > 0 &&
    parsed.hostname === ownExtensionId
  ) {
    return false;
  }
  if (BLOCKED_PROTOCOLS.has(parsed.protocol)) {
    return true;
  }
  return STORE_HOSTS.has(parsed.hostname.toLowerCase());
}
