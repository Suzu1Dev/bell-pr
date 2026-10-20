import assert from "node:assert/strict";
import test from "node:test";
import { insertTemplate } from "./ByHandHelpers";

const template = "## Summary\n\n## Testing\n";

test("a PR template fills an empty description, verbatim", () => {
  assert.equal(insertTemplate("", template), template);
  assert.equal(insertTemplate("  \n", template, 1), template);
});

test("a PR template goes in at the cursor as a paragraph of its own, and nothing written is replaced", () => {
  const body = "I fixed the retry cap.\nIt was off by one.";
  // Without a cursor, at the end.
  assert.equal(insertTemplate(body, template), `${body}\n\n${template}`);
  assert.equal(insertTemplate(`${body}\n`, template), `${body}\n\n${template}`);
  // At the start, and after the first line.
  assert.equal(insertTemplate(body, template, 0), `${template}\n${body}`);
  assert.equal(insertTemplate(body, template, 23), `I fixed the retry cap.\n\n${template}\nIt was off by one.`);
  // A selection is never overwritten: the template follows it.
  for (const at of [-5, 0, 10, 23, body.length, body.length + 9]) {
    const result = insertTemplate(body, template, at);
    assert.ok(result.includes(template));
    assert.equal(result.replace(template, "").replace(/\n/g, ""), body.replace(/\n/g, ""), String(at));
  }
});
