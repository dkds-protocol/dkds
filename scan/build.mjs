// Builds scan.dkds.org into out/.
//
//   node build.mjs
//
// Sources: src/ (the application), ../dkds.js/src (verification), ../brand (tokens, mark, icons, fonts),
// zxing-wasm (the QR decoder) and pdfjs-dist (PDF files). The resolver hosts of the Content Security
// Policy are those of DEFAULT_DOH_SERVERS in dkds.js.

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { DEFAULT_DOH_SERVERS } from "../dkds.js/src/discovery/doh.ts";
import { ICON_LINKS, iconFiles, iconSymbols, markSymbol } from "../brand/lib/icons.mjs";
import { en } from "./src/i18n/en.ts";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8").replace(/\r\n/g, "\n");
const OUT = here("./out/");
const BRAND = "../brand/";

const DESCRIPTION =
  "Verifies DKDS stamps on documents: reads the stamp with the camera, from an image or PDF file, or as text, and checks it against the key published in the DNS. Documents are checked on the device.";

const scanVersion = JSON.parse(read("./package.json")).version;
// The build identifier is not known until every file is written; app.js holds this placeholder until then.
const BUILD_PLACEHOLDER = "@@SCAN_BUILD@@";
const pdfVersion = JSON.parse(read("./node_modules/pdfjs-dist/package.json")).version;

function emit(path, content) {
  const file = join(OUT, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

rmSync(OUT, { recursive: true, force: true });

// ---- the Content Security Policy -----------------------------------------------

const resolverOrigins = DEFAULT_DOH_SERVERS.map((url) => new URL(url).origin);
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  `connect-src 'self' ${resolverOrigins.join(" ")}`,
  "img-src 'self' blob: data:",
  "media-src 'self' blob: mediastream:",
  "style-src 'self'",
  "font-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// ---- code ---------------------------------------------------------------------

const common = { bundle: true, minify: true, legalComments: "none", target: ["es2022", "safari16"], logLevel: "warning" };
// The application is app.js with the chunks it imports. Each language other than English is a
// separate chunk, loaded when it is chosen (src/text.ts).
await build({
  ...common,
  entryPoints: { app: here("./src/main.ts") },
  outdir: OUT,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  define: { SCAN_VERSION: JSON.stringify(scanVersion), SCAN_BUILD: JSON.stringify(BUILD_PLACEHOLDER) },
});
await build({ ...common, entryPoints: [here("./src/decoder.worker.ts")], outfile: join(OUT, "decoder.js"), format: "esm" });
emit("app.css", [BRAND + "tokens.css", "./src/styles.css"].map(read).join("\n"));
cpSync(here("./node_modules/zxing-wasm/dist/reader/zxing_reader.wasm"), join(OUT, "zxing_reader.wasm"));

// pdf.js, loaded when the first PDF file is opened. The legacy build supports older browsers.
const PDFJS = "./node_modules/pdfjs-dist/";
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) cpSync(here(PDFJS + "legacy/build/" + f), join(OUT, "pdf", f));
for (const f of ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"]) cpSync(here(PDFJS + "wasm/" + f), join(OUT, "pdf/wasm", f));
cpSync(here(PDFJS + "iccs/"), join(OUT, "pdf/iccs"), { recursive: true });

// ---- fonts, icons and the manifest ----------------------------------------------

cpSync(here(BRAND + "fonts/"), join(OUT, "fonts"), { recursive: true, filter: (src) => !/\.txt$/.test(src) });

for (const [name, data] of Object.entries(iconFiles())) emit(name, data);

emit(
  "manifest.webmanifest",
  JSON.stringify(
    {
      name: en.appName,
      short_name: "DKDS",
      description: DESCRIPTION,
      start_url: "./",
      scope: "./",
      display: "standalone",
      background_color: "#F5F6F4",
      theme_color: "#F5F6F4",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" },
        { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
      ],
    },
    null,
    2,
  ),
);

// ---- licences of the works contained in the build -------------------------------

const section = (title, text) => `${"=".repeat(100)}\n${title}\n${"=".repeat(100)}\n\n${text.trim()}\n`;
const apache = "Licensed under the Apache License, Version 2.0, whose text is given in the first section.";
emit(
  "licences.txt",
  [
    section("scan.dkds.org", `${read("./NOTICE")}\n\n${read("./LICENSE")}`),
    section("zxing-wasm 3.1.4", read("./node_modules/zxing-wasm/LICENSE")),
    section("ZXing-C++, contained in zxing-wasm", apache),
    section(`pdf.js ${pdfVersion}`, `Copyright Mozilla Foundation. ${apache}`),
    ...readdirSync(here(PDFJS + "wasm/"))
      .filter((f) => f.startsWith("LICENSE_"))
      .map((f) => section(`pdf.js WebAssembly modules: ${f.slice(8)}`, read(PDFJS + "wasm/" + f))),
    section("@noble/curves", read("../dkds.js/node_modules/@noble/curves/LICENSE")),
    section("@noble/hashes", read("../dkds.js/node_modules/@noble/hashes/LICENSE")),
    section("Roboto", read(BRAND + "fonts/LICENSE-Roboto.txt")),
    section("Roboto Mono", read(BRAND + "fonts/LICENSE-RobotoMono.txt")),
    section("Roboto Slab", read(BRAND + "fonts/LICENSE-RobotoSlab.txt")),
    section("Lucide (icons)", read(BRAND + "LICENSE-Lucide.txt")),
  ].join("\n"),
);

// ---- the page -------------------------------------------------------------------

const SYMBOLS = `${markSymbol()}\n${iconSymbols()}`;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// The favicon links of the brand, relative to the page, so that the verifier works under any path.
const ICONS = ICON_LINKS.replace(/href="\//g, 'href="');
// The texts of the page in English; the application sets them in the language it starts in.
const tokens = { CSP, DESCRIPTION: escape(DESCRIPTION), DROP: escape(en.home.drop), LANGUAGE: escape(en.language), SYMBOLS, ICONS };
emit("index.html", read("./src/index.html").replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => {
  if (!(k in tokens)) throw new Error(`unknown token ${k}`);
  return tokens[k];
}));

// ---- hosting -------------------------------------------------------------------------
// vercel.json holds the response headers and is committed, as Vercel reads it before building.
// serve.mjs serves out/ with the same headers.

const HEADERS = [
  { key: "Content-Security-Policy", value: `${CSP}; frame-ancestors 'none'` },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];
writeFileSync(
  here("./vercel.json"),
  JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: null,
      installCommand: "npm ci && npm ci --omit=dev --prefix ../dkds.js",
      buildCommand: "node build.mjs",
      outputDirectory: "out",
      headers: [
        { source: "/(.*)", headers: HEADERS },
        { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      ],
    },
    null,
    2,
  ) + "\n",
);

// ---- the build identifier and the service worker --------------------------------
// The identifier is a hash of every file, with the placeholder in app.js. It names the service
// worker's cache, so that a new build replaces the stored files, and is shown in the footer.

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const outputs = files(OUT).map((f) => relative(OUT, f).replace(/\\/g, "/"));
const precache = ["./", ...outputs.filter((f) => !f.startsWith("pdf/") && !["index.html", "icon-512.png", "icon-maskable-512.png"].includes(f))];
const hash = createHash("sha256");
for (const f of outputs.sort()) hash.update(f).update(readFileSync(join(OUT, f)));
const version = hash.digest("hex").slice(0, 12);
const app = readFileSync(join(OUT, "app.js"), "utf8");
if (app.split(BUILD_PLACEHOLDER).length !== 2) throw new Error("app.js must contain the build placeholder once");
writeFileSync(join(OUT, "app.js"), app.replace(BUILD_PLACEHOLDER, version));
await build({
  ...common,
  entryPoints: [here("./src/sw.ts")],
  outfile: join(OUT, "sw.js"),
  format: "iife",
  define: { PRECACHE: JSON.stringify(precache), CACHE: JSON.stringify(`scan-${version}`), PDF_CACHE: JSON.stringify(`scan-pdf-${pdfVersion}`) },
});

// ---- sizes -----------------------------------------------------------------------

const gz = (f) => gzipSync(readFileSync(join(OUT, f)), { level: 9 }).length;
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
/** The files loaded at start: the page, its style sheet, app.js and the chunks app.js imports. */
const startFiles = ["index.html", "app.css", "app.js", ...[...readFileSync(join(OUT, "app.js"), "utf8").matchAll(/from"\.\/(chunks\/[^"]+)"/g)].map((m) => m[1])];
const start = startFiles.reduce((n, f) => n + gz(f), 0);
const decoder = gz("decoder.js") + gz("zxing_reader.wasm");
const pdf = gz("pdf/pdf.min.mjs") + gz("pdf/pdf.worker.min.mjs");
console.log(`wrote out/ (version ${version}): application ${kb(start)}, decoder ${kb(decoder)}, pdf.js ${kb(pdf)} (gzip)`);
