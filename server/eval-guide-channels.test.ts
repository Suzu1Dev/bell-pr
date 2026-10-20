// The guide eval's post-filter leak count (DESIGN v1.2 §9.3, threshold 0)
// covers every channel the person reads: code written into the prose
// without a fence or backticks, and code that forms in what BELL renders
// from a stored answer (the review's Markdown in the Reports tab, the chat
// answer in the Ask tab), not only fenced blocks and inline spans.
import test from "node:test";
import assert from "node:assert/strict";
import type { ByHandReview, GuideEntry } from "../shared/by-hand.js";
import { postFilterLeaks } from "./eval-guide.js";

const files = {
  "src/retry.js": "export async function withRetry(fn, attempts) {\n  for (let attempt = 0; attempt < attempts; attempt++) {\n    return await fn();\n  }\n}\n",
};
const sources = { files, worktree: {}, diff: "" };
const entry = (fields: Partial<GuideEntry>) => ({ id: "", at: "", kind: "hint", text: "", ...fields }) as GuideEntry;

test("code written into an answer's prose counts, with or without spaces", () => {
  for (const text of ["Write delay*2 there.", "Make it delayMs * 2 ** attempt; then test.", "Then retry(fn, 2) once more.", "Use attempt+1."])
    assert.equal(postFilterLeaks(entry({ text }), sources).length, 1, text);
  for (const fields of [{ ask: "Is it x=y?" }, { options: [{ name: "a&&b", tradeoff: "Short." }, { name: "Wait", tradeoff: "Simple." }] }])
    assert.equal(postFilterLeaks(entry(fields), sources).length, 1, JSON.stringify(fields));
  // Prose, refs and the files' own code stay clean.
  for (const text of ["Look at src/retry.js:2 first: the loop stops at attempts.", "It runs attempt < attempts times.", "Run it 24/7 in C++."])
    assert.deepEqual(postFilterLeaks(entry({ text }), sources), [], text);
});

test("code that forms when BELL renders a stored answer counts", () => {
  const review: ByHandReview = {
    at: "",
    changeFingerprint: "",
    verified: "No test run at this version.",
    checked: ["src/retry.js"],
    findings: [
      {
        path: "src/retry.js",
        line: 2,
        // Each line alone is prose; the Reports tab shows the field on one line: "delay * 2".
        observed: "The wait should be delay\n* 2 each time.",
        evidence: { type: "none" },
        why: "It never grows.",
        question: "What should the second wait be?",
      },
    ],
  };
  assert.equal(postFilterLeaks(review, sources).length, 1);
  assert.deepEqual(postFilterLeaks({ ...review, findings: [{ ...review.findings[0], observed: "The wait never grows." }] }, sources), []);
  // A chat answer is stored as BELL's Markdown: escapes in it are what Markdown shows.
  assert.equal(postFilterLeaks(entry({ kind: "chat", text: "Write delay\\*2 there." }), sources).length, 1);
  assert.deepEqual(postFilterLeaks(entry({ kind: "chat", text: "Look at src/retry.js:2." }), sources), []);
});
