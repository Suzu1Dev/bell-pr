import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ContributionOpportunity } from "../../shared/discovery";
import { getSampleDiscoveryJob } from "../demo/discovery";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { LearnByHandFooter } from "./LearnByHandFooter";

const sample = getSampleDiscoveryJob("en").opportunities.find((item) => item.learnByHand)!;
const llvm = 'Using AI tools to fix issues labelled as "good first issues" is forbidden.';
const matplotlib = "Note that pull requests that are AI generated will be closed for good first issues.";
/** An opportunity whose evidence quotes `quote` as its second item. */
const card = (extra: Partial<ContributionOpportunity>, quote = llvm): ContributionOpportunity => ({
  ...sample,
  learnByHand: true,
  evidence: [
    { sourceId: "s1", quote: "Fix the focus ring on the date picker.", reason: "The issue." },
    { sourceId: "s2", quote, reason: "The contributing guide." },
  ],
  ...extra,
});
const footer = (item: ContributionOpportunity, choosing = false) =>
  createElement(LearnByHandFooter, {
    item,
    issueLink: "https://github.com/example/widgets/issues/1",
    choosing,
    disabled: choosing,
    onStart() {},
  });
const start = /<button type="button" class="button primary"><svg[^>]*lucide-hand[\s\S]*?<\/svg>Start learning by hand<\/button>/;

test("a newcomer issue offers to start learning by hand next to opening it", () => {
  const html = renderEn(footer(card({})));
  assertNoHan(html);
  assert.match(html, start);
  assert.match(html, /Open the issue/);
  assert.doesNotMatch(html, /by-hand-note|<blockquote>/);
  assert.match(renderEn(footer(card({}), true)), /Importing the project…<\/button>/);
  assert.match(renderZh(footer(card({}))), /開始親手學/);
});

test("an issue the project keeps for people learning without AI tools never offers it, and quotes the rule", () => {
  const html = renderEn(footer(card({ byHandReserved: true, byHandReservedQuote: llvm })));
  assertNoHan(html);
  assert.doesNotMatch(html, /Start learning by hand/);
  assert.match(
    html,
    /<p class="by-hand-note">BELL PR won&#x27;t publish a learn-by-hand run for this issue: the project keeps it for people learning without AI tools\.<\/p>/,
  );
  assert.ok(html.includes(`<blockquote>${llvm.replaceAll('"', "&quot;")}</blockquote>`));
  // The issue still opens, to read.
  assert.match(html, /Open the issue/);
});

test("an issue whose rule is about AI-generated pull requests keeps the button, with the warning", () => {
  const html = renderEn(footer(card({ byHandReserved: true, byHandReservedOutput: true }, matplotlib)));
  assertNoHan(html);
  assert.match(html, start);
  assert.ok(
    html.includes(
      "This project closes AI-generated pull requests for issues like this one. BELL PR can publish a learn-by-hand run for it only if the project&#x27;s own text names each kind of help the guide gives, and only after you confirm the quoted rule; the task dialog shows which.",
    ),
  );
  // Discovery reads only the evidence, so it never promises the confirm.
  assert.doesNotMatch(html, /<blockquote>/);
});
