import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { SessionPanel } from "./SessionPanel";

const props = {
  run: { ...getDemo("en").run, id: "run-session", status: "review" as const },
  draft: "",
  onDraftChange() {},
  onRun() {},
  onOpenFile() {},
};

test("the collaboration composer follows both UI languages", () => {
  const en = renderEn(createElement(SessionPanel, props));
  assert.match(en, /Collaborate with the agent/);
  assert.match(en, /Message to the agent/);
  assertNoHan(en);
  const zh = renderZh(createElement(SessionPanel, props));
  assert.match(zh, /和 Agent 協作/);
  assert.match(zh, /傳給 Agent 的訊息/);
});

test("a running turn offers cancellation and disables the composer", () => {
  const run = { ...props.run, session: { running: true, messages: [], revision: 0, updatedAt: "2026-10-28T00:00:00Z", startedAt: "2026-10-28T00:00:00Z" } };
  const html = renderEn(createElement(SessionPanel, { ...props, run }));
  assert.match(html, /Current agent progress/);
  assert.match(html, />Stop<\/button>/);
  assert.match(html, /<textarea[^>]*disabled=""/);
});
