// The overflow part of a read-through: no text may be cut off or spill out
// of its box, in any language or at any width.
import { expect, type Page } from "@playwright/test";

/** One piece of text that does not fit. */
export interface OverflowProblem {
  /** Tag, id and classes of the box, for example `span.file-name`. */
  element: string;
  /** The start of its text. */
  text: string;
  reason: "overflow" | "ellipsis" | "line-clamp";
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Lists the text that does not fit inside `selectors` (default: the whole
 * page). Every visible element with text of its own is measured through
 * its box (the nearest element that is not inline). A box fails when its
 * content is wider than the box (`scrollWidth > clientWidth + 1`) and that
 * is its text's doing: cut off by an ellipsis, or running past the box's
 * edge (a decoration that overflows on purpose does not count). It also
 * fails when a line clamp hides lines. Text inside a container that
 * scrolls sideways (code, wide tables) can be scrolled to and is not a
 * problem; neither is visually hidden text.
 */
export function findOverflow(
  page: Page,
  selectors: string[] = ["body"],
): Promise<OverflowProblem[]> {
  return page.evaluate((roots) => {
    const scrollsSideways = (style: CSSStyleDeclaration) =>
      style.overflowX === "auto" || style.overflowX === "scroll";
    /** The nearest element that lays out a box of its own. */
    const boxOf = (element: Element) => {
      let box: Element | null = element;
      while (box) {
        const display = getComputedStyle(box).display;
        if (display !== "inline" && display !== "contents") return box;
        box = box.parentElement;
      }
      return null;
    };
    /** Inside an element (not the page) that scrolls its overflow sideways. */
    const inSidewaysScroller = (element: Element) => {
      for (
        let parent = element.parentElement;
        parent && parent !== document.body && parent !== document.documentElement;
        parent = parent.parentElement
      )
        if (
          scrollsSideways(getComputedStyle(parent)) &&
          parent.scrollWidth > parent.clientWidth + 1
        )
          return true;
      return false;
    };
    /** Whether some of `texts` lies left or right of the box's inside. */
    const textOutside = (box: HTMLElement, texts: Text[]) => {
      const left = box.getBoundingClientRect().left + box.clientLeft;
      const right = left + box.clientWidth;
      const range = document.createRange();
      for (const text of texts) {
        range.selectNodeContents(text);
        for (const rect of range.getClientRects())
          if (rect.width > 0 && (rect.right > right + 1 || rect.left < left - 1))
            return true;
      }
      return false;
    };
    const describe = (element: Element) =>
      [
        element.tagName.toLowerCase(),
        element.id ? `#${element.id}` : "",
        ...Array.from(element.classList, (name) => `.${name}`),
      ].join("");

    // Each box with the text nodes it lays out.
    const boxes = new Map<HTMLElement, Text[]>();
    for (const selector of roots)
      for (const root of document.querySelectorAll(selector))
        for (const element of [root, ...root.querySelectorAll("*")]) {
          if (!(element instanceof HTMLElement)) continue;
          const texts = Array.from(element.childNodes).filter(
            (node): node is Text =>
              node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
          );
          const box = texts.length ? boxOf(element) : null;
          if (!(box instanceof HTMLElement)) continue;
          if (!boxes.has(box)) boxes.set(box, []);
          for (const text of texts)
            if (!boxes.get(box)!.includes(text)) boxes.get(box)!.push(text);
        }

    const problems: OverflowProblem[] = [];
    for (const [box, texts] of boxes) {
      const style = getComputedStyle(box);
      const rect = box.getBoundingClientRect();
      // Hidden (also inside a closed <details>), collapsed or visually
      // hidden (screen-reader only) text.
      if (
        !box.checkVisibility({ visibilityProperty: true }) ||
        rect.width <= 1 ||
        rect.height <= 1
      )
        continue;
      if (scrollsSideways(style)) continue;
      const sizes = {
        scrollWidth: box.scrollWidth,
        clientWidth: box.clientWidth,
        scrollHeight: box.scrollHeight,
        clientHeight: box.clientHeight,
      };
      const text = (box.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
      const clamp = style.getPropertyValue("-webkit-line-clamp");
      const ellipsis =
        style.textOverflow === "ellipsis" && style.overflowX !== "visible";
      let reason: OverflowProblem["reason"] | undefined;
      if (
        sizes.scrollWidth > sizes.clientWidth + 1 &&
        !inSidewaysScroller(box) &&
        (ellipsis || textOutside(box, texts))
      )
        reason = ellipsis ? "ellipsis" : "overflow";
      else if (
        clamp &&
        clamp !== "none" &&
        sizes.scrollHeight > sizes.clientHeight + 1
      )
        reason = "line-clamp";
      if (reason) problems.push({ element: describe(box), text, reason, ...sizes });
    }
    return problems;
  }, selectors);
}

/**
 * Fails when text inside `selectors` (default: the whole page) is cut off
 * or spills out of its box; see findOverflow(). The message lists each
 * box with its text.
 */
export async function expectNoOverflow(page: Page, selectors?: string[]) {
  const problems = await findOverflow(page, selectors);
  const list = problems
    .map(
      (problem) =>
        `- ${problem.reason}: ${problem.element} "${problem.text}" (${problem.scrollWidth}×${problem.scrollHeight} in ${problem.clientWidth}×${problem.clientHeight})`,
    )
    .join("\n");
  expect(problems, `Text does not fit on ${page.url()}:\n${list}`).toEqual([]);
}
