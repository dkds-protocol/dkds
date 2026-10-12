/**
 * Runs the conformance check of `conformance.ts` against the built package in Node.js, Deno and
 * headless Chrome, and requires identical results.
 *
 *   npm run build && npm run test:runtimes
 *
 * Chrome is located through the environment variable CHROME_PATH, or at its default installation path.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
import { runConformance, type Report } from "./conformance.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const vectors = JSON.parse(readFileSync(here("../../../spec/vectors/vectors.json"), "utf8")).vectors;

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

async function inNode(): Promise<Report> {
  return runConformance(vectors);
}

function inDeno(): Report {
  const deno = createRequire(import.meta.url).resolve("deno/bin.cjs");
  const out = execFileSync(process.execPath, [deno, "run", "--allow-read", here("./deno.ts")], { encoding: "utf8" });
  return JSON.parse(out);
}

async function inChrome(): Promise<Report> {
  const bundle = await build({
    entryPoints: [here("./conformance.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
  });
  const chrome = CHROME_PATHS.find((p) => p && existsSync(p));
  if (!chrome) throw new Error("Chrome was not found; set the environment variable CHROME_PATH.");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage();
    const source = bundle.outputFiles[0]!.text;
    return await page.evaluate(
      async (code: string, data: unknown) => {
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        const module = await import(url);
        return module.runConformance(data);
      },
      source,
      vectors,
    );
  } finally {
    await browser.close();
  }
}

const reports: [string, Report][] = [
  ["Node.js", await inNode()],
  ["Deno", inDeno()],
  ["Chrome", await inChrome()],
];
let failed = false;
const reference = reports[0]![1].texts;
for (const [name, report] of reports) {
  const sameTexts = JSON.stringify(report.texts) === JSON.stringify(reference);
  console.log(`${name.padEnd(8)} ${report.vectors - report.failures.length} of ${report.vectors} vectors pass; stamps ${sameTexts ? "identical" : "DIFFERENT"}`);
  for (const f of report.failures) console.log(`  ${f}`);
  if (report.failures.length > 0 || !sameTexts) failed = true;
}
process.exitCode = failed ? 1 : 0;
