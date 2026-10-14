import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEvent } from "react";
import { tablistKeyDown } from "./useTablistKeys";

/** A stand-in for a tab: records focus and clicks, knows its tablist. */
interface FakeTab {
  name: string;
  owner: unknown;
  disabled?: boolean;
  ariaDisabled?: boolean;
}

function tablist(names: string[], extra: Partial<FakeTab>[] = []) {
  const log: string[] = [];
  const list: { tabs: FakeTab[]; querySelectorAll: () => unknown[] } = {
    tabs: [],
    querySelectorAll: () => list.tabs.map(element),
  };
  const elements = new Map<FakeTab, unknown>();
  function element(tab: FakeTab) {
    if (!elements.has(tab))
      elements.set(tab, {
        focus: () => log.push(`focus ${tab.name}`),
        click: () => log.push(`click ${tab.name}`),
        closest: () => tab.owner,
        hasAttribute: (name: string) => name === "disabled" && !!tab.disabled,
        getAttribute: (name: string) =>
          name === "aria-disabled" && tab.ariaDisabled ? "true" : null,
      });
    return elements.get(tab);
  }
  list.tabs = names.map((name, index) => ({
    name,
    owner: list,
    ...extra[index],
  }));
  const press = (
    from: string,
    key: string,
    modifiers: Record<string, boolean> = {},
    orientation?: "horizontal" | "vertical",
  ) => {
    const event = {
      key,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      ...modifiers,
      nativeEvent: { isComposing: modifiers.isComposing ?? false },
      currentTarget: list,
      target: element(list.tabs.find((tab) => tab.name === from)!),
      prevented: false,
      preventDefault() {
        event.prevented = true;
      },
    };
    tablistKeyDown(event as unknown as KeyboardEvent<HTMLElement>, {
      orientation,
    });
    return event.prevented;
  };
  return { log, press };
}

test("left and right move to the neighbouring tab, wrap around and select it", () => {
  const { log, press } = tablist(["explain", "reports", "chat"]);
  assert.equal(press("explain", "ArrowRight"), true);
  assert.equal(press("chat", "ArrowRight"), true);
  assert.equal(press("explain", "ArrowLeft"), true);
  assert.equal(press("reports", "ArrowLeft"), true);
  assert.deepEqual(log, [
    "focus reports",
    "click reports",
    "focus explain",
    "click explain",
    "focus chat",
    "click chat",
    "focus explain",
    "click explain",
  ]);
});

test("Home and End go to the first and last tab; the current tab is not clicked again", () => {
  const { log, press } = tablist(["explain", "reports", "chat"]);
  press("reports", "Home");
  press("reports", "End");
  assert.equal(press("chat", "End"), true);
  assert.deepEqual(log, [
    "focus explain",
    "click explain",
    "focus chat",
    "click chat",
    "focus chat",
  ]);
});

test("other keys, chords and composition leave the event alone", () => {
  const { log, press } = tablist(["explain", "reports", "chat"]);
  assert.equal(press("explain", "ArrowDown"), false);
  assert.equal(press("explain", "Enter"), false);
  assert.equal(press("explain", "ArrowRight", { ctrlKey: true }), false);
  assert.equal(press("explain", "ArrowRight", { altKey: true }), false);
  assert.equal(press("explain", "ArrowRight", { metaKey: true }), false);
  assert.equal(press("explain", "ArrowRight", { isComposing: true }), false);
  assert.deepEqual(log, []);
});

test("a vertical tablist moves with up and down instead", () => {
  const { log, press } = tablist(["a", "b"]);
  assert.equal(press("a", "ArrowRight", {}, "vertical"), false);
  assert.equal(press("a", "ArrowDown", {}, "vertical"), true);
  assert.deepEqual(log, ["focus b", "click b"]);
});

test("disabled tabs and the tabs of a nested tablist are skipped", () => {
  const nested = {};
  const { log, press } = tablist(
    ["explain", "off", "inner", "chat"],
    [{}, { disabled: true }, { owner: nested }, {}],
  );
  press("explain", "ArrowRight");
  press("chat", "ArrowLeft");
  assert.deepEqual(log, ["focus chat", "click chat", "focus explain", "click explain"]);
  const aria = tablist(["a", "b", "c"], [{}, { ariaDisabled: true }, {}]);
  aria.press("a", "ArrowRight");
  assert.deepEqual(aria.log, ["focus c", "click c"]);
});

test("a key on an element that is not one of the tabs is ignored", () => {
  const nested = {};
  const { log, press } = tablist(["a", "inner"], [{}, { owner: nested }]);
  assert.equal(press("inner", "ArrowRight"), false);
  assert.deepEqual(log, []);
});
