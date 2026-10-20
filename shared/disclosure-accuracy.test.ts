// Headroom item 2 (DESIGN v1.2 F13, §11.2): in a Learn-by-hand run the
// guide helped with, a line of the PR text that says no AI helped is quoted
// next to the record in a non-persisted confirm, `disclosure-accuracy`.
// It is never a block and never calls the line true or false.
import assert from "node:assert/strict";
import test from "node:test";
import { respectChecks } from "./contribution.js";
import type { ByHandPreflightInput } from "./draft-checks.js";
import { aiDisclosureLine } from "./drafts.js";
import { assistanceDenial } from "./project-policy.js";

test("assistanceDenial quotes the first line that says no AI helped", () => {
  const cases: [string, string, string | undefined][] = [
    ["Fixes the cap.\n\nNo AI tools were used.", "", "No AI tools were used."],
    ["## Summary\nNo AI tools were used.", "", "No AI tools were used."],
    ["## Summary\n- Fixes the cap\n- No AI-generated code", "", "No AI-generated code"],
    ["Fixes the cap.\n\n1. No LLM was involved.", "", "No LLM was involved."],
    ["Written without AI assistance.", "", "Written without AI assistance."],
    ["The tests were not AI-generated.", "", "The tests were not AI-generated."],
    ["AI usage disclosure: NO", "", "AI usage disclosure: NO"],
    // A wrapped commit message joins its paragraph; the subject stays apart.
    ["Fixes the cap.", "Cap the retry delay\n\nThis change was written without\nAI assistance.", "This change was written without AI assistance."],
    // A denial clause of its own, even next to a disclosure.
    ["No AI wrote code; the guide explained the parser.", "", "No AI wrote code; the guide explained the parser."],
    [`Fixes the cap.\n\n${aiDisclosureLine}`, "", aiDisclosureLine],
    // Not a denial: no AI named, the guide's help named, a disclosure, code.
    ["No behavior change for existing callers.", "", undefined],
    ["I did not use AI except to have the guide explain the parser.", "", undefined],
    ["Claude Code explained the parser and pointed out problems in my draft.", "", undefined],
    ["Fixes the cap.\n\n```\n// No AI tools were used.\n```", "", undefined],
    ["Fixes the cap.\n\n<!-- No AI tools were used. -->", "", undefined],
  ];
  for (const [body, commitMessage, expected] of cases)
    assert.equal(assistanceDenial(body, commitMessage), expected, `${body} | ${commitMessage}`);
});

const helped: ByHandPreflightInput = { helps: ["explain", "review"], now: "2026-10-21T00:00:00.000Z" };
const accuracy = (body: string, learnByHand?: ByHandPreflightInput, locale: "en" | "zh-TW" = "en") =>
  respectChecks({ body, ...(learnByHand ? { learnByHand } : {}) }, locale).filter(
    (check) => check.id === "disclosure-accuracy",
  );

test("a Learn-by-hand run the guide helped with gets one confirm that quotes the line next to the record", () => {
  const body = "Caps the retry delay.\n\nNo AI tools were used.";
  assert.deepEqual(accuracy(body, helped), [
    {
      id: "disclosure-accuracy",
      kind: "confirm",
      message:
        'Your text says "No AI tools were used.". In this run BELL PR\'s guide gave you explanations and reviews. If that line means something else, confirm; otherwise reword it.',
      // The record it stands next to says the claim and what BELL can't see.
      details: ["You used: explanations and reviews."],
    },
  ]);
  const [zh] = accuracy(body, helped, "zh-TW");
  assert.equal(zh.kind, "confirm");
  assert.ok(zh.message.includes("「No AI tools were used.」"));
  // The commit message counts as well.
  assert.equal(
    respectChecks({ body: "Caps the retry delay.", commitMessage: "Cap the delay\n\nWritten without AI assistance.", learnByHand: helped })
      .filter((check) => check.id === "disclosure-accuracy").length,
    1,
  );
});

test("no confirm without the guide's help, in an agent run, or without a denial", () => {
  const body = "Caps the retry delay.\n\nNo AI tools were used.";
  assert.deepEqual(accuracy(body, { helps: [], now: helped.now }), []);
  // An agent run (or an unclean Learn-by-hand run, which gets no input) never gets it.
  assert.deepEqual(accuracy(body), []);
  assert.deepEqual(accuracy(`Caps the retry delay.\n\n${aiDisclosureLine}`), []);
  assert.deepEqual(accuracy("Caps the retry delay.\n\nThe guide explained the backoff.", helped), []);
  // It is never a block.
  assert.ok(respectChecks({ body, learnByHand: helped }).every((check) => check.kind === "confirm"));
});
