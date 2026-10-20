/**
 * Arrow-key navigation for a tablist whose tabs use a roving tabindex
 * (`tabIndex={selected ? 0 : -1}`), the way the workspace tabs work:
 * ArrowLeft and ArrowRight move to the previous and next tab and wrap
 * around, Home and End go to the first and last tab, and the tab that gets
 * focus is selected through its own click handler (automatic activation).
 */
import { useCallback, type KeyboardEvent } from "react";
import { rovingTarget } from "./useRovingList";

export interface TablistKeyOptions {
  /** A vertical tablist moves with ArrowUp and ArrowDown instead. */
  orientation?: "horizontal" | "vertical";
}

/**
 * The keydown handler for the element with role="tablist". It acts only on
 * keys pressed on one of its own enabled tabs (a nested tablist keeps its
 * own keys) and ignores Alt, Ctrl and Meta chords and text composition.
 */
export function tablistKeyDown(
  event: KeyboardEvent<HTMLElement>,
  { orientation = "horizontal" }: TablistKeyOptions = {},
): void {
  if (
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent.isComposing
  )
    return;
  const tablist = event.currentTarget;
  const tabs = Array.from(
    tablist.querySelectorAll<HTMLElement>('[role="tab"]'),
  ).filter(
    (tab) =>
      tab.closest('[role="tablist"]') === tablist &&
      !tab.hasAttribute("disabled") &&
      tab.getAttribute("aria-disabled") !== "true",
  );
  const index = tabs.indexOf(event.target as HTMLElement);
  if (index < 0) return;
  const next = rovingTarget(event.key, index, tabs.length, {
    orientation,
    loop: true,
  });
  if (next === undefined) return;
  event.preventDefault();
  tabs[next].focus();
  if (next !== index) tabs[next].click();
}

/** tablistKeyDown as a stable handler: `<div role="tablist" onKeyDown={…}>`. */
export function useTablistKeys(options: TablistKeyOptions = {}) {
  const { orientation } = options;
  return useCallback(
    (event: KeyboardEvent<HTMLElement>) =>
      tablistKeyDown(event, { orientation }),
    [orientation],
  );
}
