import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withNodes } from "./withNodes";

const render = (nodes: ReturnType<typeof withNodes>) =>
  renderToStaticMarkup(createElement("p", null, nodes));

test("elements go where each locale's sentence puts them, and strings pass through", () => {
  const code = createElement("code", null, "src/utils");
  const english = ({ path, purpose }: { path: string; purpose: string }) =>
    `Module ${path}: ${purpose}`;
  const chinese = ({ path, purpose }: { path: string; purpose: string }) =>
    `所在模組 ${path}：${purpose}`;
  assert.equal(
    render(withNodes(english, { path: code, purpose: "Shared <helpers>" })),
    "<p>Module <code>src/utils</code>: Shared &lt;helpers&gt;</p>",
  );
  assert.equal(
    render(withNodes(chinese, { path: code, purpose: "共用工具" })),
    "<p>所在模組 <code>src/utils</code>：共用工具</p>",
  );
});

test("elements may open or close the sentence, appear twice, or be left out", () => {
  const key = createElement("kbd", null, "Shift");
  const other = createElement("kbd", null, "Enter");
  assert.equal(
    render(withNodes(({ key }: { key: string }) => `${key} selects lines`, { key })),
    "<p><kbd>Shift</kbd> selects lines</p>",
  );
  assert.equal(
    render(
      withNodes(
        ({ a, b }: { a: string; b: string }) => `Press ${b}, then ${a}, then ${b}`,
        { a: key, b: other },
      ),
    ),
    "<p>Press <kbd>Enter</kbd>, then <kbd>Shift</kbd>, then <kbd>Enter</kbd></p>",
  );
  assert.equal(
    render(withNodes(() => "No key needed", { key })),
    "<p>No key needed</p>",
  );
});
