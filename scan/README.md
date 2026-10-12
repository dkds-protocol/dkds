# scan.dkds.org

The verifier of DKDS stamps that runs in a web browser. It reads a stamp with the camera, from an
image or PDF file, or as pasted text, verifies it with [dkds.js](../dkds.js/), and displays the
result as required by section 9.1 of the specification. Documents are processed on the device; the
only network requests after loading are the DNS queries for the issuer's key.

## Function

| Input | Control | Behaviour |
|---|---|---|
| Camera | "Open camera" | The rear camera is read continuously until a stamp is found; the torch where the device has one, and a change between the rear and the front camera |
| Image | "Open file", or dropped or pasted onto the page | PNG, JPEG, WebP, GIF and BMP; HEIC and AVIF where the browser decodes them |
| PDF file | "Open file" | Up to 50 pages are rendered at 300 dots per inch and read; password-protected files are opened with the reader's password |
| Text | "Paste text", or pasted onto the page | The text form `DKDS:…` is verified exactly as entered; pasted text is taken from the plain-text form of the clipboard |

Every stamp found is verified independently; a stamp that appears on several pages is shown once,
with its pages. A QR code that is not a stamp is reported as such, and its content is not shown. Its
text is discarded in the decoder's worker and never reaches the page, so that the verifier cannot be
used to pass on a phishing address.

The result card follows section 9.1. For `valid`, the outcome, the domain (in Unicode form, with the
ASCII form below an internationalised domain), the time of signing in local time with its UTC offset,
the DNSSEC status and the warnings come first; the fields follow in a table of names and values under
"Contents of the stamp, signed by <domain>", each value in its own bidirectional isolate and
unformatted, with the raw text of the stamp below them on request. For any other outcome, the card shows the outcome and one
sentence of explanation, and no fields. Each card is tagged with where the stamp was read: the
camera, the text, or the file and its pages.

The key store of section 9.2 is kept in the browser's local storage. It holds lookup names, key
records and domains, never fields, and enables the warnings `key-changed`, `key-disappeared` and
`similar-domain`. "Forget verified domains" clears it.

The camera screen fills the display without the header: the controls form one row at the bottom and
the frame is centred in the space above them. "Switch camera" changes between the rear and the front
camera; where the browser does not report the direction of a camera, as on most computers, it
changes to the next camera in the browser's list. Links to dkds.org, the source code and `licences.txt`
open in a new tab, so that the verifier stays open, also when installed as an application. The
footer gives the verifier's version (`package.json`) and the build identifier, a hash of the built
files that also names the service worker's cache, so that a report of a fault can name the build.

## Languages

The verifier is available in English, Dutch, French, German, Spanish and Italian. English is the
source: `src/i18n/en.ts` holds every text, and each other language is a module of the same type, so
that a text missing from a language, or one it has in addition, does not compile. Field names and
values of stamps, domain names and technical details are shown as they are, and are marked
`translate="no"` so that a translating browser leaves them unchanged.

The language is taken from the parameter `lang` of the address (the translated pages of dkds.org link
to the verifier with it), then from a choice made in the language menu of the header and stored on
the device, then from the browser's preferred languages, and is English otherwise. A change in the
menu redraws the home, text, result and problem screens; the menu is disabled while the camera, a
file or a verification is at work. Plurals and lists follow the rules of each language through the
browser's `Intl.PluralRules` and `Intl.ListFormat`, and times are written in its conventions.

English is part of the application; each other language is a separate file, fetched when it is
chosen and stored by the service worker, so that languages add nothing to the start of the
application.

## Privacy and security

- The Content Security Policy limits connections to the verifier's own origin and to the resolvers
  of `DEFAULT_DOH_SERVERS` in dkds.js, read at build time. Scripts, styles and fonts come only from
  the verifier's origin; there are no analytics, cookies or third-party resources.
- Text read from a stamp is inserted into the page as text, never as HTML.
- The policy is given in a `meta` element and as a response header in `vercel.json`, which also
  sets `frame-ancestors 'none'` and applies the policy to the workers. The build writes
  `vercel.json`; it is committed because Vercel reads it before building.

## Errors

Each condition that ends an input has its own screen, with the inputs that remain possible: camera
access denied (with instructions for iOS and Android), no camera, camera in use, camera not supported
or not available without HTTPS, camera stopped; file empty, too large (over 100 MB), of another type,
or not decodable; PDF file damaged or protected with a password; PDF reader not loadable offline; no
QR code found; only QR codes that are not stamps; QR reader not loadable. A browser that lacks
WebAssembly, workers or `AbortSignal.timeout` is told so; without JavaScript, the page says what it
requires.

## Building and testing

dkds.js is used from `../dkds.js/src`, so that the verifier always runs the current library; its
dependencies are installed first.

```
cd ../dkds.js && npm install
cd ../scan && npm install
npm run build        # out/, ready for a static host
npm run serve        # out/ at http://localhost:8045 as Vercel serves it; Ctrl+C stops it
npm run typecheck
npm test             # builds, then runs test/run.mjs in Chrome
```

The tests need Google Chrome; `CHROME_PATH` selects another installation. They answer the DNS
queries themselves, from the test vectors, and cover:

- the 181 test vectors, entered as text, compared with the outcome, the names queried and, for valid
  stamps, the domain, time, DNSSEC status and fields as displayed;
- images of stamps of QR versions 8 to 27 (the smallest stamp has version 8) at 2 pixels per module,
  rotated, and blurred, noisy, unevenly lit and in perspective; versions 1 to 7 with shorter text;
- several codes in one image, and files without a stamp;
- PDF files with stamps drawn as vectors and as embedded images, repeated stamps, 55 pages, and a
  password;
- the camera, through Chrome's simulated camera, with stamps of versions 12 and 27 and another QR
  code; the camera screen without the header, its controls in one row and its frame centred, at
  every width; denied, missing, busy and unsupported cameras;
- warnings from the key store, local storage being unavailable, the back button, dropping a file;
- offline use through the service worker, and `licences.txt` opened as a page online and offline;
- links that open in a new tab, and the version and build in the footer;
- the layout of every screen at widths from 320 to 1440 pixels: no horizontal scrolling, no text
  that extends past its box or is cut off, and no word broken without a hyphen, with screenshots in
  `test/out/screens/`;
- every language: each text and each sentence built from data differs from the English one, apart
  from a short list of words that are the same (such as "Privacy" in Dutch); every kind of screen,
  in every language, at every width, without English text and with the layout checks above; the
  camera controls in one row; the language menu, its stored choice, the parameter of the address
  and the browser's preference; a language loaded offline;
- the absence of requests to any host other than the two resolvers, of script errors and of CSP
  violations, and the size of the application.

Photographs of printed stamps are approximated by the distorted images; tests on phones remain to be
made by hand.

## Size

| Part | Size (gzip) | Loaded |
|---|---|---|
| Application, dkds.js and English included | 42 KB | at start |
| Each other language | 4 KB | when it is chosen |
| QR decoder (zxing-wasm) | 416 KB | at start, in a worker |
| pdf.js, legacy build | 530 KB | when the first PDF file is opened |

The service worker stores the application, the decoder and the fonts at installation, and pdf.js
when it is first used.

## Source files

| File | Content |
|---|---|
| `src/main.ts` | Screens, history and the flow from an input to its result |
| `src/text.ts` | The languages and the choice among them |
| `src/i18n/en.ts` | Every text shown, in English, the source; the outcome descriptions are also rendered into the documentation |
| `src/i18n/nl.ts`, `fr.ts`, `de.ts`, `es.ts`, `it.ts` | The translations |
| `src/i18n/grammar.ts` | Plurals and lists in the rules of each language |
| `src/result.ts` | The result card (section 9.1) |
| `src/verify.ts` | Verification with dkds.js and the key store |
| `src/keystore.ts` | The key store in local storage |
| `src/camera.ts` | The camera and the scanning loop |
| `src/files.ts`, `src/image.ts`, `src/pdf.ts` | Images and PDF files |
| `src/decoder.ts`, `src/decoder.worker.ts`, `src/protocol.ts` | The QR decoder in a Web Worker |
| `src/sw.ts` | The service worker |
| `build.mjs` | The build: bundles, Content Security Policy, `vercel.json`, icons from `../brand`, manifest, build identifier |
| `serve.mjs` | A local server that serves a build as Vercel does; also used for the site |

## Hosting

The verifier is a static site: `out/` can be served by any web server that sends the headers of
`vercel.json`. It does not work when `index.html` is opened from disk, because browsers do not
permit module scripts, workers, WebAssembly loading and service workers for `file:` addresses. It
is hosted on Vercel as a project whose root directory is `scan/`; `vercel.json` gives the install
and build commands.

## Licence

Apache License 2.0; see `LICENSE` and, for the works contained in the build, `NOTICE`.
