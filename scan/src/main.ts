/**
 * scan.dkds.org: the screens and the flow from an input to its result.
 *
 * Screens: home, camera, text, progress, password, results and problems. Leaving the home screen adds
 * one history entry, so that the back button of a phone returns to the home screen. A change of
 * language redraws the home, text, results and problem screens; it is not offered while the camera,
 * a file or a verification is at work.
 */

import { startScanner, type Scanner } from "./camera.ts";
import { Decoder, DecoderUnavailable } from "./decoder.ts";
import { h, icon } from "./dom.ts";
import { readFile, type FileReading } from "./files.ts";
import { openKeyStore } from "./keystore.ts";
import { Cancelled, Problem, type ProblemDetail, type ProblemKind } from "./problem.ts";
import { resultCard, type Origin, type Source } from "./result.ts";
import { initialLanguage, LANGUAGES, setLanguage, T } from "./text.ts";
import { verifyAll, type CheckedStamp, type FoundStamp } from "./verify.ts";

/** The version of the verifier, from its package.json; set by the build. */
declare const SCAN_VERSION: string;
/** The identifier of the build, a hash of its files, which also names the service worker's cache; set by the build. */
declare const SCAN_BUILD: string;

const main = document.getElementById("main") as HTMLElement;
const fileInput = document.getElementById("file") as HTMLInputElement;
const decoder = new Decoder();
const keyStore = openKeyStore();

// ---- screens and history ----------------------------------------------------

/** Incremented on every change of screen; work started for an earlier screen discards its result. */
let session = 0;
/** Stops the work of the current screen, such as the camera. */
let teardown: (() => void) | undefined;
/** Whether a history entry was added on leaving the home screen. */
let pushed = false;

/** The browser's colour around the page, which is black on the camera screen. */
const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
const pageColor = themeColor?.content ?? "";

// ---- language -------------------------------------------------------------------

/** The language menu: a <details> element with a button for each language. */
const languageMenu = document.getElementById("lang-menu") as HTMLDetailsElement;
const languageSummary = languageMenu.querySelector("summary")!;
const languageButtons = LANGUAGES.map((l) =>
  h("button", { type: "button", lang: l.code, "data-lang": l.code, onclick: () => void chooseLanguage(l) }, l.name),
);
document.getElementById("lang-list")!.append(...languageButtons);
/** Draws the current screen again in the current language; undefined while work is in progress. */
let redraw: (() => void) | undefined;

/** Sets the texts of the page outside the screens: the title, the language menu and the drop hint. */
function applyLanguage(): void {
  document.title = T.appName;
  document.body.dataset.drop = T.home.drop;
  document.getElementById("lang-code")!.textContent = T.code.toUpperCase();
  document.getElementById("lang-label")!.textContent = T.language;
  for (const b of languageButtons) b.toggleAttribute("aria-current", b.dataset.lang === T.code);
}

/** Enables the language menu while the current screen can be drawn again, and disables it otherwise. */
function enableLanguageMenu(on: boolean): void {
  languageMenu.classList.toggle("off", !on);
  languageSummary.setAttribute("aria-disabled", String(!on));
  if (!on) languageMenu.open = false;
}

/** Marks the current screen as one that a change of language draws again with `fn`. */
function redrawWith(fn: () => void): void {
  redraw = fn;
  enableLanguageMenu(true);
}

async function chooseLanguage(language: (typeof LANGUAGES)[number]): Promise<void> {
  languageMenu.open = false;
  languageSummary.focus();
  if (language.code === T.code) return;
  let texts;
  try {
    texts = await language.load();
  } catch {
    // The file of the language could not be fetched, as offline before it was ever used.
  }
  // The screen may have started work while the language was fetched; the choice then waits.
  if (!texts || !redraw) return;
  setLanguage(texts, true);
  // A language in the address would take precedence over the choice on the next load.
  if (new URLSearchParams(location.search).has("lang")) history.replaceState(history.state, "", location.pathname);
  applyLanguage();
  redraw();
}

// The menu does not open while work is in progress, and closes on Escape or a click elsewhere.
languageSummary.addEventListener("click", (event) => {
  if (languageMenu.classList.contains("off")) event.preventDefault();
});
document.addEventListener("click", (event) => {
  if (languageMenu.open && !languageMenu.contains(event.target as Node)) languageMenu.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !languageMenu.open) return;
  languageMenu.open = false;
  languageSummary.focus();
});

// ---- rendering --------------------------------------------------------------------

/** Replaces the content of the page, within the current screen's session. */
function render(name: string, ...children: (HTMLElement | false)[]): void {
  redraw = undefined;
  enableLanguageMenu(false);
  document.body.dataset.screen = name;
  if (themeColor) themeColor.content = name === "camera" ? "#000000" : pageColor;
  main.replaceChildren(...children.filter((c): c is HTMLElement => c !== false));
  window.scrollTo(0, 0);
  const heading = main.querySelector("h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

/** Starts a new screen: ends the previous one and returns the new session number. */
function begin(): number {
  teardown?.();
  teardown = undefined;
  if (!pushed) {
    history.pushState({ screen: "inner" }, "");
    pushed = true;
  }
  return ++session;
}

/** Returns to the home screen, through the history where an entry was added. */
function goHome(): void {
  if (pushed) history.back();
  else home();
}

window.addEventListener("popstate", () => {
  pushed = false;
  home();
});

const button = (label: string, onclick: () => void, kind: "primary" | "line" = "line", iconName?: string) =>
  h("button", { class: kind === "primary" ? "btn" : "btn btn-line", type: "button", onclick }, iconName ? icon(iconName) : false, label);

const backButton = () => h("button", { class: "back", type: "button", onclick: goHome }, icon("left"), T.problem.back);

/** The three inputs, as on the home screen. */
/**
 * The three inputs: large, with the file formats under the file button, on the home screen; a row of
 * small buttons below a result.
 */
function inputButtons(big: boolean): HTMLElement {
  const file = button(T.home.file, openFile, "line", "file");
  return h(
    "div",
    { class: big ? "inputs inputs-big" : "inputs inputs-small" },
    button(T.home.camera, openCamera, "primary", "camera"),
    big ? h("div", { class: "input-file" }, file, h("p", { class: "small dim inputs-note" }, T.home.fileHint)) : file,
    button(T.home.text, () => pasteScreen(), "line", "text"),
  );
}

// ---- home -------------------------------------------------------------------

let installPrompt: (Event & { prompt(): Promise<void> }) | undefined;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as Event & { prompt(): Promise<void> };
  if (document.body.dataset.screen === "home") home();
});

function privacy(): HTMLElement {
  const count = keyStore.count();
  const status = h("p", { class: "small dim", role: "status" }, T.privacy.store(count));
  const forget = () => {
    if (!window.confirm(T.privacy.forgetConfirm(keyStore.count()))) return;
    keyStore.clear();
    status.textContent = T.privacy.forgotten;
    forgetButton.remove();
  };
  const forgetButton = h("button", { class: "btn btn-line btn-sm", type: "button", onclick: forget }, T.privacy.forget);
  return h(
    "section",
    { class: "privacy", "aria-labelledby": "privacy-h" },
    h("h2", { id: "privacy-h" }, T.privacy.title),
    h("p", {}, T.privacy.body),
    status,
    count > 0 && forgetButton,
  );
}

/**
 * A link that opens in a new tab, so that the verifier stays open; it is marked with the external-link
 * icon where it leads to another site.
 */
function tabLink(href: string, label: string, external = true): HTMLElement {
  return h("a", { href, target: "_blank", rel: "noopener" }, label, external && icon("ext", "icon ext"));
}

function footer(): HTMLElement {
  return h(
    "footer",
    { class: "foot" },
    h(
      "nav",
      { "aria-label": "DKDS" },
      tabLink("https://dkds.org", T.footer.about),
      tabLink("https://dkds.org/docs/verifying", T.footer.docs),
      tabLink("https://github.com/dkds-protocol/dkds/tree/main/scan", T.footer.source),
      tabLink("licences.txt", T.footer.licences, false),
    ),
    h("p", {}, T.footer.version(SCAN_VERSION, SCAN_BUILD)),
    installPrompt !== undefined &&
      h(
        "button",
        {
          class: "btn btn-line btn-sm",
          type: "button",
          onclick: () => {
            void installPrompt?.prompt();
            installPrompt = undefined;
          },
        },
        T.home.install,
      ),
    h("p", { class: "made" }, T.footer.madeIn),
  );
}

function home(): void {
  teardown?.();
  teardown = undefined;
  session++;
  render(
    "home",
    h(
      "section",
      { class: "home" },
      h("h1", {}, T.home.title),
      h("p", { class: "lede" }, T.home.lede),
      inputButtons(true),
    ),
    privacy(),
    footer(),
  );
  redrawWith(home);
}

// ---- problems -----------------------------------------------------------------

function platformHint(): string | undefined {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return T.problem.cameraDenied.ios;
  if (/Android/.test(ua) && /Chrome/.test(ua)) return T.problem.cameraDenied.android;
  return undefined;
}

function problemText(kind: ProblemKind, d: ProblemDetail): { title: string; body: string; extra?: string } {
  const P = T.problem;
  const name = d.name ?? "";
  switch (kind) {
    case "camera-denied":
      return { ...P.cameraDenied, extra: platformHint() };
    case "camera-missing":
      return P.cameraMissing;
    case "camera-busy":
      return P.cameraBusy;
    case "camera-unsupported":
      return P.cameraUnsupported;
    case "camera-insecure":
      return P.cameraInsecure;
    case "camera-stopped":
      return P.cameraStopped;
    case "file-type":
      return { title: P.fileType.title, body: P.fileType.body(name) };
    case "file-too-large":
      return { title: P.fileTooLarge.title, body: P.fileTooLarge.body(name) };
    case "file-empty":
      return { title: P.fileEmpty.title, body: P.fileEmpty.body(name) };
    case "image-unreadable":
      return { title: P.imageUnreadable.title, body: P.imageUnreadable.body(name) };
    case "pdf-unreadable":
      return { title: P.pdfUnreadable.title, body: P.pdfUnreadable.body(name) };
    case "pdf-unavailable":
      return P.pdfUnavailable;
    case "no-code":
      return { title: P.noCode.title, body: d.pages === undefined ? P.noCode.image(name) : P.noCode.pdf(name, d.pages) };
    case "not-stamp":
      return { title: P.notStamp.title, body: P.notStamp.body(d.count ?? 1) };
    case "reader-failed":
      return P.readerFailed;
    case "unexpected":
      return { title: P.unexpected.title, body: P.unexpected.body(d.message ?? "") };
  }
}

/** The inputs offered after each problem, the most useful first. */
function problemActions(kind: ProblemKind): HTMLElement[] {
  const camera = (primary = true) => button(T.problem.retryCamera, openCamera, primary ? "primary" : "line", "camera");
  const file = (primary = false) => button(T.problem.openFile, openFile, primary ? "primary" : "line", "file");
  const text = () => button(T.problem.pasteText, () => pasteScreen(), "line", "text");
  switch (kind) {
    case "camera-denied":
    case "camera-busy":
    case "camera-stopped":
      return [camera(), file()];
    case "camera-missing":
    case "camera-unsupported":
    case "camera-insecure":
    case "pdf-unavailable":
      return [file(true), text()];
    case "reader-failed":
      return [text()];
    case "unexpected":
      return [];
    default:
      return [file(true), camera(false)];
  }
}

function problem(p: Problem): void {
  const { title, body, extra } = problemText(p.kind, p.detail);
  render(
    "problem",
    h(
      "section",
      { class: "problem", "data-problem": p.kind },
      backButton(),
      h("div", { class: "problem-mark", "aria-hidden": "true" }, icon(p.kind === "not-stamp" ? "qr" : "alert")),
      h("h1", {}, title),
      h("p", {}, body),
      extra !== undefined && h("p", { class: "dim" }, extra),
      h("div", { class: "actions" }, ...problemActions(p.kind)),
    ),
  );
  redrawWith(() => problem(p));
}

/** Shows an error of any kind as a problem, unless the screen has changed since `s`. */
function fail(s: number, error: unknown): void {
  if (s !== session) return;
  if (error instanceof Cancelled) return goHome();
  if (error instanceof Problem) return problem(error);
  if (error instanceof DecoderUnavailable) return problem(new Problem("reader-failed"));
  problem(new Problem("unexpected", { message: error instanceof Error ? error.message : String(error) }));
}

// ---- progress -----------------------------------------------------------------

function progress(title: string, onStop?: () => void): (text: string) => void {
  const line = h("p", { class: "progress-line", role: "status", "aria-live": "polite" }, "");
  render(
    "progress",
    h(
      "section",
      { class: "progress" },
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("h1", {}, title),
      line,
      onStop !== undefined && button(T.working.cancel, onStop),
    ),
  );
  return (text) => {
    line.textContent = text;
  };
}

// ---- camera -------------------------------------------------------------------

async function openCamera(): Promise<void> {
  const s = begin();
  const video = h("video", { playsinline: true, muted: true, autoplay: true, "aria-hidden": "true" });
  const status = h("p", { class: "cam-status", role: "status", "aria-live": "polite" }, T.camera.starting);
  const torchButton = h("button", { class: "btn btn-line cam-btn", type: "button", hidden: true }, icon("torch"), h("span", {}, T.camera.torchOn));
  const switchButton = h("button", { class: "btn btn-line cam-btn", type: "button", hidden: true }, icon("switch"), T.camera.switch);
  render(
    "camera",
    h(
      "section",
      { class: "cam", "aria-label": T.camera.title },
      h("h1", { class: "sr-only" }, T.camera.title),
      h("div", { class: "cam-view" }, video, h("div", { class: "cam-frame", "aria-hidden": "true" }), status),
      h("div", { class: "cam-controls" }, button(T.camera.close, goHome, "primary", "close"), torchButton, switchButton),
    ),
  );

  let scanner: Scanner | undefined;
  let hintTimer = 0;
  let flashTimer = 0;
  const stopAll = () => {
    scanner?.stop();
    clearTimeout(hintTimer);
    clearTimeout(flashTimer);
    document.removeEventListener("visibilitychange", onVisibility);
  };
  // A hidden page releases the camera; it is opened again when the page is shown.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") scanner?.stop();
    else if (s === session) void openCamera();
  };
  teardown = stopAll;
  document.addEventListener("visibilitychange", onVisibility);

  const aim = () => {
    status.textContent = T.camera.aim;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => {
      if (s === session) status.textContent = T.camera.steady;
    }, 10_000);
  };

  try {
    const ready = decoder.start();
    scanner = await startScanner(video, decoder, {
      onStamps: (texts) => {
        if (s !== session) return;
        stopAll();
        navigator.vibrate?.(40);
        status.textContent = T.camera.found;
        void verifyAndShow(s, texts.map((text) => ({ text, pages: [] })), "camera");
      },
      onOther: () => {
        if (s !== session) return;
        status.textContent = T.camera.notStamp;
        clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => s === session && aim(), 3000);
      },
      onProblem: (p) => fail(s, p),
    });
    if (s !== session) return scanner.stop();
    await ready;
    if (s !== session) return;
    aim();
    const updateTorch = () => {
      torchButton.hidden = !scanner?.hasTorch;
    };
    updateTorch();
    let torchOn = false;
    torchButton.onclick = async () => {
      torchOn = !torchOn;
      await scanner?.setTorch(torchOn).catch(() => (torchButton.hidden = true));
      torchButton.querySelector("span")!.textContent = torchOn ? T.camera.torchOff : T.camera.torchOn;
    };
    switchButton.hidden = !scanner.canSwitch;
    switchButton.onclick = async () => {
      try {
        await scanner?.switchCamera();
        torchOn = false;
        torchButton.querySelector("span")!.textContent = T.camera.torchOn;
        updateTorch();
      } catch (e) {
        stopAll();
        fail(s, e);
      }
    };
  } catch (e) {
    stopAll();
    fail(s, e);
  }
}

// ---- files --------------------------------------------------------------------

function openFile(): void {
  fileInput.value = "";
  fileInput.click();
}

fileInput.addEventListener("change", () => {
  if (fileInput.files && fileInput.files.length > 0) void readFiles([...fileInput.files]);
});

/** Asks for the password of a PDF file, on its own screen within the reading's session. */
function askPassword(name: string, onCancel: () => void): (incorrect: boolean) => Promise<string | null> {
  return (incorrect) =>
    new Promise((resolve) => {
      const P = T.problem.pdfPassword;
      const input = h("input", { type: "password", id: "pdf-password", autocomplete: "off", required: true });
      const submit = (event: Event) => {
        event.preventDefault();
        resolve(input.value);
      };
      render(
        "password",
        h(
          "section",
          { class: "problem" },
          h("button", { class: "back", type: "button", onclick: () => (resolve(null), onCancel()) }, icon("left"), T.problem.back),
          h("h1", {}, P.title),
          h("p", {}, P.body(name)),
          h(
            "form",
            { class: "form", onsubmit: submit },
            h("label", { for: "pdf-password" }, P.label),
            input,
            incorrect && h("p", { class: "error", role: "alert" }, P.incorrect),
            h("div", { class: "actions" }, h("button", { class: "btn", type: "submit" }, P.submit)),
          ),
        ),
      );
      input.focus();
    });
}

async function readFiles(files: readonly File[]): Promise<void> {
  const file = files[0]!;
  const name = file.name || T.working.unnamed;
  const s = begin();
  const controller = new AbortController();
  const stop = () => {
    controller.abort();
    goHome();
  };
  teardown = () => controller.abort();
  let update = progress(T.working.reading(name), stop);
  try {
    await decoder.start();
    const reading = await readFile(file, {
      decoder,
      signal: controller.signal,
      askPassword: askPassword(name, stop),
      onProgress: (p) => {
        if (s !== session) return;
        if (document.body.dataset.screen !== "progress") update = progress(T.working.reading(name), stop);
        update(p.step === "pdf-library" ? T.working.loadingPdf : T.working.page(p.page, p.of));
      },
    });
    if (s !== session) return;
    if (reading.stamps.length === 0) {
      if (reading.others > 0) throw new Problem("not-stamp", { count: reading.others });
      throw new Problem("no-code", { name, pages: reading.pagesRead });
    }
    await verifyAndShow(s, reading.stamps, "file", { name, reading, several: files.length > 1 });
  } catch (e) {
    fail(s, e);
  }
}

// ---- text ---------------------------------------------------------------------

function pasteScreen(initial = ""): void {
  begin();
  showPaste(initial);
}

/**
 * Returns the plain-text form of the clipboard content of a paste event, or "" if it holds none.
 * Safari on iOS and iPadOS treats text of the form "word:rest" as a link and, by default, pastes
 * that form instead: the text before the colon in lowercase, spaces as "%20" and a "%" without two
 * hexadecimal digits as "%25". The text field and the page therefore insert the plain-text form
 * themselves.
 */
function plainText(event: ClipboardEvent): string {
  return event.clipboardData?.getData("text/plain") ?? "";
}

/** Draws the text screen with `value` in its text field. */
function showPaste(value: string): void {
  const P = T.paste;
  const area = h("textarea", { id: "stamp-text", rows: 6, spellcheck: "false", autocapitalize: "off", autocomplete: "off", autocorrect: "off" });
  area.value = value;
  area.addEventListener("paste", (event) => {
    const text = plainText(event);
    if (text === "") return;
    event.preventDefault();
    if (!document.execCommand("insertText", false, text)) area.setRangeText(text, area.selectionStart, area.selectionEnd, "end");
  });
  const error = h("p", { class: "error", role: "alert", hidden: true }, P.empty);
  const submit = (event: Event) => {
    event.preventDefault();
    if (area.value === "") {
      error.hidden = false;
      area.focus();
      return;
    }
    void verifyAndShow(session, [{ text: area.value, pages: [] }], "text");
  };
  render(
    "text",
    h(
      "section",
      { class: "paste" },
      backButton(),
      h("h1", {}, P.title),
      h("p", { class: "dim" }, P.lede),
      h(
        "form",
        { class: "form", onsubmit: submit },
        h("label", { for: "stamp-text" }, P.label),
        area,
        error,
        h("div", { class: "actions" }, h("button", { class: "btn", type: "submit" }, P.submit)),
      ),
    ),
  );
  area.focus();
  redrawWith(() => showPaste(area.value));
}

// ---- verification and results ------------------------------------------------

interface FileMeta {
  readonly name: string;
  readonly reading: FileReading;
  readonly several: boolean;
}

async function verifyAndShow(s: number, stamps: readonly FoundStamp[], source: Source, meta?: FileMeta): Promise<void> {
  if (s !== session) return;
  progress(T.working.verifying(stamps.length));
  try {
    const checked = await verifyAll(stamps, keyStore);
    if (s !== session) return;
    results(s, checked, source, meta);
  } catch (e) {
    fail(s, e);
  }
}

function results(s: number, checked: CheckedStamp[], source: Source, meta?: FileMeta): void {
  const notes: string[] = [];
  if (meta?.several) notes.push(T.problem.multipleFiles);
  const r = meta?.reading;
  if (r?.pageCount !== undefined && r.pagesRead! < r.pageCount) notes.push(T.result.unread(r.pagesRead! + 1, r.pageCount));
  if (r && r.others > 0) notes.push(T.result.others(r.others));

  const origin: Origin = { source, name: meta?.name };
  const list = h("div", { class: "cards" });
  const draw = () =>
    list.replaceChildren(
      ...checked.map((stamp, i) =>
        resultCard(stamp, origin, async () => {
          if (s !== session) return;
          const [again] = await verifyAll([stamp], keyStore);
          if (s !== session || !again) return;
          checked[i] = again;
          draw();
        }),
      ),
    );
  draw();
  render(
    "results",
    h(
      "section",
      { class: "results" },
      h("h1", {}, T.result.title(checked.length)),
      ...notes.map((note) => h("p", { class: "note" }, note)),
      list,
      h("div", { class: "next" }, h("h2", {}, T.result.next), inputButtons(false)),
    ),
  );
  redrawWith(() => results(s, checked, source, meta));
}

// ---- dropping and pasting -----------------------------------------------------

let dragDepth = 0;
const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
document.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  dragDepth++;
  document.body.classList.add("dropping");
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("dropping");
});
document.addEventListener("dragover", (event) => {
  if (hasFiles(event)) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  dragDepth = 0;
  document.body.classList.remove("dropping");
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0) return;
  event.preventDefault();
  void readFiles(files);
});

// An image or the text of a stamp pasted outside a text field is read as an input.
document.addEventListener("paste", (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea")) return;
  const files = [...(event.clipboardData?.files ?? [])];
  if (files.length > 0) {
    event.preventDefault();
    void readFiles(files);
    return;
  }
  const text = plainText(event);
  if (text !== "") {
    event.preventDefault();
    pasteScreen(text);
  }
});

// ---- start --------------------------------------------------------------------

function supported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof BigInt === "function" &&
    typeof TextDecoder === "function" &&
    typeof AbortSignal !== "undefined" &&
    "timeout" in AbortSignal
  );
}

setLanguage(await initialLanguage().load().catch(() => LANGUAGES[0]!.load()));
applyLanguage();
document.getElementById("lang-menu")!.hidden = false;

if (supported()) home();
else render("problem", h("section", { class: "problem" }, h("h1", {}, T.problem.browser.title), h("p", {}, T.problem.browser.body)));

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      // Without the service worker the verifier works online only.
    });
  });
}

// Started early, so that the WebAssembly module is ready when the first image arrives.
decoder.start().catch(() => {
  // A failure is reported when an input needs the decoder.
});
