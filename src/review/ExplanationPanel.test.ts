import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { ChangeExplanation } from "../../shared/explanations";
import { product } from "../../shared/product";
import { getDemo } from "../demo";
import en from "../i18n/en";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { ChatMessage, DiffFile } from "../types";
import {
  ExplanationPanel,
  ReviewReports,
  moduleFor,
  reportMentionCount,
  type ExplanationPanelProps,
} from "./ExplanationPanel";

// These tests pin zh-TW, the language their assertions were written in.
const { files: demoFiles, run: demoRun } = getDemo("zh-TW");

const render = (file: DiffFile) =>
  renderZh(
    createElement(ExplanationPanel, {
      file,
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
    }),
  );

test("a demo file with an explanation renders every learning section", () => {
  const file = demoFiles[0];
  assert.ok(file.explanation, "demo fixture must carry an explanation");
  const html = render(file);
  assert.match(html, /aria-label="程式碼學習助手"/);
  for (const title of [
    "白話文舉例",
    "這段改了什麼？",
    "為什麼這樣改？",
    "帶走一個開發觀念",
    "審閱時，多想一步",
  ]) {
    assert.match(html, new RegExp(title));
  }
  assert.match(html, /指數退避（Exponential backoff）/);
  assert.match(html, /示範內容 · 預先寫好，未呼叫 AI/);
  assert.doesNotMatch(html, /AI 生成/);
});

test("test files get a reading hint and extra presets while source files keep the fixed three", () => {
  const testFile = demoFiles.find((file) => file.path === "tests/retry.test.ts")!;
  const html = render(testFile);
  assert.equal(html.match(/role="tab"/g)?.length, 3);
  assert.match(html, /審查者怎麼看/);
  assert.match(html, /測試就是行為規格：先讀 it\/test 描述/);
  assert.doesNotMatch(render(demoFiles[0]), /測試就是行為規格/);
  const chat = (file: DiffFile) =>
    renderZh(
      createElement(ExplanationPanel, {
        file,
        messages: [],
        loading: false,
        onAsk() {},
        demo: true,
        chatRequestId: 1,
      }),
    );
  const plain = chat({ ...demoFiles[0], path: "src/x.ts", explanation: undefined });
  assert.match(plain, /為什麼要這樣改？/);
  assert.doesNotMatch(plain, /還有哪些做法|這個測試在保護什麼行為/);
  const explained = chat(demoFiles[0]);
  assert.match(explained, /這個觀念在專案其他地方還能用在哪？/);
  assert.match(explained, /如果不這樣改，還有哪些做法？各有什麼取捨？/);
  assert.doesNotMatch(explained, /這個測試在保護什麼行為/);
  assert.match(chat(testFile), /這個測試在保護什麼行為？/);
});

test("maintainer thread comments add the response preset and a read-only section in the reports tab", () => {
  const feedback = [
    {
      kind: "thread" as const,
      author: "maintainer",
      authorAssociation: "MEMBER",
      body: "Use a named constant <here>.",
      path: demoFiles[0].path,
      line: 4,
      isResolved: false,
      url: "https://github.com/o/r/pull/1#discussion_r1",
      createdAt: "2026-10-07T00:00:00Z",
    },
  ];
  const chat = renderZh(
    createElement(ExplanationPanel, {
      file: demoFiles[0],
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
      chatRequestId: 1,
      feedback,
    }),
  );
  assert.match(chat, /維護者這個意見對應 diff 哪幾行？有哪些回應方式與取捨？/);
  assert.doesNotMatch(
    renderZh(
      createElement(ExplanationPanel, {
        file: demoFiles[0],
        messages: [],
        loading: false,
        onAsk() {},
        demo: true,
        chatRequestId: 1,
        feedback: [],
      }),
    ),
    /維護者這個意見/,
  );
  const reports = renderZh(
    createElement(ReviewReports, { file: demoFiles[0], reports: {}, demo: false, feedback }),
  );
  assert.match(reports, /維護者對此檔的留言/);
  assert.match(reports, /來自 GitHub，唯讀/);
  assert.match(reports, /第 4 行/);
  // Comment text is escaped plain text, never interpreted as markup.
  assert.match(reports, /Use a named constant &lt;here&gt;\./);
  assert.match(reports, /這次工作還沒有審查報告/);
});

test("saved answers about an older diff are marked instead of dropped", () => {
  const html = renderZh(
    createElement(ExplanationPanel, {
      file: { ...demoFiles[0], fingerprint: "new" },
      messages: [
        { role: "user", content: "舊問題", fingerprint: "old" },
        { role: "assistant", content: "舊回答", fingerprint: "old" },
        { role: "user", content: "新問題", fingerprint: "new" },
        { role: "assistant", content: "尚未送出的本機回答" },
      ],
      loading: false,
      onAsk() {},
      demo: false,
      chatRequestId: 1,
    }),
  );
  assert.equal(html.match(/針對較舊版本/g)?.length, 2);
  for (const content of ["舊問題", "舊回答", "新問題", "尚未送出的本機回答"])
    assert.match(html, new RegExp(content));
});

test("the reports tab renders demo reports with the static-review label and per-file mention counts", () => {
  assert.ok(demoRun.reports?.reviewer, "demo fixture must carry reports");
  const html = renderZh(
    createElement(ReviewReports, {
      file: demoFiles[0],
      reports: demoRun.reports,
      demo: true,
    }),
  );
  assert.match(html, /示範內容 · 預先寫好，未呼叫 AI/);
  assert.match(html, /Lead 整合摘要/);
  assert.match(html, /Lens · Reviewer/);
  assert.match(html, /Scout · Test analyst/);
  assert.equal(html.match(/獨立靜態審查，非執行結果/g)?.length, 3);
  assert.match(html, /本報告提到此檔 \d+ 處/);
  // Markdown is rendered, not shown as raw asterisks.
  assert.match(html, /<strong>正確性<\/strong>/);
  // The lead's suggested order is listed, with the open file marked.
  assert.match(html, /Lead 建議的閱讀順序/);
  assert.match(
    html,
    /<li aria-current="true"><code>src\/utils\/retry\.ts<\/code>/,
  );
  assert.ok(
    html.indexOf("<code>src/types.ts</code>") <
      html.indexOf("<code>tests/retry.test.ts</code>"),
  );
  assert.doesNotMatch(
    renderZh(
      createElement(ReviewReports, {
        file: demoFiles[0],
        reports: { implementer: "No order section." },
        demo: false,
      }),
    ),
    /建議的閱讀順序/,
  );
  // Non-report keys stay hidden even when present.
  const extra = renderZh(
    createElement(ReviewReports, {
      file: { ...demoFiles[0], path: "docs/none.md" },
      reports: { ...demoRun.reports, guide: "導師回答", alpha: "{}" },
      demo: false,
    }),
  );
  assert.doesNotMatch(extra, /導師回答/);
  assert.equal(extra.match(/此報告未直接提到本檔/g)?.length, 3);
  const empty = renderZh(
    createElement(ReviewReports, { file: demoFiles[0], reports: {}, demo: false }),
  );
  assert.match(empty, /這次工作還沒有審查報告/);
  assert.equal(reportMentionCount("a\n\nsrc/a.ts here\n\nand a.ts\n\nnope", "src/a.ts"), 2);
});

test("alternatives and self-check cards render only when the explanation carries them, with the answer folded", () => {
  const file = demoFiles[0];
  assert.ok(file.explanation?.alternatives && file.explanation.selfCheck);
  const html = render(file);
  assert.match(html, /如果換個做法？/);
  assert.match(html, /可以查：/);
  assert.match(html, /<code>exponential backoff<\/code>/);
  assert.match(html, /考考自己/);
  assert.match(html, /第三次重試/);
  assert.match(html, /aria-expanded="false"[^>]*>看答案</);
  assert.doesNotMatch(html, /full jitter 會在 0 到 4 秒之間/);
  // Cards saved before these fields existed hide both cards.
  const legacy = render({
    ...file,
    explanation: {
      summary: file.explanation!.summary,
      reason: file.explanation!.reason,
      concept: file.explanation!.concept,
      tip: file.explanation!.tip,
      example: file.explanation!.example,
    },
  });
  assert.doesNotMatch(legacy, /如果換個做法？|考考自己/);
  assert.match(legacy, /審閱時，多想一步/);
});

test("the module line uses the longest matching module path and stays hidden without modules", () => {
  const modules = [
    { path: "src", purpose: "程式庫原始碼" },
    { path: "src/utils/", purpose: "共用工具" },
    { path: "src/utils/retry.ts", purpose: "重試邏輯" },
    { path: "tests", purpose: "測試" },
  ];
  assert.deepEqual(moduleFor("src/utils/retry.ts", modules), {
    path: "src/utils/retry.ts",
    purpose: "重試邏輯",
  });
  assert.deepEqual(moduleFor("src/utils/sleep.ts", modules), {
    path: "src/utils",
    purpose: "共用工具",
  });
  // "src" must not match "srcfoo/x.ts": prefixes are whole path segments.
  assert.equal(moduleFor("srcfoo/x.ts", modules), undefined);
  assert.equal(moduleFor("README.md", modules), undefined);
  const html = renderZh(
    createElement(ExplanationPanel, {
      file: demoFiles[1],
      messages: [],
      loading: false,
      onAsk() {},
      demo: true,
      modules,
    }),
  );
  assert.match(html, /所在模組 <code>src<\/code>：程式庫原始碼/);
  assert.doesNotMatch(render(demoFiles[1]), /所在模組/);
});

test("the note editor renders with the saved text and flags a note written for an older diff", () => {
  const file = { ...demoFiles[0], fingerprint: "b".repeat(64) };
  const withNote = (fingerprint: string) =>
    renderZh(
      createElement(ExplanationPanel, {
        file,
        messages: [],
        loading: false,
        onAsk() {},
        demo: true,
        note: { text: "我的筆記內容", fingerprint, updatedAt: "2026-01-01T00:00:00.000Z" },
        onSaveNote() {},
      }),
    );
  const current = withNote("b".repeat(64));
  assert.match(current, /我的理解/);
  assert.match(current, /我的筆記內容<\/textarea>/);
  assert.match(current, /maxLength="2000"/i);
  assert.doesNotMatch(current, /diff 已更新/);
  // The save button stays disabled until the text changes.
  assert.match(current, /儲存筆記/);
  assert.match(current, /<button[^>]*class="explain-note-save"[^>]*disabled/);
  const stale = withNote("a".repeat(64));
  assert.match(stale, /diff 已更新/);
  assert.match(stale, /我的筆記內容<\/textarea>/);
  // A stale note can be re-saved as is to refresh its fingerprint.
  assert.doesNotMatch(stale, /<button[^>]*class="explain-note-save"[^>]*disabled/);
  // Without a save handler (no persistence available) the editor is absent.
  assert.doesNotMatch(render(file), /我的理解/);
});

test("a blocked file explains why no explanation is available", () => {
  const html = render({ ...demoFiles[0], blocked: "原因" });
  assert.match(html, /目前無法解說此檔案/);
  assert.match(html, /<p>原因<\/p>/);
  assert.doesNotMatch(html, /這段改了什麼？/);
});

test("the reports tab offers a re-review button for real runs only and shows the busy state", () => {
  const render = (props: Record<string, unknown>) =>
    renderZh(
      createElement(ReviewReports, {
        file: demoFiles[0],
        reports: demoRun.reports,
        demo: false,
        ...props,
      }),
    );
  const idle = render({ onRerunReview() {} });
  assert.match(idle, /重新執行審查/);
  assert.match(idle, /不會改變已審閱與核准狀態/);
  assert.doesNotMatch(idle, /disabled=""/);
  const busy = render({ onRerunReview() {}, reviewBusy: true });
  assert.match(busy, /正在重新審查…/);
  assert.match(busy, /disabled=""/);
  // Without reports the button still renders inside the empty state.
  assert.match(render({ onRerunReview() {}, reports: {} }), /還沒有審查報告[\s\S]*重新執行審查/);
  assert.doesNotMatch(render({}), /重新執行審查/);
  assert.doesNotMatch(render({ onRerunReview() {}, demo: true }), /重新執行審查/);
});

test("a failed chat turn is recognised by its flag, not by its text", () => {
  const chat = (answer: ChatMessage) =>
    renderZh(
      createElement(ExplanationPanel, {
        file: demoFiles[0],
        messages: [{ role: "user", content: "為什麼要這樣改？" }, answer],
        loading: false,
        onAsk() {},
        demo: false,
        chatRequestId: 1,
      }),
    );
  const flagged = chat({
    role: "assistant",
    content: "This turn failed: the agent timed out",
    failed: true,
  });
  assert.match(flagged, /explain-message-assistant explain-message-error/);
  assert.match(flagged, /role="alert"/);
  assert.match(flagged, /<\/span>回答失敗<\/div>/);
  // The text the failure turn used to start with no longer marks it.
  const unflagged = chat({
    role: "assistant",
    content: "這次未能取得回答：Agent 逾時",
  });
  assert.doesNotMatch(unflagged, /explain-message-error|role="alert"|回答失敗/);
  assert.match(unflagged, /<\/span>學習助手<\/div>/);
  assert.match(unflagged, /這次未能取得回答：Agent 逾時/);
});

// English renders. The English demo is a copy of the zh-TW one until its own
// words land (2F), so these tests keep its files and diffs but put neutral
// English text where the demo's explanations and reports would go: what they
// check is the panel's own text.
const englishDemo = getDemo("en");
const englishExplanation: ChangeExplanation = {
  summary: "Failed requests now wait a little longer before each retry.",
  reason: "Spreading retries out keeps a busy server from being flooded again.",
  concept:
    "Exponential backoff\nEach wait limit doubles, and full jitter picks a random time below it.",
  tip: "Not every error is worth retrying; let the caller decide.",
  example: {
    scenario: "Many people refresh the timetable at the same moment.",
    before: "Every client waits **1 second** and retries together.",
    after: "Each client waits a random time, so the retries spread out.",
  },
  alternatives: "A fixed interval with jitter is simpler but less spread out.",
  lookup: ["exponential backoff", "full jitter"],
  selfCheck: {
    question: "How long can the third retry wait at most?",
    answer: "Up to 4 seconds, but jitter usually makes it shorter.",
  },
};
const englishFile = (path: string): DiffFile => ({
  ...(englishDemo.files.find((file) => file.path === path) ??
    englishDemo.files[0]),
  path,
  explanation: englishExplanation,
});
const englishReports = {
  implementer:
    "Integrated the retry change in src/utils/retry.ts.\n\nSuggested review order:\n1. `src/types.ts`: the new options.\n2. src/utils/retry.ts: the backoff itself.",
  reviewer: "**Correctness**: src/utils/retry.ts handles the last attempt.",
  tester: "Run the retry tests with fake timers.",
};
const englishFeedback = [
  {
    kind: "thread" as const,
    author: "maintainer",
    authorAssociation: "MEMBER",
    body: "Please use a named constant here.",
    path: "src/utils/retry.ts",
    line: 4,
    isResolved: true,
    url: "https://github.com/o/r/pull/1#discussion_r1",
    createdAt: "2026-10-07T00:00:00Z",
  },
];
const renderPanel = (props: Partial<ExplanationPanelProps> = {}) =>
  renderEn(
    createElement(ExplanationPanel, {
      file: englishFile("src/utils/retry.ts"),
      messages: [],
      loading: false,
      onAsk() {},
      demo: false,
      ...props,
    }),
  );

test("an English render of the explanation tab has no Han in its own text", () => {
  const modules = [{ path: "src/utils", purpose: "Shared helpers" }];
  const note = {
    text: "Retries now back off.",
    fingerprint: "a".repeat(64),
    updatedAt: "2026-01-02T12:00:00.000Z",
  };
  for (const demo of [false, true]) {
    const html = renderPanel({ demo, modules, note, onSaveNote() {} });
    assertNoHan(html);
    for (const text of [
      'aria-label="Code learning assistant"',
      "Understand every change",
      "What changed, and why",
      'aria-label="Learning panel"',
      "Explanation</button>",
      "Reviews</button>",
      "Ask the agent</button>",
      "A plain-language example",
      "Picture this",
      "What changed here?",
      "Why was it changed this way?",
      "A development idea to take with you",
      "Think one step further while reviewing",
      "What if it were done differently?",
      "Look up:",
      "Quiz yourself",
      "Show answer",
      "My understanding",
      "Ask about this change",
    ])
      assert.ok(html.includes(text), text);
    assert.match(html, /Module <code>src\/utils<\/code>: Shared helpers/);
    assert.match(html, demo ? /Sample · prewritten, no AI call/ : /AI-generated · may be inaccurate/);
  }
  const saved = renderPanel({
    file: { ...englishFile("src/utils/retry.ts"), fingerprint: "a".repeat(64) },
    note,
    onSaveNote() {},
  });
  // The saved time is formatted for English, not as a zh-TW date.
  assert.match(saved, /Saved · Jan \d, 2026, \d{1,2}:\d{2}\s[AP]M/);
  const stale = renderPanel({
    file: { ...englishFile("src/utils/retry.ts"), fingerprint: "b".repeat(64) },
    note,
    onSaveNote() {},
  });
  assertNoHan(stale);
  assert.match(stale, /Diff updated/);
  assert.match(stale, /written for an earlier version of the diff/);
  const testFile = renderPanel({ file: englishFile("tests/retry.test.ts") });
  assertNoHan(testFile);
  assert.match(testFile, /Tests are behavior specs/);
});

test("only the selected tab is a tab stop, and the tab panel is one too", () => {
  const tabs = (html: string) =>
    [
      ...html.matchAll(
        /<button type="button" role="tab" id="[^"]+-(\w+)" tabindex="(-?\d)" aria-selected="(\w+)"/g,
      ),
    ].map(([, name, tabIndex, selected]) => `${name} ${tabIndex} ${selected}`);
  const explain = renderPanel();
  assertNoHan(explain);
  assert.deepEqual(tabs(explain), ["explain 0 true", "reports -1 false", "chat -1 false"]);
  assert.deepEqual(tabs(renderPanel({ chatRequestId: 1 })), [
    "explain -1 false",
    "reports -1 false",
    "chat 0 true",
  ]);
  // The panel's text comes before anything focusable, so it can be
  // focused and scrolled from the keyboard.
  assert.match(explain, /role="tabpanel" aria-labelledby="[^"]+-explain" tabindex="0"/);
});

test("every explanation state renders English text without Han", () => {
  const file = englishFile("src/utils/retry.ts");
  const withoutExample = {
    ...file,
    explanation: { ...englishExplanation, example: undefined },
  };
  const states: [Partial<ExplanationPanelProps>, RegExp][] = [
    [{ file: { ...file, blocked: "The file is too large." } }, /can&#x27;t be explained/],
    [
      { file: { ...file, explanation: undefined, explanationStatus: "unavailable" } },
      /no text diff to explain/,
    ],
    [
      {
        file: { ...withoutExample, explanationStatus: "failed" },
        onRetryExplanation() {},
      },
      /example isn&#x27;t ready yet[\s\S]*Prepare the example again/,
    ],
    [
      {
        file: { ...withoutExample, explanationStatus: "failed" },
        onRetryExplanation() {},
        explanationBusy: true,
      },
      /Preparing other explanations…/,
    ],
    [
      { file: { ...withoutExample, explanationStatus: "generating" } },
      /Adding a plain-language example/,
    ],
    [
      {
        file: { ...file, explanation: undefined, explanationStatus: "failed" },
        onRetryExplanation() {},
      },
      /explanation isn&#x27;t ready yet[\s\S]*Prepare the explanation again/,
    ],
    [
      { file: { ...file, explanation: undefined, explanationStatus: "generating" } },
      /Turning the change into plain language/,
    ],
    [
      { file: { ...file, explanation: undefined, explanationStatus: "pending" } },
      /ready automatically[\s\S]*Quiz yourself/,
    ],
  ];
  for (const [props, expected] of states) {
    const html = renderPanel(props);
    assertNoHan(html);
    assert.match(html, expected);
  }
});

test("an English render of the reports tab has no Han in its own text", () => {
  const file = englishFile("src/utils/retry.ts");
  for (const demo of [false, true]) {
    const html = renderEn(
      createElement(ReviewReports, {
        file,
        reports: englishReports,
        demo,
        feedback: englishFeedback,
        onRerunReview() {},
      }),
    );
    assertNoHan(html);
    for (const text of [
      "Maintainer comments on this file",
      "1 comment",
      "From GitHub, read-only",
      `${product.name} never comments for you`,
      "Line 4",
      "Resolved",
      "Lead&#x27;s integration summary",
      "Atlas · Team lead",
      "Code review",
      "Test analysis",
      "Independent static review, not an execution result",
      "Mentions this file in 1 paragraph<",
      "This report doesn&#x27;t mention this file directly",
    ])
      assert.ok(html.includes(text), text);
    // The Lead's order is found through the untranslated anchor.
    assert.match(html, /Reading order suggested by the Lead/);
    assert.match(html, /<li aria-current="true"><code>src\/utils\/retry\.ts<\/code>/);
    assert.match(html, demo ? /Sample · prewritten, no AI call/ : /AI-generated · may be inaccurate/);
    assert.equal(html.includes("Run the review again"), !demo);
    // Re-running the review is Free: never locked or badged as Pro.
    assert.doesNotMatch(html, /pro-badge|\bPRO\b|\bPro\b|disabled=""/);
  }
  const busy = renderEn(
    createElement(ReviewReports, {
      file,
      reports: {},
      demo: false,
      onRerunReview() {},
      reviewBusy: true,
    }),
  );
  assertNoHan(busy);
  assert.match(busy, /No review reports for this run yet/);
  assert.match(busy, /Running the review again…/);
});

test("an English render of the chat tab has no Han in its own text", () => {
  const welcome = renderPanel({
    file: englishFile("tests/retry.test.ts"),
    chatRequestId: 1,
    feedback: englishFeedback,
  });
  assertNoHan(welcome);
  for (const preset of Object.values(en.review.presets))
    assert.ok(welcome.includes(preset.replace(/'/g, "&#x27;")), preset);
  assert.match(welcome, /Take your understanding further/);
  assert.match(welcome, /aria-label="Question for the agent"/);
  assert.match(welcome, /placeholder="Which part do you want to explore\?"/);
  assert.match(welcome, /Enter to send · Shift \+ Enter for a new line/);
  const file = { ...englishFile("src/utils/retry.ts"), fingerprint: "new" };
  const messages: ChatMessage[] = [
    { role: "user", content: "Why the jitter?", fingerprint: "old" },
    { role: "assistant", content: "It spreads retries.", fingerprint: "old" },
    { role: "user", content: "And the cap?" },
    { role: "assistant", content: "This turn failed: timeout", failed: true },
  ];
  for (const demo of [false, true]) {
    const html = renderPanel({ file, messages, loading: true, demo, chatRequestId: 1 });
    assertNoHan(html);
    assert.match(html, />You</);
    assert.match(html, /<\/span>Learning assistant/);
    assert.match(html, /<\/span>Answer failed/);
    assert.equal(html.match(/About an earlier version/g)?.length, 2);
    assert.match(html, /Reading the change…/);
    assert.match(html, demo ? /no AI model is called/ : /Enter to send/);
  }
  const blocked = renderPanel({
    file: { ...file, blocked: "The file is too large." },
    chatRequestId: 1,
  });
  assertNoHan(blocked);
  assert.match(blocked, /No explanation is available for this file right now/);
  assert.match(blocked, /File context can&#x27;t be attached/);
});

test("explanations and reports say they are AI output, or a prewritten sample in the demo", () => {
  const ai = "AI-generated · may be inaccurate";
  const sample = "Sample · prewritten, no AI call";
  const live = renderPanel({ demo: false });
  assertNoHan(live);
  assert.ok(live.includes(`<p class="explain-provenance">`), "live label");
  assert.ok(live.includes(ai));
  assert.ok(!live.includes(sample));
  const demo = renderPanel({ demo: true });
  assertNoHan(demo);
  assert.ok(demo.includes(`<p class="explain-provenance explain-provenance-sample">`));
  assert.ok(demo.includes(sample));
  assert.ok(!demo.includes(ai));
  // No label before there is an explanation to label.
  const pending = renderPanel({
    file: { ...englishFile("src/utils/retry.ts"), explanation: undefined, explanationStatus: "generating" },
  });
  assert.ok(!pending.includes(ai));
  for (const [isDemo, label] of [[false, ai], [true, sample]] as const) {
    const reports = renderEn(
      createElement(ReviewReports, {
        file: englishFile("src/utils/retry.ts"),
        reports: englishReports,
        demo: isDemo,
      }),
    );
    assert.ok(reports.includes(label), label);
  }
});

test("answers carry the AI label; failed turns, questions and demo answers do not", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "Why the jitter?" },
    { role: "assistant", content: "It spreads retries." },
    { role: "user", content: "And the cap?" },
    { role: "assistant", content: "This turn failed: timeout", failed: true },
    { role: "assistant", content: "The cap is maxDelay." },
  ];
  const live = renderPanel({ messages, chatRequestId: 1 });
  assertNoHan(live);
  assert.equal(
    live.match(/<p class="explain-message-provenance">AI-generated · may be inaccurate<\/p>/g)?.length,
    2,
  );
  // The label follows the answer it belongs to.
  assert.match(
    live,
    /It spreads retries\.<\/p><\/div><\/div><p class="explain-message-provenance">/,
  );
  const demo = renderPanel({ messages, chatRequestId: 1, demo: true });
  assert.doesNotMatch(demo, /explain-message-provenance/);
  const zh = renderZh(
    createElement(ExplanationPanel, {
      file: demoFiles[0],
      messages,
      loading: false,
      onAsk() {},
      demo: false,
      chatRequestId: 1,
    }),
  );
  assert.equal(zh.match(/AI 生成 · 內容可能有誤/g)?.length, 2);
});

test("every English review message is free of Han for any count", () => {
  const texts: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (typeof value === "function")
      for (const count of [1, 2])
        texts.push(
          (value as (params: unknown) => string)(
            new Proxy({}, { get: () => count }),
          ),
        );
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  visit(en.review);
  assert.ok(texts.length > 100);
  for (const text of texts) assertNoHan(text);
});

// The demo's own words are English once 2F replaces the placeholder; the
// wave-2 merge runs this test with that demo.
const englishDemoReady = englishDemo !== getDemo("zh-TW");

test(
  "an English render of the demo has no Han",
  { skip: !englishDemoReady && "the English demo is still the zh-TW placeholder" },
  () => {
    for (const file of englishDemo.files) {
      for (const chatRequestId of [0, 1])
        assertNoHan(
          renderEn(
            createElement(ExplanationPanel, {
              file,
              messages: [],
              loading: false,
              onAsk() {},
              demo: true,
              chatRequestId,
            }),
          ),
        );
      assertNoHan(
        renderEn(
          createElement(ReviewReports, {
            file,
            reports: englishDemo.run.reports,
            demo: true,
            feedback: englishDemo.prFeedback?.items.filter(
              (item) => item.path === file.path,
            ),
          }),
        ),
      );
    }
  },
);
