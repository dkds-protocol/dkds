/**
 * QR encoder: capacity, module matrices compared with an established encoder for every version and mask,
 * and decoding by two independent decoders.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BinaryBitmap, DecodeHintType, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from "@zxing/library";
import jsQRModule from "jsqr";
import QRCode from "qrcode";
import { BASE45_ALPHABET } from "../src/carrier/base45.ts";
import { encodeQr, MAX_VERSION, qrVersionFor, type QrCode } from "../src/carrier/qr.ts";
import { DkdsError } from "../src/errors.ts";
import { LIMITS } from "../src/limits.ts";

/** A deterministic text of `length` characters from the QR alphanumeric set, beginning with "DKDS:". */
function sampleText(length: number, seed: number): string {
  let s = "DKDS:";
  let x = seed;
  while (s.length < length) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += BASE45_ALPHABET[x % 45];
  }
  return s.slice(0, length);
}

/** The largest number of characters that fits in a version. */
function capacity(version: number): number {
  let n = 0;
  while ((qrVersionFor(n + 1) ?? Infinity) <= version) n++;
  return n;
}

/** jsQR is a CommonJS module whose `module.exports` is the decoder function. */
const jsQR = jsQRModule as unknown as typeof jsQRModule.default;

/** ZXing hint for rendered images without distortion; its detector for photographs fails on some of them. */
const PURE_BARCODE = new Map([[DecodeHintType.PURE_BARCODE, true]]);

/** Renders a QR code as greyscale pixels with a quiet zone of 4 modules. */
function rasterize(qr: QrCode, scale = 4): { gray: Uint8ClampedArray; rgba: Uint8ClampedArray; width: number } {
  const width = (qr.size + 8) * scale;
  const gray = new Uint8ClampedArray(width * width).fill(255);
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy++) gray.fill(0, ((y + 4) * scale + dy) * width + (x + 4) * scale, ((y + 4) * scale + dy) * width + (x + 5) * scale);
    }),
  );
  const rgba = new Uint8ClampedArray(width * width * 4);
  gray.forEach((v, i) => rgba.set([v, v, v, 255], i * 4));
  return { gray, rgba, width };
}

test("the text form of the largest envelope fits in version 27, one more character does not", () => {
  assert.equal(capacity(MAX_VERSION), LIMITS.textLength);
  assert.equal(encodeQr(sampleText(LIMITS.textLength, 1)).version, 27);
  assert.throws(() => encodeQr(sampleText(LIMITS.textLength + 1, 1)), (e: unknown) => e instanceof DkdsError && e.code === "qr-invalid");
});

test("characters outside the alphanumeric set are rejected", () => {
  assert.throws(() => encodeQr("DKDS:abc"), (e: unknown) => e instanceof DkdsError && e.code === "qr-invalid");
});

for (let version = 1; version <= MAX_VERSION; version++) {
  test(`version ${version}: capacity and modules match the qrcode package for every mask`, () => {
    const max = capacity(version);
    const text = sampleText(max, version);
    assert.throws(() => QRCode.create([{ data: sampleText(max + 1, version), mode: "alphanumeric" }], { errorCorrectionLevel: "M", version }));
    for (let mask = 0; mask < 8; mask++) {
      const ours = encodeQr(text, mask);
      assert.equal(ours.version, version);
      const reference = QRCode.create([{ data: text, mode: "alphanumeric" }], {
        errorCorrectionLevel: "M",
        version,
        maskPattern: mask as QRCode.QRCodeMaskPattern,
      });
      const m = reference.modules;
      assert.equal(m.size, ours.size);
      for (let y = 0; y < m.size; y++) {
        for (let x = 0; x < m.size; x++) assert.equal(ours.modules[y]![x], m.get(y, x) === 1, `mask ${mask}, module (${x}, ${y})`);
      }
    }
  });

  test(`version ${version}: every mask is decoded by jsQR and ZXing`, () => {
    const text = sampleText(capacity(version), version + 100);
    for (let mask = 0; mask < 8; mask++) {
      const { gray, rgba, width } = rasterize(encodeQr(text, mask));
      assert.equal(jsQR(rgba, width, width)?.data, text, `jsQR, mask ${mask}`);
      const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray, width, width)));
      assert.equal(new QRCodeReader().decode(bitmap, PURE_BARCODE).getText(), text, `ZXing, mask ${mask}`);
    }
  });
}
