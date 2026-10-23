# Backlog

## v1.1.1 polish

- Known limitation: after a refund, Pro stays in effect until the next check (the in-memory cache lasts up to 10 minutes; Protect all sites scripts are checked again only when the popup opens or the browser restarts). This is an accepted tradeoff, not a bug. Revisit it if a real refund happens.

## Done in 1.1.1

- Restore purchase: the upgrade panel and Settings (Free only) send `OPEN_LOGIN`. The service worker calls `extpay.openLoginPage()` and drops the in-memory paid cache. The login page does not reliably notify the extension, so the popup asks the user to reopen DOMGuard after signing in. The next open calls `getUser()` with an empty cache.
- Popup copy: the Protect all sites hint now says the feature hides hidden text and masks the secrets you select, and that a screenshot or screen recording of the page shows those changes.
- Offline grace: an explicit paid answer stores `domguardPurchaseVerified` (`paid: true` and `verifiedAt` only). An explicit unpaid answer deletes it. If ExtensionPay cannot be reached within 7 days of `verifiedAt`, Pro features stay available. A failed check does not unregister Protect all sites.

## Known limitations

- After a refund, Pro stays in effect until the next check (the in-memory cache lasts up to 10 minutes; Protect all sites scripts are checked again only when the popup opens or the browser restarts). This is an accepted tradeoff, not a bug. Revisit it if a real refund happens.
- If ExtensionPay cannot be reached, an explicit paid confirmation keeps Pro available for 7 days after `verifiedAt`.
- Protect all sites does not look inside iframes, and it cannot see a closed shadow tree.
- Text with `display: none` is not treated as hidden text. It is not painted into a screenshot.
- Detection is a heuristic. It does not find every secret or every hidden instruction.
- To leave screen readers working, text that uses a visual-hiding technique (a zero clip rectangle, clip-path inset(50%) or inset(100%), or a box no larger than 1px with overflow hidden) is hidden only when it matches an instruction phrase.
