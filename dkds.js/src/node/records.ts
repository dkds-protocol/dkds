/**
 * Files of key records, as read by `dkds check`: one record per line, in the form printed by
 * `dkds record` and `dkds keygen`, which is also the form of a TXT record in a zone file (RFC 1035,
 * section 5.1):
 *
 * ```
 * k2026._dkds.example.com. TXT "v=DKDS1; k=ed25519; p=..."
 * k2026._dkds.example.com. 3600 IN TXT "v=DKDS1; k=ed25519; " "p=..."
 * ```
 *
 * A TTL and the class `IN` may precede `TXT`; the record may be split into several quoted strings,
 * which are joined without separators (specification 7.2). Empty lines and lines beginning with `;`
 * or `#` are skipped, and a `;` after the last string begins a comment.
 */

import { DkdsError } from "../errors.ts";
import { parseKeyRecord, type KeyRecord } from "../discovery/record.ts";
import { checkKeyId, lookupName, toAsciiDomain } from "../domain.ts";

/** A key record expected at a lookup name. */
export interface ExpectedRecord {
  /** The line of the file, counted from 1. */
  readonly line: number;
  /** The lookup name, in ASCII and without the final dot. */
  readonly name: string;
  readonly record: KeyRecord;
}

/** An error in a file of key records; `line` is the line at which it was found. */
export class RecordFileError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.name = "RecordFileError";
    this.line = line;
  }
}

const LINE = /^(\S+)[ \t]+(?:(?:\d+|IN)[ \t]+){0,2}TXT[ \t]+(.*)$/i;
const MARKER = "._dkds.";

/** Reads a file of key records. Throws {@link RecordFileError} at the first line that is not one. */
export function parseRecordFile(text: string): ExpectedRecord[] {
  const records: ExpectedRecord[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) return;
    const match = LINE.exec(trimmed);
    if (!match) throw new RecordFileError(line, `expected <name> TXT "<record>".`);
    const name = parseName(match[1]!, line);
    if (seen.has(name)) throw new RecordFileError(line, `${name} appears more than once.`);
    seen.add(name);
    const joined = parseStrings(match[2]!, line).join("");
    const record = parseKeyRecord(joined);
    if (record === null) throw new RecordFileError(line, `"${joined}" is not a v=DKDS1 key record (7.2).`);
    records.push({ line, name, record });
  });
  if (records.length === 0) throw new RecordFileError(1, "the file contains no key records.");
  return records;
}

/**
 * Checks a lookup name, `<key_id>._dkds.<domain>` with or without the final dot, and returns it in
 * lowercase ASCII, as DNS names compare without regard to case.
 */
function parseName(written: string, line: number): string {
  const name = (written.endsWith(".") ? written.slice(0, -1) : written).toLowerCase();
  const at = name.indexOf(MARKER);
  if (at < 1) throw new RecordFileError(line, `${written} is not a name of the form <key_id>._dkds.<domain>.`);
  try {
    const keyId = name.slice(0, at);
    checkKeyId(keyId);
    return lookupName(keyId, toAsciiDomain(name.slice(at + MARKER.length)));
  } catch (e) {
    if (e instanceof DkdsError) throw new RecordFileError(line, `${written}: ${e.message}`);
    throw e;
  }
}

/** Reads the quoted character strings of a TXT record, with the escapes `\"`, `\\` and `\DDD`. */
function parseStrings(rest: string, line: number): string[] {
  const strings: string[] = [];
  let i = 0;
  for (;;) {
    while (rest[i] === " " || rest[i] === "\t") i++;
    if (i === rest.length || rest[i] === ";") break;
    if (rest[i] !== '"') throw new RecordFileError(line, "the record is not written as quoted strings.");
    let value = "";
    for (i++; ; i++) {
      if (i >= rest.length) throw new RecordFileError(line, "a quoted string is not closed.");
      const ch = rest[i]!;
      if (ch === '"') break;
      if (ch !== "\\") {
        value += ch;
        continue;
      }
      const digits = /^\d{3}/.exec(rest.slice(i + 1));
      if (digits) {
        value += String.fromCharCode(Number(digits[0]));
        i += 3;
      } else if (i + 1 < rest.length) {
        value += rest[++i];
      }
    }
    strings.push(value);
    i++;
  }
  if (strings.length === 0) throw new RecordFileError(line, "the record has no quoted string.");
  return strings;
}
