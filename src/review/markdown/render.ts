import type { Definition, FootnoteDefinition, Nodes, Parents, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { normalizeUri } from "micromark-util-sanitize-uri";
import { createElement, Fragment, type ComponentType, type ReactNode } from "react";

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

function toTree(tree: Root) {
  const definitions = new Map<string, Definition>();
  const footnotes = new Map<string, FootnoteDefinition>();
  const footnoteOrder: string[] = [];
  const footnoteCounts = new Map<string, number>();

  // The first definition of an identifier wins, wherever it is.
  const collect = (node: Nodes) => {
    if (node.type === "definition" || node.type === "footnoteDefinition") {
      const map: Map<string, Definition | FootnoteDefinition> =
        node.type === "definition" ? definitions : footnotes;
      const id = node.identifier.toUpperCase();
      if (!map.has(id)) map.set(id, node);
    }
    if ("children" in node) node.children.forEach(collect);
  };
  collect(tree);

  function all(parent: Parents) {
    const values: Child[] = [];
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
    return values;
  }

  function one(node: Nodes, parent: Parents): Child | Child[] | undefined {
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
        // Every row has a cell per column. Line breaks between a table's
        // parts would be dropped, so there are none.
        const [head, ...body] = node.children.map((row, rowIndex) =>
          element(
            "tr",
            {},
            (node.align ?? row.children.map(() => null)).map((align, cellIndex) => {
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
        element("h2", {}, [text("Footnotes")]),
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
 */
export function Markdown({
  children,
  urlTransform,
  components,
}: Options & { children: string }) {
  const tree = fromMarkdown(typeof children === "string" ? children : "", {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  return createElement(Fragment, null, toReactChildren(toTree(tree), { urlTransform, components }));
}
