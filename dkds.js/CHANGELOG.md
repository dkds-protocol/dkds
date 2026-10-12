# Changelog

Changes to dkds.js by version. Version numbers follow [Semantic Versioning](https://semver.org/).

## 1.0.0

Implements version 1 of the specification and passes every test vector in Node.js, Deno and Chrome.

- Library: creating, inspecting and verifying stamps; key generation; key records; DNS over HTTPS with
  two resolvers; warnings from a key store; QR encoding and SVG output.
- Command-line tool `dkds`: `keygen`, `record`, `create`, `inspect`, `verify`, and `serve`, which
  starts the local HTTP API for creating and verifying stamps.
