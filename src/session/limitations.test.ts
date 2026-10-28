import assert from "node:assert/strict";
import test from "node:test";
import { sessionInputLimit } from "../../shared/session";
import { limitationsRequest } from "./limitations";
import { limitationsSection, replaceLimitationsBody } from "../../shared/limitations";

test("a level-2 limitations section runs to the next heading of the same level", () => {
  const body = [
    "## Problem",
    "The retry gives up too early.",
    "",
    "## Limitations",
    "- npm test was not run.",
    "",
    "## Next steps",
    "Ship it.",
  ].join("\n");
  assert.equal(limitationsSection(body), "## Limitations\n- npm test was not run.");
});

test("nested subheadings stay inside the limitations section", () => {
  const body = [
    "## Limitations",
    "Browser checks were skipped.",
    "### Safari",
    "- not opened",
    "## Changes",
    "x",
  ].join("\n");
  assert.equal(
    limitationsSection(body),
    "## Limitations\nBrowser checks were skipped.\n### Safari\n- not opened",
  );
});

test("a higher-level heading ends the limitations section", () => {
  const body = "### Limitations\nsome gap\n## Changes\nx";
  assert.equal(limitationsSection(body), "### Limitations\nsome gap");
});

test("no limitations heading yields undefined", () => {
  assert.equal(limitationsSection("## Problem\nx\n\n## Changes\ny"), undefined);
});

test("a Chinese heading that names limitations is found", () => {
  const body = "## 驗證與限制\n- 未跑 e2e\n\n## 下一步\n跟進";
  assert.equal(limitationsSection(body), "## 驗證與限制\n- 未跑 e2e");
});

test("text before the heading is ignored even when it mentions limitations", () => {
  const body = "Limitations are listed below.\n## Validation\nok\n## Limitations\nno browser test";
  assert.equal(limitationsSection(body), "## Limitations\nno browser test");
  assert.equal(limitationsSection("Limitations are listed below.\n## Changes\nx"), undefined);
});

test("a bold label opens a section that ends at the next bold label or heading", () => {
  const body = "**Limitations**\n- not run\n\n**Validation**\n- ok\n\n## Next\nx";
  assert.equal(limitationsSection(body), "**Limitations**\n- not run");
});

test("a heading inside a fenced code block is not a section", () => {
  const body = "```md\n## Limitations\nnot a section\n```\n## Changes\nx";
  assert.equal(limitationsSection(body), undefined);
});

test("a limitations heading with no text under it is skipped", () => {
  const body = "## Limitations\n\n## Changes\nx\n\n## 限制\n- 沒有執行測試";
  assert.equal(limitationsSection(body), "## 限制\n- 沒有執行測試");
});

test("the composer request states the task and keeps the section within one message", () => {
  const request = limitationsRequest("## Limitations\n- not run");
  assert.match(request, /^The PR draft’s Limitations section lists unfinished/);
  assert.ok(request.endsWith("## Limitations\n- not run"));
  const long = limitationsRequest("x".repeat(sessionInputLimit * 2));
  assert.equal(long.length, sessionInputLimit);
});

test("replacing the limitations text keeps the heading, the spacing and every other section", () => {
  const body = "## Summary\nDoes x.\n\n## Limitations\n- `make check` was not run.\n\n## Notes\nNone.";
  assert.equal(
    replaceLimitationsBody(body, "\n- `make check` passed.\n- Not run: macOS.\n"),
    "## Summary\nDoes x.\n\n## Limitations\n- `make check` passed.\n- Not run: macOS.\n\n## Notes\nNone.",
  );
  // A section at the end of the text, and one with a blank line under its heading.
  assert.equal(
    replaceLimitationsBody("## Limitations\n\nold\n", "new"),
    "## Limitations\n\nnew\n",
  );
  // Nested subheadings belong to the section and are replaced with it.
  assert.equal(
    replaceLimitationsBody("## Limitations\nold\n### Detail\nmore\n## After\nkept", "new"),
    "## Limitations\nnew\n## After\nkept",
  );
  assert.equal(replaceLimitationsBody("## Summary\nx", "new"), undefined);
});
