// The respect checks of a Learn-by-hand run (shared/contribution.ts
// respectChecks with DraftPreflightInput.learnByHand): the input is set
// only for a clean Learn-by-hand run (byHandPreflight), and an agent run's
// checks never change.
import assert from "node:assert/strict";
import test from "node:test";
import { respectChecks, type ContributionRules } from "./contribution.js";
import type { ByHandPreflightInput } from "./draft-checks.js";

const disclosureRules: ContributionRules = {
  checkedAt: "2026-10-20T00:00:00.000Z",
  findings: [
    { kind: "disclose", path: "CONTRIBUTING.md", line: 12, quote: "If you used AI tools, say so in the PR description.", contribution: true },
  ],
  filesRead: ["CONTRIBUTING.md"],
};
const learnByHand: ByHandPreflightInput = {
  helps: ["explain", "answer", "review"],
  now: "2026-10-21T00:00:00.000Z",
};
const disclosureCheck = (body: string, byHand?: ByHandPreflightInput) =>
  respectChecks({ body, rules: disclosureRules, ...(byHand ? { learnByHand: byHand } : {}) }, "en").find(
    (check) => check.id === "ai-disclosure",
  );

test("the guide's help verbs satisfy a disclosure rule only for a clean Learn-by-hand run", () => {
  const honest = "Fixes the cap.\n\nClaude Code explained the parser and pointed out problems in my draft.";
  assert.equal(disclosureCheck(honest, learnByHand), undefined);
  // The same words in an agent run (or an unclean Learn-by-hand run, which gets no input) do not.
  assert.equal(disclosureCheck(honest)?.kind, "block");
  assert.equal(disclosureCheck("Fixes the cap.\n\nNot reviewed by AI.", learnByHand)?.kind, "block");
  assert.equal(disclosureCheck("Fixes the cap.\n\nI used Claude Code to explain the parser.")?.kind, undefined);
});
