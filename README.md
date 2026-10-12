# DKDS: Domain-Keyed Document Stamp

The Domain-Keyed Document Stamp (DKDS) is an open protocol for verifying the origin and content of
documents. A stamp is a QR code printed on a document. It contains the key facts of the document, the
domain name of the issuer, the time of issue and an Ed25519 signature over all of these. The public
key that checks the signature is published in the DNS records of the issuer's domain, so that any
party can verify a stamp without an account, a registry or an intermediary.

## Contents

| Directory | Content |
|---|---|
| [`spec/`](spec/) | The specification of version 1, its test vectors, and the tools that generate the vectors and check them against an independent reference verifier |
| [`dkds.js/`](dkds.js/) | The reference implementation: a JavaScript library, the command-line tool `dkds` and a local HTTP API, published on npm as [`dkds.js`](https://www.npmjs.com/package/dkds.js) |
| [`scan/`](scan/) | scan.dkds.org, the verifier that runs in a web browser: camera, image and PDF files, and text |
| [`brand/`](brand/) | The colours, typefaces and mark shared by the websites |

## Status

Version 1 of the specification is final. Its test vectors are fixed with it: the SHA-256 digest of
[`spec/vectors/vectors.json`](spec/vectors/vectors.json) is recorded in
[`vectors.json.sha256`](spec/vectors/vectors.json.sha256). dkds.js implements version 1 in full and
passes every test vector in Node.js, Deno and Chrome.

## Building and testing

Each directory is a separate Node.js project. Node.js 24 or later is required for development.

```
cd spec/tools && npm install && npm test        # regenerate the vectors and check them
cd dkds.js && npm install && npm test           # unit tests, test vectors, differential tests (after spec/tools)
cd scan && npm install && npm test              # the verifier in Chrome (after installing dkds.js)
```

The same tests run on GitHub Actions for every push and pull request
([`.github/workflows/test.yml`](.github/workflows/test.yml)). Changes to dkds.js and scan.dkds.org are
recorded in their changelogs, [`dkds.js/CHANGELOG.md`](dkds.js/CHANGELOG.md) and
[`scan/CHANGELOG.md`](scan/CHANGELOG.md).

## Security

Vulnerabilities are reported privately, as described in [`SECURITY.md`](SECURITY.md).

## Licences

The specification and its test vectors are licensed under the Creative Commons Attribution 4.0
International licence (CC BY 4.0). dkds.js, scan.dkds.org and the specification tools in [`spec/tools/`](spec/tools/)
are licensed under the Apache License 2.0; see the `LICENSE` and `NOTICE` files in each directory.
The typefaces in [`brand/fonts/`](brand/fonts/) keep their own licences.
