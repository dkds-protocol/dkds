# Domain-Keyed Document Stamp (DKDS), version 1

Status: final. Published 12 October 2026. Version 1 is not changed except to correct errors; changes
to the protocol are made in a later version (section 11).

Corrected 19 October 2026: sections 1 and 9.1 described the time of issue as established by a valid
stamp; it is stated by the signer (section 12).

Copyright 2026 Vince Lubbers. This specification is licensed under the Creative Commons Attribution 4.0
International licence (CC BY 4.0).

---

## 1. Introduction

A DKDS stamp is a QR code printed on a document. It contains the key facts of the document, the
domain name of the issuer, the time of issue and a digital signature over all of these. The public
key needed to check the signature is published in the DNS records of the issuer's domain. Any party
can verify a stamp without an account, a registry or an intermediary.

A valid stamp establishes that the holder of the domain signed the stamp, that its facts have not
been altered since, and the time of signing as stated by the signer. It does not establish that the
facts are true, or that the document it is printed on matches it; the reader makes that comparison.

### 1.1 Conformance language

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT and MAY are to be interpreted as
described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in capitals.

### 1.2 Roles

- **Issuer**: the organisation that holds a domain, publishes a key under it and signs stamps.
- **Verifier**: software that reads a stamp, retrieves the key and reports an outcome.
- **Reader**: the person who uses the result of a verifier and compares it with the document, or an
  automated process that makes this comparison on a person's behalf.

### 1.3 Notation

Integers are unsigned and big-endian unless stated otherwise. `||` denotes concatenation of byte strings. ASCII strings in
quotes denote their bytes, without a terminator. Hexadecimal values are written `0x2A`.

---

## 2. Structure

DKDS is defined as five layers. Each layer has one function and depends only on the layers named
below.

| Layer | Function | Defined in | Depends on |
|---|---|---|---|
| Carrier | Represents the envelope as a QR code | Section 3 | The envelope as an opaque byte string |
| Envelope | Holds the header, payload and signature | Section 4 | Payload and signature as byte strings |
| Payload | Holds the issuer's facts | Section 5 | Nothing |
| Signature | Protects the envelope against alteration | Section 6 | A message, a public key, an algorithm |
| Key discovery | Maps a domain and key ID to a public key | Section 7 | A domain and a key ID |

A protocol version fixes every choice in every layer. Nothing within a version is optional or
negotiable. Section 11 describes how later versions change one layer at a time.

---

## 3. Carrier

### 3.1 Text form

The text form of a stamp is the ASCII string `"DKDS:"` followed by the Base45 encoding (RFC 9285)
of the envelope:

```
text = "DKDS:" || Base45(envelope)
```

The text MUST consist of exactly these characters, with nothing before or after them. It MUST be at
most 1,637 characters long, which limits the envelope to 1,088 bytes.

### 3.2 Base45

Base45 encoding and decoding follow RFC 9285, with these requirements on decoding:

- every character MUST be in the Base45 alphabet; there is no case folding;
- a group of three characters whose value exceeds 65,535 is invalid;
- a final group of one character is invalid;
- a final group of two characters whose value exceeds 255 is invalid.

Under these rules every envelope has exactly one text form.

### 3.3 QR code

The text form is encoded as one QR code (ISO/IEC 18004) in alphanumeric mode, with error correction
level M. The full text, including the prefix, uses only the QR alphanumeric character set. A stamp
uses QR version 27 or lower; a verifier MUST read every version up to and including 27.

A document MAY carry several stamps. Each is verified independently.

---

## 4. Envelope

### 4.1 Layout

| Field | Size | Content |
|---|---|---|
| `version` | 1 byte | `0x01` |
| `domain_len` | 1 byte | Length of `domain` in bytes; bounded by 4.2 and by the length of the lookup name |
| `domain` | `domain_len` bytes | The issuer's domain name (4.2) |
| `keyid_len` | 1 byte | Length of `key_id`, 1 to 16 |
| `key_id` | `keyid_len` bytes | Key identifier (4.3) |
| `issued_at` | 4 bytes | Time of signing, in seconds since 1970-01-01T00:00:00Z, excluding leap seconds |
| `payload_len` | 2 bytes | Length of `payload` in bytes, at least 1 |
| `payload` | `payload_len` bytes | Section 5 |
| `signature` | the remaining bytes | Section 6; at least 1 byte |

The envelope MUST be at most 1,088 bytes. The part of the envelope before `signature` is called the
**signed part**.

### 4.2 Domain

`domain` is an ASCII domain name with no trailing dot. It MUST satisfy all of the following:

- it consists of at least two labels separated by `.`;
- each label is 1 to 63 characters from `a` to `z`, `0` to `9` and `-`;
- no label begins or ends with `-`;
- a label whose third and fourth characters are `--` MUST begin with `xn--`;
- for a label that begins with `xn--`, the characters after `xn--` MUST be valid Punycode: decoding
  them as in RFC 3492, section 6.2, MUST succeed and MUST NOT produce a surrogate (U+D800 to U+DFFF)
  or a code point above U+10FFFF. The decoded string MUST contain no forbidden code point
  (Appendix B) and none of the full stops U+3002, U+FF0E and U+FF61, which display like `.`, and
  encoding it with Punycode MUST reproduce exactly the characters after `xn--`.
  (A label whose decoded form is ASCII only always ends with `-`, and is already excluded by the
  rule on hyphens.)

RFC 3492 detects integer overflow relative to the size of the integers an implementation uses. Under
the rules above, integers of 32 bits and integers of arbitrary precision give the same result for
every label.

The **Unicode form** of the domain is the domain with every `xn--` label replaced by its decoded
string. These rules are purely algorithmic: they need no Unicode character tables, so every verifier
reaches the same result. Whether the Unicode form is a valid internationalised domain name under
IDNA2008 (RFC 5891) is not checked here; verifiers report doubtful names as warnings (9.3).

The **lookup name** is `key_id || "._dkds." || domain`. It MUST be at most 253 characters long.

### 4.3 Key ID

`key_id` is 1 to 16 characters from `a` to `z` and `0` to `9`. It identifies one key of the issuer.

### 4.4 Version

`0x01` identifies this version. `0x00` and `0xFF` are reserved and never assigned. Any other value
identifies a version this document does not define.

---

## 5. Payload

### 5.1 Encoding

The payload is a list of fields, encoded as below and then compressed with raw DEFLATE (RFC 1951).
The compressed bytes are the `payload` field of the envelope.

```
count          1 byte       number of fields, 1 to 255
then, for each field, in display order:
  name_len     1 byte       1 to 255
  name         name_len bytes, UTF-8
  value_len    2 bytes      0 to 65,535
  value        value_len bytes, UTF-8
```

Every field is a name and a value, both text. There are no other types.

### 5.2 Rules

A payload is valid only if all of the following hold:

- the DEFLATE stream is valid and ends exactly at the end of `payload`. A stream is invalid if it
  is truncated or contains any of the following: a block of type 3; a stored block whose `LEN` and
  `NLEN` do not match; a Huffman code that is over-subscribed, or incomplete (except a
  literal/length or distance code that consists of a single code of length 1); a literal/length code
  without the end-of-block symbol; more than 286 literal/length or 30 distance code lengths; a
  repeat code that has no previous length or repeats past the declared number of lengths; length
  symbol 286 or 287; distance symbol 30 or 31; a distance that reaches before the start of the
  output. These are the rules of the `inflate` function of zlib;
- the decompressed data is at most 16,384 bytes; a decoder MUST stop decompressing once this limit
  is exceeded;
- the field list ends exactly at the end of the decompressed data;
- every name and value is valid UTF-8 (RFC 3629) and contains no forbidden code point (Appendix B);
- no two names are equal, compared byte for byte.

Values MAY be empty. Issuers SHOULD use Unicode Normalization Form C; verifiers do not check it.

---

## 6. Signature

### 6.1 Signed message

The signed message is the ASCII string `"DKDS"` followed by the signed part of the envelope:

```
message = "DKDS" || signed_part
```

The prefix `"DKDS"` is not transmitted. It ensures that a DKDS signature cannot be valid as a
signature in another protocol that signs different data.

### 6.2 Algorithm

The algorithm is named by the key record (section 7), never by the stamp. This version defines one
algorithm, `ed25519`.

### 6.3 Ed25519

Ed25519 is used as defined in RFC 8032, section 5.1, with the following rules, which remove the
differences between implementations. The public key `A` is 32 bytes. The signature is 64 bytes,
`R || S`, where `R` and `S` are 32 bytes each.

Verification fails if any of the following holds:

1. the signature is not exactly 64 bytes long;
2. `S`, read as a little-endian integer, is greater than or equal to the group order `L`;
3. `A` or `R` does not decode to a point on the curve, or encoding the decoded point again does not
   reproduce the same 32 bytes (this rejects every non-canonical encoding);
4. `A` or `R` is a point of small order (one of the 8 points whose order divides 8);
5. with `k = SHA-512(R || A || message)` read as a little-endian integer modulo `L`, the encoding of
   the point `[S]B - [k]A` is not byte-for-byte equal to `R`.

This is the cofactorless verification equation of RFC 8032, section 5.1.7, with the canonicality and
small-order checks made mandatory. It matches the behaviour of libsodium. Many other Ed25519
libraries omit some of checks 2 to 4; an implementation using such a library MUST perform the
missing checks itself before calling it. The test vectors contain at least one signature for each
check.

---

## 7. Key discovery

### 7.1 Location

The key for a stamp is published as a DNS TXT record at the lookup name `<key_id>._dkds.<domain>`.
The record MAY be reached through a CNAME, which the verifier follows as for any DNS query.

### 7.2 Record format

The record is a tag list. If the TXT record consists of several character strings, they are joined
without separators before parsing.

```
record    = tag *( sep tag ) [ sep ] *WSP
tag       = *WSP name *WSP "=" *WSP value *WSP
sep       = ";"
name      = ALPHA *( ALPHA / DIGIT / "_" )
value     = *( %x21-3A / %x3C-7E )        ; visible ASCII except ";"
WSP       = %x20 / %x09                    ; space or tab
```

Defined tags:

| Tag | Required | Value |
|---|---|---|
| `v` | yes; MUST be the first tag | `DKDS1` |
| `k` | yes | The algorithm. This version defines `ed25519`. |
| `p` | yes | The public key in Base64 (RFC 4648, section 4) with padding, in canonical form: encoding the decoded bytes again reproduces the value exactly. For `ed25519` it decodes to exactly 32 bytes. An empty value means the key is revoked. |

Each tag appears at most once. Unknown tags are ignored. Tag names and the values of `v` and `k` are
case-sensitive.

Example:

```
k2026._dkds.northwind.example. TXT "v=DKDS1; k=ed25519; p=6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
```

### 7.3 Selecting the record

Of the TXT records at the lookup name, only those whose first tag is `v=DKDS1` are considered: the
text before the first `;`, or the whole record if it has none, matches the `tag` rule with the name
`v` and the value `DKDS1`. A considered record counts even if the rest of it does not parse.

There MUST be exactly one considered record, and it MUST parse according to 7.2: it matches the
`record` rule, no tag appears twice, and `k` and `p` are present. Otherwise no usable key exists at
the name. The value of `p` is checked against its algorithm only in step 9 of 8.2.

### 7.4 Revocation

An issuer revokes a key by replacing its record with one whose `p` tag is empty:
`v=DKDS1; k=ed25519; p=`. Every stamp signed with a revoked key is invalid, including stamps signed
before the revocation, because a holder of a stolen key can choose any `issued_at`.

---

## 8. Verification

### 8.1 Outcomes

Verification ends in exactly one of the following outcomes. These identifiers are used by verifiers,
test vectors and conformance tests.

| Outcome | Meaning |
|---|---|
| `valid` | The stamp was signed with the key published for its domain and key ID. |
| `malformed` | The stamp, or its payload, does not conform to this specification. |
| `unsupported` | The stamp uses a version, or its key uses an algorithm, that the verifier does not implement. |
| `key-not-found` | The DNS answer contains no usable key record at the lookup name, or the key in the record cannot be decoded. |
| `key-revoked` | The key record exists and marks the key as revoked. |
| `invalid-signature` | The signature does not verify. |
| `unavailable` | The key could not be retrieved, for example because of a timeout, a server failure, a DNSSEC validation failure or disagreeing resolvers. The stamp may be checked again later. |

### 8.2 Procedure

A verifier performs these steps in order. The first step that fails determines the outcome. No step
may be skipped or reordered.

1. The text form satisfies section 3.1 and 3.2. Otherwise: `malformed`.
2. The decoded envelope is at least one byte long and its first byte is not `0x00` or `0xFF`.
   Otherwise: `malformed`.
3. The first byte is `0x01`. Otherwise: `unsupported`.
4. The envelope satisfies section 4: every length field is within its bounds and within the
   envelope, `domain` and `key_id` satisfy 4.2 and 4.3, the lookup name is at most 253 characters,
   `payload_len` is at least 1, and at least 1 byte remains for `signature`. Otherwise: `malformed`.
5. `issued_at` is no more than 600 seconds after the verifier's current time. Otherwise:
   `malformed`.
6. Query the lookup name for TXT records. If no answer is obtained: `unavailable`. If the answer
   contains no usable record (7.3), including when the name does not exist: `key-not-found`.
7. The record's `p` tag is not empty. Otherwise: `key-revoked`.
8. The verifier implements the algorithm named by `k`. Otherwise: `unsupported`.
9. The value of `p` decodes as required for the algorithm. Otherwise: `key-not-found`.
10. The signature verifies under section 6. Otherwise: `invalid-signature`.
11. The payload satisfies section 5. Otherwise: `malformed`.
12. The outcome is `valid`.

A verifier makes no DNS query for a stamp that fails steps 1 to 5. The payload is decompressed and
parsed only after the signature has been verified.

---

## 9. Verifier requirements

### 9.1 Presentation

On `valid`, a verifier MUST present:

1. the outcome;
2. the domain; if it contains `xn--` labels, in its Unicode form (4.2), with the ASCII form available;
3. the issue time, with an explicit time zone: either UTC or local time with its offset;
4. whether the DNS answer was validated with DNSSEC;
5. any warnings (9.3);
6. every field, in order, with names and values exactly as signed.

Items 1, 2, 4 and 5 are the verifier's own statements. Item 3 is reported by the verifier and stated
by the signer, who chooses it (section 12). Item 6 consists of statements of the issuer.

A verifier that displays the result to a person MUST display these items in the order above, with the
domain prominently. The verifier's statements MUST be visually distinct from the fields, and the
fields MUST be presented under a heading that identifies them as statements of the issuer. A field
named, for example, `Issued by` must never be confusable with the verifier's own display of the
domain.

A verifier that passes the result to other software, such as an application or a process that
compares the fields with the document, MUST return the fields separately from its own statements, so
that no field can be taken for one of them.

On any other outcome, a verifier MUST NOT present the fields.

### 9.2 DNS

A verifier SHOULD query two independent resolvers, operated by different organisations. If both
answer and the answers differ, the outcome is `unavailable`. If only one answers, its answer is
used, and the verifier reports that only one resolver was reached.

Two answers are the same if both state that the name does not exist, or if both contain the same set
of TXT records, each record compared after its character strings are joined (7.2). The order of the
records, their time to live and the DNSSEC status are not compared. An answer that a name exists
but holds no TXT records differs from an answer that the name does not exist.

A resolver answers when it returns the TXT records at the name, or states that the name does not
exist. A timeout, an error, a server failure or a failed DNSSEC validation is no answer from that
resolver; when no resolver answers, the outcome is `unavailable`. A validating resolver reports a
failed DNSSEC validation as a server failure.

The DNSSEC status is that of the answer as a whole: it is validated only if the resolver validated
every record of it, including any CNAME records followed to reach the name, and, when several
resolvers answer, only if every one of them validated it. A verifier either validates the answer
itself, or relies on the AD flag (RFC 4035) of a validating resolver reached over an authenticated
channel, such as DNS over HTTPS (RFC 8484) or DNS over TLS (RFC 7858). An answer from an unsigned
zone is used, and reported as not validated under 9.1.

A verifier MAY remember keys it has seen before, and SHOULD warn when the key record of a domain it
has seen changes or disappears.

### 9.3 Warnings

A verifier SHOULD check the domain for lookalike risks: mixed scripts, confusable characters (Unicode
Technical Standard #39), and small differences from domains the reader has verified before. These
checks produce warnings. They MUST NOT change the outcome, which is determined only by section 8.

---

## 10. Issuer requirements

1. A key published for DKDS MUST NOT be used for any other purpose.
2. A key ID MUST NOT be reused for a different key. Changing the key behind a key ID invalidates every
   stamp signed with the old key.
3. An issuer SHOULD keep every key record published for as long as documents signed with it are
   expected to be verified. A key that is no longer used for signing stays published; a key that may
   be compromised is revoked (7.4).
4. Each stamp SHOULD contain at least one field that identifies the subject of the document, such as
   a name, and one that identifies the document, such as a number. Without these, a valid stamp can
   be copied onto another document unnoticed.
5. Field values SHOULD be written exactly as they are printed on the document, so that the reader can
   compare them character by character.
6. An issuer SHOULD print stamps black on white, at a module size of at least 0.33 mm, with a quiet
   zone of 4 modules. At that module size, a stamp of about 640 envelope bytes is about 3.5 cm wide,
   and one of the maximum size about 4.4 cm.

---

## 11. Versioning

Each layer can change in a later version without changing the others:

- **Signature algorithms** are added by defining a new `k` value. The envelope and the record version
  stay the same. A verifier that does not implement the algorithm reports `unsupported`.
- **Envelope or payload** changes require a new `version` byte value.
- **Key record** changes that affect verification require a new record version (`v=DKDS2`). Tags that
  do not affect verification may be added to `DKDS1` records, because unknown tags are ignored. Their
  values are restricted to the characters of the `value` rule (7.2): a record with a value outside
  it does not parse.
- **Carriers** other than the QR code may be defined for the same envelope. A carrier transports the
  envelope unchanged.

---

## 12. Security considerations

- **Lookalike domains.** The protocol proves which domain signed a stamp, not that the reader
  recognises it. Verifiers display the domain prominently to a person (9.1) and warn about lookalikes
  (9.3).
- **Stolen keys.** A thief can sign stamps with any issue time. Revocation (7.4) therefore invalidates
  all stamps of the key. Short-lived keys limit the number of legitimate stamps affected.
- **Forged DNS answers.** DNSSEC prevents them where the issuer's zone is signed. Verifiers report
  whether it was (9.1) and compare resolvers (9.2).
- **Lapsed domains.** Whoever holds a domain can publish keys under it and sign stamps with any issue
  time. A valid stamp therefore means that the current holder of the domain vouches for it.
- **Untrue content.** A stamp shows who made a statement, not whether it is correct.
- **Copied stamps.** A stamp can be copied onto another document. The reader detects this by
  comparing the fields with the document; issuer requirement 4 makes that comparison meaningful.
- **Hostile input.** Every length is bounded, decompression stops at 16,384 bytes, no DNS query is made
  for a malformed stamp, and the payload is parsed only after the signature verifies.
- **Display spoofing.** Forbidden code points (Appendix B) prevent text that displays differently from
  what was signed, and invisible characters that would let two different names display the same. The
  separation in 9.1 prevents fields from imitating the verifier.
- **Confidentiality.** None. Anyone who scans a stamp can read every field.
- **Quantum computers.** A large quantum computer could forge Ed25519 signatures. A post-quantum
  algorithm can be introduced as a new `k` value (section 11), within the 1,088-byte limit only for
  algorithms with small signatures.

---

## Appendix A. Limits

| Item | Limit |
|---|---|
| Text form | 1,637 characters |
| Envelope | 1,088 bytes |
| Lookup name | 253 characters |
| Domain label | 1 to 63 characters |
| Key ID | 1 to 16 characters |
| Fields | 1 to 255 |
| Field name | 1 to 255 bytes |
| Field value | 0 to 65,535 bytes |
| Decompressed payload | 16,384 bytes |
| Clock tolerance | 600 seconds |

## Appendix B. Forbidden code points

Names, values and the decoded labels of a domain MUST NOT contain any of the following:

| Code points | Description |
|---|---|
| U+0000 to U+001F, U+007F to U+009F | Control characters (Unicode category Cc), including line breaks and tabs |
| U+061C | Arabic letter mark |
| U+200E, U+200F | Left-to-right and right-to-left marks |
| U+202A to U+202E | Bidirectional embeddings and overrides |
| U+2066 to U+2069 | Bidirectional isolates |
| U+2028, U+2029 | Line and paragraph separators |
| U+FEFF | Byte order mark |
| U+FDD0 to U+FDEF | Noncharacters |
| U+FFFE, U+FFFF, and the last two code points of every plane (U+1FFFE, U+1FFFF, ... U+10FFFE, U+10FFFF) | Noncharacters |
| U+00AD | Soft hyphen |
| U+034F | Combining grapheme joiner |
| U+115F, U+1160, U+3164, U+FFA0 | Hangul fillers |
| U+17B4, U+17B5 | Khmer inherent vowels |
| U+200B | Zero-width space |
| U+2060 to U+2064 | Word joiner and invisible mathematical operators |
| U+206A to U+206F | Deprecated format characters |
| U+FFF9 to U+FFFB | Interlinear annotation characters |
| U+1BCA0 to U+1BCA3 | Shorthand format controls |
| U+1D173 to U+1D17A | Musical format characters |
| U+E0000 to U+E007F | Tag characters |

The rows from U+00AD onward are characters that display as nothing or as blank space and that no
script requires; they would let two different names or values display the same.

The zero-width non-joiner and zero-width joiner (U+200C, U+200D), the variation selectors (U+FE00 to
U+FE0F, U+E0100 to U+E01EF) and the Mongolian variation selectors and vowel separator (U+180B to
U+180F) are allowed, because scripts and emoji need them.

## Appendix C. Example

This example is produced by `tools/example.mjs`, which follows this specification and decodes
its own output as a check. The private key is 32 bytes of `0x07`; it is published here and
MUST NOT be used for anything else.

### C.1 Fields

| # | Name | Value |
|---|---|---|
| 1 | Supplier | Northwind B.V. |
| 2 | Invoice no. | 2026-0917 |
| 3 | Date | 2026-09-30 |
| 4 | Customer | Harbour Logistics B.V. |
| 5 | Amount | 4,812.50 EUR |
| 6 | Pay to IBAN | NL91 ABNA 0417 1643 00 |
| 7 | Due | 2026-10-30 |

The field list is 172 bytes; compressed with raw DEFLATE it is 155 bytes. The payload below was
compressed with the zlib of Node.js 24 at level 9. Another encoder, or other settings, produce a
different payload that is equally valid; the signature and the text form then differ too. From the
payload bytes below, the envelope, the signature and the text form can be reproduced exactly.

### C.2 Envelope

```
version        1 B  01
domain_len     1 B  11
domain        17 B  6e 6f 72 74 68 77 69 6e 64 2e 65 78 61 6d 70 6c
                    65
keyid_len      1 B  05
key_id         5 B  6b 32 30 32 36
issued_at      4 B  6a bc cf 90
payload_len    2 B  00 9b
payload      155 B  35 cd 41 0b 82 30 18 80 e1 41 51 96 d1 d1 f3 f7
                    03 72 7c 53 b3 3c ce 0c 12 44 a2 a8 bb 99 d4 20
                    37 99 5b d1 bf 0f a2 8e ef e5 79 c7 ce d1 76 dd
                    43 34 9a cc 4b a5 cd fd 25 e4 15 52 7a a6 6e 2e
                    9f 4a d4 0d 48 45 c9 24 c0 20 f6 31 61 ab 61 56
                    99 86 4c 7f ed 87 e8 6c 6c 6f 54 db 68 e2 ed 2a
                    7d 51 56 43 a1 6e a2 37 a2 ee bf d0 88 b7 ca 4a
                    43 66 d1 62 cd 02 ba 44 d8 9e 0e ee be 7a 83 51
                    90 a7 bc 24 5e 59 24 0c 78 5a 72 c0 88 ad 80 c5
                    51 08 88 83 cc fe 4f 0c fd 10 3f
signature     64 B  3f ef 0c 62 53 5e 86 94 89 bd 4c cf e8 9e 1d 54
                    37 35 86 69 80 1d 37 71 ad 16 50 90 5a 48 ee 16
                    46 cc 4a a1 4e 4a 10 19 0e ff 87 0e 5b c4 53 2a
                    11 28 3e 46 ff 30 a6 77 4b 2a e1 b2 90 33 2b 05
```

Envelope: 250 bytes. Issued at 2026-09-30T09:00:00Z (1790758800).

### C.3 Text form

380 characters:

```
DKDS:360B/D5LED9DZED-TCB$CBECP9EVYC$OD846P*65*N99I/RJU.PLK1R368D
GQB8:2JHOQAAVDLE7QA-U7UN1KU8+EL5KJC34JHJANQ./163IK0TUBPRLQX/RBT6
9$PA/K50WO$S9JA 1LA+5VK9PU10$83T4N74-A6/TLT.A0:GY7G78H VDF3E8XR/
USWG5WCAXO8H:DM1798UEGQPANLH9-:C3MCNF0TV87:J88U/LF0EAA9L+Q45CB.P
1OJBDFO1.LN.OO31ZTGX6W+S1J22W38KP1COAR0HQIH/V9FIT%V33:6T:G$8GI07
U*LE8ARIBK4UY.8PJ9H+9Q12E+1E3H2RB5NAR72C*7XBW02LRM9/NSFAIXJ5
```

The line breaks are for presentation only; the text form contains none.

### C.4 Key record

```
k2026._dkds.northwind.example. TXT "v=DKDS1; k=ed25519; p=6kpsY+KcUgq+9VB7Ey7F+ZVHdq6+vnuSQh7qaRRG0iw="
```
