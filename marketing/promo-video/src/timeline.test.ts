import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraView, type CameraKey } from "./lib/camera.ts";
import { events } from "./music.ts";
import { timeline } from "./timeline.ts";

const { shots, fps, viewport } = timeline;
const output = { width: timeline.width, height: timeline.height };

test("the composition is 1920x1080 at 30 fps and 2259 frames (75.28 s)", () => {
  assert.deepEqual([timeline.width, timeline.height, fps, timeline.durationInFrames], [1920, 1080, 30, 2259]);
  assert.deepEqual(viewport, { width: 1440, height: 810, deviceScaleFactor: 2 });
});

test("the shots follow each other without a gap from frame 0 to the end", () => {
  assert.equal(shots[0].from, 0);
  shots.forEach((shot, index) => {
    assert.ok(shot.to > shot.from, `${shot.id} has frames`);
    if (index > 0) assert.equal(shot.from, shots[index - 1].to, `${shot.id} starts where the shot before ends`);
  });
  assert.equal(shots.at(-1)!.to, timeline.durationInFrames);
});

test("the cuts land on the music's events", () => {
  const starts = new Set(shots.map((shot) => shot.from));
  for (const frame of [events.riser, events.drop, events.lift, events.climax, events.accent])
    assert.ok(starts.has(frame), `a shot starts at frame ${frame}`);
  const end = shots.find((shot) => shot.scene === "end")!;
  assert.ok(end.from <= events.finalHit + 7 && events.finalHit < end.to, "the end card is up for the final hit");
});

test("every shot that shows the product names its capture method and has a camera", () => {
  for (const shot of shots.filter((each) => each.scene === "footage")) {
    assert.ok(shot.capture, `${shot.id} is captured`);
    assert.ok(["still", "screencast", "clock"].includes(shot.capture!.method));
    assert.ok(shot.workspace, `${shot.id} shows the sample workspace`);
    if (shot.capture!.method === "still") {
      assert.ok(shot.stills?.length, `${shot.id} lists its stills`);
      assert.deepEqual(shot.stills!.map((still) => still.state), shot.capture!.states);
    } else assert.ok(shot.camera?.length && shot.clip, `${shot.id} has a clip and a camera`);
  }
});

/** Every camera key of every footage shot, with where it belongs. */
function allKeys(): { where: string; key: CameraKey }[] {
  return shots.filter((shot) => shot.scene === "footage").flatMap((shot) => [
    ...(shot.camera ?? []).map((key) => ({ where: `${shot.id} f${key.f}`, key })),
    ...(shot.stills ?? []).flatMap((still) =>
      still.camera.map((key) => ({ where: `${shot.id}/${still.state} f${key.f}`, key })),
    ),
  ]);
}

test("cameras stay inside the capture and never zoom past 1.65x", () => {
  for (const { where, key } of allKeys()) {
    assert.ok(key.zoom >= 1 && key.zoom <= 1.65, `${where}: zoom ${key.zoom}`);
    assert.ok(key.x >= 0 && key.x <= viewport.width && key.y >= 0 && key.y <= viewport.height, `${where}: inside`);
  }
});

test("a zoomed camera shows the whole sidebar or none of it", () => {
  // The app's sidebar is 228 CSS pixels wide; a sliver of it at the frame's
  // edge reads as a glitch. Views over a dialog's blurred backdrop are exempt.
  const sidebar = 228;
  for (const { where, key } of allKeys()) {
    if (key.dialog) continue;
    const { left } = cameraView(key, viewport, output);
    assert.ok(left <= 0.5 || left >= sidebar, `${where}: the left edge at ${left.toFixed(0)} cuts the sidebar`);
  }
});

test("clip skips and still changes stay inside their shots", () => {
  for (const shot of shots) {
    const length = shot.to - shot.from;
    for (const still of shot.stills ?? []) assert.ok(still.from >= 0 && still.from < length);
    for (const [from, to] of shot.clip?.skip ?? []) assert.ok(to > from && from >= shot.clip!.startAt);
    for (const key of shot.cursor ?? []) assert.ok(key.f >= 0 && key.f <= length, `${shot.id} cursor f${key.f}`);
  }
});
