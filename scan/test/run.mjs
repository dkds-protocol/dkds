// Tests of scan.dkds.org in Chrome. Run after the build:
//
//   node build.mjs && node test/run.mjs
//
// The DNS is answered by the test, which intercepts the requests to the resolvers and replies with
// DNS messages built from the test vectors; the verifier's clock is set to each vector's time.
// Screenshots of every screen are written to test/out/screens/.

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import puppeteer from "puppeteer-core";
import { DEFAULT_DOH_SERVERS } from "../../dkds.js/src/index.ts";
import { serve } from "../serve.mjs";
import { en } from "../src/i18n/en.ts";
import { LANGUAGES as LANGUAGE_LIST } from "../src/text.ts";
import * as F from "./fixtures.mjs";

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const BUILD = fileURLToPath(new URL("../out/", import.meta.url));
const CHROME =
  process.env.CHROME_PATH ??
  { win32: "C:/Program Files/Google/Chrome/Application/chrome.exe", darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }[process.platform] ??
  "/usr/bin/google-chrome";
const WIDTHS = [320, 360, 390, 768, 1024, 1440];
const RESOLVERS = DEFAULT_DOH_SERVERS.map((u) => new URL(u).host);
const VECTORS = JSON.parse(readFileSync(new URL("../../spec/vectors/vectors.json", import.meta.url), "utf8")).vectors;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "fixtures"), { recursive: true });
mkdirSync(join(OUT, "screens"), { recursive: true });

// ---- reporting ------------------------------------------------------------------

let failures = 0;
const sections = [];
const only = process.argv[2];
/** Runs a group of checks and records its result. With an argument, only the groups whose name contains it run. */
async function group(name, fn) {
  if (only && !name.includes(only)) return;
  const t = Date.now();
  try {
    const summary = await fn();
    sections.push(`ok    ${name}${summary ? `: ${summary}` : ""} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    failures++;
    sections.push(`FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
  console.log(sections.at(-1));
}

// ---- simulated DNS ----------------------------------------------------------------

function encodeName(name) {
  const out = [];
  for (const label of name.replace(/\.$/, "").split(".")) out.push(label.length, ...Buffer.from(label, "latin1"));
  out.push(0);
  return out;
}

function rr(owner, type, rdata) {
  return [...encodeName(owner), 0, type, 0, 1, 0, 0, 1, 0, rdata.length >> 8, rdata.length & 0xff, ...rdata];
}

function txtRdata(strings) {
  const out = [];
  for (const s of strings) {
    const bytes = Buffer.from(s, "latin1");
    out.push(bytes.length, ...bytes);
  }
  return out;
}

/** Answers a DNS query from a table in the form of the test vectors' `dns`. */
function dnsReply(query, table) {
  let offset = 12;
  const labels = [];
  while (query[offset] !== 0) {
    labels.push(query.subarray(offset + 1, offset + 1 + query[offset]).toString("latin1"));
    offset += query[offset] + 1;
  }
  const question = [...query.subarray(12, offset + 5)];
  const qname = labels.join(".");
  const lookup = (name) => table[name] ?? table[name.toLowerCase()];
  const answers = [];
  let name = qname;
  let entry = lookup(name);
  for (let hops = 0; entry?.result === "cname" && hops < 8; hops++) {
    answers.push(rr(name, 5, encodeName(entry.target)));
    name = entry.target;
    entry = lookup(name);
  }
  if (entry?.result === "failure") return { qname, status: 503 };
  let flags = 0x8180;
  if (entry === undefined || entry.result === "nxdomain") flags |= 3;
  else {
    if (entry.dnssec) flags |= 0x20;
    for (const record of entry.txt) answers.push(rr(name, 16, txtRdata(record)));
  }
  const header = [0, 0, flags >> 8, flags & 0xff, 0, 1, 0, answers.length, 0, 0, 0, 0];
  return { qname, status: 200, body: Buffer.from([...header, ...question, ...answers.flat()]) };
}

// ---- browser ------------------------------------------------------------------------

const { server, url } = await serve();
const host = new URL(url).host;
/** Hosts of every request made by any page, for the network check. */
const contacted = new Set();
/** Script errors and CSP violations of every page. */
const errors = [];

async function launch(args = []) {
  return puppeteer.launch({ executablePath: CHROME, headless: true, args });
}

/** Launches Chrome with a simulated camera that shows the video file at `path`, with camera access granted. */
async function launchCamera(path) {
  const b = await launch(["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${path}`]);
  await b.setPermission(new URL(url).origin, { permission: { name: "camera" }, state: "granted" });
  return b;
}

/** Runs `promise`; when it fails, adds the state of the camera permission, the stream and the video to the error. */
async function withCameraState(page, promise) {
  try {
    return await promise;
  } catch (e) {
    const camera = await page
      .evaluate(async () => {
        const permission = await navigator.permissions.query({ name: "camera" }).then((p) => p.state, () => "unknown");
        const video = document.querySelector("video");
        const track = video?.srcObject?.getVideoTracks?.()[0];
        const stream = track ? `track ${track.readyState}, muted ${track.muted}` : "no stream";
        return `permission ${permission}; ${stream}; video ${video ? `readyState ${video.readyState}, ${video.videoWidth}x${video.videoHeight}` : "absent"}`;
      })
      .catch(() => "state unavailable");
    throw new Error(`${e instanceof Error ? e.message : e} (camera: ${camera})`);
  }
}

/**
 * Opens a page whose DNS requests are answered from `state.dns` and whose clock reads `state.now`
 * where set. Errors, CSP violations and the names queried are recorded in `state`.
 */
async function openPage(browser, { width = 390, height = 844, intercept = true, before, query = "" } = {}) {
  const page = await browser.newPage();
  const state = { dns: {}, queries: [], errors };
  await page.setViewport({ width, height });
  await page.emulateTimezone("Europe/Amsterdam");
  await page.evaluateOnNewDocument(() => {
    const real = Date.now.bind(Date);
    Date.now = () => (typeof globalThis.__now === "number" ? globalThis.__now * 1000 : real());
    document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`));
  });
  if (before) await page.evaluateOnNewDocument(before);
  page.on("pageerror", (e) => state.errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && state.errors.push(m.text()));
  page.on("request", (r) => contacted.add(new URL(r.url()).host || new URL(r.url()).protocol));
  if (intercept) {
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const u = new URL(request.url());
      if (!RESOLVERS.includes(u.host)) return void request.continue();
      const reply = dnsReply(Buffer.from(u.searchParams.get("dns") ?? "", "base64url"), state.dns);
      state.queries.push(reply.qname);
      const headers = { "access-control-allow-origin": "*", "content-type": "application/dns-message" };
      void request.respond(reply.status === 200 ? { status: 200, headers, body: reply.body } : { status: reply.status, headers: { "access-control-allow-origin": "*" }, body: "" });
    });
  }
  await page.goto(url + query, { waitUntil: "networkidle0" });
  await screen(page, ["home"]);
  return { page, state };
}

/** Waits until one of the named screens is shown and returns its name. */
async function screen(page, names, timeout = 20000) {
  await page.waitForFunction((n) => n.includes(document.body.dataset.screen), { timeout }, names).catch(async (e) => {
    const shown = await page.evaluate(() => `${document.body.dataset.screen}: ${document.querySelector("main")?.innerText.replace(/\s+/g, " ").slice(0, 160)}`);
    throw new Error(`waiting for ${names.join(" or ")}; shown: ${shown}`);
  });
  return page.evaluate(() => document.body.dataset.screen);
}

/** Clicks the first visible button whose text is `label`. */
async function press(page, label) {
  const clicked = await page.evaluate((l) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l && x.offsetParent !== null);
    b?.click();
    return Boolean(b);
  }, label);
  assert.ok(clicked, `no button "${label}"`);
}

/** Verifies text through the text input and returns the cards. */
async function verifyText(page, state, text, { now, dns } = {}) {
  state.dns = dns ?? {};
  state.queries = [];
  await page.evaluate((t) => (globalThis.__now = t), now ?? null);
  if ((await page.evaluate(() => document.body.dataset.screen)) !== "text") await press(page, "Paste text");
  await screen(page, ["text"]);
  await page.$eval("#stamp-text", (el, t) => (el.value = t), text);
  await press(page, "Verify text");
  await screen(page, ["results"]);
  return cards(page);
}

/** Opens a file through the file input and returns the screen reached. */
async function openFile(page, state, path, { dns } = {}) {
  state.dns = dns ?? F.testDns();
  await page.evaluate(() => (globalThis.__now = null));
  const input = await page.$("#file");
  // As the application does on "Open file": a file input reports no change for the same file.
  await page.evaluate(() => {
    document.body.dataset.screen = "waiting";
    document.getElementById("file").value = "";
  });
  await input.uploadFile(path);
  return screen(page, ["results", "problem", "password"], 60000);
}

/** The result cards as shown. */
function cards(page) {
  return page.$$eval(".card", (list) =>
    list.map((card) => ({
      outcome: card.dataset.outcome,
      title: card.querySelector(".status")?.textContent.trim(),
      domain: card.querySelector(".domain")?.textContent,
      ascii: [...card.querySelectorAll(".warnings bdi")].map((b) => b.textContent).find((t) => t.includes("xn--")),
      facts: card.querySelector(".facts")?.textContent,
      pages: card.querySelector(".pages")?.textContent,
      stated: card.querySelector(".contents-h")?.textContent,
      source: card.querySelector(".source-name")?.textContent,
      fields: [...card.querySelectorAll(".field")].map((f) => [f.querySelector("th").textContent, f.querySelector("td .empty") ? "" : f.querySelector("td").textContent]),
      warnings: [...card.querySelectorAll(".warnings li")].map((li) => li.textContent),
      hints: [...card.querySelectorAll(".hint")].map((p) => p.textContent),
    })),
  );
}

/**
 * Text that does not fit: text that extends past the box it is set in or is cut off by a box that
 * hides its overflow, such as a long word in a narrow button (text in a scrolling container is
 * exempt), and words of prose split across two lines without a hyphen, which a long compound
 * prevents with soft hyphens (U+00AD). Codes, domain names and the issuer's fields may break anywhere.
 */
function misfits(page) {
  return page.evaluate(() => {
    const out = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      const parent = n.parentElement;
      if (!text || !parent || parent.closest("svg, script, style, .sr-only, option, [hidden]")) continue;
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0);
      if (!rects.length) continue;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      let block = parent;
      while (getComputedStyle(block).display.startsWith("inline") && block.parentElement) block = block.parentElement;
      const bounds = [block];
      let scrolled = false;
      for (let a = parent; a && a !== document.body; a = a.parentElement) {
        const overflow = getComputedStyle(a).overflowX;
        if (overflow === "auto" || overflow === "scroll") { scrolled = true; break; }
        if (overflow === "hidden" || overflow === "clip") bounds.push(a);
      }
      if (scrolled) continue;
      const box = bounds.map((b) => b.getBoundingClientRect()).concat([{ left: 0, right: innerWidth }]);
      const past = Math.max(...box.map((b) => Math.max(right - b.right, b.left - left)));
      if (past > 1) out.push(`"${text.slice(0, 40)}" +${Math.round(past)}px`);
      if (parent.closest('[translate="no"], code, pre, .mono')) continue;
      for (const m of n.textContent.matchAll(/[\p{L}\u00ad]{6,}/gu)) {
        if (m[0].includes("\u00ad")) continue;
        range.setStart(n, m.index);
        range.setEnd(n, m.index + m[0].length);
        if ([...range.getClientRects()].filter((r) => r.width > 0).length > 1) out.push(`"${m[0]}" broken without a hyphen`);
      }
    }
    return out;
  });
}

/**
 * Checks for horizontal overflow of the page and for text that does not fit, at every width, and saves
 * screenshots at 390 and 1280 pixels.
 */
async function layout(page, name) {
  const original = page.viewport();
  const over = [];
  for (const width of [...WIDTHS, 1280]) {
    await page.setViewport({ width, height: 844 });
    const excess = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (excess > 0 && WIDTHS.includes(width)) over.push(`${width}: +${excess}px`);
    if (WIDTHS.includes(width)) for (const c of await misfits(page)) over.push(`${width}: ${c}`);
    if (width === 390 || width === 1280) await page.screenshot({ path: join(OUT, "screens", `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewport(original);
  assert.deepEqual(over, [], `${name} overflows`);
}

function file(name, data) {
  const path = join(OUT, "fixtures", name);
  writeFileSync(path, data);
  return path;
}

/** The texts of every language, English first. */
const LANGUAGES = await Promise.all(LANGUAGE_LIST.map((l) => l.load()));

const browser = await launch();
console.log(await browser.version());
const { page, state } = await openPage(browser);

// ---- 1. the test vectors through the text input -------------------------------------

await group("test vectors through the text input", async () => {
  const wrong = [];
  for (const v of VECTORS) {
    await page.evaluate(() => localStorage.clear());
    const [card] = await verifyText(page, state, v.text, { now: v.now, dns: v.dns });
    const e = v.expected;
    const queries = [...new Set(state.queries)];
    const problems = [];
    if (card.outcome !== e.outcome) problems.push(`outcome ${card.outcome}`);
    if (JSON.stringify(queries) !== JSON.stringify(e.queries)) problems.push(`queries ${JSON.stringify(queries)}`);
    if (e.outcome === "valid") {
      if (card.domain !== e.domain_unicode) problems.push(`domain ${card.domain}`);
      if (e.domain !== e.domain_unicode && card.ascii !== e.domain) problems.push(`ASCII form ${card.ascii}`);
      if (JSON.stringify(card.fields) !== JSON.stringify(e.fields)) problems.push("fields differ");
      if (!card.stated?.endsWith(e.domain_unicode)) problems.push(`heading ${card.stated}`);
      const d = new Date(e.issued_at * 1000);
      // The page runs in Europe/Amsterdam (openPage), so the time is local with its offset.
      const local = new Intl.DateTimeFormat("en-GB", { year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).formatToParts(d);
      const part = (type) => local.find((p) => p.type === type).value;
      if (!card.facts.includes(`${part("hour")}:${part("minute")}:${part("second")} (UTC+0`) || !card.facts.includes(part("year"))) problems.push(`time ${card.facts}`);
      if (!card.facts.includes(e.dnssec ? "Answer validated with DNSSEC" : "Answer not validated with DNSSEC")) problems.push("DNSSEC line");
    } else if (card.fields.length > 0 || card.stated !== undefined) problems.push("fields shown for an outcome other than valid");
    if (problems.length) wrong.push(`${v.id}: ${problems.join("; ")}`);
  }
  assert.deepEqual(wrong, []);
  return `${VECTORS.length} vectors, outcome, queries, domain, time, DNSSEC status and fields as displayed`;
});

// ---- 2. display ------------------------------------------------------------------------

const vector = (id) => VECTORS.find((v) => v.id === id);
async function showVector(id) {
  const v = vector(id);
  await page.evaluate(() => localStorage.clear());
  return verifyText(page, state, v.text, { now: v.now, dns: v.dns });
}

await group("links and version", async () => {
  await page.goto(url, { waitUntil: "networkidle0" });
  await screen(page, ["home"]);
  const links = await page.$$eval("a[href]", (list) => list.map((a) => ({ href: a.getAttribute("href"), target: a.target, rel: a.rel })));
  const sameTab = links.filter((l) => l.target !== "_blank" || !l.rel.includes("noopener")).map((l) => l.href);
  assert.deepEqual(sameTab, ["./"], "only the link to the verifier itself opens in the same tab");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const line = await page.$eval(".foot p", (e) => e.textContent);
  assert.match(line, new RegExp(`^Verifier ${version.replace(/\./g, "\\.")} · build [0-9a-f]{12}$`));
  return `${links.length - 1} links open in a new tab; ${line}`;
});

await group("display of each outcome at widths 320 to 1440", async () => {
  await page.goto(url, { waitUntil: "networkidle0" });
  await screen(page, ["home"]);
  await layout(page, "home");
  await press(page, "Paste text");
  await press(page, "Verify text");
  assert.ok(await page.$eval(".error", (e) => !e.hidden), "no message for empty text");
  await layout(page, "text-empty");

  const [idn] = await showVector("valid-idn-domain");
  assert.equal(idn.ascii, "xn--mnchen-3ya.example");
  assert.ok(idn.warnings.some((w) => w.includes("xn--mnchen-3ya.example")), "no IDN warning");
  await layout(page, "valid-idn");
  await showVector("valid-unicode-fields");
  await layout(page, "valid-unicode-fields");
  await showVector("valid-name-255-bytes");
  await layout(page, "valid-long-name");
  await showVector("valid-envelope-1088");
  await layout(page, "valid-long-value");
  await showVector("valid-lookup-name-253");
  await layout(page, "valid-long-domain");
  for (const [outcome, id] of [
    ["malformed", "carrier-trailing-newline"],
    ["unsupported", "envelope-version-02"],
    ["key-not-found", "dns-nxdomain"],
    ["key-revoked", "record-revoked"],
    ["invalid-signature", "signature-payload-altered"],
    ["unavailable", "dns-failure"],
  ]) {
    const [card] = await showVector(id);
    assert.equal(card.outcome, outcome, id);
    await layout(page, outcome);
  }
  const [newline] = await showVector("carrier-trailing-newline");
  assert.ok(newline.hints.length === 1, "no hint about the line break");
  return "home, text input, 5 valid stamps with long, right-to-left and internationalised content, 6 other outcomes";
});

await group("verify again after an unavailable key", async () => {
  const v = vector("dns-failure");
  const [before] = await showVector("dns-failure");
  assert.equal(before.outcome, "unavailable");
  state.dns = vector("valid-appendix-c").dns;
  await press(page, "Verify again");
  await page.waitForSelector('.card[data-outcome="valid"]', { timeout: 10000 });
  return `${v.id} answered on the second attempt`;
});

await group("pasting the plain-text form of the clipboard", async () => {
  const v = vector("valid-appendix-c");
  // The link form that Safari on iOS pastes by default, beside the plain-text form.
  const link = "dkds:" + v.text.slice(5).replace(/ /g, "%20").replace(/%(?![0-9A-F]{2})/g, "%25");
  const paste = (selector) =>
    page.evaluate((selector, plain, link) => {
      const data = new DataTransfer();
      data.setData("text/uri-list", link);
      data.setData("text/plain", plain);
      document.querySelector(selector).dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    }, selector, v.text, link);
  const field = () => page.$eval("#stamp-text", (e) => e.value);
  state.dns = v.dns;
  // Into the text field.
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate((t) => { localStorage.clear(); globalThis.__now = t; }, v.now);
  await press(page, "Paste text");
  await screen(page, ["text"]);
  await page.focus("#stamp-text");
  await paste("#stamp-text");
  assert.equal(await field(), v.text, "text field");
  await press(page, "Verify text");
  await screen(page, ["results"]);
  assert.equal((await cards(page))[0].outcome, "valid");
  // Onto the page outside a text field.
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate((t) => { globalThis.__now = t; }, v.now);
  await paste("body");
  await screen(page, ["text"]);
  assert.equal(await field(), v.text, "page");
  return "the plain-text form is inserted, not the link form, in the text field and from the page";
});

await group("warnings from the key store", async () => {
  await page.evaluate(() => localStorage.clear());
  const a = await F.stamp({ fields: [["Invoice", "1"]] });
  const changed = await F.stamp({ fields: [["Invoice", "2"]], key: F.KEY_B });
  const similar = await F.stamp({ domain: "scan-tost.example", fields: [["Invoice", "3"]] });
  const [first] = await verifyText(page, state, a.text, { dns: F.testDns() });
  assert.equal(first.outcome, "valid");
  assert.deepEqual(first.warnings, []);
  const [second] = await verifyText(page, state, changed.text, { dns: F.testDns(F.RECORD_B) });
  assert.equal(second.outcome, "valid");
  assert.ok(second.warnings.some((w) => w.includes("differs from the key seen")), "no key-changed warning");
  const [third] = await verifyText(page, state, similar.text, { dns: F.testDns(F.RECORD_A, "scan-tost.example") });
  assert.ok(third.warnings.some((w) => w.includes("resembles scan-test.example")), `no similar-domain warning: ${third.warnings}`);
  await layout(page, "valid-warnings");
  const [gone] = await verifyText(page, state, a.text, { dns: {} });
  assert.equal(gone.outcome, "key-not-found");
  assert.ok(gone.warnings.some((w) => w.includes("no longer published")), "no key-disappeared warning");

  await page.goto(url, { waitUntil: "networkidle0" });
  await screen(page, ["home"]);
  assert.match(await page.$eval(".privacy", (e) => e.textContent), /Keys of 2 verified domains/);
  page.once("dialog", (d) => d.accept());
  await press(page, "Forget verified domains");
  assert.match(await page.$eval(".privacy", (e) => e.textContent), /have been forgotten/);
  assert.equal(await page.evaluate(() => localStorage.length), 0);
  return "key changed, similar domain, key disappeared, forget";
});

await group("local storage unavailable", async () => {
  const { page: p, state: s } = await openPage(browser, {
    before: `Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } })`,
  });
  const a = await F.stamp({ fields: [["Invoice", "1"]] });
  const [card] = await verifyText(p, s, a.text, { dns: F.testDns() });
  assert.equal(card.outcome, "valid");
  await p.goBack();
  await screen(p, ["home"]);
  assert.match(await p.$eval(".privacy", (e) => e.textContent), /Keys of 1 verified domain is/);
  await p.close();
  return "verification works; the key store lasts for the session";
});

await group("back button", async () => {
  await verifyText(page, state, vector("valid-appendix-c").text, { now: vector("valid-appendix-c").now, dns: vector("valid-appendix-c").dns });
  await page.goBack();
  await screen(page, ["home"]);
  await press(page, "Paste text");
  await screen(page, ["text"]);
  await press(page, "Back");
  await screen(page, ["home"]);
  return "results and text input return to the home screen";
});

// ---- 3. QR images ---------------------------------------------------------------------

const byVersion = await F.stampsByVersion();
const smallest = Math.min(...byVersion.keys());

await group(`QR versions ${smallest} to 27 as images`, async () => {
  const wrong = [];
  let count = 0;
  for (const [version, { stamp, fields }] of byVersion) {
    for (const [label, options] of [
      ["2px", { scale: 2 }],
      ["4px-rotated-23", { scale: 4, angle: 23 }],
      ["photo", { scale: 5, angle: 4, blur: 1, noiseLevel: 30, gradient: 0.5, perspective: 0.08, margin: 60 }],
    ]) {
      const path = file(`v${version}-${label}.png`, F.qrPng(stamp.qr, options.scale, options));
      const reached = await openFile(page, state, path);
      const [card] = reached === "results" ? await cards(page) : [];
      count++;
      if (card?.outcome !== "valid" || JSON.stringify(card.fields) !== JSON.stringify(fields)) wrong.push(`v${version} ${label}: ${reached} ${card?.outcome ?? ""}`);
    }
  }
  assert.deepEqual(wrong, []);
  return `${count} images: 2 pixels per module; rotated 23° at 4 pixels; blurred, noisy, unevenly lit and in perspective`;
});

await group(`QR versions 1 to ${smallest - 1} as images`, async () => {
  const wrong = [];
  for (const { version, text } of F.shortCodes(smallest)) {
    const reached = await openFile(page, state, file(`short-v${version}.png`, F.qrPng(F.encodeQr(text), 4)));
    const [card] = reached === "results" ? await cards(page) : [];
    if (!["malformed", "unsupported"].includes(card?.outcome)) wrong.push(`v${version}: ${reached} ${card?.outcome ?? ""}`);
  }
  assert.deepEqual(wrong, []);
  return "read, and reported as malformed or unsupported, since no stamp is that short";
});

await group("several codes in one image", async () => {
  const a = await F.stamp({ fields: [["Invoice", "A"]] });
  const b = await F.stamp({ fields: [["Invoice", "B"]] });
  const other = F.encodeQr("HTTPS://PHISHING.EXAMPLE/PAY");
  const lum = F.drawCodes(1800, 700, [
    { qr: a.qr, x: 330, y: 350, scale: 5 },
    { qr: b.qr, x: 900, y: 350, scale: 5, angle: 10 },
    { qr: other, x: 1500, y: 350, scale: 6 },
  ]);
  const reached = await openFile(page, state, file("three-codes.png", F.lumPng(1800, 700, lum)));
  assert.equal(reached, "results");
  const shown = await cards(page);
  assert.deepEqual(shown.map((c) => c.outcome), ["valid", "valid"]);
  const notes = await page.$$eval(".note", (n) => n.map((x) => x.textContent));
  assert.ok(notes.some((n) => n.includes("1 other QR code")), `notes: ${notes}`);
  assert.ok(!(await page.content()).includes("PHISHING"), "the content of another QR code is shown");
  await layout(page, "results-several");
  return "two stamps verified, the third code reported without its content";
});

await group("files that hold no stamp", async () => {
  const cases = [
    ["phishing.png", F.qrPng(F.encodeQr("HTTPS://PHISHING.EXAMPLE/PAY"), 6), "not-stamp"],
    ["blank.png", F.lumPng(400, 300, new Float32Array(400 * 300).fill(240)), "no-code"],
    ["notes.txt", Buffer.from("A text file."), "file-type"],
    ["empty.png", Buffer.alloc(0), "file-empty"],
    ["damaged.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]), "image-unreadable"],
    ["damaged.pdf", Buffer.from("%PDF-1.7\nnothing else"), "pdf-unreadable"],
    ["renamed.pdf", Buffer.from("Not a PDF file at all."), "pdf-unreadable"],
  ];
  for (const [name, data, kind] of cases) {
    const reached = await openFile(page, state, file(name, data));
    assert.equal(reached, "problem", name);
    assert.equal(await page.$eval(".problem", (e) => e.dataset.problem), kind, name);
    assert.ok(!(await page.content()).includes("PHISHING"), "the content of another QR code is shown");
    await layout(page, `problem-${kind}`);
  }
  return cases.map((c) => c[2]).join(", ");
});

// ---- 4. PDF files ------------------------------------------------------------------------

await group("PDF files", async () => {
  const a = await F.stamp({ fields: [["Invoice", "PDF-A"], ["Amount", "100.00 EUR"]] });
  const b = await F.stamp({ fields: [["Invoice", "PDF-B"]] });
  const other = F.encodeQr("HTTPS://PHISHING.EXAMPLE/PAY");
  const text = (s) => `BT /F1 11 Tf 56 780 Td (${s}) Tj ET\n`;

  // One page, the stamp drawn as vectors, 30 mm wide.
  let reached = await openFile(page, state, file("one.pdf", F.pdf([{ content: text("Invoice") + F.qrVector(a.qr, 460, 60, 85) }])));
  assert.equal(reached, "results");
  let shown = await cards(page);
  assert.deepEqual([shown.length, shown[0].outcome], [1, "valid"]);

  // Three pages: stamp A with another code, an empty page, stamp B as an embedded image beside A again.
  const pages = [
    { content: F.qrVector(a.qr, 460, 60, 85) + F.qrVector(other, 56, 60, 85) },
    { content: text("Terms") },
    { content: `q 85 0 0 85 300 300 cm /Im1 Do Q\n` + F.qrVector(a.qr, 460, 60, 85), images: { Im1: F.qrImage(b.qr) } },
  ];
  reached = await openFile(page, state, file("several.pdf", F.pdf(pages)));
  assert.equal(reached, "results");
  shown = await cards(page);
  assert.deepEqual(shown.map((c) => [c.outcome, c.pages]), [["valid", "Pages 1 and 3"], ["valid", "Page 3"]]);
  await layout(page, "results-pdf");

  // 55 pages, the stamp on page 2: pages 51 to 55 are not read.
  const many = Array.from({ length: 55 }, (_, i) => ({ content: i === 1 ? F.qrVector(a.qr, 460, 60, 85) : text(`Page ${i + 1}`) }));
  reached = await openFile(page, state, file("many.pdf", F.pdf(many)));
  assert.equal(reached, "results");
  const notes = await page.$$eval(".note", (n) => n.map((x) => x.textContent));
  assert.ok(notes.some((n) => n.includes("Pages 51 to 55 were not read")), `notes: ${notes}`);

  // Password protected.
  reached = await openFile(page, state, file("protected.pdf", F.pdf([{ content: F.qrVector(a.qr, 460, 60, 85) }], { password: "secret" })));
  assert.equal(reached, "password");
  await layout(page, "password");
  await page.type("#pdf-password", "wrong");
  await press(page, "Open PDF file");
  await page.waitForSelector(".error", { timeout: 10000 });
  await page.$eval("#pdf-password", (e) => (e.value = ""));
  await page.type("#pdf-password", "secret");
  await press(page, "Open PDF file");
  assert.equal(await screen(page, ["results", "problem"], 60000), "results");
  assert.equal((await cards(page))[0].outcome, "valid");

  // Declining the password returns to the home screen.
  await openFile(page, state, file("protected.pdf", F.pdf([{ content: F.qrVector(a.qr, 460, 60, 85) }], { password: "secret" })));
  await press(page, "Back");
  await screen(page, ["home"]);
  return "vector stamp, embedded image, repeated stamp, another code, 55 pages, password";
});

await group("dropping a file", async () => {
  const png = F.qrPng((await F.stamp({ fields: [["Dropped", "yes"]] })).qr, 4);
  state.dns = F.testDns();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    document.dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true }));
    document.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, png.toString("base64"));
  await screen(page, ["results"]);
  assert.deepEqual((await cards(page))[0].fields, [["Dropped", "yes"]]);
  return "an image dropped on the page is read";
});

// ---- 5. the camera -------------------------------------------------------------------------

/** Opens the camera in a browser whose fake camera shows `video`, and returns the screen reached. */
async function cameraRun(video, name) {
  const path = file(name, video);
  const b = await launchCamera(path);
  try {
    const { page: p, state: s } = await openPage(b);
    s.dns = F.testDns();
    await press(p, "Open camera");
    await screen(p, ["camera"]);
    return { browser: b, page: p, state: s };
  } catch (e) {
    await b.close();
    throw e;
  }
}

/**
 * Checks the camera screen at every width and two heights: the header hidden, no scrolling, the
 * controls in one row and unclipped, the frame centred in the image. Returns what is wrong.
 */
async function cameraFit(page) {
  const misplaced = [];
  for (const width of WIDTHS) {
    for (const height of [568, 844]) {
      await page.setViewport({ width, height });
      const p = await page.evaluate(() => {
        const rect = (e) => e.getBoundingClientRect();
        const buttons = [...document.querySelectorAll(".cam-controls .btn")];
        const view = rect(document.querySelector(".cam-view"));
        const frame = rect(document.querySelector(".cam-frame"));
        return {
          header: rect(document.querySelector(".bar")).height,
          scroll: document.documentElement.scrollHeight - innerHeight,
          rows: new Set(buttons.map((b) => Math.round(rect(b).top))).size,
          clipped: buttons.filter((b) => b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight || rect(b).left < 0 || rect(b).right > innerWidth).length,
          dx: Math.abs(frame.left + frame.width / 2 - (view.left + view.width / 2)),
          dy: Math.abs(frame.top + frame.height / 2 - (view.top + view.height / 2)),
        };
      });
      const wrong = [
        p.header > 0 && "header shown",
        p.scroll > 0 && `scrolls ${p.scroll}px`,
        p.rows !== 1 && `${p.rows} rows of controls`,
        p.clipped > 0 && `${p.clipped} controls clipped`,
        (p.dx > 1 || p.dy > 1) && `frame off centre by ${p.dx.toFixed(1)}, ${p.dy.toFixed(1)}`,
        ...(await misfits(page)),
      ].filter(Boolean);
      if (wrong.length) misplaced.push(`${width}x${height}: ${wrong.join(", ")}`);
    }
  }
  return misplaced;
}

await group("camera", async () => {
  const typical = byVersion.get(12);
  let run = await cameraRun(F.y4m(typical.stamp.qr), "camera-v12.y4m");
  try {
    await withCameraState(run.page, screen(run.page, ["results"], 30000));
    assert.equal((await cards(run.page))[0].outcome, "valid");
    assert.equal((await cards(run.page))[0].source, "Camera");
  } finally {
    await run.browser.close();
  }

  const dense = byVersion.get(27);
  run = await cameraRun(F.y4m(dense.stamp.qr, { width: 1920, height: 1080, scale: 6, frames: 3, angle: 4 }), "camera-v27.y4m");
  try {
    await withCameraState(run.page, screen(run.page, ["results"], 60000));
    assert.equal((await cards(run.page))[0].outcome, "valid");
  } finally {
    await run.browser.close();
  }

  run = await cameraRun(F.y4m(F.encodeQr("HTTPS://PHISHING.EXAMPLE/PAY"), { scale: 7 }), "camera-other.y4m");
  try {
    await withCameraState(run.page, run.page.waitForFunction(() => document.querySelector(".cam-status")?.textContent === "This QR code is not a DKDS stamp.", { timeout: 30000 }));
    assert.ok(!(await run.page.content()).includes("PHISHING"));
    // The simulated camera has no torch and cannot be switched; all three controls are shown, with
    // the longest label, to check that they fit.
    await run.page.evaluate(() => {
      for (const b of document.querySelectorAll(".cam-btn")) b.hidden = false;
      document.querySelector(".cam-btn span").textContent = "Turn off torch";
    });
    const misplaced = await cameraFit(run.page);
    assert.deepEqual(misplaced, []);
    await run.page.setViewport({ width: 390, height: 844 });
    await layout(run.page, "camera");
    await press(run.page, "Close camera");
    await screen(run.page, ["home"]);
    const live = await run.page.evaluate(() => document.querySelector("video")?.srcObject ?? null);
    assert.equal(live, null, "the camera is still running");
  } finally {
    await run.browser.close();
  }
  return "version 12 and version 27 stamps read from a moving camera image; another code reported; header hidden, controls in one row and frame centred at every width; camera closed";
});

await group("camera failures", async () => {
  const b = await launch(["--use-fake-device-for-media-stream", "--deny-permission-prompts"]);
  try {
    const { page: p } = await openPage(b);
    await press(p, "Open camera");
    assert.equal(await screen(p, ["problem"], 30000), "problem");
    assert.equal(await p.$eval(".problem", (e) => e.dataset.problem), "camera-denied");
    await layout(p, "problem-camera-denied");
  } finally {
    await b.close();
  }
  const kinds = [];
  for (const [error, kind] of [
    ["NotFoundError", "camera-missing"],
    ["NotReadableError", "camera-busy"],
    [null, "camera-unsupported"],
  ]) {
    const { page: p } = await openPage(browser, {
      intercept: false,
      before: `(() => {
        const error = ${JSON.stringify(error)};
        if (error === null) Object.defineProperty(navigator, "mediaDevices", { value: undefined });
        else navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("test", error));
      })()`,
    });
    await press(p, "Open camera");
    await screen(p, ["problem"]);
    assert.equal(await p.$eval(".problem", (e) => e.dataset.problem), kind);
    await layout(p, `problem-${kind}`);
    kinds.push(kind);
    await p.close();
  }
  return ["camera-denied", ...kinds].join(", ");
});

// ---- 6. languages ------------------------------------------------------------------------------

/** Names and abbreviations that read the same in every language. */
const SAME_EVERYWHERE = ["DKDS", "dkds.org", "DNS", "Apache License 2.0"];

/**
 * Texts that a language writes as English does. Every other text identical to the English one is
 * taken to be untranslated, so that a text copied from English as a stand-in is found.
 */
const SAME_AS_ENGLISH = {
  nl: ["Privacy", "Camera"],
  fr: ["Documentation", "Licences", "Page 2"],
  de: ["Domain", "Text"],
  es: [],
  it: ["Privacy", "Password"],
};

/** The texts that `language` may show as English does. */
const sameAsEnglish = (language) => new Set([...SAME_EVERYWHERE, ...(SAME_AS_ENGLISH[language.code] ?? [])]);

/**
 * Arguments with which each text function is called to compare the languages: every function of
 * en.ts needs an entry, so that a new function is compared too.
 */
const FILE = ["invoice.pdf"];
const SAMPLES = {
  "warnings.idn": [[{ ascii: "xn--mnchen-3ya.example", similar: [] }]],
  "warnings.mixed-script": [[{ ascii: "", similar: [] }]],
  "warnings.single-resolver": [[{ ascii: "", similar: [] }]],
  "warnings.key-changed": [[{ ascii: "", similar: [] }]],
  "warnings.key-disappeared": [[{ ascii: "", similar: [] }]],
  "warnings.similar-domain": [[{ ascii: "", similar: ["a.example"] }], [{ ascii: "", similar: ["a.example", "b.example", "c.example"] }]],
  "privacy.store": [[0], [1], [3]],
  "privacy.forgetConfirm": [[1], [3]],
  "footer.version": [["1.0.0", "0123456789ab"]],
  "working.reading": [FILE],
  "working.page": [[2, 5]],
  "working.verifying": [[1], [3]],
  "result.title": [[1], [3]],
  "result.unread": [[51, 55]],
  "result.others": [[1], [3]],
  "result.page": [[[2]], [[1, 3]], [[1, 2, 3]]],
  "result.dnssec": [[true], [false]],
  "result.step": [[5]],
  "problem.fileType.body": [FILE],
  "problem.fileTooLarge.body": [FILE],
  "problem.fileEmpty.body": [FILE],
  "problem.imageUnreadable.body": [FILE],
  "problem.pdfUnreadable.body": [FILE],
  "problem.pdfPassword.body": [FILE],
  "problem.noCode.image": [FILE],
  "problem.noCode.pdf": [["invoice.pdf", 1], ["invoice.pdf", 4]],
  "problem.notStamp.body": [[1], [3]],
  "problem.unexpected.body": [["Out of memory"]],
};

/** Every text of a language module as [key, text]: strings, and each function called with its samples. */
function textsOf(language) {
  const out = [];
  const walk = (node, path) => {
    for (const [key, value] of Object.entries(node)) {
      const at = path ? `${path}.${key}` : key;
      if (typeof value === "string") out.push([at, value]);
      else if (typeof value === "function") {
        if (!SAMPLES[at]) throw new Error(`no samples for the text function ${at}`);
        SAMPLES[at].forEach((args, i) => {
          const result = value(...args);
          out.push([`${at}#${i}`, Array.isArray(result) ? result.map((part) => (typeof part === "string" ? part : part.domain)).join("") : result]);
        });
      } else if (value !== null && typeof value === "object") walk(value, at);
    }
  };
  walk(language, "");
  return out;
}

/** The keys that are not texts shown on screen. */
const NOT_SHOWN = new Set(["code", "name", "locale"]);

await group("languages: every text translated", async () => {
  const english = new Map(textsOf(en));
  const untranslated = [];
  for (const language of LANGUAGES.filter((l) => l !== en)) {
    const same = sameAsEnglish(language);
    for (const [key, text] of textsOf(language)) {
      if (!NOT_SHOWN.has(key) && text === english.get(key) && !same.has(text)) untranslated.push(`${language.code} ${key}: "${text}"`);
    }
  }
  assert.deepEqual(untranslated, [], "texts identical to English");
  return `${english.size} texts and sentences in ${LANGUAGES.length - 1} languages differ from English, apart from the listed names and words`;
});

/** The texts the page shows outside elements marked translate="no": text nodes, accessible names and the title. */
function shownTexts(page) {
  return page.evaluate(() => {
    const out = new Set([document.title]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement || n.parentElement.closest('[translate="no"], script, style, svg, option')) continue;
      out.add(n.textContent.replace(/\s+/g, " ").trim());
    }
    for (const el of document.querySelectorAll("[aria-label], [title]")) {
      if (el.closest('[translate="no"]')) continue;
      out.add(el.getAttribute("aria-label") ?? "");
      out.add(el.getAttribute("title") ?? "");
    }
    return [...out].filter((t) => /\p{L}/u.test(t));
  });
}

/** Clicks the first element that matches `selector`, for controls whose label depends on the language. */
const click = (page, selector) => page.$eval(selector, (e) => e.click());

/** Verifies text through the text input, finding the controls by position rather than by label. */
async function verifyTextIn(page, state, text, { now, dns } = {}) {
  state.dns = dns ?? {};
  await page.evaluate((t) => (globalThis.__now = t), now ?? null);
  if ((await page.evaluate(() => document.body.dataset.screen)) !== "text") await click(page, ".inputs .btn:nth-child(3)");
  await screen(page, ["text"]);
  await page.$eval("#stamp-text", (el, t) => (el.value = t), text);
  await click(page, ".form button[type=submit]");
  await screen(page, ["results"]);
}

/** The screens that {@link tour} shows. */
const TOUR_VECTORS = ["valid-idn-domain", "valid-unicode-fields", "carrier-trailing-newline", "record-revoked", "dns-failure"];

/**
 * Shows each kind of screen in the language `code` and checks its layout. Returns the texts shown
 * on each screen.
 */
async function tour(code) {
  const { page: p, state: s } = await openPage(browser, { query: `?lang=${code}` });
  const shown = {};
  const visit = async (name) => {
    await layout(p, `${code}-${name}`);
    shown[name] = await shownTexts(p);
  };
  try {
    assert.equal(await p.evaluate(() => document.documentElement.lang), code, "lang attribute");
    assert.equal(await p.$eval("#lang-code", (e) => e.textContent), code.toUpperCase(), "language menu");
    await visit("home");
    await click(p, ".inputs .btn:nth-child(3)");
    await screen(p, ["text"]);
    await click(p, ".form button[type=submit]");
    await visit("text");
    for (const id of TOUR_VECTORS) {
      const v = vector(id);
      await verifyTextIn(p, s, v.text, { now: v.now, dns: v.dns });
      await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      await visit(id);
    }
    const a = await F.stamp({ fields: [["Invoice", "PDF-A"]] });
    const pdf = file(`${code}-two-pages.pdf`, F.pdf([{ content: F.qrVector(a.qr, 460, 60, 85) }, { content: F.qrVector(a.qr, 460, 60, 85) }]));
    assert.equal(await openFile(p, s, pdf), "results");
    await visit("results-pdf");
    assert.equal(await openFile(p, s, file(`${code}-notes.txt`, Buffer.from("A text file."))), "problem");
    await visit("problem-file-type");
    const locked = file(`${code}-protected.pdf`, F.pdf([{ content: F.qrVector(a.qr, 460, 60, 85) }], { password: "secret" }));
    assert.equal(await openFile(p, s, locked), "password");
    await visit("password");
  } finally {
    await p.close();
  }
  return shown;
}

await group("languages: every screen, without overflow and without English text", async () => {
  const english = await tour("en");
  const found = [];
  for (const language of LANGUAGES.filter((l) => l !== en)) {
    const same = sameAsEnglish(language);
    const shown = await tour(language.code);
    for (const [name, texts] of Object.entries(shown)) {
      for (const text of texts) if (english[name].includes(text) && !same.has(text)) found.push(`${language.code} ${name}: "${text}"`);
    }
  }
  assert.deepEqual(found, [], "texts left in English");
  return `${LANGUAGES.map((l) => l.code).join(", ")}: ${TOUR_VECTORS.length + 5} screens each at widths 320 to 1440`;
});

await group("languages: camera controls", async () => {
  const misplaced = [];
  const path = file("camera-languages.y4m", F.y4m(F.encodeQr("HTTPS://PHISHING.EXAMPLE/PAY"), { scale: 7 }));
  const b = await launchCamera(path);
  try {
    for (const language of LANGUAGES) {
      const { page: p } = await openPage(b, { query: `?lang=${language.code}` });
      await click(p, ".inputs .btn:nth-child(1)");
      await screen(p, ["camera"]);
      // The camera has started once the status asks for the stamp; the controls are then final.
      const started = [language.camera.aim, language.camera.notStamp, language.camera.steady];
      await withCameraState(p, p.waitForFunction((texts) => texts.includes(document.querySelector(".cam-status")?.textContent), { timeout: 30000 }, started));
      // All three controls, with the longer torch label, as on a phone with a torch and two cameras.
      const longer = [language.camera.torchOn, language.camera.torchOff].sort((x, y) => y.length - x.length)[0];
      await p.evaluate((label) => {
        for (const button of document.querySelectorAll(".cam-btn")) button.hidden = false;
        document.querySelector(".cam-btn span").textContent = label;
      }, longer);
      assert.equal(await p.$$eval(".cam-controls .btn:not([hidden])", (list) => list.length), 3, "controls shown");
      misplaced.push(...(await cameraFit(p)).map((m) => `${language.code} ${m}`));
      await p.setViewport({ width: 360, height: 640 });
      await p.screenshot({ path: join(OUT, "screens", `${language.code}-camera-360.png`) });
      await p.close();
    }
  } finally {
    await b.close();
  }
  assert.deepEqual(misplaced, []);
  return "the three controls fit in one row at every width in every language";
});

await group("languages: choice, storage and browser preference", async () => {
  const pick = (code) => LANGUAGES.find((l) => l.code === code);
  const heading = (p) => p.$eval("h1", (e) => e.textContent);
  /** Chooses a language in the menu and waits for the screen to show `title`, as the language file loads first. */
  const choose = async (p, code, title) => {
    await p.click("#lang-menu summary");
    await p.click(`#lang-list [data-lang="${code}"]`);
    await p.waitForFunction((t) => document.querySelector("h1")?.textContent === t, { timeout: 5000 }, title).catch(() => {});
  };
  const { page: p, state: s } = await openPage(browser);
  try {
    await p.evaluate(() => localStorage.clear());
    await p.reload({ waitUntil: "networkidle0" });
    await screen(p, ["home"]);
    assert.equal(await heading(p), en.home.title);
    await choose(p, "nl", pick("nl").home.title);
    assert.equal(await heading(p), pick("nl").home.title, "home screen not redrawn");
    const page = await p.evaluate(() => [document.documentElement.lang, document.title, localStorage.getItem("dkds-language")]);
    assert.deepEqual(page, ["nl", pick("nl").appName, "nl"]);
    await p.reload({ waitUntil: "networkidle0" });
    await screen(p, ["home"]);
    assert.equal(await heading(p), pick("nl").home.title, "choice not kept");
    const v = vector("valid-appendix-c");
    await verifyTextIn(p, s, v.text, { now: v.now, dns: v.dns });
    await choose(p, "fr", pick("fr").result.title(1));
    assert.equal(await heading(p), pick("fr").result.title(1), "results not redrawn");
    assert.equal(await p.$eval(".status", (e) => e.textContent), pick("fr").outcomes.valid.title);
    await p.evaluate(() => localStorage.clear());
  } finally {
    await p.close();
  }
  const { page: q } = await openPage(browser, { query: "?lang=it" });
  assert.equal(await heading(q), pick("it").home.title, "language in the address");
  assert.equal(await q.evaluate(() => localStorage.getItem("dkds-language")), null, "the address language is stored");
  await q.close();
  const { page: r } = await openPage(browser, { before: `Object.defineProperty(navigator, "languages", { get: () => ["de-AT", "en"] })` });
  assert.equal(await heading(r), pick("de").home.title, "browser preference");
  await r.close();
  return "the menu redraws the home and results screens and is remembered; the address and the browser's preference choose the language";
});

// ---- 7. offline use ---------------------------------------------------------------------------

await group("offline use", async () => {
  const { page: p, state: s } = await openPage(browser, { intercept: false });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload({ waitUntil: "networkidle0" });
  await p.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const build = await p.$eval(".foot p", (e) => /build ([0-9a-f]+)/.exec(e.textContent)[1]);
  assert.ok((await p.evaluate(() => caches.keys())).includes(`scan-${build}`), "the footer's build does not name the cache");

  // A file opened as a page is the file, not the application, online and offline.
  const licences = new URL("licences.txt", url).href;
  const opened = [];
  for (const offline of [false, true]) {
    await p.setOfflineMode(offline);
    const response = await p.goto(licences, { waitUntil: "load" });
    assert.ok(response.headers()["content-type"].startsWith("text/plain"), `licences.txt is ${response.headers()["content-type"]}`);
    assert.ok((await p.evaluate(() => document.body.innerText)).includes("Apache License"), "licences.txt shows no licence");
    opened.push(response.fromServiceWorker() ? "from the service worker" : "from the network");
  }
  // Every language is in the cache of the service worker, so that it loads without a network.
  await p.goto(`${url}?lang=de`, { waitUntil: "load" });
  await screen(p, ["home"]);
  assert.equal(await p.$eval("h1", (e) => e.textContent), LANGUAGES.find((l) => l.code === "de").home.title, "German offline");
  await p.goto(url, { waitUntil: "load" });
  await screen(p, ["home"]);
  const v = vector("valid-appendix-c");
  const [card] = await verifyText(p, s, v.text, { now: v.now });
  assert.equal(card.outcome, "unavailable");
  assert.ok(card.hints.includes("This device is offline."), `hints: ${card.hints}`);
  const reached = await openFile(p, s, join(OUT, "fixtures", "v12-2px.png"));
  assert.equal(reached, "results", "the QR reader does not work offline");
  await p.setOfflineMode(false);
  await p.close();
  return `the application, a language and the QR reader load from the service worker; verification reports unavailable; licences.txt opens ${opened.join(" and ")}`;
});

// ---- 8. network, errors and size ------------------------------------------------------------

await group("network requests", async () => {
  const other = [...contacted].filter((h) => h !== host && !RESOLVERS.includes(h) && h !== "data:" && h !== "blob:");
  assert.deepEqual(other, []);
  return `only ${host} and ${RESOLVERS.join(", ")} were contacted`;
});

await group("script errors and CSP violations", async () => {
  // The resolvers' failures are simulated; the browser reports them as failed resources.
  const unexpected = errors.filter((e) => !/status of 503|ERR_INTERNET_DISCONNECTED/.test(e));
  assert.deepEqual(unexpected, []);
  return "none";
});

await group("size", async () => {
  const gz = (f) => gzipSync(readFileSync(join(BUILD, f)), { level: 9 }).length;
  // The page, its style sheet, app.js and the chunks app.js imports; the languages are loaded when chosen.
  const imported = [...readFileSync(join(BUILD, "app.js"), "utf8").matchAll(/from"\.\/(chunks\/[^"]+)"/g)].map((m) => m[1]);
  const app = ["index.html", "app.js", "app.css", ...imported].reduce((n, f) => n + gz(f), 0);
  const decoder = gz("decoder.js") + gz("zxing_reader.wasm");
  const pdf = gz("pdf/pdf.min.mjs") + gz("pdf/pdf.worker.min.mjs");
  const kb = (n) => Math.round(n / 1024);
  assert.ok(app <= 60 * 1024, `application ${kb(app)} KB`);
  assert.ok(decoder <= 500 * 1024, `decoder ${kb(decoder)} KB`);
  return `application ${kb(app)} KB, decoder ${kb(decoder)} KB, pdf.js ${kb(pdf)} KB, gzip`;
});

await browser.close();
server.close();
console.log(`\n${failures ? `${failures} groups failed` : "all groups passed"}; screenshots in test/out/screens/`);
process.exitCode = failures ? 1 : 0;
