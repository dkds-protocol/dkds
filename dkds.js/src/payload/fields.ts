/**
 * The payload (specification section 5): a list of text fields, compressed with raw DEFLATE.
 */

import { bytesEqual, isWellFormed, utf8Decode, utf8Encode } from "../bytes.ts";
import { assertNoForbidden } from "../codepoints.ts";
import { DkdsError, fail } from "../errors.ts";
import { LIMITS } from "../limits.ts";
import { deflateRaw } from "./deflate.ts";
import { inflateRaw } from "./inflate.ts";

/** A field: a name and a value, both text (5.1). */
export type Field = readonly [name: string, value: string];

/**
 * Returns the fields as a list of pairs, from an array of pairs or a `Map`. Names and values are
 * normalised to Unicode Normalization Form C (5.2). Plain objects are rejected, because JavaScript
 * orders the keys of a plain object that look like integers before all other keys, while the order of
 * fields is signed. Throws `fields-invalid`.
 */
export function normalizeFields(fields: unknown): Field[] {
  let entries: unknown[];
  if (fields instanceof Map) entries = [...fields.entries()];
  else if (Array.isArray(fields)) entries = fields;
  else {
    return fail(
      "fields-invalid",
      "Fields must be an array of [name, value] pairs or a Map. Plain objects are not accepted, because JavaScript reorders keys that look like integers.",
    );
  }
  return entries.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") {
      return fail("fields-invalid", `Field ${i + 1} is not a [name, value] pair of strings.`);
    }
    for (const [what, text] of [["name", entry[0]], ["value", entry[1]]] as const) {
      if (!isWellFormed(text)) fail("fields-invalid", `The ${what} of field ${i + 1} contains a lone surrogate.`);
    }
    return [entry[0].normalize("NFC"), entry[1].normalize("NFC")] as const;
  });
}

/**
 * Encodes fields as a field list (5.1) and checks every rule of 5.1 and 5.2 that applies to it. Throws
 * `fields-invalid`, `field-name-invalid`, `field-name-duplicate`, `field-value-invalid`,
 * `forbidden-code-point` or `payload-too-large`.
 */
export function encodeFieldList(fields: readonly Field[]): Uint8Array {
  if (fields.length < 1 || fields.length > LIMITS.fieldCount) {
    fail("fields-invalid", `A stamp has 1 to ${LIMITS.fieldCount} fields; ${fields.length} were given (5.1).`);
  }
  const encoded: { name: Uint8Array; value: Uint8Array }[] = [];
  let size = 1;
  for (const [i, [name, value]] of fields.entries()) {
    const label = `field ${i + 1}`;
    assertNoForbidden(name, `The name of ${label}`);
    assertNoForbidden(value, `The value of ${label}`);
    const nameBytes = utf8Encode(name);
    const valueBytes = utf8Encode(value);
    if (nameBytes.length < 1 || nameBytes.length > LIMITS.fieldNameBytes) {
      fail("field-name-invalid", `The name of ${label} has ${nameBytes.length} bytes; it must have 1 to ${LIMITS.fieldNameBytes} (5.1).`);
    }
    if (valueBytes.length > LIMITS.fieldValueBytes) {
      fail("field-value-invalid", `The value of ${label} has ${valueBytes.length} bytes; the maximum is ${LIMITS.fieldValueBytes} (5.1).`);
    }
    if (encoded.some((e) => bytesEqual(e.name, nameBytes))) {
      fail("field-name-duplicate", `The name "${name}" occurs more than once (5.2).`);
    }
    encoded.push({ name: nameBytes, value: valueBytes });
    size += 1 + nameBytes.length + 2 + valueBytes.length;
  }
  if (size > LIMITS.inflatedBytes) {
    fail("payload-too-large", `The field list has ${size} bytes; the maximum is ${LIMITS.inflatedBytes} (5.2).`);
  }

  const out = new Uint8Array(size);
  let offset = 0;
  out[offset++] = fields.length;
  for (const { name, value } of encoded) {
    out[offset++] = name.length;
    out.set(name, offset);
    offset += name.length;
    out[offset++] = value.length >> 8;
    out[offset++] = value.length & 0xff;
    out.set(value, offset);
    offset += value.length;
  }
  return out;
}

/** Encodes and compresses fields into the `payload` of an envelope. */
export function encodePayload(fields: readonly Field[]): Uint8Array {
  return deflateRaw(encodeFieldList(fields));
}

/**
 * Decompresses and decodes a payload, checking every rule of 5.1 and 5.2. Throws `deflate-invalid`,
 * `payload-too-large`, `fields-invalid`, `field-name-invalid`, `field-name-duplicate`, `utf8-invalid` or
 * `forbidden-code-point`.
 */
export function decodePayload(payload: Uint8Array): Field[] {
  return decodeFieldList(inflateRaw(payload, LIMITS.inflatedBytes));
}

/** Decodes a field list (5.1). See {@link decodePayload} for the errors. */
export function decodeFieldList(data: Uint8Array): Field[] {
  let offset = 0;
  const take = (n: number): Uint8Array => {
    if (offset + n > data.length) fail("fields-invalid", "The field list ends before a declared length (5.2).");
    return data.subarray(offset, (offset += n));
  };
  const count = take(1)[0]!;
  if (count < 1) fail("fields-invalid", "The field list declares zero fields (5.1).");

  const fields: Field[] = [];
  const names: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const label = `field ${i + 1}`;
    const nameLength = take(1)[0]!;
    if (nameLength < 1) fail("field-name-invalid", `The name of ${label} is empty (5.1).`);
    const nameBytes = take(nameLength);
    if (names.some((n) => bytesEqual(n, nameBytes))) fail("field-name-duplicate", `The name of ${label} occurs earlier (5.2).`);
    names.push(nameBytes);
    const lengthBytes = take(2);
    const valueBytes = take((lengthBytes[0]! << 8) | lengthBytes[1]!);
    fields.push([decodeFieldText(nameBytes, `The name of ${label}`), decodeFieldText(valueBytes, `The value of ${label}`)]);
  }
  if (offset !== data.length) fail("fields-invalid", "Data follows the end of the field list (5.2).");
  return fields;
}

function decodeFieldText(bytes: Uint8Array, what: string): string {
  let text: string;
  try {
    text = utf8Decode(bytes);
  } catch (e) {
    if (e instanceof DkdsError) fail(e.code, `${what} is not valid UTF-8 (5.2).`);
    throw e;
  }
  assertNoForbidden(text, what);
  return text;
}
