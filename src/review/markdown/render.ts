import type { Definition, FootnoteDefinition, Nodes, Parents, Root, TableRow } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";
import { markdownTooNested } from "../../../shared/markdown-nesting";

/*
 * GitHub Flavored Markdown to React elements, without raw HTML. It renders
 * what MarkdownContent's earlier unified pipeline (remark-parse,
 * remark-rehype, hast-util-to-jsx-runtime, raw HTML skipped) rendered: the
 * same GFM parser (the one shared/draft-checks.ts uses), then the steps of
 * mdast-util-to-hast 13 and hast-util-to-jsx-runtime 2 that this tree
 * needs, so the HTML is the same byte for byte (corpus.json next to this
 * file). Links (footnote links too), images and headings carry only the
 * props that MarkdownContent's components read.
 */

/** The props a component in `components` receives. */
export interface MarkdownElementProps {
  children?: ReactNode;
  /** A link's target, after `urlTransform`. */
  href?: string;
  /** An image's text alternative. */
  alt?: string;
  /** A code block's language, as `language-<name>`. */
  className?: string;
}

export type MarkdownComponents = Partial<
  Record<string, ComponentType<MarkdownElementProps>>
>;

type Props = Record<string, unknown>;
interface Text {
  type: "text";
  value: string;
}
/** Raw HTML: it takes its place between blocks, and never renders. */
interface Raw {
  type: "raw";
}
interface Element {
  type: "element";
  tagName: string;
  properties: Props;
  children: Child[];
}
type Child = Text | Raw | Element;

const text = (value: string): Text => ({ type: "text", value });
const element = (
  tagName: string,
  properties: Props = {},
  children: Child[] = [],
): Element => ({ type: "element", tagName, properties, children });
const isParagraph = (child: Child | undefined): child is Element =>
  child?.type === "element" && child.tagName === "p";

/** Line breaks between children, and around them for a loose container. */
function wrap(children: Child[], loose = false) {
  const result: Child[] = loose ? [text("\n")] : [];
  children.forEach((child, index) => {
    if (index) result.push(text("\n"));
    result.push(child);
  });
  if (loose && children.length) result.push(text("\n"));
  return result;
}

const isSpace = (character: string | undefined) => character === " " || character === "\t";

/**
 * Spaces and tabs around each line ending go; the first line's start and the
 * last line's end stay. In linear time, as trim-lines did: one pattern for
 * both sides backtracks over a long run of spaces, in quadratic time.
 */
function trimLines(value: string) {
  const parts = value.split(/(\r?\n|\r)/);
  return parts
    .map((part, index) => {
      if (index % 2) return part;
      let start = 0;
      let end = part.length;
      if (index > 0) while (start < end && isSpace(part[start])) start++;
      if (index < parts.length - 1) while (end > start && isSpace(part[end - 1])) end--;
      return part.slice(start, end);
    })
    .join("");
}

/** Appends one by one: spreading into a call throws past about 100,000 items. */
function append(target: Child[], items: Child[]) {
  for (const item of items) target.push(item);
}

/** Whether a list's items are separated by blank lines. */
const listLoose = (parent: Parents) =>
  parent.type === "list" &&
  (Boolean(parent.spread) ||
    parent.children.some((item) =>
      item.spread === null || item.spread === undefined
        ? item.children.length > 1
        : item.spread,
    ));

/** Visits every node in document order, without recursion: nesting can be thousands deep. */
function walk(node: Nodes, visit: (node: Nodes) => void) {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop()!;
    visit(current);
    if ("children" in current)
      for (let index = current.children.length - 1; index >= 0; index--)
        stack.push(current.children[index]);
  }
}

const textBlocks = new Set(["paragraph", "heading", "code", "tableCell", "break"]);

/** A subtree's text, each block and hard break on its own line. */
function plainText(node: Nodes) {
  let value = "";
  walk(node, (current) => {
    if (value && textBlocks.has(current.type)) value += "\n";
    if (current.type === "text" || current.type === "inlineCode" || current.type === "code")
      value += current.value;
  });
  return value;
}

/**
 * How deep nodes nest before the rest shows as its text: each level takes
 * stack frames here and in React, so thousands of levels would overflow.
 * Text nested past markdownNestingLimit never gets here, which keeps most
 * trees under this depth; text that limit reads as code may still reach it.
 */
const maxDepth = 100;

/**
 * How many empty cells a document's tables may add to fill short rows: a
 * wide head over many one-cell rows would otherwise make millions.
 */
const maxPadding = 100_000;

function toTree(tree: Root, footnoteLabel: string) {
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  const footnoteOrder: string[] = [];
  const footnoteCounts = new Map<string, number>();
  let depth = 0;
  let paddingLeft = maxPadding;

  // The first definition of an identifier wins, wherever it is.
  walk(tree, (node) => {
    if (node.type === "definition" || node.type === "footnoteDefinition") {
      const map: Map<string, Definition | FootnoteDefinition> =
        node.type === "definition" ? definitions : footnotes;
      const id = node.identifier.toUpperCase();
      if (!map.has(id)) map.set(id, node);
    }
  });

  function all(parent: Parents) {
    const values: Child[] = [];
    depth++;
    parent.children.forEach((node, index) => {
      const result = one(node, parent);
      if (!result) return;
      // Spaces after a hard break are not content.
      if (index && parent.children[index - 1].type === "break" && !Array.isArray(result)) {
        const head = result.type === "element" ? result.children[0] : result;
        if (head?.type === "text") head.value = head.value.replace(/^[ \t]+/, "");
      }
      if (Array.isArray(result)) values.push(...result);
      else values.push(result);
    });
    depth--;
    return values;
  }

  function one(node: Nodes, parent: Parents): Child | Child[] | undefined {
    if (depth > maxDepth && "children" in node) return text(plainText(node));
    switch (node.type) {
      case "blockquote":
        return element("blockquote", {}, wrap(all(node), true));
      case "break":
        return [element("br"), text("\n")];
      case "code": {
        // The info's first word; empty when it starts with a Unicode space,
        // which the parser does not trim.
        const language = node.lang ? node.lang.split(/\s+/)[0] : undefined;
        return element("pre", {}, [
          element(
            "code",
            language === undefined ? {} : { className: `language-${language}` },
            [text(node.value ? `${node.value}\n` : "")],
          ),
        ]);
      }
      case "delete":
        return element("del", {}, all(node));
      case "emphasis":
        return element("em", {}, all(node));
      case "strong":
        return element("strong", {}, all(node));
      case "paragraph":
        return element("p", {}, all(node));
      case "heading":
        return element(`h${node.depth}`, {}, all(node));
      case "thematicBreak":
        return element("hr");
      case "text":
        return text(trimLines(node.value));
      case "inlineCode":
        return element("code", {}, [text(node.value.replace(/\r?\n|\r/g, " "))]);
      case "html":
        return { type: "raw" };
      case "link":
        return element("a", { href: normalizeUri(node.url) }, all(node));
      case "image":
      case "imageReference":
        return element("img", { alt: node.alt });
      // The parser makes a reference only to a label that is defined.
      case "linkReference": {
        const url = definitions.get(node.identifier.toUpperCase())?.url;
        return element("a", { href: normalizeUri(url || "") }, all(node));
      }
      case "footnoteReference": {
        const id = node.identifier.toUpperCase();
        const count = (footnoteCounts.get(id) ?? 0) + 1;
        if (count === 1) footnoteOrder.push(id);
        footnoteCounts.set(id, count);
        return element("sup", {}, [
          element("a", { href: `#user-content-fn-${normalizeUri(id.toLowerCase())}` }, [
            text(String(footnoteOrder.indexOf(id) + 1)),
          ]),
        ]);
      }
      case "list": {
        const items = all(node);
        const properties: Props = {};
        if (typeof node.start === "number" && node.start !== 1)
          properties.start = node.start;
        if (
          items.some(
            (item) =>
              item.type === "element" &&
              item.properties.className === "task-list-item",
          )
        )
          properties.className = "contains-task-list";
        return element(node.ordered ? "ol" : "ul", properties, wrap(items, true));
      }
      case "listItem": {
        const results = all(node);
        const loose = listLoose(parent);
        const properties: Props = {};
        if (typeof node.checked === "boolean") {
          let paragraph = results[0];
          if (!isParagraph(paragraph)) {
            paragraph = element("p");
            results.unshift(paragraph);
          }
          if (paragraph.children.length) paragraph.children.unshift(text(" "));
          paragraph.children.unshift(
            element("input", { type: "checkbox", checked: node.checked, disabled: true }),
          );
          properties.className = "task-list-item";
        }
        // A tight item's paragraphs show as their text.
        const children: Child[] = [];
        results.forEach((child, index) => {
          if (loose || index || !isParagraph(child)) children.push(text("\n"));
          if (isParagraph(child) && !loose) append(children, child.children);
          else children.push(child);
        });
        const tail = results[results.length - 1];
        if (tail && (loose || !isParagraph(tail))) children.push(text("\n"));
        return element("li", properties, children);
      }
      case "table": {
        // Every row has a cell per column, as long as the empty cells this
        // adds fit in what is left of maxPadding; past it, a short row shows
        // only its own cells. Line breaks between a table's parts would be
        // dropped, so there are none.
        const columns = node.align?.length ?? 0;
        const padding = node.children.reduce(
          (sum, row) => sum + Math.max(0, columns - row.children.length),
          0,
        );
        const pad = padding <= paddingLeft;
        if (pad) paddingLeft -= padding;
        const cells = (row: TableRow) => {
          const align = node.align ?? row.children.map(() => null);
          return pad ? align : align.slice(0, row.children.length);
        };
        const [head, ...body] = node.children.map((row, rowIndex) =>
          element(
            "tr",
            {},
            cells(row).map((align, cellIndex) => {
              const cell = row.children[cellIndex];
              return element(
                rowIndex ? "td" : "th",
                align ? { style: { textAlign: align } } : {},
                cell ? all(cell) : [],
              );
            }),
          ),
        );
        return element("table", {}, [
          element("thead", {}, [head]),
          ...(body.length ? [element("tbody", {}, body)] : []),
        ]);
      }
      // Definitions only resolve references.
      default:
        return undefined;
    }
  }

  const root = wrap(all(tree));
  // The footnotes that were referenced, in the order of their first reference.
  const items: Element[] = [];
  for (let index = 0; index < footnoteOrder.length; index++) {
    const id = footnoteOrder[index];
    const definition = footnotes.get(id);
    if (!definition) continue;
    const content = all(definition);
    const safeId = normalizeUri(id.toLowerCase());
    const backReferences: Child[] = [];
    for (let reference = 1; reference <= footnoteCounts.get(id)!; reference++) {
      if (backReferences.length) backReferences.push(text(" "));
      backReferences.push(
        element("a", { href: `#user-content-fnref-${safeId}${reference > 1 ? `-${reference}` : ""}` }, [
          text("↩"),
          ...(reference > 1 ? [element("sup", {}, [text(String(reference))])] : []),
        ]),
      );
    }
    const tail = content[content.length - 1];
    if (isParagraph(tail)) {
      const last = tail.children[tail.children.length - 1];
      if (last?.type === "text") last.value += " ";
      else tail.children.push(text(" "));
      append(tail.children, backReferences);
    } else append(content, backReferences);
    items.push(element("li", { id: `user-content-fn-${safeId}` }, wrap(content, true)));
  }
  if (items.length)
    root.push(
      text("\n"),
      element("section", { "data-footnotes": true, className: "footnotes" }, [
        element("h2", {}, [text(footnoteLabel)]),
        text("\n"),
        element("ol", {}, wrap(items, true)),
        text("\n"),
      ]),
    );
  return root;
}

interface Options {
  urlTransform: (url: string) => string;
  components: MarkdownComponents;
}

/**
 * Raw HTML and empty text render nothing, so they are left out. Elements are
 * keyed by position, as they were by hast-util-to-jsx-runtime.
 */
const toReactChildren = (children: Child[], options: Options) =>
  children
    .filter((child) => child.type === "element" || (child.type === "text" && child.value))
    .map((child, index) => toReact(child, options, index));

function toReact(child: Child, options: Options, key: number): ReactNode {
  if (child.type !== "element") return child.type === "text" ? child.value : null;
  const props: Props = { ...child.properties, key };
  if (child.tagName === "a") props.href = options.urlTransform(String(props.href));
  // One child as itself (a code block's text stays a string), several as an
  // array, never spread into the call.
  const children = toReactChildren(child.children, options);
  if (children.length) props.children = children.length > 1 ? children : children[0];
  return createElement(options.components[child.tagName] ?? child.tagName, props);
}

/**
 * Renders Markdown as React elements. Raw HTML never renders, `urlTransform`
 * rewrites every link's target, and `components` replace elements by tag
 * name. Anything but a string renders nothing, as with the earlier pipeline.
 * Text that cannot be rendered, such as nesting deeper than the parser can
 * take, shows as written instead of taking down the view. So does text
 * nested past markdownNestingLimit, which never reaches the parser: a few
 * thousand levels take it seconds or minutes, and deeper still it throws.
 */
export function Markdown({
  children,
  urlTransform,
  components,
  footnoteLabel,
}: Options & {
  children: string;
  /** The heading of the footnotes section, in the reader's language. */
  footnoteLabel: string;
}) {
  const source = typeof children === "string" ? children : "";
  const asWritten = createElement("p", { style: { whiteSpace: "pre-wrap" } }, source);
  if (markdownTooNested(source)) return asWritten;
  try {
    const tree = fromMarkdown(source, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });
    return createElement(Fragment, null, toReactChildren(toTree(tree, footnoteLabel), { urlTransform, components }));
  } catch {
    return asWritten;
  }
}
