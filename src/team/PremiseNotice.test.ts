import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactElement } from "react";
import type { PremiseCheck } from "../../shared/team";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { PremiseNotice } from "./PremiseNotice";

const premise: PremiseCheck = {
  verdict: "refuted",
  statement: "呼叫端把自己產生的 id 交給瀏覽器。",
  evidence: "src/web/interviews.rs:195 回傳的是 interview.id。",
};
const render = (value?: PremiseCheck, compact = false) =>
  renderZh(createElement(PremiseNotice, { premise: value, compact }));

test("a premise check names its verdict, the assumption and the evidence, and says who made it", () => {
  const html = render(premise);
  assert.match(html, /premise-refuted/);
  assert.match(html, /前提查核：假設不成立/);
  assert.match(html, /呼叫端把自己產生的 id 交給瀏覽器。/);
  assert.match(html, /src\/web\/interviews\.rs:195/);
  assert.match(html, /由 Lead 閱讀程式碼得出/);
  assert.match(render({ ...premise, verdict: "holds" }), /假設成立/);
  assert.match(render({ ...premise, verdict: "unclear" }), /無法確認假設/);
  // Compact keeps the evidence folded under a one-line summary.
  assert.match(render(premise, true), /<details><summary>.*假設不成立.*<span>呼叫端把自己產生的 id/);
  assert.equal(render(undefined), "");
});

test("the premise check reads in English, and a verdict word from a later build reads as unclear", () => {
  const english = renderEn(createElement(PremiseNotice, { premise: { ...premise, statement: "The caller hands over an id it made.", evidence: "src/web/interviews.rs:195 returns interview.id." } }));
  assertNoHan(english);
  assert.match(english, /Premise check: the assumption does not hold/);
  assert.match(english, /Found by the lead reading the code/);
  const later = render({ ...premise, verdict: "partly" as PremiseCheck["verdict"] });
  assert.match(later, /premise-unclear/);
  assert.match(later, /無法確認假設/);
});


test("in a Learn-by-hand run the premise check says the guide found it", () => {
  const english = renderEn(createElement(PremiseNotice, { premise, guide: true }));
  assert.match(english, /Found by the guide reading the code; check it against the cited lines\./);
  assert.doesNotMatch(english, /the lead/);
  assert.match(renderEn(createElement(PremiseNotice, { premise, compact: true, guide: true })), /Found by the guide reading the code/);
  assert.match(renderZh(createElement(PremiseNotice, { premise, guide: true })), /由嚮導閱讀程式碼得出/);
});

type DetailsProps = {
  onKeyDown?: (event: unknown) => void;
  onBlur?: (event: unknown) => void;
};

/** The compact notice's <details> as PremiseNotice returns it, so its handlers can be called. */
function compactDetails(): DetailsProps {
  const captured: { notice?: ReactElement<{ children: ReactElement<DetailsProps> }> } = {};
  renderEn(
    createElement(function Capture() {
      captured.notice = PremiseNotice({ premise, compact: true }) as typeof captured.notice;
      return captured.notice ?? null;
    }),
  );
  const details = captured.notice!.props.children;
  assert.equal(details.type, "details");
  return details.props;
}

/** An open <details> holding `inside`, in a page that has the focus unless `pageFocused` is false. */
function openDetails(inside: object[] = [], pageFocused = true) {
  const summary = { focused: false, focus: () => void (summary.focused = true) };
  const details = {
    open: true,
    summary,
    contains: (node: unknown) => node === details || node === summary || inside.includes(node as object),
    querySelector: (selector: string) => (selector === "summary" ? summary : null),
    ownerDocument: { hasFocus: () => pageFocused },
  };
  return details;
}

test("the open evidence folds when focus moves on or on Escape, so it never hides the focused control", () => {
  const { onKeyDown, onBlur } = compactDetails();
  assert.ok(onKeyDown && onBlur, "the compact premise check handles Escape and focus leaving it");
  const evidence = { closest: () => null };
  // Moving from the summary into the evidence keeps it open.
  const details = openDetails([evidence]);
  onBlur({ currentTarget: details, relatedTarget: evidence });
  assert.equal(details.open, true);
  // Tab past the toolbar lands on Whole file or Reviewed under the overlay: it folds, and focus stays there.
  onBlur({ currentTarget: details, relatedTarget: { closest: () => null } });
  assert.equal(details.open, false);
  assert.equal(details.summary.focused, false);
  // A dialog over the page (help, command palette) keeps it, so the focus can come back to the evidence.
  const covered = openDetails([evidence]);
  onBlur({ currentTarget: covered, relatedTarget: { closest: () => ({ role: "dialog" }) } });
  assert.equal(covered.open, true);
  // A click on the page outside it folds it too.
  const clicked = openDetails();
  onBlur({ currentTarget: clicked, relatedTarget: null });
  assert.equal(clicked.open, false);
  // Leaving the window keeps it, so the reader can check the cited lines in another app.
  const away = openDetails([], false);
  onBlur({ currentTarget: away, relatedTarget: null });
  assert.equal(away.open, true);

  // Escape folds it and puts focus back on its summary, and the page does not see the key (focus mode stays on).
  let stopped = 0;
  const keyDown = (currentTarget: ReturnType<typeof openDetails>, key: string) =>
    onKeyDown({ key, currentTarget, stopPropagation: () => void stopped++ });
  const escaped = openDetails();
  keyDown(escaped, "Escape");
  assert.equal(escaped.open, false);
  assert.equal(escaped.summary.focused, true);
  assert.equal(stopped, 1);
  // Folded, Escape is the page's again; other keys leave it open.
  keyDown(escaped, "Escape");
  assert.equal(stopped, 1);
  const typed = openDetails();
  keyDown(typed, "Tab");
  assert.equal(typed.open, true);
  assert.equal(stopped, 1);
});
