# Changelog

Changes to dkds.js by version. Version numbers follow [Semantic Versioning](https://semver.org/).

## 1.1.0

Additions to the command-line tool; the library and every outcome are unchanged.

- `dkds check <file>` compares every key record in a file, one per line in the form printed by
  `dkds record`, with the published record, and reports each as `matches`, `differs`, `missing` or
  `unavailable`. Its exit status is 0 when every record matches, 1 when one differs or is missing, and
  2 when one could not be retrieved, so that a scheduled run reports a record that was changed,
  revoked or lost, for example in a move to another DNS provider. Lines in the form of a zone file,
  with a TTL, the class `IN` and several quoted strings, are read as well.
- `dkds keygen` takes `--domain` and `--key-id`, and then prints the record of the new key with its
  DNS name, in the form that `dkds record` prints and `dkds check` reads.

## 1.0.0

Implements version 1 of the specification and passes every test vector in Node.js, Deno and Chrome.

- Library: creating, inspecting and verifying stamps; key generation; key records; DNS over HTTPS with
  two resolvers; warnings from a key store; QR encoding and SVG output.
- Command-line tool `dkds`: `keygen`, `record`, `create`, `inspect`, `verify`, and `serve`, which
  starts the local HTTP API for creating and verifying stamps.
