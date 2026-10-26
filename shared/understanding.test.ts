import test from "node:test";
import assert from "node:assert/strict";
import type { ChangeExplanation } from "./explanations.js";
import {
  changedLines,
  changeFingerprint,
  checkQuestionCount,
  checkScope,
  creditedAttempt,
  isConfidentMiss,
  isTrivialFile,
  looksCopied,
  needsUntestedQuestion,
  pickCheckFiles,
  planCheck,
  recordPass,
  reportMentionCount,
  synchronizeUnderstandingRecord,
  understandingStatus,
  type CheckFile,
  type FileAttempt,
  type RunUnderstanding,
  type UnderstandingItem,
} from "./understanding.js";

/** A changed file with `lines` added lines and a real-looking patch. */
function file(path: string, lines: number, extra: Partial<CheckFile> = {}): CheckFile {
  const added = Array.from({ length: lines }, (_, index) => `+const line${index} = ${index};`);
  return {
    path,
    fingerprint: `${path}@1`,
    additions: lines,
    deletions: 0,
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,0 +1,${lines} @@\n${added.join("\n")}\n`,
    ...extra,
  };
}

const questions = {
  fallback: (path: string) => `In one sentence, what does the change to ${path} do, and why?`,
  untested: "What did you not test, and why?",
};

const card = (question: string, answer: string): ChangeExplanation => ({
  summary: "Retries now wait longer each time and add randomness to the wait.",
  reason: "Many clients retrying together would flood the server again.",
  concept: "Exponential backoff\nThe ceiling doubles each round.",
  tip: "Not every error deserves a retry.",
  selfCheck: { question, answer },
});

const ready = (content: ChangeExplanation, fingerprint?: string) => ({
  status: "ready",
  fingerprint,
  content,
});

const summary =
  "This change makes failed GET requests retry with growing random waits, so brief outages recover; a wrong status list could retry errors that should fail fast.";

test("the question count follows the changed-line buckets at 15/16, 100/101 and 400/401", () => {
  assert.deepEqual(
    [0, 15, 16, 100, 101, 400, 401, 5000].map(checkQuestionCount),
    [0, 0, 1, 1, 2, 2, 3, 3],
  );
  // The buckets count non-trivial files only.
  assert.equal(changedLines([file("src/a.ts", 10), file("package-lock.json", 900)]), 10);
  assert.equal(checkQuestionCount(changedLines([file("src/a.ts", 16), file("yarn.lock", 900)])), 1);
});

test("lockfiles, generated output, whitespace-only patches and small docs changes are trivial", () => {
  assert.ok(isTrivialFile(file("package-lock.json", 300)));
  assert.ok(isTrivialFile(file("crates/x/Cargo.lock", 30)));
  assert.ok(isTrivialFile(file("dist/app.min.js", 30)));
  assert.ok(isTrivialFile(file("api/service.pb.go", 30)));
  // The project's own linguist-generated patterns.
  assert.ok(isTrivialFile(file("src/gen/client.ts", 40), ["src/gen/**"]));
  assert.ok(isTrivialFile(file("schema.graphql.ts", 40), ["*.graphql.ts"]));
  assert.ok(!isTrivialFile(file("src/gen/client.ts", 40), ["other/**"]));
  const whitespace: CheckFile = {
    path: "src/a.ts",
    fingerprint: "w",
    additions: 2,
    deletions: 2,
    patch: "@@ -1,2 +1,2 @@\n-if (a){\n-  run( );\n+if (a) {\n+    run();\n",
  };
  assert.ok(isTrivialFile(whitespace));
  assert.ok(!isTrivialFile({ ...whitespace, patch: "@@ -1 +1 @@\n-run(1);\n+run(2);\n" }));
  assert.ok(isTrivialFile(file("README.md", 3)));
  assert.ok(isTrivialFile(file("docs/guide/setup.ts", 2)));
  assert.ok(!isTrivialFile(file("README.md", 4)));
  assert.ok(!isTrivialFile(file("src/a.ts", 1)));
  // Dependency manifests and build files are code, whatever their extension.
  assert.ok(!isTrivialFile(file("requirements.txt", 2)));
  assert.ok(!isTrivialFile(file("native/CMakeLists.txt", 2)));
  // No rename rule: BELL diffs with --no-renames, so a rename is two files.
  assert.ok(!isTrivialFile(file("src/new-name.ts", 20, { status: "added" })));
  // A held-back file is still a change to ask about.
  assert.ok(!isTrivialFile(file("secrets.ts", 0, { blocked: "credentials", patch: "Held back." })));
});

test("files rank CI config first, then Reviewer or Test analyst mentions, source before tests, size and review order", () => {
  const files = [
    file("tests/a.test.ts", 90),
    file("src/small.ts", 5),
    file("src/big.ts", 60),
    file("src/mentioned.ts", 10),
    file(".github/workflows/ci.yml", 3),
    file("src/tie-b.ts", 20),
    file("src/tie-a.ts", 20),
    file("yarn.lock", 500),
  ];
  const reports = {
    reviewer: "Looks fine.\n\n`src/mentioned.ts` lacks validation.",
    tester: "Missing: a case in tests/a.test.ts for the limit.",
    implementer:
      "Done.\n\n## Suggested review order:\n\n1. `src/tie-b.ts` — first.\n2. `src/tie-a.ts` — then.",
  };
  assert.deepEqual(
    pickCheckFiles({ files, reports }).map((value) => value.path),
    [
      ".github/workflows/ci.yml",
      "src/mentioned.ts",
      "tests/a.test.ts",
      "src/big.ts",
      "src/tie-b.ts",
      "src/tie-a.ts",
      "src/small.ts",
    ],
  );
  // An explicit order wins over the one in the Lead's report; then the path breaks ties.
  assert.deepEqual(
    pickCheckFiles({ files: [file("src/tie-b.ts", 20), file("src/tie-a.ts", 20)], reviewOrder: [] })
      .map((value) => value.path),
    ["src/tie-a.ts", "src/tie-b.ts"],
  );
});

test("a mention only in the Lead's integration summary does not raise a file", () => {
  const files = [file("src/big.ts", 60), file("src/named.ts", 10)];
  const reports = { implementer: "Integrated src/big.ts and src/named.ts.\n\nsrc/named.ts is new." };
  assert.deepEqual(
    pickCheckFiles({ files, reports }).map((value) => value.path),
    ["src/big.ts", "src/named.ts"],
  );
  assert.deepEqual(
    pickCheckFiles({ files, reports: { ...reports, reviewer: "src/named.ts needs a test." } })
      .map((value) => value.path),
    ["src/named.ts", "src/big.ts"],
  );
  assert.equal(reportMentionCount("a\n\nsrc/a.ts here\n\nand a.ts\n\nnope", "src/a.ts"), 2);
});

test("the plan asks about the top-ranked files, falls back without a card and adds the not-tested question", () => {
  const files = [file("src/a.ts", 80), file("src/b.ts", 40), file("README.md", 30)];
  const explanations = {
    "src/a.ts": ready(card("What is the ceiling on the third retry?", "Four seconds."), "src/a.ts@1"),
    // A card for an older version of the file is not used.
    "src/b.ts": ready(card("Old question?", "Old answer."), "src/b.ts@0"),
  };
  const plan = planCheck({ files, explanations, questions });
  assert.deepEqual(
    plan.map((item) => [item.id, item.source, item.question]),
    [
      ["selfCheck:src/a.ts", "selfCheck", "What is the ceiling on the third retry?"],
      ["fallback:src/b.ts", "fallback", questions.fallback("src/b.ts")],
      ["untested", "untested", questions.untested],
    ],
  );
  assert.equal(plan[0].reference, "Four seconds.");
  assert.equal(plan[1].reference, undefined);
  // A blocked file never uses a card; a docs-only change has no not-tested question.
  const blocked = planCheck({
    files: [file("src/a.ts", 30, { blocked: "binary" })],
    explanations,
    questions,
  });
  assert.deepEqual(blocked.map((item) => item.id), ["fallback:src/a.ts", "untested"]);
  assert.ok(!needsUntestedQuestion([file("README.md", 40), file("tests/x.test.ts", 40)]));
  assert.ok(needsUntestedQuestion([file("src/x.ts", 1)]));
  assert.ok(needsUntestedQuestion([file("requirements.txt", 2)]));
  assert.ok(needsUntestedQuestion([file("CMakeLists.txt", 40)]));
  assert.deepEqual(planCheck({ files: [file("README.md", 40)], questions }).map((item) => item.id), [
    "fallback:README.md",
  ]);
  // The Test analyst's report is the reference for the not-tested question.
  assert.equal(
    planCheck({ files: [file("src/x.ts", 2)], reports: { tester: " Not run. " }, questions })[0].reference,
    "Not run.",
  );
});

test("a credited attempt fills its file's slot at the current fingerprint only", () => {
  const files = [file("src/a.ts", 80), file("src/b.ts", 10)];
  const explanations = {
    "src/a.ts": ready(card("What is the ceiling?", "Four seconds at most.")),
    "src/b.ts": ready(card("Does it retry a 404?", "No, 404 is not listed.")),
  };
  const quiz = {
    answer: "it waits under four seconds",
    confidence: "think" as const,
    grade: "got" as const,
    at: "2026-10-15T00:00:00.000Z",
  };
  const credited = planCheck({
    files,
    explanations,
    attempts: { "src/a.ts": { fingerprint: "src/a.ts@1", quiz } },
    questions,
  });
  assert.deepEqual(credited.map((item) => item.id), ["attempt:src/a.ts", "untested"]);
  assert.equal(credited[0].source, "attempt");
  // At an older fingerprint the attempt does not count.
  const stale = planCheck({
    files,
    explanations,
    attempts: { "src/a.ts": { fingerprint: "src/a.ts@0", quiz } },
    questions,
  });
  assert.deepEqual(stale.map((item) => item.id), ["selfCheck:src/a.ts", "untested"]);
  // An attempt on a file that was not picked neither adds nor displaces a question.
  const other = planCheck({
    files,
    explanations,
    attempts: { "src/b.ts": { fingerprint: "src/b.ts@1", quiz } },
    questions,
  });
  assert.deepEqual(other.map((item) => item.id), ["selfCheck:src/a.ts", "untested"]);
  // Skipped, ungraded, too short or copied attempts are not credit.
  const variants: FileAttempt["quiz"][] = [
    { ...quiz, skipped: true },
    { ...quiz, grade: undefined },
    { ...quiz, confidence: undefined },
    { ...quiz, answer: "four seconds" },
  ];
  for (const variant of variants)
    assert.ok(!creditedAttempt({ fingerprint: "f", quiz: variant }, { fingerprint: "f" }), JSON.stringify(variant));
  assert.ok(
    !creditedAttempt(
      { fingerprint: "f", quiz: { ...quiz, answer: "The ceiling is four seconds at most, really." } },
      { fingerprint: "f" },
      "the ceiling is four seconds at most really",
    ),
  );
});

test("answers already locked keep their slot when the reports change", () => {
  const files = [file("src/a.ts", 60), file("src/b.ts", 30)];
  const explanations = {
    "src/a.ts": ready(card("A?", "Answer A here.")),
    "src/b.ts": ready(card("B?", "Answer B here.")),
  };
  const first = planCheck({ files, explanations, questions });
  assert.equal(first[0].id, "selfCheck:src/a.ts");
  const record: RunUnderstanding = {
    items: [item("selfCheck:src/a.ts", "src/a.ts", "src/a.ts@1")],
  };
  // A rerun review now mentions only b.ts: the locked a.ts question stays.
  const after = planCheck({
    files,
    explanations,
    record,
    reports: { reviewer: "src/b.ts is risky." },
    questions,
  });
  assert.deepEqual(after.map((value) => value.id), ["selfCheck:src/a.ts", "untested"]);
});

function item(
  id: string,
  path?: string,
  fingerprint?: string,
  extra: Partial<UnderstandingItem> = {},
): UnderstandingItem {
  return {
    id,
    ...(path ? { path, fingerprint } : {}),
    source: id === "untested" ? "untested" : "selfCheck",
    question: "Q?",
    answer: "the wait grows each round",
    confidence: "sure",
    lockedAt: "2026-10-15T00:00:00.000Z",
    grade: "got",
    ...extra,
  };
}

test("the status names every missing part and passes once the rule holds", () => {
  const files = [file("src/a.ts", 60)];
  const current = changeFingerprint(files);
  const plan = planCheck({
    files,
    explanations: { "src/a.ts": ready(card("A?", "The ceiling is four seconds at most on that retry.")) },
    questions,
  });
  const status = (record?: RunUnderstanding) =>
    understandingStatus({ record, plan, files, required: true });
  assert.deepEqual(status().missing, [
    { part: "summary" },
    { part: "answer", itemId: "selfCheck:src/a.ts" },
    { part: "answer", itemId: "untested" },
  ]);
  const record: RunUnderstanding = {
    summary: { text: summary, changeFingerprint: current, at: "t" },
    items: [
      item("selfCheck:src/a.ts", "src/a.ts", "src/a.ts@1", { grade: undefined }),
      item("untested", undefined, undefined, { grade: undefined, answer: "a server sending Retry-After" }),
    ],
  };
  assert.deepEqual(status(record).missing, [{ part: "grade", itemId: "selfCheck:src/a.ts" }]);
  record.items![0].grade = "partly";
  assert.deepEqual(status(record).missing, [{ part: "correction", itemId: "selfCheck:src/a.ts" }]);
  record.items![0].correction = "too short";
  assert.equal(status(record).passed, false);
  record.items![0].correction = "the ceiling doubles, it is not fixed";
  assert.deepEqual(status(record), { required: true, passed: true, stale: false, missing: [] });
  // "I don't know" needs Guessing and counts as missed, so it needs a correction.
  const unsure = structuredClone(record);
  unsure.items![0] = item("selfCheck:src/a.ts", "src/a.ts", "src/a.ts@1", {
    answer: "",
    dontKnow: true,
    confidence: "sure",
    grade: undefined,
  });
  assert.deepEqual(status(unsure).missing, [{ part: "answer", itemId: "selfCheck:src/a.ts" }]);
  unsure.items![0].confidence = "guess";
  assert.deepEqual(status(unsure).missing, [{ part: "correction", itemId: "selfCheck:src/a.ts" }]);
  unsure.items![0].correction = "the ceiling doubles each round";
  assert.equal(status(unsure).passed, true);
  // Too few words, an answer at an older fingerprint, a copied answer.
  const short = structuredClone(record);
  short.items![0].answer = "it grows";
  assert.deepEqual(status(short).missing, [{ part: "answer", itemId: "selfCheck:src/a.ts" }]);
  const older = structuredClone(record);
  older.items![0].fingerprint = "src/a.ts@0";
  assert.deepEqual(status(older).missing, [{ part: "answer", itemId: "selfCheck:src/a.ts" }]);
  const copied = structuredClone(record);
  copied.items![0].answer = "The ceiling is four seconds at most on that retry!";
  assert.deepEqual(status(copied).missing, [{ part: "answer", itemId: "selfCheck:src/a.ts" }]);
});

test("a summary needs 15 words, CJK characters counting one each, and must not copy a card", () => {
  const files = [file("README.md", 2)];
  const current = changeFingerprint(files);
  const status = (text: string, cards: ChangeExplanation[] = []) =>
    understandingStatus({
      record: { summary: { text, changeFingerprint: current, at: "t" } },
      plan: [],
      files,
      required: true,
      cards,
    });
  const han = (count: number) => "重".repeat(count);
  assert.equal(status(han(15)).passed, true);
  assert.deepEqual(status(han(14)).missing, [{ part: "summary" }]);
  assert.equal(status(summary).passed, true);
  assert.deepEqual(status("Too short to explain anything.").missing, [{ part: "summary" }]);
  const explanation = card("Q?", "A.");
  explanation.reason =
    "This change makes failed GET requests retry with growing random waits, so brief outages recover; a wrong status list could retry errors that should fail fast. And more.";
  assert.deepEqual(status(summary, [explanation]).missing, [{ part: "summary" }]);
});

test("copy detection ignores case, whitespace and punctuation, in both directions", () => {
  const reference = "The ceiling is min(30, 1 × 2²) = 4 seconds. Full jitter picks a random wait.";
  assert.ok(looksCopied("4 seconds. Full JITTER picks a random   wait", [reference]));
  // A reference of 8 or more words inside a longer text.
  assert.ok(looksCopied(`I think ${reference} That is my answer.`, [reference]));
  // A short answer that shares a few words, or recalls a short stretch of
  // the wording, is not a copy.
  assert.ok(!looksCopied("a random wait", [reference]));
  assert.ok(!looksCopied("full jitter picks a random wait", [reference]));
  assert.ok(
    !looksCopied("the HttpError is thrown right away", [
      "No. shouldRetry returns true only for 408, 429, 500, 502, 503 and 504. 404 is not on the list, so the HttpError is thrown right away.",
    ]),
  );
  assert.ok(!looksCopied("The wait is random and capped by maxDelay.", [reference]));
  // Words must match whole: "wait" is not "waiting".
  assert.ok(!looksCopied("jitter picks a random waiting time", [reference]));
  // A short reference inside the text is not a copy either.
  assert.ok(!looksCopied("It is four seconds, I think, at most.", ["four seconds"]));
  assert.ok(!looksCopied("", [reference]));
  assert.ok(!looksCopied("anything at all here goes", []));
});

test("copy detection finds a copied part of a Chinese sentence, one character per word", () => {
  const reference = "每次重試前的等待上限會加倍，實際等待時間是零到上限之間的隨機值。";
  // A copy that starts and ends inside a clause, without any punctuation.
  assert.ok(looksCopied("等待時間是零到上限之間的隨機值", [reference]));
  assert.ok(looksCopied("每次重試前的等待上限會加倍", [reference]));
  // A Chinese reference of 8 or more characters inside a longer answer.
  assert.ok(looksCopied(`我認為${reference}大概是這樣`, [reference]));
  // Shorter than 12 characters, or not in the reference: not a copy.
  assert.ok(!looksCopied("上限加倍", [reference]));
  assert.ok(!looksCopied("重試前的等待上限會加倍", [reference]));
  assert.ok(
    !looksCopied("會直接被拋出", [
      "不會。shouldRetry 只對 408、429、500、502、503、504 回傳 true，404 不在清單中，所以 HttpError 會直接被拋出。",
    ]),
  );
  assert.ok(
    !looksCopied("不會重試，直接失敗", [
      "最多 4 個：第一次請求加上 3 次重試。408、429、500、502、503、504 以外的狀態碼（例如 404）不會重試，直接失敗。",
    ]),
  );
  assert.ok(!looksCopied("等待會越來越長，而且有隨機性", [reference]));
  // As a summary, a copied clause of 15 characters does not pass.
  const files = [file("src/a.ts", 2)];
  const status = understandingStatus({
    record: { summary: { text: "等待時間是零到上限之間的隨機值", changeFingerprint: changeFingerprint(files), at: "t" } },
    plan: [],
    files,
    required: true,
    cards: [{ ...card("Q?", "A."), reason: reference }],
  });
  assert.deepEqual(status.missing, [{ part: "summary" }]);
});

test("a summary written for an older version of the change is stale and needs confirming", () => {
  const before = [file("src/a.ts", 10)];
  const after = [file("src/a.ts", 10, { fingerprint: "src/a.ts@2" })];
  const record: RunUnderstanding = {
    summary: { text: summary, changeFingerprint: changeFingerprint(before), at: "t" },
    items: [item("untested", undefined, undefined, { grade: undefined, answer: "nothing with real servers" })],
  };
  const plan = planCheck({ files: after, questions });
  const status = understandingStatus({ record, plan, files: after, required: false });
  assert.equal(status.stale, true);
  assert.deepEqual(status.missing, [{ part: "summary-confirm" }]);
  assert.equal(status.required, false);
  record.summary!.changeFingerprint = changeFingerprint(after);
  assert.equal(understandingStatus({ record, plan, files: after, required: false }).passed, true);
});

test("the change fingerprint is FNV-1a 64-bit over the sorted path:fingerprint lines", () => {
  const files = [file("b.ts", 1), file("a.ts", 1)];
  const value = changeFingerprint(files);
  assert.match(value, /^[0-9a-f]{16}$/);
  assert.equal(changeFingerprint([...files].reverse()), value);
  assert.notEqual(changeFingerprint([file("a.ts", 1)]), value);
  // FNV-1a 64 of the empty input is the offset basis.
  assert.equal(changeFingerprint([]), "cbf29ce484222325");
  assert.equal(changeFingerprint([{ path: "a", fingerprint: "" }]), fnv("a:"));
});

/** A reference FNV-1a 64-bit, for the test above. */
function fnv(text: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(text, "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

test("after the change moves, only changed files' answers drop and the re-check asks only about them", () => {
  const files = [file("src/a.ts", 60), file("src/b.ts", 60)];
  const record: RunUnderstanding = {
    summary: { text: summary, changeFingerprint: changeFingerprint(files), at: "t" },
    items: [
      item("fallback:src/a.ts", "src/a.ts", "src/a.ts@1"),
      item("fallback:src/b.ts", "src/b.ts", "src/b.ts@1"),
      item("untested", undefined, undefined, { grade: undefined }),
    ],
    startedAt: "2026-10-15T00:00:00.000Z",
  };
  const plan = planCheck({ files, questions });
  recordPass(record, { files, plan, now: "2026-10-15T00:04:00.000Z" });
  assert.equal(record.passedFingerprint, changeFingerprint(files));
  assert.deepEqual(record.passedFiles, { "src/a.ts": "src/a.ts@1", "src/b.ts": "src/b.ts@1" });
  assert.deepEqual(record.history, [
    { passedAt: "2026-10-15T00:04:00.000Z", questions: 3, misses: 0, confidentMisses: 0, seconds: 240 },
  ]);
  assert.equal(record.startedAt, undefined);
  // Nothing moved: nothing changes, and the passed check asks nothing new.
  assert.equal(synchronizeUnderstandingRecord(record, files), false);
  assert.deepEqual(planCheck({ files, record, questions }), []);
  const moved = [files[0], file("src/b.ts", 60, { fingerprint: "src/b.ts@2" })];
  assert.equal(synchronizeUnderstandingRecord(record, moved), true);
  assert.deepEqual(record.items?.map((value) => value.id), ["fallback:src/a.ts", "untested"]);
  assert.equal(record.passedAt, undefined);
  assert.equal(record.history?.length, 1);
  // The re-check asks only about the file that changed since the pass.
  assert.deepEqual(checkScope(moved, record).map((value) => value.path), ["src/b.ts"]);
  // The not-tested answer stays recorded, so only the file question is new.
  const replan = planCheck({ files: moved, record, questions });
  assert.deepEqual(replan.map((value) => value.id), ["fallback:src/b.ts", "untested"]);
  assert.deepEqual(
    understandingStatus({ record, plan: replan, files: moved, required: true }).missing,
    [{ part: "summary-confirm" }, { part: "answer", itemId: "fallback:src/b.ts" }],
  );
  // Without a pass, a moved file only drops its own answer.
  const open: RunUnderstanding = {
    items: [item("selfCheck:src/a.ts", "src/a.ts", "src/a.ts@1"), item("untested")],
  };
  synchronizeUnderstandingRecord(open, moved);
  assert.deepEqual(open.items?.map((value) => value.id), ["selfCheck:src/a.ts", "untested"]);
  synchronizeUnderstandingRecord(open, [file("src/b.ts", 60)]);
  assert.deepEqual(open.items?.map((value) => value.id), ["untested"]);
});

test("a confident miss is Partly or Missed at Sure or Think so", () => {
  assert.ok(isConfidentMiss({ grade: "partly", confidence: "think" }));
  assert.ok(isConfidentMiss({ grade: "missed", confidence: "sure" }));
  assert.ok(!isConfidentMiss({ grade: "missed", confidence: "guess" }));
  assert.ok(!isConfidentMiss({ grade: "got", confidence: "sure" }));
  assert.ok(!isConfidentMiss({ dontKnow: true, confidence: "guess" }));
});
