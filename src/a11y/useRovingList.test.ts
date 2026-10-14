import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type KeyboardEvent } from "react";
import { renderEn } from "../test-utils/render";
import { rovingTarget, useRovingList, type RovingList } from "./useRovingList";

test("arrow keys move one step along the list's own orientation only", () => {
  assert.equal(rovingTarget("ArrowDown", 2, 5), 3);
  assert.equal(rovingTarget("ArrowUp", 2, 5), 1);
  assert.equal(rovingTarget("ArrowRight", 2, 5), undefined);
  assert.equal(rovingTarget("ArrowLeft", 2, 5), undefined);
  const horizontal = { orientation: "horizontal" } as const;
  assert.equal(rovingTarget("ArrowRight", 2, 5, horizontal), 3);
  assert.equal(rovingTarget("ArrowLeft", 2, 5, horizontal), 1);
  assert.equal(rovingTarget("ArrowDown", 2, 5, horizontal), undefined);
  const both = { orientation: "both" } as const;
  assert.equal(rovingTarget("ArrowDown", 2, 5, both), 3);
  assert.equal(rovingTarget("ArrowRight", 2, 5, both), 3);
  assert.equal(rovingTarget("a", 2, 5), undefined);
  assert.equal(rovingTarget("Enter", 2, 5), undefined);
});

test("Home and End jump to the ends, which hold unless the list loops", () => {
  assert.equal(rovingTarget("Home", 3, 5), 0);
  assert.equal(rovingTarget("End", 1, 5), 4);
  assert.equal(rovingTarget("ArrowDown", 4, 5), 4);
  assert.equal(rovingTarget("ArrowUp", 0, 5), 0);
  assert.equal(rovingTarget("ArrowDown", 4, 5, { loop: true }), 0);
  assert.equal(rovingTarget("ArrowUp", 0, 5, { loop: true }), 4);
});

test("PageUp and PageDown move by the page size and stop at the ends", () => {
  assert.equal(rovingTarget("PageDown", 2, 50), undefined);
  assert.equal(rovingTarget("PageDown", 2, 50, { pageSize: 10 }), 12);
  assert.equal(rovingTarget("PageDown", 45, 50, { pageSize: 10 }), 49);
  assert.equal(rovingTarget("PageUp", 12, 50, { pageSize: 10 }), 2);
  assert.equal(rovingTarget("PageUp", 3, 50, { pageSize: 10 }), 0);
});

test("an empty list never moves and an index out of range is clamped first", () => {
  assert.equal(rovingTarget("ArrowDown", 0, 0), undefined);
  assert.equal(rovingTarget("Home", 0, 0), undefined);
  assert.equal(rovingTarget("ArrowUp", 9, 5), 3);
  assert.equal(rovingTarget("ArrowDown", -4, 5), 1);
});

test("disabled items are skipped by every key, and an end stays put when only disabled items lie beyond", () => {
  const off = (...indexes: number[]) => ({ disabled: (index: number) => indexes.includes(index) });
  assert.equal(rovingTarget("ArrowDown", 0, 5, off(1, 2)), 3);
  assert.equal(rovingTarget("ArrowUp", 3, 5, off(1, 2)), 0);
  assert.equal(rovingTarget("ArrowDown", 3, 5, off(4)), 3);
  assert.equal(rovingTarget("ArrowDown", 4, 5, { loop: true, ...off(0) }), 1);
  assert.equal(rovingTarget("ArrowUp", 1, 5, { loop: true, ...off(0) }), 4);
  assert.equal(rovingTarget("Home", 3, 5, off(0)), 1);
  assert.equal(rovingTarget("End", 1, 5, off(4)), 3);
  assert.equal(rovingTarget("Home", 2, 5, off(0, 1, 3, 4)), 2);
  assert.equal(rovingTarget("ArrowRight", 0, 3, { orientation: "horizontal", ...off(1) }), 2);
  assert.equal(rovingTarget("PageDown", 0, 10, { pageSize: 3, ...off(3) }), 2);
  assert.equal(rovingTarget("PageDown", 0, 10, { pageSize: 3, ...off(1, 2, 3) }), 0);
  assert.equal(rovingTarget("PageUp", 9, 10, { pageSize: 3, ...off(6) }), 7);
  assert.equal(rovingTarget("PageUp", 9, 10, { pageSize: 3, ...off(6, 7, 8) }), 9);
});

function List({
  count,
  initialIndex,
  disabled,
  capture,
}: {
  count: number;
  initialIndex?: number;
  disabled?: number[];
  capture?: (list: RovingList) => void;
}) {
  const roving = useRovingList(count, {
    initialIndex,
    pageSize: 2,
    disabled: disabled && ((index) => disabled.includes(index)),
  });
  capture?.(roving);
  return createElement(
    "ul",
    { role: "listbox", "aria-label": "Items" },
    Array.from({ length: count }, (_, index) => {
      const { ref, ...props } = roving.itemProps(index);
      return createElement(
        "li",
        { key: index, role: "option", "aria-selected": false, ref, ...props },
        `Item ${index}`,
      );
    }),
  );
}

const tabStops = (html: string) =>
  [...html.matchAll(/tabindex="(-?\d+)"/g)].map((match) => match[1]);

test("exactly one item is a tab stop, the first unless told otherwise", () => {
  assert.deepEqual(tabStops(renderEn(createElement(List, { count: 4 }))), [
    "0",
    "-1",
    "-1",
    "-1",
  ]);
  assert.deepEqual(
    tabStops(renderEn(createElement(List, { count: 4, initialIndex: 2 }))),
    ["-1", "-1", "0", "-1"],
  );
  // A tab stop past the end (the list got shorter) stays on the last item.
  assert.deepEqual(
    tabStops(renderEn(createElement(List, { count: 3, initialIndex: 7 }))),
    ["-1", "-1", "0"],
  );
  assert.equal(renderEn(createElement(List, { count: 0 })).includes("tabindex"), false);
  // A tab stop on a disabled item moves to the nearest item that can take it.
  assert.deepEqual(
    tabStops(renderEn(createElement(List, { count: 4, disabled: [0] }))),
    ["-1", "0", "-1", "-1"],
  );
  assert.deepEqual(
    tabStops(renderEn(createElement(List, { count: 4, initialIndex: 3, disabled: [3] }))),
    ["-1", "-1", "0", "-1"],
  );
});

/** A keydown on the list, recording whether its default was prevented. */
function keyEvent(key: string, modifiers: Partial<Record<string, boolean>> = {}) {
  const event = {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
    nativeEvent: { isComposing: modifiers.isComposing ?? false },
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
  };
  return event;
}

test("a moving key focuses the next item and prevents scrolling; chords and other keys pass", () => {
  let list: RovingList | undefined;
  renderEn(createElement(List, { count: 5, capture: (value) => (list = value) }));
  assert.ok(list);
  const focused: number[] = [];
  for (let index = 0; index < 5; index++) {
    const element = { focus: () => focused.push(index) };
    list.itemProps(index).ref(element as unknown as HTMLElement);
  }
  const press = (event: ReturnType<typeof keyEvent>) =>
    list!.handleKeyDown(event as unknown as KeyboardEvent);

  const down = keyEvent("ArrowDown");
  assert.equal(press(down), 1);
  assert.equal(down.prevented, true);
  assert.deepEqual(focused, [1]);
  // Shift still moves, so the caller can extend a selection.
  assert.equal(press(keyEvent("End", { shiftKey: true })), 4);
  assert.equal(press(keyEvent("PageDown")), 2);
  assert.deepEqual(focused, [1, 4, 2]);
  for (const event of [
    keyEvent("ArrowDown", { ctrlKey: true }),
    keyEvent("ArrowDown", { altKey: true }),
    keyEvent("ArrowDown", { metaKey: true }),
    keyEvent("ArrowDown", { isComposing: true }),
    keyEvent("ArrowRight"),
    keyEvent("Enter"),
    keyEvent(" "),
  ]) {
    assert.equal(press(event), undefined, event.key);
    assert.equal(event.prevented, false, event.key);
  }
  assert.deepEqual(focused, [1, 4, 2]);
});
