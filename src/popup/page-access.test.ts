import { describe, expect, it } from 'vitest';

import { isBlockedPageUrl } from './page-access';

describe('isBlockedPageUrl', () => {
  it('allows ordinary web pages and the local test page', () => {
    expect(isBlockedPageUrl('https://example.com/inbox')).toBe(false);
    expect(isBlockedPageUrl('http://127.0.0.1:8080/')).toBe(false);
    expect(isBlockedPageUrl('file:///D:/DOMGuard/test/sample.html')).toBe(false);
  });

  it('blocks browser pages, the Web Store, and extension pages by protocol or host', () => {
    expect(isBlockedPageUrl('chrome://newtab/')).toBe(true);
    expect(isBlockedPageUrl('chrome://settings/')).toBe(true);
    expect(isBlockedPageUrl('edge://newtab/')).toBe(true);
    expect(isBlockedPageUrl('chrome-extension://abcdefghijklmnop/popup.html')).toBe(true);
    expect(isBlockedPageUrl('chrome-extension://abcdefghijklmnop/welcome.html', 'abcdefghijklmnop')).toBe(
      false,
    );
    expect(isBlockedPageUrl('chrome-extension://otherid/welcome.html', 'abcdefghijklmnop')).toBe(true);
    expect(isBlockedPageUrl('https://chromewebstore.google.com/detail/domguard')).toBe(true);
    expect(isBlockedPageUrl('https://chrome.google.com/webstore/category/extensions')).toBe(true);
    expect(isBlockedPageUrl('view-source:https://example.com/')).toBe(true);
  });

  it('does not treat a normal address as blocked when the string is not a URL', () => {
    expect(isBlockedPageUrl('not a url')).toBe(false);
  });
});