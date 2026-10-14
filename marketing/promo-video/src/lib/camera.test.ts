import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraAt, cameraView, toOutput } from "./camera.ts";

const viewport = { width: 1440, height: 810 };
const output = { width: 1920, height: 1080 };

test("cameraAt holds before the first key and after the last", () => {
  const keys = [
    { f: 10, x: 100, y: 200, zoom: 1.2 },
    { f: 20, x: 300, y: 400, zoom: 1.5 },
  ];
  assert.deepEqual(cameraAt(keys, 0), { x: 100, y: 200, zoom: 1.2 });
  assert.deepEqual(cameraAt(keys, 99), { x: 300, y: 400, zoom: 1.5 });
});

test("cameraAt eases between keys and moves zoom evenly in log space", () => {
  const keys = [
    { f: 0, x: 0, y: 0, zoom: 1 },
    { f: 10, x: 100, y: 100, zoom: 4, ease: "linear" as const },
  ];
  const middle = cameraAt(keys, 5);
  assert.equal(middle.x, 50);
  assert.ok(Math.abs(middle.zoom - 2) < 1e-9, "halfway from 1x to 4x is 2x");
  const eased = cameraAt([keys[0], { ...keys[1], ease: "inOut" }], 2);
  assert.ok(eased.x < 20, "ease-in-out starts slower than linear");
});

test("cameraView fills the frame with the viewport at zoom 1", () => {
  const view = cameraView({ x: 720, y: 405, zoom: 1 }, viewport, output);
  assert.deepEqual(view, { scale: 1920 / 1440, left: 0, top: 0 });
});

test("cameraView never shows past the viewport's edges", () => {
  const view = cameraView({ x: 1400, y: 20, zoom: 1.5 }, viewport, output);
  assert.equal(view.left, 1440 - 960);
  assert.equal(view.top, 0);
  const tooWide = cameraView({ x: 0, y: 0, zoom: 0.5 }, viewport, output);
  assert.deepEqual(tooWide, { scale: 1920 / 1440, left: 0, top: 0 }, "zoom stays at least 1");
});

test("toOutput maps a viewport point through the camera", () => {
  const view = cameraView({ x: 960, y: 540, zoom: 2 }, viewport, output);
  assert.deepEqual(toOutput(view, view.left, view.top), { x: 0, y: 0 });
  const center = toOutput(view, 960, 540);
  assert.equal(center.x, 960);
  assert.equal(center.y, 540);
});
