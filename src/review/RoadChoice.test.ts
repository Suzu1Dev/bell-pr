import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import en from "../i18n/en";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import {
  RoadChoice,
  RoadChoiceView,
  type RoadChoiceProps,
  type RoadChoiceViewProps,
} from "./RoadChoice";

const t = en.review.tryFirst;
const alternatives =
  "A fixed interval with jitter is simpler, but the retries still bunch up.";
const lookup = ["exponential backoff", "full jitter"];
const sample = {
  guess: "Wait the same short time between tries.",
  why: "A fixed wait still floods an overloaded server.",
};

const road = (props: Partial<RoadChoiceProps> = {}) =>
  renderEn(createElement(RoadChoice, { alternatives, lookup, demo: false, ...props }));

const view = (props: Partial<RoadChoiceViewProps>) =>
  renderEn(
    createElement(RoadChoiceView, {
      alternatives,
      lookup,
      demo: false,
      guess: "",
      revealed: false,
      revealing: false,
      why: "",
      canSaveWhy: false,
      saved: false,
      typing: false,
      onGuess() {},
      onReveal() {},
      onChoice() {},
      onWhy() {},
      onSaveWhy() {},
      onFillGuess() {},
      onFillWhy() {},
      ...props,
    }),
  );

const lookupChips =
  '<p class="explain-lookup"><span>Look up:</span><code>exponential backoff</code><code>full jitter</code></p>';

test("before you look, the card asks for a guess and keeps the alternative out of the markup", () => {
  const markup = road();
  assertNoHan(markup);
  for (const text of ["What if it were done differently?", t.badge, t.road.reveal])
    assert.ok(markup.includes(text), text);
  const field = /<label class="tf-label" for="([^"]+)">Before you look: how else could this be done\?<\/label><textarea id="\1"[^>]*>/.exec(
    markup,
  );
  assert.ok(field, "labelled guess field");
  assert.match(field[0], /maxLength="300"/i);
  assert.match(field[0], /placeholder="Optional, one line"/);
  assert.ok(!markup.includes(alternatives));
  assert.ok(!markup.includes('role="radiogroup"'));
  assert.match(markup, /<div class="tf-reference" aria-live="polite"><\/div>/);
  // The lookup chips stay as they are, at the foot of the card.
  assert.ok(markup.includes(lookupChips));
  assert.ok(!markup.includes(t.fill));
  // While a guess is being saved, the alternative is still not there.
  const saving = view({ guess: sample.guess, revealing: true });
  assert.match(saving, /aria-busy="true"[^>]*>.*Saving…<\/button>/);
  assert.ok(!saving.includes(alternatives));
});

test("after the reveal, the guess sits above the alternative and the choice is a radio group", () => {
  const markup = road({ saved: { guess: sample.guess } });
  assertNoHan(markup);
  assert.ok(!markup.includes(t.road.reveal));
  assert.match(
    markup,
    /<div class="tf-reference" aria-live="polite"><div class="tf-reference-body"><div class="tf-yours"><p class="tf-label">Your guess<\/p><p class="tf-yours-text">Wait the same short time between tries\.<\/p><\/div><div class="markdown-content"><p>A fixed interval/,
  );
  const group = /<div class="tf-chips" role="radiogroup" aria-labelledby="([^"]+)" tabindex="-1" data-focus="choices">([\s\S]*?)<\/div>/.exec(
    markup,
  );
  assert.ok(group, "choice radiogroup");
  assert.match(
    markup,
    new RegExp(`<p class="tf-label" id="${group[1]}">For this project, which would you choose\\?</p>`),
  );
  assert.deepEqual(
    [...group[2].matchAll(/type="radio"[^>]*value="(\w+)"[^>]*\/>([^<]+)<\/label>/g)].map(
      ([, value, label]) => `${value}:${label}`,
    ),
    ["keep:Keep this approach", "switch:Prefer the other", "depends:It depends"],
  );
  assert.ok(!group[2].includes("checked"), "nothing chosen yet");
  const why = /<label class="tf-label" for="([^"]+)">Why\? \(optional, one line\)<\/label><textarea id="\1"[^>]*>/.exec(
    markup,
  );
  assert.ok(why, "labelled why field");
  assert.match(why[0], /maxLength="300"/i);
  // Nothing to save until a choice and a why exist.
  assert.match(markup, /<button type="button" class="tf-button" disabled="">Save<\/button>/);
  assert.match(markup, /<span class="tf-status" role="status"><\/span>/);
  assert.ok(markup.includes(lookupChips));
});

test("a saved choice and why come back checked and filled", () => {
  const markup = road({ saved: { choice: "keep", why: sample.why } });
  assertNoHan(markup);
  const checked = [...markup.matchAll(/<input type="radio"[^>]*\/>/g)]
    .filter(([input]) => input.includes('checked=""'))
    .map(([input]) => /value="(\w+)"/.exec(input)![1]);
  assert.deepEqual(checked, ["keep"]);
  assert.ok(markup.includes(`>${sample.why}</textarea>`));
  // Without a guess there is no guess block.
  assert.ok(!markup.includes(t.road.yourGuess));
  assert.match(view({ revealed: true, choice: "keep", why: "Because.", canSaveWhy: true }), /<button type="button" class="tf-button">Save<\/button>/);
  assert.match(view({ revealed: true, choice: "keep", saved: true }), /<span class="tf-status" role="status">Saved<\/span>/);
});

test("the demo types the sample guess and why; a real run never offers it", () => {
  const before = road({ demo: true, sample });
  assertNoHan(before);
  assert.equal(before.match(/class="tf-button tf-fill"/g)?.length, 1);
  const after = road({ demo: true, sample, saved: { guess: sample.guess } });
  assertNoHan(after);
  assert.equal(after.match(/class="tf-button tf-fill"/g)?.length, 1);
  assert.ok(!road({ sample }).includes(t.fill));
  assert.ok(!road({ sample, saved: { guess: sample.guess } }).includes(t.fill));
});

test("a failed save is announced", () => {
  const markup = view({ revealed: true, choice: "keep", error: t.fileChanged });
  assertNoHan(markup);
  assert.ok(markup.includes('<p class="tf-error" role="alert">'));
});

test("the zh-TW road choice uses the shared vocabulary", () => {
  const markup = renderZh(
    createElement(RoadChoice, { alternatives, lookup, demo: false, saved: { guess: sample.guess } }),
  );
  for (const text of ["如果換個做法？", "先試著答", "你的猜想", "維持這個做法", "偏好另一種", "看情況", "可以查："])
    assert.ok(markup.includes(text), text);
});
