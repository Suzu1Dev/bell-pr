import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { understandingLimits, type FileAttempt } from "../../shared/understanding";
import { api, send } from "../api";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { DiffFile } from "../types";
import { ExplanationPanel, type ExplanationPanelProps } from "./ExplanationPanel";
import { QuizAttempt } from "./QuizAttempt";
import { revealInput, saveFirst } from "./try-first";
import { WalkthroughAttempt, type WalkthroughInput } from "./WalkthroughAttempt";
import { WalkthroughCards } from "./WalkthroughCards";

const client = getDemo("en").files.find((entry) => entry.path === "src/client.ts")!;
const unit = client.walkthrough!.functions[0];
const key = `${unit.name}:${unit.startLine}`;
const at = "2026-10-20T09:00:00.000Z";
/** Plain words of the unit's reference answer (its code spans render as code). */
const referenceWords = "calls the function it was given again on every retry";
const save = async () => {};

/** The first element of `type` in a tree that is not rendered further. */
function find(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node))
    return node.map((child) => find(child, type)).find(Boolean);
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  return node.type === type ? (node as ReactElement<Record<string, unknown>>) : find(node.props.children, type);
}

/** What `component` returns for `props`, rendered once in English: its own elements, with their handlers. */
function shallow<P>(component: (props: P) => ReactNode, props: P): ReactNode {
  let tree: ReactNode;
  function Probe() {
    tree = component(props);
    return null;
  }
  renderEn(createElement(Probe));
  return tree;
}

const cards = (props: Partial<Parameters<typeof WalkthroughCards>[0]>, file: DiffFile = client) =>
  renderEn(createElement(WalkthroughCards, { file, demo: true, ...props }));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("with try first on, each unit's Check yourself asks for an answer and a confidence before its answer shows", () => {
  const html = cards({ tryFirst: true, onAttempt: save });
  assertNoHan(html);
  assert.match(html, /<h3><svg[^>]*>.*?<\/svg>Check yourself<span class="tf-badge">Try first<\/span><\/h3>/);
  assert.match(html, /<label class="tf-label" for="[^"]+">Your answer<\/label><textarea/);
  assert.match(html, /role="radiogroup"/);
  assert.match(html, />Show answer<\/button>/);
  // Neither the fold nor anything it would show.
  assert.doesNotMatch(html, /<details class="walkthrough-check">/);
  assert.ok(!html.includes(referenceWords));
  // The sample has no prewritten walkthrough answer to type.
  assert.doesNotMatch(html, /Fill with the sample answer/);
  const zh = renderZh(
    createElement(WalkthroughCards, {
      file: getDemo("zh-TW").files.find((entry) => entry.path === "src/client.ts")!,
      demo: true,
      tryFirst: true,
      onAttempt: save,
    }),
  );
  assert.match(zh, /考考自己<span class="tf-badge">先試著答<\/span>/);
});

test("with try first off, the unit keeps today's fold, saved answers or not", () => {
  const attempts = { [key]: { answer: "It builds the URL from baseURL.", confidence: "think" as const, at } };
  for (const html of [cards({ onAttempt: save }), cards({ tryFirst: false, attempts, onAttempt: save })]) {
    assert.match(html, /<details class="walkthrough-check"><summary>Check yourself: /);
    assert.doesNotMatch(html, /tf-card/);
  }
});

test("a saved unit answer shows beside its answer, then one line once graded", () => {
  const revealed = cards({
    tryFirst: true,
    onAttempt: save,
    attempts: { [key]: { answer: "It builds the URL from baseURL.", confidence: "think", at } },
  });
  assertNoHan(revealed);
  assert.ok(revealed.includes(referenceWords));
  assert.match(revealed, /It builds the URL from baseURL\./);
  assert.match(revealed, /How did your answer compare\?/);
  const graded = cards({
    tryFirst: true,
    onAttempt: save,
    attempts: { [key]: { answer: "It builds the URL from baseURL.", confidence: "think", grade: "got", at } },
  });
  assert.match(graded, /Your grade: Got it\./);
  assert.doesNotMatch(graded, /How did your answer compare\?/);
});

test("a run that takes no attempts shows a saved unit answer read-only and folds an unanswered one", () => {
  // Published, say: the Changes tab passes no onAttempt.
  const saved = cards({
    tryFirst: true,
    attempts: { [key]: { answer: "It builds the URL from baseURL.", confidence: "sure", at } },
  });
  assertNoHan(saved);
  assert.match(saved, /It builds the URL from baseURL\./);
  assert.ok(saved.includes(referenceWords));
  assert.doesNotMatch(saved, /<textarea|How did your answer compare\?|Show answer/);
  const unanswered = cards({ tryFirst: true });
  assert.match(unanswered, /<details class="walkthrough-check">/);
  assert.doesNotMatch(unanswered, /<textarea/);
});

test("the panel passes the try-first switch, this version's unit answers and the save to the walkthrough", () => {
  const sent: unknown[] = [];
  const attempt: FileAttempt = {
    fingerprint: "a".repeat(64),
    walkthroughs: { [key]: { answer: "It builds the URL.", confidence: "think", at } },
  };
  const props = (extra: Partial<ExplanationPanelProps>) =>
    find(
      shallow(ExplanationPanel, {
        file: { ...client, fingerprint: "a".repeat(64) },
        messages: [],
        loading: false,
        onAsk() {},
        demo: false,
        initialTab: "walkthrough",
        attempt,
        onAttempt: async (input) => void sent.push(input),
        ...extra,
      }),
      WalkthroughCards,
    )!.props;
  const shown = props({});
  assert.equal(shown.tryFirst, true);
  assert.deepEqual(shown.attempts, attempt.walkthroughs);
  void (shown.onAttempt as (input: WalkthroughInput) => Promise<void>)({ unit: key, skipped: true });
  assert.deepEqual(sent, [{ walkthrough: { unit: key, skipped: true } }]);
  assert.equal(props({ tryFirst: false }).tryFirst, false);
  // Answers made on an earlier version of the file start over.
  assert.equal(props({ file: { ...client, fingerprint: "b".repeat(64) } }).attempts, undefined);
  assert.equal(props({ onAttempt: undefined }).onAttempt, undefined);
});

test("once the file has the most unit answers kept, a new unit still asks first but is not sent, and says so", () => {
  // A walkthrough made again at the same version brings units with new
  // keys; the server keeps at most walkthroughUnits answers per file
  // version and refuses one more (409 walkthroughFull), which would leave
  // the unit's answer hidden behind a save that can never succeed.
  const answered = (count: number) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `earlier${index}:${index + 1}`,
        { answer: "An earlier answer.", confidence: "think" as const, at },
      ]),
    );
  const limit = understandingLimits.walkthroughUnits;
  const props = { unit, demo: false, onAttempt: save };
  const full = find(shallow(WalkthroughAttempt, { ...props, attempts: answered(limit) }), QuizAttempt)!;
  assert.equal(full.props.onSave, undefined);
  assert.equal(full.props.readOnly, false);
  const html = renderEn(createElement(WalkthroughAttempt, { ...props, attempts: answered(limit) }));
  assertNoHan(html);
  assert.match(html, /<textarea/);
  assert.match(html, /This file already has the most walkthrough answers BELL PR keeps, so this one stays on this page and isn&#x27;t saved\./);
  assert.match(
    renderZh(createElement(WalkthroughAttempt, { ...props, attempts: answered(limit) })),
    /這個檔案的程式碼解說作答已達 BELL PR 保留的上限/,
  );
  // One fewer, or this unit's own answer among them: saved as usual, with no note.
  const room = renderEn(createElement(WalkthroughAttempt, { ...props, attempts: answered(limit - 1) }));
  assert.doesNotMatch(room, /most walkthrough answers/);
  assert.equal(typeof find(shallow(WalkthroughAttempt, { ...props, attempts: answered(limit - 1) }), QuizAttempt)!.props.onSave, "function");
  const own = { ...answered(limit - 1), [key]: { answer: "It builds the URL.", confidence: "think" as const, at } };
  assert.equal(typeof find(shallow(WalkthroughAttempt, { ...props, attempts: own }), QuizAttempt)!.props.onSave, "function");
  assert.doesNotMatch(renderEn(createElement(WalkthroughAttempt, { ...props, attempts: own })), /most walkthrough answers/);
});

test("a unit's answer is saved through PATCH /attempts before its answer is revealed", async () => {
  let release!: () => void;
  const requests: { url: string; method?: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    await new Promise<void>((done) => {
      release = done;
    });
    return new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  // The Changes tab's save (useUnderstanding.saveAttempt), behind the panel's mapping.
  const file = { ...client, fingerprint: "a".repeat(64) };
  const onAttempt = async (input: { walkthrough?: WalkthroughInput }) => {
    await api("/runs/run-1/attempts", send("PATCH", { filePath: file.path, fingerprint: file.fingerprint, ...input }));
  };
  const card = find(
    shallow(WalkthroughAttempt, { unit, demo: false, onAttempt: (walkthrough) => onAttempt({ walkthrough }) }),
    QuizAttempt,
  )!;
  assert.equal(card.props.readOnly, false);
  const onSave = card.props.onSave as (input: ReturnType<typeof revealInput>) => Promise<void>;
  let revealed = false;
  const reveal = saveFirst(revealInput("  It builds the URL from baseURL. ", "think"), onSave).then(() => {
    revealed = true;
  });
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, [
    {
      url: "/api/runs/run-1/attempts",
      method: "PATCH",
      body: {
        filePath: "src/client.ts",
        fingerprint: "a".repeat(64),
        walkthrough: { unit: key, answer: "It builds the URL from baseURL.", confidence: "think" },
      },
    },
  ]);
  // The save is under way: nothing is revealed until the server answers.
  assert.equal(revealed, false);
  release();
  await reveal;
  assert.equal(revealed, true);
});
