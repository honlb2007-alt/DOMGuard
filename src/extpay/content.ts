// Payment-detection script required by ExtPay for onPaid. The manifest matches
// only https://extensionpay.com/*, so this never runs on pages the user browses.
// Importing the package registers its page-message listener; it does not scan
// or modify the page.
import 'extpay';
