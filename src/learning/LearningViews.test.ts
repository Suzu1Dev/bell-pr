import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  learningViewHref,
  LearningViewNav,
  parseLearningView,
} from "./LearningViews";

test("a view= value names a view; anything else is the notes", () => {
  assert.equal(parseLearningView("practice"), "practice");
  assert.equal(parseLearningView(undefined), "notes");
  assert.equal(parseLearningView("streams"), "notes");
  assert.equal(parseLearningView("__proto__"), "notes");
});

test("a view's address keeps the other flags, and the notes need no view=", () => {
  assert.equal(learningViewHref("practice"), "#/learning?view=practice");
  assert.equal(learningViewHref("notes"), "#/learning");
  const flags = { present: "1", view: "practice", locale: "en" };
  assert.equal(learningViewHref("notes", flags), "#/learning?present=1&locale=en");
  assert.equal(learningViewHref("practice", flags), "#/learning?present=1&locale=en&view=practice");
});

test("the views are links, and the one shown is the current page", () => {
  const html = renderEn(createElement(LearningViewNav, { view: "practice", flags: { locale: "en" } }));
  assertNoHan(html);
  assert.equal(
    html,
    '<nav class="learning-views" aria-label="Learning views">' +
      '<a href="#/learning?locale=en" data-view="notes">Notes</a>' +
      '<a href="#/learning?locale=en&amp;view=practice" aria-current="page" data-view="practice">Practice</a>' +
      "</nav>",
  );
  assert.match(renderZh(createElement(LearningViewNav, { view: "notes" })), /aria-current="page" data-view="notes">筆記<\/a>.*>練習<\/a>/);
});
