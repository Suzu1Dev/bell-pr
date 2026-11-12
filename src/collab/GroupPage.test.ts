import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { type Answer, cannotTake, GroupPage, HoldAnswer, taskChoices } from "./GroupPage";

const asOf = "2026-11-10T09:00:05.000Z";
const free: Answer = { asOf, invalid: [], holds: [] };
const held = (hold: Partial<Answer["holds"][number]> = {}): Answer => ({
  ...free,
  holds: [
    { name: "Ada", mine: false, title: "Fix pagination", paths: ["src/api"], since: "2026-11-10T08:40:00.000Z", ...hold },
  ],
});
const box = (answer?: Answer) => renderEn(createElement(HoldAnswer, { answer }));
const boxes = (html: string) => html.match(/class="split-(warning|info)"/g) ?? [];
const updates = /<p>as of [^<]+ · this answer updates by itself<\/p>/;

test("the answer is one box: nothing in the way, or who holds what", () => {
  assert.equal(box(), '<div id="hold-answer"></div>');

  const nothing = box(free);
  assert.deepEqual(boxes(nothing), ['class="split-info"']);
  assert.match(nothing, /<p>No one holds these paths, as far as BELL PR checked<\/p>/);
  assert.match(nothing, updates);

  const another = box(held());
  assert.deepEqual(boxes(another), ['class="split-warning"']);
  assert.match(
    another,
    /<p><strong>Ada<\/strong> holds <code class="log-command">src\/api<\/code> — Fix pagination, since [^<]+<\/p>/,
  );
  assert.match(another, updates);

  const own = box(held({ mine: true, paths: ["src/api", "docs"] }));
  assert.deepEqual(boxes(own), ['class="split-warning"']);
  assert.match(
    own,
    /<p><strong>You<\/strong> hold <code class="log-command">src\/api<\/code>, <code class="log-command">docs<\/code> — Fix pagination, since/,
  );

  for (const html of [nothing, another, own]) assertNoHan(html);
});

test("a path that cannot be held and a refused hold are said in that same box", () => {
  const invalid = box({ ...held(), invalid: ["../x"] });
  assert.deepEqual(boxes(invalid), ['class="split-warning"']);
  assert.match(
    invalid,
    /<p>Cannot be held: <code class="log-command">\.\.\/x<\/code><\/p><p><strong>Ada<\/strong> holds /,
  );

  // After a 409: the hold that got there first, with no time when the server gave none.
  const refused = box({ ...held({ since: undefined }), notTaken: true });
  assert.deepEqual(boxes(refused), ['class="split-warning"']);
  assert.match(
    refused,
    /<p><strong>Not taken\. <\/strong><strong>Ada<\/strong> holds <code class="log-command">src\/api<\/code> — Fix pagination<\/p>/,
  );
  assertNoHan(invalid + refused);
});

test("what the server sent is shown as text", () => {
  const html = box(held({ name: "<b>Ada</b>", title: "<img src=x>", paths: ["<script>"] }));
  assert.match(html, /<strong>&lt;b&gt;Ada&lt;\/b&gt;<\/strong>/);
  assert.match(html, /<code class="log-command">&lt;script&gt;<\/code> — &lt;img src=x&gt;/);
  assert.doesNotMatch(html, /<img|<script|<b>/);
});

test("the answer reads in Traditional Chinese", () => {
  const html = renderZh(createElement(HoldAnswer, { answer: { ...held(), notTaken: true } }));
  assert.match(html, /<strong>沒有佔用成功。<\/strong><strong>Ada<\/strong> 自 [^<]+ 起佔用 <code class="log-command">src\/api<\/code>：Fix pagination/);
  assert.match(renderZh(createElement(HoldAnswer, { answer: held({ mine: true }) })), /<strong>你<\/strong>自 /);
});

test("Take hold is off without a title, without an answer, and while something is in the way", () => {
  assert.equal(cannotTake("Fix pagination", free), false);
  assert.equal(cannotTake("  ", free), true);
  assert.equal(cannotTake("Fix pagination"), true);
  assert.equal(cannotTake("Fix pagination", held()), true);
  assert.equal(cannotTake("Fix pagination", held({ mine: true })), true);
  assert.equal(cannotTake("Fix pagination", { ...free, invalid: ["../x"] }), true);
  assert.equal(cannotTake("Fix pagination", { ...held(), notTaken: true }), true);
});

test("a selected prerequisite stays visible after its unfinished hold leaves the task list", () => {
  const api = { taskId: "t-api", title: "API" };
  const ui = { taskId: "t-ui", title: "UI" };
  assert.deepEqual(taskChoices([api], [ui]), [api, ui]);
  assert.deepEqual(taskChoices([], [api, ui]), [api, ui]);
});

test("where group work is off the page says how to start it", () => {
  const html = renderEn(createElement(GroupPage, { status: { codex: true, github: true } }));
  assert.match(html, /<h1[^>]*>Who holds which paths\?<\/h1>/);
  assert.match(html, /<h2>Group work is off for this BELL PR\.<\/h2>/);
  assert.ok(html.includes("bell-pr start --group"));
  assertNoHan(html);
  // Until the app knows, the page shows no card at all.
  assert.doesNotMatch(renderEn(createElement(GroupPage, { status: null })), /settings-card/);
});
