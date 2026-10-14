import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { appVersion } from "../version";
import {
  ErrorBoundary,
  ErrorFallback,
  diagnosticsText,
  reloadOnPreloadError,
} from "./ErrorBoundary";

test("getDerivedStateFromError keeps the thrown error as the boundary state", () => {
  const error = new Error("x");
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(error), { error });
  const wrapped = ErrorBoundary.getDerivedStateFromError("plain text");
  assert.ok(wrapped.error instanceof Error);
  assert.equal(wrapped.error.message, "plain text");
});

test("the fallback offers Reload and Copy diagnostics in English", () => {
  const html = renderEn(
    createElement(ErrorFallback, { error: new Error("boom"), onReload() {} }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /<h3>Something went wrong<\/h3>/);
  assert.match(html, /<button type="button" class="button primary">Reload<\/button>/);
  assert.match(html, /<button type="button" class="button secondary">Copy diagnostics<\/button>/);
  assert.match(html, /This part of BELL PR stopped working/);
  // The message stays in the copied diagnostics, not on the page.
  assert.doesNotMatch(html, /boom/);
  assertNoHan(html);
});

test("the fallback follows the UI language", () => {
  const html = renderZh(
    createElement(ErrorFallback, { error: new Error("boom"), onReload() {} }),
  );
  assert.match(html, /<button type="button" class="button primary">重新載入<\/button>/);
  assert.match(html, /BELL PR 的這個部分無法正常運作/);
  assert.doesNotMatch(html, /boom/);
});

test("diagnostics name the build, the browser and the message, without the stack", () => {
  const error = new Error("Cannot read properties of undefined");
  error.stack = "TypeError: Cannot read\n    at render (/home/someone/app/src/x.tsx:1:1)";
  assert.equal(
    diagnosticsText(error, "TestBrowser/1.0"),
    `BELL PR ${appVersion}\nTestBrowser/1.0\nCannot read properties of undefined`,
  );
});

test("the boundary renders its children until an error is caught", () => {
  const html = renderEn(
    createElement(ErrorBoundary, null, createElement("p", null, "panel")),
  );
  assert.equal(html, "<p>panel</p>");

  const boundary = new ErrorBoundary({ children: createElement("p", null, "panel") });
  boundary.state = { error: new Error("x") };
  const fallback = renderEn(boundary.render() as ReactElement);
  assert.match(fallback, />Reload</);
  assert.doesNotMatch(fallback, /panel/);
});

test("a changed reset key clears an error that was already showing", () => {
  const updates: unknown[] = [];
  const boundary = new ErrorBoundary({ children: null, resetKey: "run:b.ts" });
  boundary.setState = (state) => {
    updates.push(state);
  };
  const error = new Error("x");
  boundary.state = { error };
  // The error was caught in this very update: no retry, or it could loop.
  boundary.componentDidUpdate({ children: null, resetKey: "run:a.ts" }, { error: null });
  assert.deepEqual(updates, []);
  // Same key: the fallback stays.
  boundary.componentDidUpdate({ children: null, resetKey: "run:b.ts" }, { error });
  assert.deepEqual(updates, []);
  // The reader opened another file while the fallback showed.
  boundary.componentDidUpdate({ children: null, resetKey: "run:a.ts" }, { error });
  assert.deepEqual(updates, [{ error: null }]);
});

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    },
  };
}

/** Lets the session check that reloadOnPreloadError started finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));
const signedIn = async () => true;
const live = () => false;

test("a failed chunk load reloads once per tab session, then lets the boundary show", async () => {
  const { values, storage } = fakeStorage();
  let prevented = 0;
  let reloads = 0;
  const event = { preventDefault: () => void prevented++ };
  const reload = () => void reloads++;

  assert.equal(reloadOnPreloadError(event, () => storage, reload, signedIn, live), true);
  assert.equal(prevented, 1);
  await settle();
  assert.equal(reloads, 1);
  assert.equal(values.size, 1);

  assert.equal(reloadOnPreloadError(event, () => storage, reload, signedIn, live), false);
  await settle();
  assert.equal(prevented, 1);
  assert.equal(reloads, 1);
});

test("without working session storage a failed chunk load never reloads", async () => {
  let prevented = 0;
  let reloads = 0;
  const event = { preventDefault: () => void prevented++ };
  const reload = () => void reloads++;
  const blocked = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  const readOnly = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem() {},
  };

  assert.equal(reloadOnPreloadError(event, blocked, reload, signedIn, live), false);
  assert.equal(reloadOnPreloadError(event, () => readOnly, reload, signedIn, live), false);
  await settle();
  assert.equal(prevented, 0);
  assert.equal(reloads, 0);
});

test("an ended session never reloads into the sign-in page", async () => {
  const { values, storage } = fakeStorage();
  let prevented = 0;
  let reloads = 0;
  let checks = 0;
  const event = { preventDefault: () => void prevented++ };
  const reload = () => void reloads++;
  const check = async () => {
    checks++;
    return true;
  };

  // Known ended: the error goes to the boundary as it is.
  assert.equal(reloadOnPreloadError(event, () => storage, reload, check, () => true), false);
  await settle();
  assert.deepEqual([prevented, reloads, checks, values.size], [0, 0, 0, 0]);

  // Found ended by the check (or the server did not answer): no reload,
  // and a later failure may still reload once the session works again.
  const signedOut = async () => false;
  assert.equal(reloadOnPreloadError(event, () => storage, reload, signedOut, live), true);
  await settle();
  assert.deepEqual([prevented, reloads, values.size], [1, 0, 0]);
  assert.equal(reloadOnPreloadError(event, () => storage, reload, check, live), true);
  await settle();
  assert.deepEqual([prevented, reloads, checks, values.size], [2, 1, 1, 1]);
});
