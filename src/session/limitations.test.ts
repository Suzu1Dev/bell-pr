import assert from "node:assert/strict";
import test from "node:test";
import { sessionInputLimit } from "../../shared/session";
import { limitationsRequest } from "./limitations";
import {
  limitationsSection,
  draftCheckSections,
  replaceDraftCheckSections,
} from "../../shared/limitations";

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
  assert.equal(
    limitationsSection(body),
    "## Limitations\n- npm test was not run.",
  );
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
  const body =
    "Limitations are listed below.\n## Validation\nok\n## Limitations\nno browser test";
  assert.equal(limitationsSection(body), "## Limitations\nno browser test");
  assert.equal(
    limitationsSection("Limitations are listed below.\n## Changes\nx"),
    undefined,
  );
});

test("a bold label opens a section that ends at the next bold label or heading", () => {
  const body =
    "**Limitations**\n- not run\n\n**Validation**\n- ok\n\n## Next\nx";
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
  const body =
    "## Summary\nDoes x.\n\n## Limitations\n- `make check` was not run.\n\n## Notes\nNone.";
  assert.equal(
    replaceDraftCheckSections(body, { limitations: "\n- Not run: macOS.\n" })
      ?.body,
    "## Summary\nDoes x.\n\n## Limitations\n- Not run: macOS.\n\n## Notes\nNone.",
  );
  // A section at the end of the text, and one with a blank line under its heading.
  assert.equal(
    replaceDraftCheckSections("## Limitations\n\nold\n", { limitations: "new" })
      ?.body,
    "## Limitations\n\nnew\n",
  );
  // A template's nested headings must not disappear in a whole-body replacement.
  assert.equal(
    replaceDraftCheckSections(
      "## Limitations\nold\n### Detail\nmore\n## After\nkept",
      { limitations: "new" },
    ),
    undefined,
  );
  assert.equal(
    replaceDraftCheckSections("## Summary\nx", { limitations: "new" }),
    undefined,
  );
});

test("validation and limitations replacements preserve heading style, order and unrelated prose", () => {
  const body =
    "## Problem\nKeep exactly.\n\n**Limitations**\nold gaps\n\n## Changes\nKeep this too.\n\n**Validation**\nold checks\n\n## Notes\nKeep notes.";
  assert.deepEqual(draftCheckSections(body), {
    validation: "**Validation**\nold checks",
    limitations: "**Limitations**\nold gaps",
  });
  const updated = replaceDraftCheckSections(body, {
    validation: "- Local check exited 0.",
    limitations: "- Not run: macOS.",
  });
  assert.equal(
    updated?.body,
    "## Problem\nKeep exactly.\n\n**Limitations**\n- Not run: macOS.\n\n## Changes\nKeep this too.\n\n**Validation**\n- Local check exited 0.\n\n## Notes\nKeep notes.",
  );
  assert.equal(
    updated?.before,
    "**Limitations**\nold gaps\n\n**Validation**\nold checks",
  );
  assert.equal(
    updated?.after,
    "**Limitations**\n- Not run: macOS.\n\n**Validation**\n- Local check exited 0.",
  );
});

test("combined, nested, duplicated and fenced headings cannot become overlapping draft edits", () => {
  for (const body of [
    "## Validation and Limitations\nMixed text.",
    "## 驗證與限制\nMixed text.",
    "## Limitations\nA gap.\n### Validation\nA nested result.",
    "## Validation\nOne.\n## Validation\nTwo.\n## Limitations\nGap.",
    "## Validation\n### Unit tests\nOne.\n### Integration tests\nTwo.\n## Limitations\nGap.",
    "## Validation\n**Unit tests**\nOne.\n## Limitations\nGap.",
    "```md\n## Validation\nAn example.\n```\n## Limitations\nGap.",
  ]) {
    assert.equal(draftCheckSections(body).validation, undefined);
    assert.equal(
      replaceDraftCheckSections(body, {
        validation: "Result.",
        limitations: "Remaining gap.",
      }),
      undefined,
    );
  }
  assert.deepEqual(draftCheckSections("## 驗證與限制\nMixed text."), {});
});

test("grouped edits reject injected headings and absent targets without losing the other section", () => {
  const body = "## Validation\nOld.\n## Limitations\nGap.\n## Changes\nKeep.";
  for (const validation of ["## Changes\nWrong.", "**Problem**\nWrong."])
    assert.equal(
      replaceDraftCheckSections(body, {
        validation,
        limitations: "No remaining gaps in the requested scope.",
      }),
      undefined,
    );
  assert.equal(
    replaceDraftCheckSections("## Limitations\nGap.", {
      validation: "Result.",
      limitations: "Changed.",
    }),
    undefined,
  );
  assert.equal(
    replaceDraftCheckSections(body, {
      validation: "Old.",
      limitations: "Gap.",
    }),
    undefined,
  );
});

test("separate Chinese labels, empty targets and CRLF text retain their original structure", () => {
  const body = "## 問題\r\nKeep.\r\n\r\n## 驗證\r\n\r\n## 限制\r\nGap.\r\n";
  const result = replaceDraftCheckSections(body, {
    validation: "Observed result.",
    limitations: "Remaining gap.",
  });
  assert.equal(
    result?.body,
    "## 問題\r\nKeep.\r\n\r\n## 驗證\r\n\r\nObserved result.\r\n\r\n## 限制\r\nRemaining gap.\r\n",
  );
});
