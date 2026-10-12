// Builds the worked example for Appendix C of specification.md, following the
// specification exactly, then decodes it again as a check.
//
//   node example.mjs           prints the appendix as Markdown
//
// The key is derived from a fixed seed so the output is stable.

import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

// ---- inputs ----------------------------------------------------------------
const domain = "northwind.example";
const keyId = "k2026";
const issuedAt = Date.UTC(2026, 8, 30, 9, 0, 0) / 1000;
const fields = [
  ["Supplier", "Northwind B.V."],
  ["Invoice no.", "2026-0917"],
  ["Date", "2026-09-30"],
  ["Customer", "Harbour Logistics B.V."],
  ["Amount", "4,812.50 EUR"],
  ["Pay to IBAN", "NL91 ABNA 0417 1643 00"],
  ["Due", "2026-10-30"],
];
const seed = Buffer.alloc(32, 7);

// ---- helpers ---------------------------------------------------------------
const u8 = (n) => Buffer.from([n]);
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const ascii = (s) => Buffer.from(s, "ascii");
const hex = (b) => b.toString("hex").replace(/(..)/g, "$1 ").trim();

const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function base45(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i += 2) {
    if (i + 1 < buf.length) {
      let n = buf[i] * 256 + buf[i + 1];
      s += B45[n % 45]; n = Math.floor(n / 45);
      s += B45[n % 45] + B45[Math.floor(n / 45)];
    } else {
      s += B45[buf[i] % 45] + B45[Math.floor(buf[i] / 45)];
    }
  }
  return s;
}
function unbase45(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const g = s.slice(i, i + 3), v = [...g].map((c) => B45.indexOf(c));
    if (v.includes(-1) || g.length === 1) throw new Error("malformed: base45");
    const n = v[0] + v[1] * 45 + (g.length === 3 ? v[2] * 2025 : 0);
    if (g.length === 3) { if (n > 0xffff) throw new Error("malformed: group"); out.push(n >> 8, n & 255); }
    else { if (n > 0xff) throw new Error("malformed: tail"); out.push(n); }
  }
  return Buffer.from(out);
}

// ---- section 5: payload ----------------------------------------------------
const list = Buffer.concat([
  u8(fields.length),
  ...fields.flatMap(([n, v]) => {
    const nb = Buffer.from(n, "utf8"), vb = Buffer.from(v, "utf8");
    return [u8(nb.length), nb, u16(vb.length), vb];
  }),
]);
const payload = deflateRawSync(list, { level: 9 });

// ---- section 4: envelope ---------------------------------------------------
const parts = [
  ["version", u8(1)],
  ["domain_len", u8(domain.length)],
  ["domain", ascii(domain)],
  ["keyid_len", u8(keyId.length)],
  ["key_id", ascii(keyId)],
  ["issued_at", u32(issuedAt)],
  ["payload_len", u16(payload.length)],
  ["payload", payload],
];
const signedPart = Buffer.concat(parts.map((p) => p[1]));

// ---- section 6: signature --------------------------------------------------
const priv = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
  format: "der", type: "pkcs8",
});
const pub = createPublicKey(priv);
const pubRaw = pub.export({ format: "der", type: "spki" }).subarray(-32);
const message = Buffer.concat([ascii("DKDS"), signedPart]);
const signature = sign(null, message, priv);
parts.push(["signature", signature]);
const envelope = Buffer.concat([signedPart, signature]);

// ---- section 3: carrier ----------------------------------------------------
const text = "DKDS:" + base45(envelope);
if (envelope.length > 1088 || text.length > 1637) throw new Error("over the limit");

// ---- check: decode what was encoded ----------------------------------------
{
  if (!text.startsWith("DKDS:")) throw new Error("prefix");
  const env = unbase45(text.slice(5));
  if (!env.equals(envelope)) throw new Error("base45 round trip");
  let o = 0;
  const take = (n) => { const b = env.subarray(o, o + n); if (b.length !== n) throw new Error("short"); o += n; return b; };
  if (take(1)[0] !== 1) throw new Error("version");
  const d = take(take(1)[0]).toString("ascii");
  const k = take(take(1)[0]).toString("ascii");
  take(4);
  const pl = take(take(2).readUInt16BE(0));
  const sig = env.subarray(o);
  if (d !== domain || k !== keyId || sig.length !== 64) throw new Error("fields");
  if (!verify(null, Buffer.concat([ascii("DKDS"), env.subarray(0, o)]), pub, sig)) throw new Error("signature");
  const flat = inflateRawSync(pl);
  let p = 0, n = flat[p++];
  for (let i = 0; i < n; i++) {
    const nl = flat[p++], nm = flat.subarray(p, p += nl).toString("utf8");
    const vl = flat.readUInt16BE(p); p += 2;
    const vv = flat.subarray(p, p += vl).toString("utf8");
    if (nm !== fields[i][0] || vv !== fields[i][1]) throw new Error("field " + i);
  }
  if (p !== flat.length) throw new Error("trailing data");
}

// ---- output: Appendix C ----------------------------------------------------
const record = `v=DKDS1; k=ed25519; p=${pubRaw.toString("base64")}`;
const out = [];
out.push("This example is produced by `tools/example.mjs`, which follows this specification and decodes");
out.push("its own output as a check. The private key is 32 bytes of `0x07`; it is published here and");
out.push("MUST NOT be used for anything else.");
out.push("");
out.push("### C.1 Fields");
out.push("");
out.push("| # | Name | Value |");
out.push("|---|---|---|");
fields.forEach(([n, v], i) => out.push(`| ${i + 1} | ${n} | ${v} |`));
out.push("");
out.push(`The field list is ${list.length} bytes; compressed with raw DEFLATE it is ${payload.length} bytes.`);
out.push("");
out.push("### C.2 Envelope");
out.push("");
out.push("```");
for (const [name, bytes] of parts) {
  const h = hex(bytes);
  const lines = h.match(/.{1,48}(\s|$)/g).map((l) => l.trim());
  out.push(`${name.padEnd(12)} ${String(bytes.length).padStart(3)} B  ${lines[0]}`);
  for (const l of lines.slice(1)) out.push(`${"".padEnd(12)}        ${l}`);
}
out.push("```");
out.push("");
out.push(`Envelope: ${envelope.length} bytes. Issued at ${new Date(issuedAt * 1000).toISOString().replace(".000Z", "Z")} (${issuedAt}).`);
out.push("");
out.push("### C.3 Text form");
out.push("");
out.push(`${text.length} characters:`);
out.push("");
out.push("```");
out.push(text.match(/.{1,64}/g).join("\n"));
out.push("```");
out.push("");
out.push("The line breaks are for presentation only; the text form contains none.");
out.push("");
out.push("### C.4 Key record");
out.push("");
out.push("```");
out.push(`${keyId}._dkds.${domain}. TXT "${record}"`);
out.push("```");
console.log(out.join("\n"));
