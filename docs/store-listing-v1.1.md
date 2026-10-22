# DOMGuard store listing draft (v1.1)

Checked against `src/` on October 22, 2026. Sentences that the code does not support are not left as claims. Each one is marked `[MISMATCH: ...]`.

Title:
DOMGuard - Hide Secrets Before You Share or Paste to AI

Summary:
Hide API keys, emails and card numbers on any page, then copy a clean screenshot to share or paste into AI tools.

[MISMATCH: "on any page" is broader than the product. Chrome blocks extensions on chrome:// pages, the Chrome Web Store, the New Tab page, and the built-in PDF viewer. "a clean screenshot" matches Pro captures, which hide hidden text and run the pixel pass. A free capture is a plain copy of the visible tab, limited to 3 per local day (`FREE_DAILY_SCREENSHOTS` in `src/shared/config.ts`). The same sentence is the manifest description requested for this release.]

Description:

Before you share your screen, post a screenshot, or paste a page into an AI tool, hide what should not leave your browser.

DOMGuard masks sensitive data on web pages and hides text that people can't see but AI tools might read.

[MISMATCH: "Turn it on once and it keeps working on every site." Protect all sites is off until a paid install turns it on and Chrome grants optional access to all sites. It does not start on every site by itself.]

PROTECT ALL SITES (PRO)

- One switch for all websites. No need to turn it on page by page
- Hides hidden text as pages load and change, so it keeps working while you scroll or switch pages
- Optionally masks API keys, tokens and card numbers automatically. Emails and phone numbers can be added in settings
- Hold Alt to peek at the original text while automatic masks are on
- Turn it off for specific sites
- All-sites access is requested only when a paid install turns this on, and turning it off removes that permission when nothing else needs it

[MISMATCH: "Works with any screenshot or screen recording tool, including the ones built into your computer." DOMGuard does not record and does not connect to other capture tools. Hiding is a visual change on the page, and it is best-effort: iframes, closed shadow trees, and a burst over the time budget can leave text visible. A picture already copied is not changed.]

[MISMATCH: "Hold Alt to peek at the original text while masks are on" is only partly true. The Alt listener is in `src/content/automask.ts`, which runs when Protect all sites has "Mask sensitive data" on. The manual picker does not listen for Alt by itself.]

HIDE SENSITIVE DATA

- Click any element on a page to hide it (free)
- Choose a solid black or blurred mask
- Auto Scan & Mask finds API keys (OpenAI, Anthropic, AWS, GitHub, Stripe), JWT tokens, card numbers and optionally emails and phone numbers (Pro)
- Card numbers are checked before masking to reduce false alarms

SCREENSHOTS THAT JUST WORK

- Capture area, from the shortcut or the popup, lets you drag a rectangle. Releasing the drag copies the image when the page allows a clipboard write
- Press that shortcut again while the tool is open to capture the visible area. That second press does not copy by itself
- Capture a custom size by entering width and height in pixels
- Capture the visible area from the toolbar popup
- Paste with Ctrl+V on Windows or Command+V on Mac when the copy succeeded

[MISMATCH: "Press the shortcut, drag to select an area, and the image is already in your clipboard. Press Ctrl+V to paste it anywhere." A command shortcut does not give the page a user gesture, so the second press shows "Ready to copy" instead of copying. Clipboard write also fails on http pages and when the document is not focused. Mac paste is Command+V, not Ctrl+V.]

SEE WHAT'S HIDDEN

Some web pages contain text that people can't see, such as near-invisible, tiny or off-screen text, written to give instructions to AI tools. Show Hidden Text outlines where it is on the page and lists what it says, and flags text that looks like an instruction to an AI (a heuristic, not a guarantee).

[MISMATCH: this section does not say Show Hidden Text is Pro. `DETECT_HIDDEN_TEXT` is rejected with `PRO_REQUIRED` unless `isPro()` is true in the service worker.]

KEYBOARD SHORTCUTS

Suggested keys are the `commands` entries in `manifest.json`. The welcome page does not hardcode them. It fills the table from `chrome.commands.getAll()` and labels known commands in `src/shared/shortcuts.ts`. Until you change a shortcut, Chrome uses the suggested key. "Open DOMGuard" is the toolbar command Chrome reports as `_execute_action`. The manifest does not suggest a key for it, so the welcome page shows "Not set" until you set one.

| Action | Default shortcut |
| --- | --- |
| Turn Protect all sites on or off | Alt+Shift+P |
| Mask sensitive data on this page | Alt+Shift+M |
| Capture an area of the page | Ctrl+Shift+S (Command+Shift+S on Mac) |
| Open DOMGuard | Not set |

You can change them at chrome://extensions/shortcuts

PRIVATE BY DESIGN

- Page content and screenshots are processed locally in your browser and never leave your device
- No analytics, no tracking
- The only network connection is to ExtensionPay, to check Pro purchases
- Minimal permissions, and DOMGuard only runs on the tab you activate unless you turn on Protect all sites

PRICING

Free to start. DOMGuard Pro is a one-time $4.99 purchase, with no subscription. Payments are handled by ExtensionPay and Stripe. ExtensionPay keeps the email used for your purchase. See the privacy policy for details.

[MISMATCH: `$4.99` is the label in `src/popup/index.html`. This pass did not read the price configured at ExtensionPay. If that dashboard price differs, the popup label is wrong.]

Free vs Pro, from the service worker and `FREE_DAILY_SCREENSHOTS`:

- Free: manual picker, clear masks, and the black or blurred mask style. Capture visible area, Capture area, and custom size share 3 plain screenshots per local day. Those copies do not remove hidden text and do not run the pixel pass. The count is stored only after a successful clipboard write.
- Pro: Protect all sites, Auto Scan & Mask (including the quick-mask shortcut), Show Hidden Text, and unlimited screenshots. Pro screenshots hide hidden text and run the pixel pass.

GOOD TO KNOW

- Works on web pages in your browser only, not in other desktop apps
- Chrome blocks extensions on chrome:// pages, the Chrome Web Store, the New Tab page and the built-in PDF viewer
- Hidden text inside iframes and closed shadow roots is not covered
- Screenshots cover the visible area of the current tab
- Detection is best-effort. It can't guarantee that every secret or every hidden instruction is found, so always review your screen before sharing
- Phone number detection covers international format (+ country code) and Taiwan mobile numbers

## Single purpose

DOMGuard helps users hide sensitive information and hidden text on web pages before they share a screenshot or their screen, or paste page content into AI tools.

## Permission justifications

- activeTab: Used to capture a screenshot of the visible area of the current tab and to run DOMGuard on the current page only after the user clicks the extension or uses a shortcut.
- scripting: Used to inject DOMGuard's scanning and masking code into the current tab on demand, after the user clicks the extension or uses a shortcut. After Protect all sites is turned on, the same permission registers `protect-all.js` and `automask.js` for later visits.
- storage: Used to store settings and the daily free screenshot count in `chrome.storage.local`: `domguardScreenshotQuota` (local date and count), `maskStyle`, `protectAll`, `protectGrantNeeded`, `protectHideText`, `autoMask`, `maskApiKeys`, `maskCards`, `maskEmails`, `maskPhones`, `protectDisabledHosts` (hostnames), `customCaptureWidth`, `customCaptureHeight` (the last custom capture size in pixels), `hintProtectSeen`, `hintCaptureSeen`, and `hintToolsSeen`. The ExtensionPay library uses `chrome.storage.sync` for `extensionpay_user`, `extensionpay_api_key`, and `extensionpay_installed_at`.
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
2. "Turn it on once and it keeps working on every site" is not the default. Protect all sites is a paid switch plus an optional permission.
3. "Works with any screenshot or screen recording tool, including the ones built into your computer" overstates coverage. DOMGuard does not record, and hiding is best-effort.
4. Alt peek runs from the automatic-mask script, not from the manual picker alone.
5. A capture shortcut does not always leave the image on the clipboard, and Ctrl+V is not the paste key on Mac. http pages and an unfocused document cannot copy.
6. Show Hidden Text is Pro. The feature paragraph did not say so.
7. $4.99 is the popup label. The ExtensionPay dashboard price was not checked in this pass.
8. The previous data-use form checks Website content and Financial and payment information. The extension does not transmit page content, screenshots, or card numbers.
