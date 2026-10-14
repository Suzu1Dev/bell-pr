/**
 * A minimal DOM for the UI tests that need effects to run.
 *
 * renderToStaticMarkup (src/test-utils/render.tsx) never runs effects, so a
 * test that checks what a component does once it is mounted, such as telling
 * its parent about a corrected value, renders with react-dom/client into
 * this instead. It implements only what React uses to create, update and
 * remove elements and text: no events are dispatched and nothing is laid
 * out. Tests only; nothing in the app imports it.
 */
import { act, type ReactElement } from "react";
import type { Locale } from "../../shared/i18n/locale";
import { LocaleProvider, type Messages } from "../i18n";
import en from "../i18n/en";
import zhTW from "../i18n/zh-TW";

const dictionaries: Record<Locale, Messages> = { en, "zh-TW": zhTW };

class FakeNode {
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  constructor(
    readonly nodeType: number,
    readonly nodeName: string,
    readonly ownerDocument: FakeDocument | null,
  ) {}
  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  appendChild(child: FakeNode) {
    return this.insertBefore(child, null);
  }
  insertBefore(child: FakeNode, before: FakeNode | null) {
    child.parentNode?.removeChild(child);
    const at = before ? this.childNodes.indexOf(before) : -1;
    if (at < 0) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  removeChild(child: FakeNode) {
    const at = this.childNodes.indexOf(child);
    if (at >= 0) this.childNodes.splice(at, 1);
    child.parentNode = null;
    return child;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  set textContent(text: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (text) this.appendChild(new FakeText(text, this.ownerDocument));
  }
  contains(node: FakeNode | null): boolean {
    for (let current = node; current; current = current.parentNode)
      if (current === this) return true;
    return false;
  }
  getRootNode() {
    return this.ownerDocument ?? this;
  }
  addEventListener() {}
  removeEventListener() {}
}

class FakeText extends FakeNode {
  constructor(
    public nodeValue: string,
    ownerDocument: FakeDocument | null,
  ) {
    super(3, "#text", ownerDocument);
  }
  get data() {
    return this.nodeValue;
  }
  override get textContent() {
    return this.nodeValue;
  }
  override set textContent(text: string) {
    this.nodeValue = text;
  }
}

class FakeStyle {
  private values = new Map<string, string>();
  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }
  removeProperty(name: string) {
    this.values.delete(name);
  }
  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
}

export class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>();
  readonly style = new FakeStyle();
  // Element state React writes as properties.
  value = "";
  checked = false;
  selected = false;
  disabled = false;
  constructor(
    readonly tagName: string,
    ownerDocument: FakeDocument | null,
    readonly namespaceURI = "http://www.w3.org/1999/xhtml",
  ) {
    super(1, tagName.toUpperCase(), ownerDocument);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }
  setAttributeNS(_namespace: string | null, name: string, value: string) {
    this.setAttribute(name, value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  removeAttributeNS(_namespace: string | null, name: string) {
    this.removeAttribute(name);
  }
  toggleAttribute(name: string, force?: boolean) {
    const on = force ?? !this.attributes.has(name);
    if (on) this.attributes.set(name, "");
    else this.attributes.delete(name);
    return on;
  }
  /** A select's options, in document order. */
  get options(): FakeElement[] {
    return this.querySelectorAll((node) => node.nodeName === "OPTION");
  }
  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument?.activeElement === this)
      this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  /** Every element below this one that `match` accepts. */
  querySelectorAll(match: (element: FakeElement) => boolean): FakeElement[] {
    return this.childNodes.flatMap((child) =>
      child instanceof FakeElement
        ? [...(match(child) ? [child] : []), ...child.querySelectorAll(match)]
        : [],
    );
  }
}

class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly head: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  defaultView: unknown = null;
  constructor() {
    super(9, "#document", null);
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
  }
  createElement(tagName: string) {
    return new FakeElement(tagName.toLowerCase(), this);
  }
  createElementNS(namespace: string, tagName: string) {
    return new FakeElement(tagName, this, namespace);
  }
  createTextNode(text: string) {
    return new FakeText(text, this);
  }
}

export interface Mounted {
  container: FakeElement;
  /** The text the container shows now. */
  text(): string;
  /** Renders `element` again in the same root. */
  rerender(element: ReactElement): Promise<void>;
  /** Unmounts and removes the fake DOM globals. */
  unmount(): Promise<void>;
}

/**
 * Renders `element` in `locale` with react-dom/client into a fake DOM and
 * runs its effects, inside `act`. Install `fetch` stubs before calling it.
 * Call `unmount()` when done: it restores the globals it replaced.
 */
export async function mount(
  element: ReactElement,
  locale: Locale = "en",
): Promise<Mounted> {
  const globals = globalThis as Record<string, unknown>;
  const saved = {
    window: globals.window,
    document: globals.document,
    act: globals.IS_REACT_ACT_ENVIRONMENT,
  };
  const document = new FakeDocument();
  const window = Object.assign(new EventTarget(), {
    document,
    location: { hash: "", href: "http://localhost/" },
    HTMLIFrameElement: class {},
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) =>
      clearTimeout(handle),
  });
  document.defaultView = window;
  globals.window = window;
  globals.document = document;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  // react-dom/client decides at import whether it runs in a browser.
  const { createRoot } = await import("react-dom/client");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const wrap = (child: ReactElement) => (
    <LocaleProvider locale={locale} messages={dictionaries[locale]}>
      {child}
    </LocaleProvider>
  );
  await act(async () => root.render(wrap(element)));
  return {
    container,
    text: () => container.textContent,
    rerender: (next) => act(async () => root.render(wrap(next))),
    async unmount() {
      await act(async () => root.unmount());
      globals.window = saved.window;
      globals.document = saved.document;
      globals.IS_REACT_ACT_ENVIRONMENT = saved.act;
    },
  };
}
