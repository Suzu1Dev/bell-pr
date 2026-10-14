import assert from "node:assert/strict";
import test from "node:test";
import type { DraftSource } from "../../shared/drafts";
import { disclosureRule } from "./disclosure";

const source = (
  content: string,
  kind: DraftSource["kind"] = "contributing",
): DraftSource => ({ id: `${kind}:${content.length}`, kind, label: "CONTRIBUTING.md", content });

test("rules that ask contributors to disclose AI assistance are found and quoted", () => {
  for (const [line, quote] of [
    [
      "If you are using any kind of AI assistance to contribute, it must be disclosed in the pull request.",
      "If you are using any kind of AI assistance to contribute, it must be disclosed in the pull request.",
    ],
    ["- **Please disclose any use of AI tools** in your PR description.", "Please disclose any use of AI tools in your PR description."],
    ["AI-assisted contributions must be clearly marked as such.", "AI-assisted contributions must be clearly marked as such."],
    ["Tell us if you used an LLM to write the change.", "Tell us if you used an LLM to write the change."],
    ["You must declare the use of generative tools.", "You must declare the use of generative tools."],
    ["If you use AI tools, you must disclose it in the pull request.", "If you use AI tools, you must disclose it in the pull request."],
    ["When an LLM wrote part of the code, please clearly mention that.", "When an LLM wrote part of the code, please clearly mention that."],
  ])
    assert.deepEqual(
      disclosureRule([source(`# Contributing\n\nSome intro.\n\n${line}\n`)]),
      { sourceId: `contributing:${`# Contributing\n\nSome intro.\n\n${line}\n`.length}`, label: "CONTRIBUTING.md", quote },
      line,
    );
  // A template heading or checkbox names the disclosure.
  assert.equal(
    disclosureRule([source("## Summary\n\n## AI disclosure\n\n- [ ] Done", "template")])?.quote,
    "AI disclosure",
  );
  assert.equal(
    disclosureRule([source("- [ ] AI usage disclosed below", "template")])?.quote,
    "AI usage disclosed below",
  );
});

test("other lines, other sources, code and negations are not disclosure rules", () => {
  for (const content of [
    "Please state your aim in the PR description.",
    "We use AI to triage issues.",
    "AI-generated contributions are not accepted.",
    "AI tools must not be used to write tests.",
    "You do not need to disclose which editor or AI tool you used.",
    "```\nPlease disclose any use of AI tools.\n```",
    "<!-- Please disclose any use of AI tools. -->",
    "Every PR must reference an existing issue.",
  ])
    assert.equal(disclosureRule([source(content)]), undefined, content);
  // Only contributing guides and templates count, like the other rule quotes.
  assert.equal(
    disclosureRule([source("Please disclose any use of AI tools.", "documentation")]),
    undefined,
  );
  assert.equal(disclosureRule([]), undefined);
});
