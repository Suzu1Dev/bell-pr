import assert from "node:assert/strict";
import test from "node:test";
import { locales } from "../../shared/i18n/locale";
import { demoDraftPreparation as panelDraftPreparation } from "../draft/DraftGuidancePanel";
import {
  demoContributionBrief as missionBrief,
  demoInsights as missionInsights,
} from "../mission/demo";
import { demoTeam as boardTeam } from "../team/TeamBoard";
import type { DiffFile } from "../types";
import {
  demoAnswer,
  demoContributionBrief,
  demoDraftPreparation,
  demoFiles,
  demoInsights,
  demoRepo,
  demoRun,
  demoTeam,
  getDemo,
  type DemoAnswerTopic,
} from "./index";

// String values under these keys are structure (ids, paths, times, enum
// values, code), so every locale must carry the same value. Any other string
// is copy and only its presence is compared.
const structuralKeys = new Set([
  "agent",
  "baseBranch",
  "baseSha",
  "branch",
  "checkedAt",
  "command",
  "confidence",
  "createdAt",
  "defaultBranch",
  "deliveredTo",
  "dependsOn",
  "direction",
  "effort",
  "evidence",
  "files",
  "fingerprint",
  "from",
  "fullName",
  "generatedAt",
  "id",
  "integratedFiles",
  "kind",
  "language",
  "messageDelivery",
  "name",
  "outcome",
  "owner",
  "patch",
  "path",
  "phase",
  "policy",
  "protocol",
  "provider",
  "recipients",
  "repoId",
  "reviewedFiles",
  "source",
  "sourceId",
  "sources",
  "status",
  "templateSourceId",
  "time",
  "to",
  "topic",
  "url",
]);

/** The demo with its copy blanked out: what every locale must share. */
function structure(value: unknown, key = ""): unknown {
  if (typeof value === "function") return "<function>";
  if (value instanceof RegExp) return "<RegExp>";
  if (Array.isArray(value)) return value.map((item) => structure(item, key));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, structure(item, name)]),
    );
  if (typeof value === "string" && !structuralKeys.has(key)) return "<copy>";
  return value;
}

const answerText = (topic: DemoAnswerTopic, file: DiffFile) => {
  const answer = getDemo("zh-TW").answers.find((item) => item.topic === topic);
  assert.ok(answer, `zh-TW has a ${topic} answer`);
  return answer.text({ file });
};

test("every locale has the same demo structure: ids, paths, times and array lengths", () => {
  const reference = structure(getDemo("zh-TW"));
  for (const locale of locales)
    assert.deepEqual(structure(getDemo(locale)), reference, locale);
});

test("the legacy names and the component re-exports are the zh-TW fixtures", () => {
  const zh = getDemo("zh-TW");
  assert.equal(demoRepo, zh.repo);
  assert.equal(demoFiles, zh.files);
  assert.equal(demoRun, zh.run);
  assert.equal(demoInsights, zh.insights);
  assert.equal(demoContributionBrief, zh.contributionBrief);
  assert.equal(demoTeam, zh.team);
  assert.equal(demoDraftPreparation, zh.draftPreparation);
  assert.equal(missionInsights, zh.insights);
  assert.equal(missionBrief, zh.contributionBrief);
  assert.equal(boardTeam, zh.team);
  assert.equal(panelDraftPreparation, zh.draftPreparation);
});

test("demoAnswer gives the rationale answer to a why question, with or without the locale", () => {
  const file = demoFiles[0];
  const answer = demoAnswer(file, "為什麼這樣做", "zh-TW");
  assert.equal(answer, answerText("why", file));
  assert.match(answer, /^示範回覆 · 本機預寫內容，未呼叫 AI 模型。/);
  assert.ok(file.explanation && answer.includes(file.explanation.reason));
  assert.equal(demoAnswer(file, "為什麼這樣做"), answer);
});

test("demoAnswer checks the topics in table order and falls back to the generic answer", () => {
  const file = demoFiles[1];
  const cases: [string, DemoAnswerTopic][] = [
    ["怎麼確認它有效？", "test"],
    ["Math.random 在這裡做什麼？", "jitter"],
    ["這樣改有什麼風險？", "risk"],
    ["原因是什麼？", "why"],
    // Both the jitter and the why keywords match; jitter comes first.
    ["為什麼要用 jitter？", "jitter"],
    ["這個檔案在做什麼？", "generic"],
  ];
  for (const [question, topic] of cases)
    assert.equal(demoAnswer(file, question), answerText(topic, file), question);
});

test("a file without an explanation still gets a complete answer", () => {
  const file = { ...demoFiles[0], path: "src/other.ts", explanation: undefined };
  assert.match(demoAnswer(file, "有什麼風險？"), /先確認這段變更的輸入、輸出與錯誤處理。/);
  assert.match(demoAnswer(file, "隨便問問"), /^示範回覆[\s\S]*src\/other\.ts\n\n這個檔案包含本次任務的程式變更。/);
});

test("every locale has one generic answer and stateless keyword tables", () => {
  for (const locale of locales) {
    const { answers } = getDemo(locale);
    assert.equal(
      answers.filter((answer) => answer.topic === "generic").length,
      1,
      locale,
    );
    for (const answer of answers)
      assert.doesNotMatch(answer.keywords.flags, /[gy]/, `${locale} ${answer.topic}`);
  }
});
