/**
 * Punycode (RFC 3492) for single domain labels, without the `xn--` prefix.
 */

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_INT = 0x7fffffff;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function threshold(k: number, bias: number): number {
  return k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
}

/** Digit value of a lowercase basic code point (`a`-`z` = 0-25, `0`-`9` = 26-35), or -1. */
function digitValue(c: number): number {
  if (c >= 0x61 && c <= 0x7a) return c - 0x61;
  if (c >= 0x30 && c <= 0x39) return c - 0x30 + 26;
  return -1;
}

function digitChar(d: number): string {
  return String.fromCharCode(d < 26 ? d + 0x61 : d - 26 + 0x30);
}

/**
 * Decodes a Punycode string to code points. Only lowercase digits are accepted, which is the form
 * that {@link punycodeEncode} produces. Returns `null` when the input is not valid Punycode or decodes
 * to a surrogate or a value above U+10FFFF.
 */
export function punycodeDecode(input: string): number[] | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(delimiter, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) return null;
    output.push(c);
  }
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  for (let pos = delimiter > 0 ? delimiter + 1 : 0; pos < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (pos >= input.length) return null;
      const digit = digitValue(input.charCodeAt(pos++));
      if (digit < 0) return null;
      if (digit > Math.floor((MAX_INT - i) / w)) return null;
      i += digit * w;
      const t = threshold(k, bias);
      if (digit < t) break;
      if (w > Math.floor(MAX_INT / (BASE - t))) return null;
      w *= BASE - t;
    }
    const length = output.length + 1;
    bias = adapt(i - oldi, length, oldi === 0);
    if (Math.floor(i / length) > MAX_INT - n) return null;
    n += Math.floor(i / length);
    i %= length;
    if (n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return null;
    output.splice(i++, 0, n);
  }
  return output;
}

/** Encodes code points as Punycode with lowercase digits. */
export function punycodeEncode(input: readonly number[]): string {
  let output = "";
  for (const c of input) if (c < 0x80) output += String.fromCharCode(c);
  const basic = output.length;
  let handled = basic;
  if (basic > 0) output += "-";
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;
  while (handled < input.length) {
    let m = Infinity;
    for (const c of input) if (c >= n && c < m) m = c;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const c of input) {
      if (c < n) delta++;
      if (c !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const t = threshold(k, bias);
        if (q < t) break;
        output += digitChar(t + ((q - t) % (BASE - t)));
        q = Math.floor((q - t) / (BASE - t));
      }
      output += digitChar(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return output;
}
