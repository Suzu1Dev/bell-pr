import assert from "node:assert/strict";
import test from "node:test";
import { locales } from "../../../shared/i18n/locale";
import { getDemo } from "../../demo";
import type { Run } from "../../types";
import {
  demoCheckFiles,
  demoConfirmSummary,
  demoGate,
  demoLockAnswers,
  demoRestart,
  demoSaveAttempt,
  demoSaveForecast,
  demoSaveGrades,
  demoUnderstandingView,
} from "./understandingDemo";

const questions = {
  fallback: (path: string) => `What does ${path} change?`,
  untested: "What did you not test?",
};
const at = "2026-10-03T02:00:00.000Z";
const later = "2026-10-03T02:05:00.000Z";
const retry = "selfCheck:src/utils/retry.ts";

function sampleRun(locale: (typeof locales)[number] = "en"): Run {
  const demo = getDemo(locale);
  return { ...demo.run, status: "review", reviewedFiles: demo.files.map((file) => file.path) };
}

/** The sample's own answers, as its "Fill" buttons type them. */
function sampleAnswers(locale: (typeof locales)[number] = "en") {
  const sample = getDemo(locale).understandingSample!;
  return {
    summary: sample.summary,
    items: Object.entries(sample.answers).map(([id, answer]) => ({
      id,
      answer: answer.answer,
      confidence: answer.confidence,
    })),
  };
}

test("the sample asks about retry.ts and what was not tested, and passes with its own answers", () => {
  for (const locale of locales) {
    const demo = getDemo(locale);
    let run = sampleRun(locale);
    const view = demoUnderstandingView(run, demo.files, { required: true, questions });
    assert.deepEqual(view.plan.map((item) => item.id), [retry, "untested"], locale);
    assert.equal(view.passed, false);
    assert.deepEqual(view.missing.map((entry) => entry.part), ["summary", "answer", "answer"]);
    // The reference is the AI-written answer of the file's own question.
    assert.equal(
      view.plan[0].reference,
      demo.files.find((file) => file.path === "src/utils/retry.ts")!.explanation!.selfCheck!.answer,
    );
    assert.equal(view.plan[1].question, questions.untested);

    // Lock: the summary and both answers, timed from when the panel opened.
    const locked = demoLockAnswers(run, demo.files, { ...sampleAnswers(locale), openedAt: at }, questions, later);
    assert.equal(locked.startedAt, at);
    assert.equal(locked.items?.length, 2);
    run = { ...run, understanding: locked };
    const grading = demoUnderstandingView(run, demo.files, { required: true, questions });
    assert.deepEqual(grading.missing, [{ part: "grade", itemId: retry }]);

    // Partly needs a correction before the check passes.
    const sample = demo.understandingSample!.answers[retry];
    const unexplained = demoSaveGrades(run, demo.files, { items: [{ id: retry, grade: "partly" }] }, questions, later);
    assert.equal(unexplained.passedAt, undefined);
    const graded = demoSaveGrades(
      run,
      demo.files,
      { items: [{ id: retry, grade: "partly", correction: sample.correction }] },
      questions,
      later,
    );
    assert.equal(graded.passedAt, later);
    // The pass is a receipt: 2 questions, 1 miss, a confident one, 5 minutes.
    assert.deepEqual(graded.history, [
      { passedAt: later, questions: 2, misses: 1, confidentMisses: 1, seconds: 300 },
    ]);
    run = { ...run, understanding: graded };
    assert.equal(demoUnderstandingView(run, demo.files, { required: true, questions }).passed, true);
    assert.deepEqual(demoGate(run, demo.files, true), { required: true, passed: true });
    // The run it was given is never changed.
    assert.equal(sampleRun(locale).understanding, undefined);
  }
});

test("I don't know counts as missed and needs a correction", () => {
  const demo = getDemo("en");
  const run = sampleRun();
  const record = demoLockAnswers(
    run,
    demo.files,
    {
      summary: sampleAnswers().summary,
      items: [
        { id: retry, answer: "", dontKnow: true, confidence: "guess" },
        { id: "untested", answer: "I did not try a slow server at all.", confidence: "sure" },
      ],
    },
    questions,
    at,
  );
  const item = record.items!.find((entry) => entry.id === retry)!;
  assert.equal(item.dontKnow, true);
  assert.equal(item.grade, "missed");
  const view = demoUnderstandingView({ ...run, understanding: record }, demo.files, { required: true, questions });
  assert.deepEqual(view.missing, [{ part: "correction", itemId: retry }]);
  // The grade stays Missed whatever is sent.
  const graded = demoSaveGrades(
    { ...run, understanding: record },
    demo.files,
    { items: [{ id: retry, grade: "got", correction: "The ceiling doubles each attempt up to the cap." }] },
    questions,
    at,
  );
  assert.equal(graded.items!.find((entry) => entry.id === retry)!.grade, "missed");
  assert.ok(graded.passedAt);
});

test("a credited try-first answer fills its file's slot and is locked with the answers", () => {
  const demo = getDemo("en");
  const quiz = demo.quizSamples!["src/utils/retry.ts"];
  const file = demo.files.find((entry) => entry.path === "src/utils/retry.ts")!;
  const attempts = demoSaveAttempt(sampleRun(), file, { quiz: { answer: quiz.answer, confidence: quiz.confidence } }, at);
  const graded = demoSaveAttempt({ ...sampleRun(), attempts }, file, { quiz: { grade: quiz.grade } }, at);
  const run = { ...sampleRun(), attempts: graded };
  const view = demoUnderstandingView(run, demo.files, { required: true, questions });
  assert.deepEqual(view.plan.map((item) => item.id), ["attempt:src/utils/retry.ts", "untested"]);
  // The client never sends the credited item; locking adds it.
  const record = demoLockAnswers(
    run,
    demo.files,
    { summary: sampleAnswers().summary, items: [{ id: "untested", answer: "I did not test a slow server here.", confidence: "think" }] },
    questions,
    at,
  );
  assert.deepEqual(record.items!.map((item) => [item.id, item.source, item.grade]), [
    ["attempt:src/utils/retry.ts", "attempt", "got"],
    ["untested", "untested", undefined],
  ]);
  assert.ok(record.passedAt, "a Got it attempt and the untested answer pass");
  // A graded attempt stays as it was answered.
  const again = demoSaveAttempt(run, file, { quiz: { answer: "Something else entirely now.", grade: "missed" } }, later);
  assert.equal(again["src/utils/retry.ts"].quiz?.answer, quiz.answer);
  assert.equal(again["src/utils/retry.ts"].quiz?.grade, "got");
  // An attempt on a file that was not picked changes nothing.
  const client = demo.files.find((entry) => entry.path === "src/client.ts")!;
  const other = demoSaveAttempt(sampleRun(), client, { quiz: { ...demo.quizSamples!["src/client.ts"] } }, at);
  assert.deepEqual(
    demoUnderstandingView({ ...sampleRun(), attempts: other }, demo.files, { required: true, questions }).plan.map(
      (item) => item.id,
    ),
    [retry, "untested"],
  );
});

test("after the change moves, the summary needs confirming and only changed files are asked about", () => {
  const demo = getDemo("en");
  const run = sampleRun();
  const record = demoSaveGrades(
    { ...run, understanding: demoLockAnswers(run, demo.files, sampleAnswers(), questions, at) },
    demo.files,
    { items: [{ id: retry, grade: "got" }] },
    questions,
    at,
  );
  assert.ok(record.passedAt);
  // retry.ts changes; the pass ends with it (as synchronizeUnderstanding does).
  const moved = demo.files.map((file) =>
    file.path === "src/utils/retry.ts" ? { ...file, fingerprint: "changed" } : file,
  );
  const stale = {
    ...run,
    understanding: {
      ...record,
      items: record.items!.filter((item) => item.path !== "src/utils/retry.ts"),
      passedAt: undefined,
      passedFingerprint: undefined,
    },
  };
  const view = demoUnderstandingView(stale, moved, { required: true, questions });
  assert.equal(view.stale, true);
  assert.deepEqual(view.missing, [
    { part: "summary-confirm" },
    { part: "answer", itemId: retry },
  ]);
  const confirmed = demoConfirmSummary(stale, moved, undefined, questions, later);
  assert.equal(confirmed.summary?.text, record.summary?.text);
  assert.equal(confirmed.summary?.confirmedAt, later);
  assert.equal(confirmed.summary?.changeFingerprint, demoUnderstandingView({ ...stale, understanding: confirmed }, moved, { required: true, questions }).changeFingerprint);
  // An edit replaces the text.
  const edited = demoConfirmSummary(stale, moved, "  A new explanation of the moved change, in fifteen or more plain words for the check.  ", questions, later);
  assert.equal(edited.summary?.text, "A new explanation of the moved change, in fifteen or more plain words for the check.");
});

test("start over keeps the passed checks and the forecast, and the forecast saves alone", () => {
  const demo = getDemo("en");
  const run = sampleRun();
  const record = demoSaveGrades(
    { ...run, understanding: demoLockAnswers(run, demo.files, sampleAnswers(), questions, at) },
    demo.files,
    { items: [{ id: retry, grade: "got" }], forecast: { dimension: "tests", question: " Will they ask about the cap? " } },
    questions,
    at,
  );
  assert.deepEqual(record.forecast, { dimension: "tests", question: "Will they ask about the cap?", at });
  const restarted = demoRestart({ ...run, understanding: record });
  assert.deepEqual(Object.keys(restarted).sort(), ["forecast", "history"]);
  assert.equal(restarted.history?.length, 1);
  assert.equal(demoGate({ ...run, understanding: restarted }, demo.files, true).passed, false);
  // The forecast alone, and an empty one removes it.
  const forecast = demoSaveForecast(run, { dimension: "naming" }, later);
  assert.deepEqual(forecast.forecast, { dimension: "naming", at: later });
  assert.equal(demoSaveForecast({ ...run, understanding: forecast }, {}, later).forecast, undefined);
});

test("the gate lets the sample through with the check off, and only while it waits for review", () => {
  const demo = getDemo("en");
  assert.deepEqual(demoGate(sampleRun(), demo.files, false), { required: false, passed: false });
  assert.deepEqual(demoGate(sampleRun(), demo.files, true), { required: true, passed: false });
  // A published sample shows its record, and asks nothing.
  const view = demoUnderstandingView({ ...sampleRun(), status: "published" }, demo.files, { required: true, questions });
  assert.deepEqual(view.plan, []);
  assert.deepEqual(view.missing, []);
  // Sample files carry no fingerprint: the path stands in.
  assert.deepEqual(
    demoCheckFiles(demo.files).map((file) => file.fingerprint),
    demo.files.map((file) => file.path),
  );
});
