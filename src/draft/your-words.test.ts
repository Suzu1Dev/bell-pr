import assert from "node:assert/strict";
import test from "node:test";
import { aiDisclosureLine } from "../../shared/drafts";
import {
  hasCjk,
  includesText,
  insertSummary,
  insertUntested,
  notTestedLabel,
} from "./your-words";

const summary = "Retries now wait longer each time, and a 503 is retried.";
const untested = "I did not test a server that sends Retry-After.";

test("the summary opens the first section, after its heading", () => {
  assert.equal(
    insertSummary("## Summary\n\n- Adds retries.\n\n## Testing\n\n- npm test", summary),
    `## Summary\n\n${summary}\n\n- Adds retries.\n\n## Testing\n\n- npm test`,
  );
  // Text before the first heading stays where it is; the summary goes under the heading.
  assert.equal(
    insertSummary("Fixes #42\n\n# Motivation\n<!-- why -->\nText.", summary),
    `Fixes #42\n\n# Motivation\n\n${summary}\n\n<!-- why -->\nText.`,
  );
  // An empty first section.
  assert.equal(insertSummary("## Summary\n", summary), `## Summary\n\n${summary}`);
});

test("without a heading the summary goes at the top", () => {
  assert.equal(insertSummary("Adds retries.", summary), `${summary}\n\nAdds retries.`);
  assert.equal(insertSummary("\n\nAdds retries.", summary), `${summary}\n\nAdds retries.`);
  assert.equal(insertSummary("", summary), summary);
  // A heading inside a code block is not one.
  assert.equal(
    insertSummary("```md\n## Not a heading\n```", summary),
    `${summary}\n\n\`\`\`md\n## Not a heading\n\`\`\``,
  );
  assert.equal(insertSummary("Body", "   "), "Body");
});

test("the not-tested answer goes at the end of the Testing section", () => {
  assert.equal(
    insertUntested("## Summary\n\nAdds retries.\n\n## How was this tested?\n\n- npm test\n\n## Notes\n\nNone.", untested),
    `## Summary\n\nAdds retries.\n\n## How was this tested?\n\n- npm test\n\n${untested}\n\n## Notes\n\nNone.`,
  );
  // A deeper heading inside the section belongs to it.
  assert.equal(
    insertUntested("## Testing\n\n### Unit\n\n- npm test\n\n## Notes", untested),
    `## Testing\n\n### Unit\n\n- npm test\n\n${untested}\n\n## Notes`,
  );
  // The last section, and an empty one.
  assert.equal(insertUntested("## Tests\n\n- ok\n", untested), `## Tests\n\n- ok\n\n${untested}`);
  assert.equal(insertUntested("## Tests", untested), `## Tests\n\n${untested}`);
});

test("without a Testing heading the answer is a Not tested paragraph at the end", () => {
  assert.equal(
    insertUntested("## Summary\n\nAdds retries.\n\n## Validation\n\nRan it.\n", untested),
    `## Summary\n\nAdds retries.\n\n## Validation\n\nRan it.\n\n${notTestedLabel} ${untested}`,
  );
  assert.equal(insertUntested("", untested), `${notTestedLabel} ${untested}`);
  assert.equal(notTestedLabel, "**Not tested:**");
});

test("BELL's AI-disclosure line stays the last line", () => {
  const body = `## Summary\n\nAdds retries.\n\n${aiDisclosureLine}`;
  assert.equal(
    insertUntested(body, untested),
    `## Summary\n\nAdds retries.\n\n${notTestedLabel} ${untested}\n\n${aiDisclosureLine}`,
  );
  const tested = `## Testing\n\n- npm test\n\n${aiDisclosureLine}`;
  assert.equal(insertUntested(tested, untested), `## Testing\n\n- npm test\n\n${untested}\n\n${aiDisclosureLine}`);
});

test("CJK text and text already in the description are recognized", () => {
  assert.equal(hasCjk("This retries GET requests."), false);
  assert.equal(hasCjk("重試 GET 請求"), true);
  assert.equal(hasCjk("リトライ"), true);
  assert.equal(hasCjk("재시도"), true);
  assert.equal(includesText(`x\n\n${summary}\n`, ` ${summary} `), true);
  assert.equal(includesText("x", summary), false);
  assert.equal(includesText("x", "  "), false);
});
