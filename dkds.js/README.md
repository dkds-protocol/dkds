# dkds.js

dkds.js is the reference implementation of the Domain-Keyed Document Stamp (DKDS) protocol, version
1. It creates and verifies stamps, and can be used as a JavaScript library, as the command-line tool
`dkds`, or as a local HTTP API for software written in other languages.

Every rule of the specification is applied; none can be disabled. The library passes all test
vectors of the specification in Node.js, Deno and Chrome, and produces identical stamps in each.

## Installation

```
npm install dkds.js
```

The library runs in Node.js 22 and later, in current browsers, in Deno and in Bun. The command-line
tool and the local HTTP API require Node.js.

## Verifying a stamp

```js
import { verifyStamp } from "dkds.js";

const result = await verifyStamp(text);
```

`text` is the string that a QR scanner returns. The result contains the outcome and, when the outcome
is `valid`, the fields:

```js
{
  outcome: "valid",
  step: 12,
  reason: "The stamp was signed with the key published for its domain and key ID.",
  domain: "northwind.example",
  domainUnicode: "northwind.example",
  keyId: "k2026",
  issuedAt: 1790758800,
  dnssec: false,
  resolvers: 2,
  warnings: [],
  fields: [["Supplier", "Northwind B.V."], ["Invoice no.", "2026-0917"]]
}
```

The outcome is one of `valid`, `malformed`, `unsupported`, `key-not-found`, `key-revoked`,
`invalid-signature` and `unavailable` (specification 8.1). `step` is the step of the verification
procedure (specification 8.2) that determined it. `fields` is present only for `valid`.

`verifyStamp` does not throw because of the stamp or the DNS. It throws a `DkdsError` with the code
`invalid-argument` only when it is called incorrectly.

| Option | Default | Meaning |
|---|---|---|
| `now` | the system clock | The verifier's clock, in Unix seconds. |
| `resolve` | two DNS over HTTPS resolvers | The DNS lookup (see [DNS](#dns)). |
| `keyStore` | none | Remembers key records, for the warnings `key-changed`, `key-disappeared` and `similar-domain`. |
| `signal` | none | An `AbortSignal` that cancels the DNS lookup. |

### Presenting the result

The result keeps the issuer's fields in `fields`, apart from the verifier's statements, as section
9.1 of the specification requires of results returned to software. An application that displays the
result to a person shows the outcome, the domain, the time of issue with its time zone, the DNSSEC
status and the warnings, followed by the fields under a heading that identifies them as statements of
the issuer.

## Creating a stamp

```js
import { createStamp } from "dkds.js";

const stamp = await createStamp({
  domain: "northwind.example",
  keyId: "k2026",
  privateKey: pem,
  fields: [
    ["Supplier", "Northwind B.V."],
    ["Invoice no.", "2026-0917"],
    ["Amount", "4,812.50 EUR"],
  ],
});

stamp.text;      // the text form, "DKDS:..."
stamp.svg;       // the QR code as SVG, 0.33 mm per module, with a quiet zone of 4 modules
stamp.qr;        // { version, mask, size, modules }, for drawing the code in another format
stamp.envelope;  // the envelope bytes
```

Fields are given as an array of `[name, value]` pairs or as a `Map`, in the order in which they are
displayed. Plain objects are not accepted, because JavaScript orders object keys that look like
integers before all other keys. Names and values are converted to Unicode Normalization Form C.

`createStamp` checks every rule that a verifier checks and verifies the signature it has made before
returning the stamp. It throws a `DkdsError` when a rule is not met; the `code` of the error identifies
the rule, for example `domain-invalid`, `field-name-duplicate`, `forbidden-code-point` or `too-large`.

The same input always produces the same stamp, in every runtime.

### Keys held outside the process

A private key held in a hardware security module or a key management service is used through a
signer instead of `privateKey`:

```js
const stamp = await createStamp({
  domain: "northwind.example",
  keyId: "k2026",
  signer: {
    publicKey,                                   // 32 bytes
    sign: async (message) => kms.sign(message),  // returns the 64-byte Ed25519 signature
  },
  fields,
});
```

A signature that does not verify under `publicKey` is rejected with the code `signer-mismatch`.

## Keys and key records

```js
import { generateKey, keyRecord, publicKeyOf } from "dkds.js";

const { privateKey, publicKey } = generateKey();  // PKCS#8 PEM, 32 bytes
keyRecord(publicKey);                             // "v=DKDS1; k=ed25519; p=..."
keyRecord(null);                                  // "v=DKDS1; k=ed25519; p=", which revokes the key
publicKeyOf(privateKey);                          // the public key of a PEM key or a 32-byte seed
```

Private keys are stored as PKCS#8 PEM (RFC 8410). Keys generated with OpenSSL
(`openssl genpkey -algorithm ed25519`) are accepted.

The key record is published as a TXT record at `<key ID>._dkds.<domain>`.

## DNS

By default, `verifyStamp` queries Cloudflare (`cloudflare-dns.com`) and Google (`dns.google`) in
parallel over DNS over HTTPS (RFC 8484). When both answer and the answers differ, the outcome is
`unavailable`. When only one answers, its answer is used and the warning `single-resolver` is given.
`dnssec` is `true` only when every answering resolver validated the answer with DNSSEC.

Other resolvers are configured with `resolve`:

```js
import { combineResolvers, dohResolver } from "dkds.js";
import { systemResolver } from "dkds.js/node";

const resolve = combineResolvers(
  dohResolver("https://doh.first.example/dns-query"),
  dohResolver("https://doh.second.example/dns-query"),
);
await verifyStamp(text, { resolve });

await verifyStamp(text, { resolve: systemResolver() });  // the operating system's DNS; dnssec is always false
```

Some servers, such as Quad9, accept DNS over HTTPS only over HTTP/2, which RFC 8484 recommends. The
built-in `fetch` of Node.js uses HTTP/1.1; such servers are used in Node.js by passing a `fetch`
function with HTTP/2 support in the options of `dohResolver`. Browsers negotiate HTTP/2 themselves.

A resolver is any function that takes a DNS name and returns one of
`{ result: "answer", txt, dnssec }`, `{ result: "nxdomain" }` or `{ result: "failure" }`, where `txt`
lists the TXT records at the name, each as its list of character strings.

## Warnings

Warnings inform the reader. They never change the outcome.

| Code | Meaning |
|---|---|
| `idn` | The domain contains internationalised labels; the result contains both forms. |
| `mixed-script` | A label of the domain mixes scripts, for example Latin and Cyrillic. |
| `single-resolver` | Only one of several resolvers answered. |
| `key-changed` | The key record differs from the one in the key store. |
| `key-disappeared` | A key record in the key store is no longer published. |
| `similar-domain` | The domain resembles a domain in the key store. |

A key store is an object with the methods `get(lookupName)`, `set(lookupName, record, domainUnicode)`
and, optionally, `domains()`.

## Inspecting a stamp

`inspectStamp(text)` returns the domain, key ID, time of issue and sizes of a stamp without verifying
it and without any DNS query. It never returns the fields.

## Command-line tool

```
dkds keygen --out key.pem
dkds record --key key.pem --domain northwind.example --key-id k2026 [--check]
dkds record --revoke --domain northwind.example --key-id k2026
dkds create --key key.pem --domain northwind.example --key-id k2026 \
            --field "Invoice no.=2026-0917" --field "Amount=4,812.50 EUR" --svg stamp.svg
dkds verify "DKDS:..." [--json]
dkds inspect "DKDS:..." [--json]
dkds serve [--key key.pem --domain northwind.example --key-id k2026]
```

`dkds verify` and `dkds inspect` read the stamp from standard input when it is not given as an
argument. Times are given as Unix seconds or in ISO 8601 with a time zone.

The exit status of `dkds verify` is 0 for `valid`, 2 for `unavailable`, and 1 for every other outcome.
Incorrect usage gives 64.

## Local HTTP API

`dkds serve` starts an HTTP server on `127.0.0.1:8445`.

| Request | Body | Response |
|---|---|---|
| `GET /` | | `{ "dkds": "1", "version": "..." }` |
| `POST /verify` | `{ "text": "DKDS:..." }` | the result of `verifyStamp` |
| `POST /create` | `{ "fields": [[name, value], ...], "issuedAt": 1790758800 }` | `{ "text": "...", "svg": "..." }` |

`/create` is available only when a key is given at start, and requires the header
`Authorization: Bearer <token>`. The token is read from the environment variable `DKDS_TOKEN`, or
generated and printed at start.

The server refuses requests that carry an `Origin` header, so that web pages opened in a browser on
the same computer cannot use it. It also refuses requests whose `Host` header does not name the
server, bodies that are not `application/json`, and bodies larger than 64 KB. Errors are returned as
`{ "error": { "code": "...", "message": "..." } }`.

## Testing

```
npm test                                  # unit tests, test vectors, differential and mutation tests
npm run build && npm run test:runtimes    # the test vectors in Node.js, Deno and Chrome
```

The test suite includes the 181 test vectors of the specification and a comparison with the reference
verifier of the specification on mutated stamps; that comparison requires the dependencies of
`../spec/tools` to be installed (`npm install` there). It compares the QR encoder with the `qrcode` package
for every version and mask, and decodes its output with jsQR and ZXing. It compares the DEFLATE
decompressor with zlib on valid, corrupted, truncated and extended streams.

## Dependencies

`@noble/curves` and `@noble/hashes` provide Ed25519 and SHA-512. Base45, Punycode, DEFLATE, the QR
encoder and DNS messages are implemented in the package. The minified browser bundle is 73 KB, or 29 KB
compressed with gzip.

## Licence

Apache License 2.0.
