/**
 * Roving tabindex for a list of items that is one tab stop: the active item
 * has tabIndex 0, every other item -1, and the arrow keys move focus between
 * them. A long list (a diff with hundreds of lines) then costs a keyboard
 * user one Tab press instead of one per item.
 */
import { useRef, useState, type KeyboardEvent } from "react";

export interface RovingKeyOptions {
  /**
   * Which arrow keys move: "vertical" (ArrowUp/ArrowDown, the default),
   * "horizontal" (ArrowLeft/ArrowRight) or "both".
   */
  orientation?: "vertical" | "horizontal" | "both";
  /** Moving past either end wraps around to the other end. Default false. */
  loop?: boolean;
  /** How far PageUp and PageDown move; 0 (the default) leaves them alone. */
  pageSize?: number;
}

/**
 * The index `key` moves to from `index` in a list of `count` items, or
 * undefined when the key does not move in this list. Home and End go to the
 * first and last item; at an end without `loop` the index stays where it is.
 */
export function rovingTarget(
  key: string,
  index: number,
  count: number,
  { orientation = "vertical", loop = false, pageSize = 0 }: RovingKeyOptions = {},
): number | undefined {
  if (count <= 0) return undefined;
  const last = count - 1;
  const current = Math.min(Math.max(index, 0), last);
  const vertical = orientation !== "horizontal";
  const horizontal = orientation !== "vertical";
  const step = (delta: number) =>
    loop
      ? (((current + delta) % count) + count) % count
      : Math.min(Math.max(current + delta, 0), last);
  switch (key) {
    case "ArrowDown":
      return vertical ? step(1) : undefined;
    case "ArrowUp":
      return vertical ? step(-1) : undefined;
    case "ArrowRight":
      return horizontal ? step(1) : undefined;
    case "ArrowLeft":
      return horizontal ? step(-1) : undefined;
    case "Home":
      return 0;
    case "End":
      return last;
    case "PageDown":
      return pageSize > 0 ? Math.min(current + pageSize, last) : undefined;
    case "PageUp":
      return pageSize > 0 ? Math.max(current - pageSize, 0) : undefined;
    default:
      return undefined;
  }
}

/** The props one item of a roving list needs. */
export interface RovingItemProps {
  tabIndex: 0 | -1;
  ref: (element: HTMLElement | null) => void;
  /** Keeps the tab stop on an item that got focus another way (a click). */
  onFocus: () => void;
}

export interface RovingList {
  /** The item that holds the tab stop, within 0..count-1 (0 when empty). */
  activeIndex: number;
  /** Moves the tab stop without moving focus. */
  setActiveIndex: (index: number) => void;
  /** Moves the tab stop to `index` and focuses that item. */
  focusItem: (index: number) => void;
  /** Spread onto item `index`; give each index to one element only. */
  itemProps: (index: number) => RovingItemProps;
  /**
   * Handles a key pressed on the list. When the key moves, it prevents the
   * default (scrolling), moves the tab stop and focus, and returns the new
   * index; otherwise it returns undefined and leaves the event alone. Keys
   * with Alt, Ctrl or Meta, and keys typed while composing text, never move;
   * Shift does not stop a move, so the caller can extend a selection.
   */
  handleKeyDown: (event: KeyboardEvent) => number | undefined;
}

/** Roving tabindex over `count` items; see RovingKeyOptions for the keys. */
export function useRovingList(
  count: number,
  options: RovingKeyOptions & { initialIndex?: number } = {},
): RovingList {
  const [active, setActive] = useState(options.initialIndex ?? 0);
  const items = useRef<(HTMLElement | null)[]>([]);
  const activeIndex = count > 0 ? Math.min(Math.max(active, 0), count - 1) : 0;

  function focusItem(index: number) {
    setActive(index);
    items.current[index]?.focus();
  }

  return {
    activeIndex,
    setActiveIndex: setActive,
    focusItem,
    itemProps: (index) => ({
      tabIndex: index === activeIndex ? 0 : -1,
      ref: (element) => {
        items.current[index] = element;
      },
      onFocus: () => setActive(index),
    }),
    handleKeyDown(event) {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.nativeEvent.isComposing
      )
        return undefined;
      const next = rovingTarget(event.key, activeIndex, count, options);
      if (next === undefined) return undefined;
      event.preventDefault();
      focusItem(next);
      return next;
    },
  };
}
