import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { TeamPage } from "./TeamPage";

test("the agent team page reads in English with no Chinese left", () => {
  const html = renderEn(createElement(TeamPage, { beginContribution() {} }));
  assert.match(html, /<h1 tabindex="-1">One goal, one agent team\.<\/h1>/);
  assert.match(html, /2 to 4 teammates · Shared task board/);
  assert.match(html, /Uses the Codex or Claude Code CLI signed in on this computer\./);
  assertNoHan(html);
  assert.match(
    renderZh(createElement(TeamPage, { beginContribution() {} })),
    /<h1 tabindex="-1">一個目標，一支 Agent team。<\/h1>/,
  );
  assert.match(
    renderZh(createElement(TeamPage, { beginContribution() {} })),
    /2 至 4 位 Teammates · 共享任務板/,
  );
});
