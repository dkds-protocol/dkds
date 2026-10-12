/**
 * The result card of one stamp (specification 9.1). For `valid`, the verifier's
 * statements come first, in the order of 9.1; the fields follow, set apart under a heading that names
 * the domain that signed them, with the text of the stamp below them. For any other outcome, the card
 * shows the outcome and its explanation, and no fields. Each card is tagged with where the stamp was
 * read.
 */

import type { Warning } from "../../dkds.js/src/index.ts";
import { h, icon } from "./dom.ts";
import { formatTime } from "./format.ts";
import type { WarningDetail } from "./i18n/en.ts";
import { T, type Sentence } from "./text.ts";
import type { CheckedStamp } from "./verify.ts";

/** How the stamp was entered, for hints about the text. */
export type Source = "camera" | "file" | "text";

/** Where the stamps of one result were read: the input, and the name of the file for a file. */
export interface Origin {
  readonly source: Source;
  readonly name?: string;
}

const TONE = {
  valid: "ok",
  malformed: "bad",
  unsupported: "idle",
  "key-not-found": "bad",
  "key-revoked": "bad",
  "invalid-signature": "bad",
  unavailable: "idle",
} as const;

const ICON = { ok: "check-circle", bad: "x-circle", idle: "alert" } as const;

/** The sentence of a warning; a code unknown to this module is shown with the message of dkds.js. */
function warningText(warning: Warning, stamp: CheckedStamp): HTMLElement {
  const sentence = (T.warnings as Readonly<Record<string, ((detail: WarningDetail) => Sentence) | undefined>>)[warning.code];
  const parts = sentence && !(warning.code === "similar-domain" && stamp.similar.length === 0)
    ? sentence({ ascii: stamp.result.domain ?? "", similar: stamp.similar })
    : [warning.message];
  return h("span", {}, ...parts.map((p) => (typeof p === "string" ? p : h("bdi", { class: p.domain.length > 24 ? "dom-inline long" : "dom-inline", translate: "no" }, p.domain))));
}

function warningList(warnings: readonly Warning[], stamp: CheckedStamp): HTMLElement | false {
  if (warnings.length === 0) return false;
  return h(
    "ul",
    { class: "warnings", "aria-label": T.result.labels.warnings },
    ...warnings.map((w) => h("li", {}, icon("alert"), warningText(w, stamp))),
  );
}

/** The tag naming where the stamp was read: the camera, the text, or the file and its pages. */
function sourceTag(stamp: CheckedStamp, origin: Origin): HTMLElement {
  const [iconName, label] =
    origin.source === "camera" ? ["camera", T.result.fromCamera] : origin.source === "text" ? ["text", T.result.fromText] : ["file", origin.name ?? ""];
  return h(
    "span",
    { class: "source" },
    icon(iconName),
    h("span", { class: "source-name", translate: origin.source === "file" ? "no" : undefined }, label),
    stamp.pages.length > 0 && h("span", { class: "pages" }, T.result.page(stamp.pages)),
  );
}

function statusLine(stamp: CheckedStamp, origin: Origin): HTMLElement {
  const tone = TONE[stamp.result.outcome];
  return h(
    "div",
    { class: "status-row" },
    h("h2", { class: `status ${tone}` }, icon(ICON[tone]), T.outcomes[stamp.result.outcome].title),
    sourceTag(stamp, origin),
  );
}

/** The text form of the stamp, shown on request, with a button that copies it. */
function stampText(text: string): HTMLElement {
  const copy = h("button", { class: "btn btn-line btn-sm", type: "button" }, T.result.copy);
  copy.hidden = !navigator.clipboard;
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(text).then(() => {
      copy.textContent = T.result.copied;
      setTimeout(() => (copy.textContent = T.result.copy), 2000);
    });
  });
  return h("details", { class: "raw" }, h("summary", {}, T.result.raw), h("pre", { class: "raw-text", translate: "no" }, text), copy);
}

let cards = 0;

function validCard(stamp: CheckedStamp, origin: Origin): HTMLElement {
  const r = stamp.result;
  const domain = r.domainUnicode ?? r.domain ?? "";
  const headingId = `contents-${++cards}`;
  return h(
    "article",
    { class: "card", "data-outcome": r.outcome },
    h(
      "div",
      { class: "own" },
      statusLine(stamp, origin),
      h("p", { class: "domain", "aria-label": T.result.labels.domain }, h("bdi", { translate: "no" }, domain)),
      h(
        "dl",
        { class: "facts" },
        h("dt", {}, T.result.labels.signed),
        h("dd", {}, formatTime(r.issuedAt ?? 0, T.locale)),
        h("dt", {}, T.result.labels.dns),
        h("dd", {}, T.result.dnssec(r.dnssec === true)),
      ),
      warningList(r.warnings, stamp),
    ),
    h(
      "section",
      { class: "contents", "aria-labelledby": headingId },
      h("h3", { class: "contents-h", id: headingId }, `${T.result.contentsBy} `, h("bdi", { class: domain.length > 24 ? "dom-inline long" : "dom-inline", translate: "no" }, domain)),
      h(
        "div",
        { class: "fields" },
        h(
          "table",
          {},
          h("thead", {}, h("tr", {}, h("th", { scope: "col" }, T.result.fieldName), h("th", { scope: "col" }, T.result.fieldValue))),
          h(
            "tbody",
            // The issuer's text, which a translating browser must leave as it was signed.
            { translate: "no" },
            ...(r.fields ?? []).map(([name, value]) =>
              h(
                "tr",
                { class: "field" },
                h("th", { scope: "row" }, h("bdi", {}, name)),
                h("td", {}, value === "" ? h("span", { class: "empty", translate: "yes" }, T.result.emptyValue) : h("bdi", {}, value)),
              ),
            ),
          ),
        ),
      ),
      stampText(stamp.text),
    ),
  );
}

function otherCard(stamp: CheckedStamp, origin: Origin, onRetry: () => void): HTMLElement {
  const r = stamp.result;
  const hints: string[] = [];
  if (r.outcome === "unavailable" && !navigator.onLine) hints.push(T.result.offline);
  // A stamp never begins with white space or ends with a line break; a space at the end can be Base45.
  if (r.outcome === "malformed" && origin.source === "text" && /^\s|[\r\n\t]$/.test(stamp.text)) hints.push(T.result.whitespace);
  // For an outcome other than valid, only the warning key-disappeared is shown.
  const warnings = r.warnings.filter((w) => w.code === "key-disappeared");
  return h(
    "article",
    { class: "card", "data-outcome": r.outcome },
    h(
      "div",
      { class: "own" },
      statusLine(stamp, origin),
      h("p", { class: "explain" }, T.outcomes[r.outcome].description),
      ...hints.map((hint) => h("p", { class: "hint" }, hint)),
      warningList(warnings, stamp),
      r.outcome === "unavailable" && h("div", { class: "card-actions" }, h("button", { class: "btn btn-line btn-sm", type: "button", onclick: onRetry }, T.result.again)),
      h("details", { class: "details" }, h("summary", {}, T.result.details), h("p", {}, T.result.step(r.step)), h("p", { class: "mono reason", translate: "no" }, r.reason)),
    ),
  );
}

/** The card of one verified stamp. `onRetry` verifies the stamp again, for `unavailable`. */
export function resultCard(stamp: CheckedStamp, origin: Origin, onRetry: () => void): HTMLElement {
  return stamp.result.outcome === "valid" ? validCard(stamp, origin) : otherCard(stamp, origin, onRetry);
}
