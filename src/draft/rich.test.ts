import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { rich } from "./rich";

const html = (node: ReturnType<typeof rich>) =>
  renderToStaticMarkup(createElement(Fragment, null, node));

test("rich puts elements where the message places their parameters", () => {
  const en = ({ branch, commit }: { branch: string; commit: string }) =>
    `Based on ${branch} at ${commit}.`;
  // A translation may order the parameters differently.
  const zh = ({ branch, commit }: { branch: string; commit: string }) =>
    `以 ${branch} 的 ${commit} 為基準。`;
  const params = {
    branch: createElement("code", null, "main"),
    commit: createElement("code", null, "abc1234"),
  };
  assert.equal(
    html(rich(en, params)),
    "Based on <code>main</code> at <code>abc1234</code>.",
  );
  assert.equal(
    html(rich(zh, params)),
    "以 <code>main</code> 的 <code>abc1234</code> 為基準。",
  );
});

test("rich passes plain values through and shows an element only where its slot is", () => {
  const message = ({ count, link }: { count: number; link: string }) =>
    `${count} sources: ${link}, again ${link}`;
  assert.equal(
    html(rich(message, { count: 2, link: createElement("a", { href: "#s" }, "list") })),
    '2 sources: <a href="#s">list</a>, again <a href="#s">list</a>',
  );
  const dropped = ({ name }: { name: string }) => (name ? "No name here." : "");
  assert.equal(
    html(rich(dropped, { name: createElement("b", null, "x") })),
    "No name here.",
  );
  // Data text is escaped like any other text, never parsed as markup.
  assert.equal(
    html(rich(({ quote }: { quote: string }) => `“${quote}”`, { quote: "<b>&" })),
    "“&lt;b&gt;&amp;”",
  );
});
