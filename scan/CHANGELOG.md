# Changelog

Changes to scan.dkds.org by version. The version and the build identifier of the deployed verifier
are shown in its footer.

## 1.0.1

- Pasted text is taken from the plain-text form of the clipboard. Safari on iOS and iPadOS pasted
  the text of a stamp in the form of a link, with the prefix in lowercase and some characters
  percent-encoded, so that a stamp copied and pasted on an iPhone or iPad was reported as malformed.
  See [Text from other sources](https://dkds.org/docs/verifying#text-from-other-sources) in the guide
  to building a verifier.

## 1.0.0

- Inputs: the camera, with a torch and switching between the rear and the front camera; image files;
  PDF files of up to 50 pages, including files protected with a password; and the text form of a
  stamp. Files can also be dropped or pasted onto the page.
- Verification with dkds.js against two DNS resolvers, and the key store of section 9.2 in the
  browser's local storage.
- A result card per stamp, as required by section 9.1 of the specification: the outcome, the domain,
  the time of signing in local time with its UTC offset, the DNSSEC status and the warnings, followed
  by the fields in a table under "Contents of the stamp, signed by <domain>", and the raw text of the
  stamp, which can be copied. Each card names where the stamp was read: the camera, the text, or the
  file and its pages.
- A screen for each condition that ends an input, such as camera access denied or a file without a
  QR code.
- Languages: English, Dutch, French, German, Spanish and Italian, chosen in a menu in the header, by
  the address (`?lang=nl`) or by the browser's preference. Each language other than English is loaded
  when it is chosen. Field names and values, domain names and technical details are marked so that a
  translating browser leaves them unchanged.
- Use without a network after the first visit, through a service worker, and installation as an
  application.
- A Content Security Policy that limits connections to the verifier's own origin and the two
  resolvers.
