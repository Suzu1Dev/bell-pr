import assert from "node:assert/strict";
import { test } from "node:test";
import { cursorAt, fadeSeconds, restSeconds, rippleSeconds, type CursorEvent } from "./cursor.ts";

const events: CursorEvent[] = [
  { type: "start", t: 0, x: 100, y: 100 },
  { type: "move", from: 1, t: 2, x: 300, y: 500, target: "button" },
  { type: "click", t: 2.2, x: 300, y: 500, target: "button" },
];

test("the cursor rests at its start until it moves", () => {
  assert.equal(cursorAt(events, -0.1), undefined);
  assert.deepEqual({ ...cursorAt(events, 0.5) }, { x: 100, y: 100, opacity: 1, press: 0, ripples: [] });
});

test("the cursor eases to its target and arrives on time", () => {
  const halfway = cursorAt(events, 1.5)!;
  assert.equal(halfway.x, 200);
  assert.equal(halfway.y, 300);
  const early = cursorAt(events, 1.1)!;
  assert.ok(early.x < 110, "it starts slowly");
  assert.deepEqual([cursorAt(events, 2)!.x, cursorAt(events, 2)!.y], [300, 500]);
});

test("a click presses the cursor and sends out a ripple", () => {
  const pressed = cursorAt(events, 2.2 + 0.09)!;
  assert.ok(pressed.press > 0.9);
  assert.deepEqual(pressed.ripples.map((age) => Math.round(age * 100) / 100), [0.09]);
  assert.deepEqual(cursorAt(events, 2.2 + rippleSeconds + 0.01)!.ripples, []);
});

test("the cursor fades out after its last event", () => {
  assert.ok(cursorAt(events, 2.2 + restSeconds - 0.01)!.opacity === 1);
  assert.equal(cursorAt(events, 2.2 + restSeconds + fadeSeconds + 0.01)!.opacity, 0);
});

test("the cursor is gone after a hide event", () => {
  const hidden: CursorEvent[] = [...events, { type: "hide", t: 2.3 }];
  assert.ok(cursorAt(hidden, 2.29));
  assert.equal(cursorAt(hidden, 2.3), undefined);
  assert.equal(cursorAt(hidden, 5), undefined);
});
