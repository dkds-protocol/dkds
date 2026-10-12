# Security policy

This policy covers the reporting of vulnerabilities in the DKDS specification, its reference
implementation dkds.js, the browser verifier at scan.dkds.org, and the test vectors and tools in this
repository.

## Scope

| Component | Covered | Versions |
|---|---|---|
| Specification ([`spec/specification.md`](spec/specification.md)) | Flaws in the protocol that allow a stamp to verify as valid without the issuer's private key, or that let a verifier display something other than what was signed | Version 1 |
| dkds.js ([`dkds.js/`](dkds.js/)) | Deviations from the specification that affect the outcome of verification, and defects that allow hostile input to crash, exhaust or take control of the host | The latest release on npm |
| scan.dkds.org ([`scan/`](scan/)) | The same as for dkds.js, and defects that disclose data from the device, such as the content of documents, or that let a page inject markup or script | The deployed version |
| Test vectors and tools ([`spec/vectors/`](spec/vectors/), [`spec/tools/`](spec/tools/)) | Expected results that contradict the specification | The current version |

The following are not vulnerabilities in the sense of this policy:

- Properties of the protocol that section 12 of the specification and the page
  [Security considerations](https://dkds.org/docs/security) describe, such as lookalike domains,
  stolen keys, lapsed domains, forged DNS answers for zones without DNSSEC, copied stamps and the
  absence of confidentiality. Proposals that reduce their effect are welcome as ordinary issues.
- The key management of individual issuers, and the operation of DNS resolvers and DNS hosting.
- The website dkds.org, which is a static site without user data; defects in it can be reported as
  ordinary issues.

## Reporting

Vulnerabilities are reported privately through GitHub: on the page of the repository
[dkds-protocol/dkds](https://github.com/dkds-protocol/dkds), under Security, "Report a
vulnerability". Public issues are not used for vulnerabilities until a fix is available.

A useful report states the component and version affected, the steps or the stamp text that
reproduce the problem, and the consequence. A stamp that demonstrates a flaw should be signed with a
key generated for the purpose, never with an issuer's production key.

## Handling

1. The report is acknowledged, normally within seven days.
2. The problem is confirmed or rejected, with reasons, in the private advisory.
3. A fix is prepared in private. For dkds.js it is released on npm; scan.dkds.org is redeployed. A flaw
   in the specification is corrected in a new revision of the specification and covered by new test
   vectors, and, where needed, by a new protocol version (section 11).
4. The advisory is published on GitHub once the fix is available, with credit to the reporter unless
   anonymity is requested. A CVE identifier is requested for vulnerabilities in released software.

Where a flaw affects other implementations of the protocol, their maintainers are informed before
publication where they can be identified.
