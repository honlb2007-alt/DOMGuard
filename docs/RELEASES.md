# Releases

## 1.1.1

Date:

Commit: fill in the hash after this tree is committed.

Package: `domguard-1.1.1.zip`, 74371 bytes. SHA-256 `59B26C9FB1BFCE8E2C9AC6397033289CBBBC5B78AC9DCE65677D5C2CCDE623D5`.

Permissions: `activeTab`, `storage`, `scripting`. Host permission `https://extensionpay.com/*`. Optional host permission `<all_urls>`.

- Restore purchase is in the upgrade panel and in Settings while the plan is Free. It opens ExtensionPay's sign-in page and clears the in-memory paid cache. Reopen DOMGuard after signing in.
- The Protect all sites hint now describes the feature: it hides hidden text and masks the secrets you select, and a screenshot or screen recording of the page shows those changes.
- If ExtensionPay cannot be reached, a paid confirmation from the last 7 days (`domguardPurchaseVerified`, `paid` and `verifiedAt` only) keeps Pro features on. The popup says it cannot verify the purchase. The record is removed only when `paid` is false. A failed check does not turn Protect all sites off.
- ExtensionPay calls stop after 8 seconds. The popup opens without waiting for that check. A timeout keeps the 7-day confirmation when one exists, and otherwise leaves the install Free.
- Removing all-sites access turns Protect all sites off and clears the toolbar badge.
- Text hidden with a zero clip, `clip-path: inset(50%)` or `inset(100%)`, or a box no larger than 1px with overflow hidden is removed only when it matches an instruction phrase.
- A text node longer than 1,000,000 characters is skipped. Longer scans are split into short chunks. The paused-sites list stops at 500 hostnames.

Known limitations:

- After a refund, Pro stays on until the next check. The in-memory result lasts up to 10 minutes. Protect all sites is checked again when the popup opens or the browser restarts.
- If ExtensionPay cannot be reached, Pro stays available for 7 days after `verifiedAt`.
- Protect all sites does not look inside iframes, and it cannot see a closed shadow tree.
- Text with `display: none` is not treated as hidden text.
- Detection is a best guess. It does not find every secret or every hidden instruction.
- Text that uses a visual-hiding technique is hidden only when it matches an instruction phrase.
- A screenshot is the visible area of the current tab.
