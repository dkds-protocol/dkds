/**
 * dkds: reference implementation of the Domain-Keyed Document Stamp protocol, version 1.
 *
 * @packageDocumentation
 */

export { verifyStamp, OUTCOMES } from "./verify.ts";
export type { Outcome, VerifyOptions, VerifyResult } from "./verify.ts";

export { createStamp } from "./create.ts";
export type { CreateOptions, Stamp } from "./create.ts";

export { inspectStamp } from "./inspect.ts";
export type { Inspection } from "./inspect.ts";

export { generateKey, publicKeyOf, keySigner } from "./keys.ts";
export type { KeyPair, PrivateKey, Signer } from "./keys.ts";
export { formatKeyRecord as keyRecord } from "./discovery/record.ts";

export { dohResolver, defaultResolver, DEFAULT_DOH_SERVERS } from "./discovery/doh.ts";
export type { DohOptions } from "./discovery/doh.ts";
export { combineResolvers } from "./discovery/resolver.ts";
export type { DnsAnswer, Resolver, ResolveOptions } from "./discovery/resolver.ts";

export type { Warning, WarningCode, KeyStore } from "./warnings.ts";
export type { Field } from "./payload/fields.ts";

export { encodeQr } from "./carrier/qr.ts";
export type { QrCode } from "./carrier/qr.ts";
export { renderSvg } from "./carrier/svg.ts";
export type { SvgOptions } from "./carrier/svg.ts";

export { DkdsError } from "./errors.ts";
export type { ErrorCode } from "./errors.ts";
export { LIMITS } from "./limits.ts";
