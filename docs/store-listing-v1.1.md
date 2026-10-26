# DOMGuard store listing draft (v1.1)

## What's new in 1.1.1

Paste this into the store version description:

Restore a purchase from the upgrade panel, or from Settings while the plan says Free. Sign in with the email from checkout, then reopen DOMGuard. If the purchase check cannot connect, Pro stays available for 7 days after the last confirmation. Protect all sites hides hidden text and masks the secrets you select. A screenshot or screen recording of the page shows those changes.

Do not write a reply-time promise, a refund policy, "guarantee", "everywhere", or "any app".

Checked against `src/` on October 22, 2026. Sentences that the code does not support are not left as claims. Each one is marked `[MISMATCH: ...]`.

Title:
DOMGuard - Hide Secrets Before You Share or Paste to AI

Summary:
Hide API keys, emails and card numbers on any page, then copy a clean screenshot to share or paste into AI tools.

[MISMATCH: "on any page" is broader than the product. Chrome blocks extensions on chrome:// pages, the Chrome Web Store, the New Tab page, and the built-in PDF viewer. "a clean screenshot" matches Pro captures, which hide hidden text and run the pixel pass. A free capture is a plain copy of the visible tab, limited to 3 per local day (`FREE_DAILY_SCREENSHOTS` in `src/shared/config.ts`). The same sentence is the manifest description requested for this release.]

Description:

Stop leaking secrets before you share a page or paste it into an AI tool.

DOMGuard hides sensitive information on web pages, and can show text that people cannot see but an AI tool might still read.

HIDE SENSITIVE DATA

- Click any element on a page to hide it (free)
- Choose a solid black or blurred mask
- Masks stay with the page as you scroll
- Free: manual masking is not limited

AUTO SCAN AND MASK (PRO)

- One click finds API keys (OpenAI, Anthropic, AWS, GitHub, Stripe), JWT tokens, and card numbers, then covers them
- Email addresses and phone numbers stay visible until you turn them on
- Phone numbers cover international format and Taiwan mobile numbers
- Card numbers are checked before masking to reduce false alarms
- While automatic masks are on, hold Alt to peek at the original text

SHOW HIDDEN TEXT (PRO)

Some pages contain text people cannot see, such as near-invisible, tiny, or off-screen text, written to give instructions to AI tools. Show Hidden Text outlines where it is and lists what it says. A line that looks like an instruction to an AI is marked as a best guess, not a guarantee.

PROTECT ALL SITES (PRO)

- One switch for the websites you visit. It stays off until you turn it on and allow access to all sites
- Hides hidden text as pages load and change
- Can also mask API keys, tokens, and card numbers automatically. Emails and phone numbers can be added in settings
- You can pause it on specific sites
- Hiding happens on the page. DOMGuard does not record your screen and does not connect to other capture tools. Text inside iframes, or inside closed parts of a page, can remain visible

SCREENSHOTS

Capture what you can see and copy it to the clipboard. Paste with Ctrl+V on Windows or Command+V on Mac. DOMGuard does not download or save the picture.

- Drag a rectangle, or enter a width and height, to capture one area
- Capture the visible area from the toolbar
- Free: 3 plain screenshots per local day. These copies do not remove hidden text
- Pro: unlimited screenshots. These hide hidden text and clean faint pixels before the copy
- A shortcut capture may ask you to press Copy. Copying can fail on some pages

PRIVATE BY DESIGN

- Page content and screenshots are processed in your browser and are not uploaded
- No analytics, no tracking
- The only network connection is to ExtensionPay, to check Pro purchases
- DOMGuard runs on the tab you open, unless you turn on Protect all sites

PRICING

Free to start. DOMGuard Pro is a one-time $4.99 purchase, with no subscription. Payments are handled by ExtensionPay and Stripe. ExtensionPay keeps the email used for your purchase. See the privacy policy for details.

After you pay, quit Chrome completely and open DOMGuard again. Stripe can stay on its receipt page, and that page does not refresh the extension. If the plan still says Free, choose Restore purchase, sign in with the email from checkout, then quit Chrome and open DOMGuard again.

GOOD TO KNOW

- Works on web pages in your browser only, not in other desktop apps
- Chrome blocks extensions on chrome:// pages, the Chrome Web Store, the New Tab page, and the built-in PDF viewer
- Screenshots cover the visible area of the current tab
- Detection is best-effort. It cannot guarantee that every secret or every hidden instruction is found. Review the screen before sharing

## Single purpose

DOMGuard helps users hide sensitive information and hidden text on web pages before they share a screenshot or their screen, or paste page content into AI tools.

## Permission justifications

- activeTab: Used to capture a screenshot of the visible area of the current tab and to run DOMGuard on the current page only after the user clicks the extension or uses a shortcut.
- scripting: Used to inject DOMGuard's scanning and masking code into the current tab on demand, after the user clicks the extension or uses a shortcut. After Protect all sites is turned on, the same permission registers `protect-all.js` and `automask.js` for later visits.
- storage: Used to store settings and the daily free screenshot count in `chrome.storage.local`: `domguardScreenshotQuota` (local date and count), `maskStyle`, `protectAll`, `protectGrantNeeded`, `protectHideText`, `autoMask`, `maskApiKeys`, `maskCards`, `maskEmails`, `maskPhones`, `protectDisabledHosts` (hostnames), `customCaptureWidth`, `customCaptureHeight` (the last custom capture size in pixels), `domguardPurchaseVerified` (`paid` set to true, and `verifiedAt`; no email; removed only when ExtensionPay reports `paid` as false), `hintProtectSeen`, `hintCaptureSeen`, and `hintToolsSeen`. The ExtensionPay library uses `chrome.storage.sync` for `extensionpay_user`, `extensionpay_api_key`, and `extensionpay_installed_at`.
- Host permission https://extensionpay.com/*: Used only to check Pro purchase status and open the payment page through ExtensionPay. A small content script runs only on extensionpay.com so the extension can detect that a payment was completed. It does not run on any other website.
- Optional host permission (all sites): Requested only when a paid user turns on Protect all sites. A free click opens the upgrade panel and does not call `chrome.permissions.request`. The grant lets DOMGuard hide hidden text and mask sensitive data on pages the user visits, so the user does not have to enable it on each page. Everything is processed locally in the browser. The permission is not requested at install time. Turning the feature off removes `<all_urls>` when neither hidden-text hiding nor automatic masking still needs it.

## Remote code

No

## Data usage

Checked, carrying forward the previous form answers and comparing them with the code and `docs/privacy.html`:

- Personally identifiable information: checked. ExtensionPay stores the purchase user record, which can include the purchase email, in `chrome.storage.sync` under `extensionpay_user`. DOMGuard itself does not ask for an email.
- Financial and payment information: checked in the previous form. DOMGuard does not receive or store card numbers. Stripe and ExtensionPay handle the payment. The extension stores the paid flag inside the ExtensionPay user record.
- Website content: checked in the previous form. Page text and screenshots are processed in the browser and are not uploaded. Chrome's disclosure treats data as collected when it is transmitted off the device, so this box is broader than what the extension transmits.
- Everything else: not checked. No analytics, location, contacts, or health data.
- All three certifications: checked. The code has no sale or transfer of user data, no use unrelated to hiding secrets and hidden text, and no credit or lending use.

[MISMATCH: "Website content" is checked, but page content and screenshots are not sent off the device. If the form means transmitted data, leave this box unchecked. "Financial and payment information" is checked, but the extension never sees a card number. Leave it checked only if the form counts the ExtensionPay purchase record.]

## Test instructions for reviewers

Test on an ordinary https web page, such as a news article or a page you control. Do not start on chrome://, the Chrome Web Store, the New Tab page, or the built-in PDF viewer. Chrome blocks extensions there.

No account is required for the free tools: Manual picker, the Capture area shortcut, and Capture visible area. Free captures share 3 successful copies per local day. The fourth opens the upgrade panel. Hidden-text cleanup is not part of a free capture.

Pro tools require a one-time purchase through ExtensionPay and Stripe: Protect all sites, Auto Scan & Mask, Show Hidden Text, and unlimited screenshots. While the install is unpaid, clicking a Pro control opens the upgrade panel. Protect all sites asks for access to all sites only after the install is paid and the switch is turned on. It does not ask at install.

On `test/injection-demo.html`:

1. Open the file in a tab. If the address is file://, turn on "Allow access to file URLs" for DOMGuard, or serve the file over http on your machine and open that address.
2. Confirm the readable controls (ordinary body text, the grey caption, the 12px line, and the text on a gradient or image) are visible.
3. With Pro, click Show Hidden Text. Cases 1 through 5 should be listed, along with the instruction line and the open-shadow clip. The instruction line is marked as a heuristic.
4. Click Reveal on one row only. The other rows stay hidden. Press Escape or Close. A row that Protect all sites had hidden returns to the protected state.
5. Click "Remove case 4", then click that list row if it is still showing. The panel says the element is no longer on the page. Click Refresh, or wait about a second, after "Add an off-screen line". The new line appears in the list.

[OPTIONAL: reviewer Pro access instructions]

## Mismatch list

1. Summary and manifest description: "on any page" ignores pages Chrome blocks. "a clean screenshot" describes a Pro capture. Free captures are plain and limited to 3 per day.
2. The pasted description now says Protect all sites stays off until the user turns it on and allows access.
3. The pasted description now says DOMGuard does not record and does not connect to other capture tools.
4. Alt peek is described only while automatic masks are on.
5. The pasted description says a shortcut capture may ask for Copy, and that copying can fail on some pages. Mac paste is Command+V.
6. Show Hidden Text is labeled Pro.
7. The ExtensionPay plan button shows $4.99 Lifetime, matching the popup label.
8. The previous data-use form checks Website content and Financial and payment information. The extension does not transmit page content, screenshots, or card numbers.
