import assert from "node:assert/strict";
import test from "node:test";
import { formatters, intlLocale, locales } from "../../shared/i18n/locale";
import { demoDraftPreparation as panelDraftPreparation } from "../draft/DraftGuidancePanel";
import {
  demoContributionBrief as missionBrief,
  demoInsights as missionInsights,
} from "../mission/demo";
import { demoTeam as boardTeam } from "../team/TeamBoard";
import type { DiffFile } from "../types";
import { getSampleDiscoveryJob } from "./discovery";
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
// is copy and only its presence is compared. The discovery entry is copy
// only: getSampleDiscoveryJob() takes its structure from shared.ts.
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
function structure(value: unknown, key = "", copyOnly = false): unknown {
  if (typeof value === "function") return "<function>";
  if (value instanceof RegExp) return "<RegExp>";
  if (Array.isArray(value))
    return value.map((item) => structure(item, key, copyOnly));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        structure(item, name, copyOnly || key === "discovery"),
      ]),
    );
  if (typeof value === "string" && (copyOnly || !structuralKeys.has(key)))
    return "<copy>";
  return value;
}

/** Every timestamp field in the fixtures, as [where, value]. */
function timestamps(value: unknown, where = ""): [string, unknown][] {
  if (Array.isArray(value))
    return value.flatMap((item, index) => timestamps(item, `${where}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([name, item]) =>
    /At$|^time$/.test(name)
      ? [[`${where}.${name}`, item] as [string, unknown]]
      : timestamps(item, `${where}.${name}`),
  );
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

test("no fixture timestamp parses to an invalid Date", () => {
  for (const locale of locales) {
    const found = [
      ...timestamps(getDemo(locale)),
      ...timestamps(getSampleDiscoveryJob(locale), "discovery"),
    ];
    // run.createdAt, three log times, generatedAt, two messages, checkedAt,
    // and the discovery job's two times and three pushedAt dates.
    assert.ok(found.length >= 13, `${locale}: ${found.length} timestamps`);
    for (const [where, value] of found) {
      assert.equal(typeof value, "string", `${locale} ${where}`);
      assert.ok(
        !Number.isNaN(new Date(value as string).getTime()),
        `${locale} ${where} = ${value}`,
      );
    }
  }
});

test("every activity log time formats as a time, never 'Invalid Date'", () => {
  for (const locale of locales) {
    const format = new Intl.DateTimeFormat(intlLocale(locale), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    for (const log of getDemo(locale).run.logs) {
      const date = new Date(log.time);
      // format() throws a RangeError on an invalid Date.
      assert.match(format.format(date), /\d{2}:\d{2}:\d{2}/, log.time);
      assert.notEqual(date.toLocaleTimeString(intlLocale(locale)), "Invalid Date");
    }
  }
});

test("the agent cards, activity log and team board name the same agents", () => {
  for (const locale of locales) {
    const { run, team } = getDemo(locale);
    const agents = run.agents.map((agent) => agent.id);
    assert.deepEqual(agents, [
      "lead",
      "member-1",
      "member-2",
      "member-3",
      "reviewer",
      "tester",
    ]);
    for (const log of run.logs) assert.ok(agents.includes(log.agent), log.agent);
    for (const task of team.tasks) assert.ok(agents.includes(task.owner), task.owner);
    const tasks = team.tasks.map((task) => task.id);
    for (const message of team.messages) {
      assert.ok(agents.includes(message.from), message.from);
      assert.ok(["all", "lead", ...tasks].includes(message.to), message.to);
      for (const id of [...message.recipients, ...message.deliveredTo])
        assert.ok(tasks.includes(id), id);
    }
  }
});

test("the suggested commit subject is the PR title", () => {
  for (const locale of locales) {
    const { run, draftPreparation } = getDemo(locale);
    const message = draftPreparation.proposal?.commitMessageSuggestion?.message;
    assert.equal(message?.split("\n")[0], run.draft.title, locale);
    assert.equal(
      run.draft.title,
      "feat(client): add exponential backoff and jitter to GET retries",
    );
  }
});

test("the demo timeline runs forward from the analysis to the draft check", () => {
  for (const locale of locales) {
    const { insights, run, team, draftPreparation } = getDemo(locale);
    const times = [
      insights.generatedAt,
      run.createdAt,
      ...run.logs.map((log) => log.time),
      draftPreparation.context?.checkedAt ?? "",
    ].map((value) => new Date(value).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), locale);
    const started = new Date(run.createdAt).getTime();
    const finished = times[times.length - 1];
    for (const message of team.messages) {
      const sent = new Date(message.createdAt).getTime();
      assert.ok(sent >= started && sent <= finished, message.createdAt);
    }
  }
});

test("the sample discovery job holds together like a live result", () => {
  for (const locale of locales) {
    const job = getSampleDiscoveryJob(locale);
    assert.equal(job.status, "ready");
    assert.equal(job.phase, "complete");
    assert.ok(job.message && job.preferences.interests && job.warnings.length);
    assert.ok(job.candidates.length >= 2 && job.candidates.length <= 3);
    assert.equal(job.opportunities.length, job.candidates.length);
    const created = Date.parse(job.createdAt);
    assert.ok(created < Date.parse(job.completedAt ?? ""));
    for (const candidate of job.candidates)
      assert.ok(Date.parse(candidate.pushedAt) < created, candidate.pushedAt);
    for (const opportunity of job.opportunities) {
      const candidate = job.candidates.find(
        (item) => item.fullName === opportunity.repository,
      );
      assert.ok(candidate, opportunity.repository);
      for (const field of [
        opportunity.title,
        opportunity.summary,
        opportunity.userNeed,
        opportunity.contributionRules,
        opportunity.feasibility,
        opportunity.effort,
      ])
        assert.ok(field.trim(), `${locale} ${opportunity.id}`);
      for (const list of [
        opportunity.firstSteps,
        opportunity.acceptanceChecks,
        opportunity.risks,
      ])
        assert.ok(list.length && list.every((item) => item.trim()));
      assert.ok(
        opportunity.popularity.includes(formatters(locale).number(candidate.stars)),
      );
      // The live pipeline drops an opportunity without these citations.
      const cited = opportunity.evidence.map((evidence) => {
        const source = candidate.sources.find(
          (item) => item.id === evidence.sourceId,
        );
        assert.ok(source, evidence.sourceId);
        assert.ok(source.content.includes(evidence.quote), evidence.quote);
        assert.equal(typeof evidence.reason, "string");
        assert.ok(evidence.reason.trim(), `${locale} ${evidence.sourceId}`);
        return source.kind;
      });
      assert.ok(cited.includes("issue"), opportunity.id);
      if (candidate.sources.some((source) => source.kind === "contributing"))
        assert.ok(cited.includes("contributing"), opportunity.id);
    }
  }
});

test("the sample repositories are fictional and link nowhere", () => {
  const job = getSampleDiscoveryJob("zh-TW");
  for (const candidate of job.candidates) {
    // Each owner was checked with `gh api users/<owner>` (404) when added.
    assert.match(candidate.fullName, /^[a-z]+-sample\/[a-z-]+$/);
    assert.equal(candidate.url, "");
    for (const source of candidate.sources) assert.equal(source.url, "");
  }
  // Every call builds a fresh job, so a caller may change its copy.
  job.candidates[0].sources.length = 0;
  job.opportunities[0].firstSteps.push("changed");
  const again = getSampleDiscoveryJob("zh-TW");
  assert.ok(again.candidates[0].sources.length > 0);
  assert.ok(!again.opportunities[0].firstSteps.includes("changed"));
});
