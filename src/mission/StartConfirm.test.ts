import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { StartConfirm, startReasonsKey, type StartReason } from "./StartConfirm";

const confirm = (reasons: StartReason[]) =>
  createElement(StartConfirm, { reasons, onConfirm() {}, onCancel() {} });
const lines = (html: string) => [...html.matchAll(/<li>([^<]+)<\/li>/g)].map((match) => match[1]);

test("each reason is one whole sentence: practise locally, BELL won't publish it while …", () => {
  const html = renderEn(
    confirm([
      { id: "issue-closed" },
      { id: "other-pr", author: "other_dev", number: 9 },
      { id: "door" },
      { id: "ban" },
      { id: "area" },
      { id: "pacing", open: 2, budget: 1 },
    ]),
  );
  assertNoHan(html);
  assert.match(html, /<h3 id="start-confirm-[^"]+" tabindex="-1"><svg[\s\S]*?<\/svg> Before the team starts<\/h3>/);
  assert.deepEqual(lines(html), [
    "You can practise this locally; BELL PR won&#x27;t publish it while the linked issue is closed.",
    "You can practise this locally; BELL PR won&#x27;t publish it while @other_dev&#x27;s pull request #9 would close the same issue, unless you give your reason when you publish.",
    "You can practise this locally; BELL PR won&#x27;t publish it while this repository doesn&#x27;t take pull requests from you.",
    "You can practise this locally; BELL PR won&#x27;t publish it while the project&#x27;s rules don&#x27;t accept AI-assisted contributions.",
    "You can practise this locally; BELL PR won&#x27;t publish it while the project keeps issues labelled for newcomers for people learning without AI tools.",
    "You can practise this locally; BELL PR won&#x27;t publish it while you have 2 open pull requests here, at least twice your budget of 1.",
  ]);
  assert.match(html, /<button type="button" class="button secondary">Back<\/button><button type="button" class="button primary"><svg[\s\S]*?<\/svg>Start and practise locally<\/button>/);
});

test("a pull request number reads as GitHub writes it, without digit grouping", () => {
  const reasons: StartReason[] = [{ id: "other-pr", author: "other_dev", number: 12345 }];
  assert.match(renderEn(confirm(reasons)), /pull request #12345 would close/);
  assert.match(renderZh(confirm(reasons)), /Pull Request #12345 會關閉/);
});

test("the good-first-issue lesson is two sentences and a pointer to help-wanted issues", () => {
  const html = renderEn(confirm([{ id: "learning" }]));
  assertNoHan(html);
  assert.deepEqual(lines(html), [
    "Issues labelled for newcomers are how people learn a project by writing the fix themselves. When an agent team takes one, the next newcomer loses that chance. Consider a help-wanted issue instead.",
  ]);
  assert.match(html, /Start anyway<\/button>/);
  assert.match(renderZh(confirm([{ id: "learning" }])), /仍要開始/);
  assert.match(renderZh(confirm([{ id: "door" }])), /你可以在本機練習/);
});

test("the reasons' key changes with the reasons, so Start asks again for new ones", () => {
  assert.equal(startReasonsKey([]), "[]");
  assert.notEqual(startReasonsKey([{ id: "door" }]), startReasonsKey([{ id: "ban" }]));
  assert.equal(startReasonsKey([{ id: "door" }]), startReasonsKey([{ id: "door" }]));
});
