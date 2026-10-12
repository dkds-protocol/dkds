/**
 * DNS messages (RFC 1035) for TXT queries, with EDNS (RFC 6891) and the DNSSEC OK bit (RFC 3225).
 */

import { latin1String } from "../bytes.ts";
import type { DnsAnswer } from "./resolver.ts";

const TYPE_TXT = 16;
const TYPE_CNAME = 5;
const TYPE_OPT = 41;
const CLASS_IN = 1;

const FLAG_QR = 0x8000;
const FLAG_TC = 0x0200;
const FLAG_RD = 0x0100;
const FLAG_AD = 0x0020;
const OPCODE_MASK = 0x7800;
const RCODE_MASK = 0x000f;
const RCODE_NOERROR = 0;
const RCODE_NXDOMAIN = 3;

const EDNS_UDP_SIZE = 1232;
const EDNS_DO = 0x8000;
const MAX_CNAME_HOPS = 16;

/**
 * Encodes a query for the TXT records at `name`, with ID 0 (RFC 8484, 4.1), recursion desired, the AD
 * bit set to request the DNSSEC validation status (RFC 6840, 5.7) and the DNSSEC OK bit set.
 */
export function encodeTxtQuery(name: string): Uint8Array {
  const labels = name.split(".");
  const qname: number[] = [];
  for (const label of labels) {
    qname.push(label.length);
    for (let i = 0; i < label.length; i++) qname.push(label.charCodeAt(i));
  }
  qname.push(0);
  const header = [0, 0, (FLAG_RD | FLAG_AD) >> 8, (FLAG_RD | FLAG_AD) & 0xff, 0, 1, 0, 0, 0, 0, 0, 1];
  const question = [...qname, 0, TYPE_TXT, 0, CLASS_IN];
  const opt = [0, 0, TYPE_OPT, EDNS_UDP_SIZE >> 8, EDNS_UDP_SIZE & 0xff, 0, 0, EDNS_DO >> 8, EDNS_DO & 0xff, 0, 0];
  return Uint8Array.from([...header, ...question, ...opt]);
}

class MessageError extends Error {}

class Reader {
  private readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  u8(): number {
    if (this.offset + 1 > this.bytes.length) throw new MessageError("The DNS message is truncated.");
    return this.bytes[this.offset++]!;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return this.u16() * 0x10000 + this.u16();
  }

  slice(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new MessageError("The DNS message is truncated.");
    return this.bytes.subarray(this.offset, (this.offset += n));
  }

  /** Reads a domain name, following compression pointers (RFC 1035, 4.1.4). Returns it in lowercase. */
  name(): string {
    const labels: string[] = [];
    let position = this.offset;
    let resume = -1;
    let length = 0;
    for (;;) {
      if (position >= this.bytes.length) throw new MessageError("The DNS message is truncated.");
      const len = this.bytes[position]!;
      if ((len & 0xc0) === 0xc0) {
        if (position + 1 >= this.bytes.length) throw new MessageError("The DNS message is truncated.");
        const target = ((len & 0x3f) << 8) | this.bytes[position + 1]!;
        if (target >= position) throw new MessageError("A DNS compression pointer does not point backwards.");
        if (resume < 0) resume = position + 2;
        position = target;
        continue;
      }
      if (len & 0xc0) throw new MessageError("A DNS label has an unsupported type.");
      position++;
      if (len === 0) break;
      if (position + len > this.bytes.length) throw new MessageError("The DNS message is truncated.");
      length += len + 1;
      if (length > 255) throw new MessageError("A DNS name is longer than 255 bytes.");
      labels.push(latin1String(this.bytes.subarray(position, position + len)).toLowerCase());
      position += len;
    }
    this.offset = resume >= 0 ? resume : position;
    return labels.join(".");
  }
}

function parseCharacterStrings(rdata: Uint8Array): string[] {
  const strings: string[] = [];
  for (let i = 0; i < rdata.length; ) {
    const len = rdata[i]!;
    if (i + 1 + len > rdata.length) throw new MessageError("A TXT record is malformed.");
    strings.push(latin1String(rdata.subarray(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return strings;
}

/**
 * Interprets a response to {@link encodeTxtQuery}. Returns the TXT records at `name`, or at the end of
 * its CNAME chain, with the AD bit as the DNSSEC status. A truncated response, a response to another
 * question, a malformed message and any response code other than NOERROR and NXDOMAIN give `failure`.
 * Characters of TXT records are returned one per byte (ISO 8859-1).
 */
export function parseTxtResponse(message: Uint8Array, name: string): DnsAnswer {
  try {
    return parse(message, name.toLowerCase());
  } catch (e) {
    if (e instanceof MessageError) return { result: "failure", reason: e.message };
    throw e;
  }
}

function parse(message: Uint8Array, name: string): DnsAnswer {
  const r = new Reader(message);
  const id = r.u16();
  const flags = r.u16();
  const qdcount = r.u16();
  const ancount = r.u16();
  r.u16();
  r.u16();
  if (id !== 0 || !(flags & FLAG_QR) || (flags & OPCODE_MASK) !== 0) throw new MessageError("The DNS response does not match the query.");
  if (flags & FLAG_TC) throw new MessageError("The DNS response is truncated.");
  const rcode = flags & RCODE_MASK;
  if (rcode !== RCODE_NOERROR && rcode !== RCODE_NXDOMAIN) return { result: "failure", reason: `The DNS server returned response code ${rcode}.` };

  if (qdcount !== 1) throw new MessageError("The DNS response does not contain exactly one question.");
  const qname = r.name();
  const qtype = r.u16();
  const qclass = r.u16();
  if (qname !== name || qtype !== TYPE_TXT || qclass !== CLASS_IN) throw new MessageError("The DNS response is for another question.");

  const cnames = new Map<string, string>();
  const txt = new Map<string, string[][]>();
  for (let i = 0; i < ancount; i++) {
    const owner = r.name();
    const type = r.u16();
    const cls = r.u16();
    r.u32();
    const rdlength = r.u16();
    const rdataStart = r.offset;
    const rdata = r.slice(rdlength);
    if (cls !== CLASS_IN) continue;
    if (type === TYPE_CNAME) {
      const target = new Reader(message);
      target.offset = rdataStart;
      cnames.set(owner, target.name());
    } else if (type === TYPE_TXT) {
      const list = txt.get(owner) ?? [];
      list.push(parseCharacterStrings(rdata));
      txt.set(owner, list);
    }
  }
  if (rcode === RCODE_NXDOMAIN) return { result: "nxdomain" };

  let target = name;
  for (let hops = 0; cnames.has(target); hops++) {
    if (hops === MAX_CNAME_HOPS) throw new MessageError("The CNAME chain is too long.");
    target = cnames.get(target)!;
  }
  return { result: "answer", txt: txt.get(target) ?? [], dnssec: (flags & FLAG_AD) !== 0 };
}
