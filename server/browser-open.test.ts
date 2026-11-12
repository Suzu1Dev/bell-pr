import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openBrowserFile } from "./browser-open.js";

const target = "http://127.0.0.1:4311#bell_token=synthetic-test-token";

test("private redirect, stale sweep, timer and explicit cleanup", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bell-browser-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directory = path.join(dir, "browser-open");
  mkdirSync(directory, { mode: 0o755 });
  const stale = path.join(directory, `${"a".repeat(32)}.html`);
  writeFileSync(stale, "stale");
  utimesSync(stale, new Date(0), new Date(0));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let opened = "";
  const cleanup = await openBrowserFile(dir, target, (url) => { opened = url; }, () => assert.fail("unexpected hint"));
  assert.match(opened, /^file:\/\//);
  assert.equal(opened.includes("synthetic-test-token"), false);
  assert.ok(readFileSync(new URL(opened), "utf8").includes(`location.replace(${JSON.stringify(target)})`));
  assert.equal(existsSync(stale), false);
  if (process.platform !== "win32") {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(new URL(opened)).mode & 0o777, 0o600);
  }
  t.mock.timers.tick(60_000);
  assert.equal(existsSync(new URL(opened)), false);
  cleanup();
  const next = await openBrowserFile(dir, target, (url) => { opened = url; }, () => assert.fail());
  next();
  assert.equal(existsSync(new URL(opened)), false);
  const exitListeners = process.listeners("exit");
  await openBrowserFile(dir, target, (url) => { opened = url; }, () => assert.fail());
  const exitCleanup = process.listeners("exit").find((listener) => !exitListeners.includes(listener));
  assert.ok(exitCleanup);
  exitCleanup(0);
  assert.equal(existsSync(new URL(opened)), false);
});

test("failed or missing opener hints once and immediately removes the file", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bell-browser-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const opener of [undefined, () => false, () => { throw new Error(target); }]) {
    let hints = 0;
    await openBrowserFile(dir, target, opener, () => { hints++; });
    assert.equal(hints, 1);
    const directory = path.join(dir, "browser-open");
    if (existsSync(directory)) assert.deepEqual(readdirSync(directory), []);
  }
});

test("symlinked redirect directory is refused", { skip: process.platform === "win32" }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bell-browser-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "other"));
  symlinkSync(path.join(dir, "other"), path.join(dir, "browser-open"));
  let hints = 0;
  await openBrowserFile(dir, target, () => assert.fail("must not open"), () => { hints++; });
  assert.equal(hints, 1);
  assert.deepEqual(readdirSync(path.join(dir, "other")), []);
});


test("foreign-owned directory is refused before changing permissions", { skip: !process.getuid }, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bell-browser-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const directory = path.join(dir, "browser-open");
  mkdirSync(directory, { mode: 0o755 });
  const original = statSync(directory);
  const uid = original.uid;
  t.mock.method(process as NodeJS.Process & { getuid: () => number }, "getuid", () => uid + 1);
  let hints = 0;
  await openBrowserFile(dir, target, () => assert.fail("must not open"), () => { hints++; });
  assert.equal(hints, 1);
  assert.equal(statSync(directory).mode, original.mode);
  assert.deepEqual(readdirSync(directory), []);
});
