import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { appVersion } from "../version";
import {
  ErrorBoundary,
  ErrorFallback,
  diagnosticsText,
  reloadOnPreloadError,
} from "./ErrorBoundary";

const han = /\p{Script=Han}/u;

test("getDerivedStateFromError keeps the thrown error as the boundary state", () => {
  const error = new Error("x");
  assert.deepEqual(ErrorBoundary.getDerivedStateFromError(error), { error });
  const wrapped = ErrorBoundary.getDerivedStateFromError("plain text");
  assert.ok(wrapped.error instanceof Error);
  assert.equal(wrapped.error.message, "plain text");
});

test("the fallback offers Reload and Copy diagnostics in English", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorFallback, { error: new Error("boom"), onReload() {} }),
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /<button type="button" class="button primary">Reload<\/button>/);
  assert.match(html, /<button type="button" class="button secondary">Copy diagnostics<\/button>/);
  assert.match(html, /This part of BELL PR stopped working/);
  // The message stays in the copied diagnostics, not on the page.
  assert.doesNotMatch(html, /boom/);
  assert.doesNotMatch(html, han);
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
  const html = renderToStaticMarkup(
    createElement(ErrorBoundary, null, createElement("p", null, "panel")),
  );
  assert.equal(html, "<p>panel</p>");

  const boundary = new ErrorBoundary({ children: createElement("p", null, "panel") });
  boundary.state = { error: new Error("x") };
  const fallback = renderToStaticMarkup(boundary.render() as ReactElement);
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
    },
  };
}

test("a failed chunk load reloads once per tab session, then lets the boundary show", () => {
  const { values, storage } = fakeStorage();
  let prevented = 0;
  let reloads = 0;
  const event = { preventDefault: () => void prevented++ };
  const reload = () => void reloads++;

  assert.equal(reloadOnPreloadError(event, () => storage, reload), true);
  assert.equal(prevented, 1);
  assert.equal(reloads, 1);
  assert.equal(values.size, 1);

  assert.equal(reloadOnPreloadError(event, () => storage, reload), false);
  assert.equal(prevented, 1);
  assert.equal(reloads, 1);
});

test("without working session storage a failed chunk load never reloads", () => {
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
  };

  assert.equal(reloadOnPreloadError(event, blocked, reload), false);
  assert.equal(reloadOnPreloadError(event, () => readOnly, reload), false);
  assert.equal(prevented, 0);
  assert.equal(reloads, 0);
});
