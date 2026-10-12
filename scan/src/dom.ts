/**
 * Element construction. Text is always inserted as text nodes, never parsed as HTML, so that content
 * read from a stamp cannot add markup to the page.
 */

type Child = Node | string | number | false | null | undefined;
type Attributes = Record<string, string | number | boolean | EventListener | undefined>;

/**
 * Creates an element. Attributes whose value is `false` or `undefined` are omitted; attributes named
 * `on<event>` are added as event listeners.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (typeof value === "function") element.addEventListener(name.slice(2), value);
    else element.setAttribute(name, value === true ? "" : String(value));
  }
  append(element, children);
  return element;
}

/** Appends children, skipping `false`, `null` and `undefined`. */
export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === false || child === null || child === undefined) continue;
    parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
}

const SVG = "http://www.w3.org/2000/svg";

/** An icon from the symbols in index.html. */
export function icon(name: string, className = "icon"): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG, "use");
  use.setAttribute("href", `#i-${name}`);
  svg.appendChild(use);
  return svg;
}
