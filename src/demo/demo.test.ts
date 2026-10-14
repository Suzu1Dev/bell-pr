import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryJob } from "../../shared/discovery";
import {
  formatters,
  intlLocale,
  locales,
  type Locale,
} from "../../shared/i18n/locale";
import { parseReviewOrder } from "../../shared/review-order";
import { assertNoHan } from "../test-utils/render";
import type { DiffFile } from "../types";
import { getSampleDiscoveryJob } from "./discovery";
import {
  demoAnswer,
  getDemo,
  type DemoAnswerTopic,
  type DemoContent,
} from "./index";

const demoFiles = getDemo("zh-TW").files;

// String values under these keys are structure (ids, paths, times, enum
// values, code), so every locale must carry the same value. Any other string
// is copy and only its presence is compared. The discovery entry is copy
// only: getSampleDiscoveryJob() takes its structure from shared.ts.
const structuralKeys = new Set([
  "agent",
  "author",
  "authorAssociation",
  "baseBranch",
  "baseSha",
  "branch",
  "checkedAt",
  "checksState",
  "command",
  "confidence",
  "createdAt",
  "defaultBranch",
  "deliveredTo",
  "dependsOn",
  "direction",
  "effort",
  "evidence",
  "fetchedAt",
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
  "state",
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

const answerText = (
  topic: DemoAnswerTopic,
  file: DiffFile,
  locale: Locale = "zh-TW",
) => {
  const answer = getDemo(locale).answers.find((item) => item.topic === topic);
  assert.ok(answer, `${locale} has a ${topic} answer`);
  return answer.text({ file });
};

// Every field, the Pro and video samples included: the structure test below
// would also pass if both locales left an optional sample out.
test("every locale has the same demo structure: ids, paths, times and array lengths", () => {
  const reference = structure(getDemo("zh-TW"));
  for (const locale of locales)
    assert.deepEqual(structure(getDemo(locale)), reference, locale);
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
    // the PR feedback's fetchedAt and two items, and the discovery job's two
    // times and three pushedAt dates.
    assert.ok(found.length >= 16, `${locale}: ${found.length} timestamps`);
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
    // Marks the built-in sample, whose candidates and sources have no links.
    assert.equal(job.sample, true);
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

test("every locale fills the Pro and video samples with the same ids and lengths", () => {
  const [reference, ...others] = locales.map((locale) => {
    const demo = getDemo(locale);
    const { prFeedback, extraRecommendations, rerunReport } = demo;
    const { importSteps, analysisSteps, publishedCard } = demo;
    assert.ok(prFeedback, `${locale} prFeedback`);
    assert.ok(extraRecommendations, `${locale} extraRecommendations`);
    assert.ok(rerunReport, `${locale} rerunReport`);
    assert.ok(importSteps && analysisSteps, `${locale} playback steps`);
    assert.ok(publishedCard, `${locale} publishedCard`);
    const filled = (text: string | undefined) => Boolean(text?.trim());
    assert.ok(prFeedback.items.every((item) => filled(item.body)), locale);
    assert.ok(prFeedback.items.some((item) => item.kind === "review"), locale);
    assert.equal(prFeedback.checks?.length, 1, `${locale} one CI check`);
    assert.ok(prFeedback.warnings?.every(filled), locale);
    assert.equal(extraRecommendations.length, 5, locale);
    const ids = [...demo.insights.recommendations, ...extraRecommendations].map(
      (recommendation) => recommendation.id,
    );
    assert.equal(new Set(ids).size, ids.length, `${locale} unique ids`);
    assert.deepEqual(Object.keys(rerunReport).sort(), ["reviewer", "tester"]);
    assert.ok(Object.values(rerunReport).every(filled), locale);
    assert.ok([...importSteps, ...analysisSteps].every(filled), locale);
    assert.ok(filled(publishedCard.title) && filled(publishedCard.note), locale);
    return {
      feedback: prFeedback.items.map((item) => item.url),
      checks: prFeedback.checks?.map((check) => check.name),
      warnings: prFeedback.warnings?.length,
      extra: extraRecommendations.map((item) => [item.id, item.acceptance.length]),
      rerun: Object.keys(rerunReport),
      importSteps: importSteps.length,
      analysisSteps: analysisSteps.length,
    };
  });
  for (const other of others) assert.deepEqual(other, reference);
});

test("the English demo contains no Han characters or CJK punctuation", () => {
  const demo = getDemo("en");
  assertNoHan(JSON.stringify(demo));
  // The answers and the discovery message are functions, which JSON drops.
  const files = [
    ...demo.files,
    { ...demo.files[0], path: "src/other.ts", explanation: undefined },
  ];
  for (const file of files)
    for (const answer of demo.answers) assertNoHan(answer.text({ file }));
  assertNoHan(JSON.stringify(getSampleDiscoveryJob("en")));
});

test("demoAnswer reads English questions with the English keyword tables", () => {
  const file = getDemo("en").files[0];
  const cases: [string, DemoAnswerTopic][] = [
    ["what are the risks?", "risk"],
    // The jitter table comes before the why table.
    ["why exponential?", "jitter"],
    ["How do I test this?", "test"],
    ["Can I verify the waits?", "test"],
    ["How can I confirm it works?", "test"],
    ["What does Math.random do here?", "jitter"],
    ["Is the backoff capped?", "jitter"],
    ["Is this backward compatible?", "risk"],
    ["Any caveats?", "risk"],
    ["How could this be better?", "risk"],
    ["Why this change?", "why"],
    ["What is the reason for HttpError?", "why"],
    ["What does this file do?", "generic"],
    // Keywords match at the start of a word, so "latest" is not "test".
    ["Is this the latest version?", "generic"],
  ];
  for (const [question, topic] of cases)
    assert.equal(
      demoAnswer(file, question, "en"),
      answerText(topic, file, "en"),
      question,
    );
});

test("the English discovery message agrees with its count", () => {
  const { message } = getDemo("en").discovery;
  assert.match(message({ count: 1 }), /found 1 source-backed opportunity to/);
  assert.match(message({ count: 3 }), /found 3 source-backed opportunities to/);
});

test("every English answer is labelled as a prewritten sample", () => {
  const demo = getDemo("en");
  const files = [
    ...demo.files,
    { ...demo.files[0], path: "src/other.ts", explanation: undefined },
  ];
  for (const file of files)
    for (const answer of demo.answers)
      assert.match(
        answer.text({ file }),
        /^Sample · prewritten, no AI call\.\n\n\S/,
        `${file.path} ${answer.topic}`,
      );
  const bare = files[files.length - 1];
  assert.match(
    demoAnswer(bare, "what are the risks?", "en"),
    /Start by checking this change's inputs, outputs and error handling\./,
  );
  assert.match(
    demoAnswer(bare, "tell me more", "en"),
    /src\/other\.ts\n\nThis file holds code changes from this task\./,
  );
});

test("the demo marks its prewritten reports, logs and samples as samples", () => {
  const markers: Record<Locale, { starts: RegExp; mentions: RegExp }> = {
    en: { starts: /^Sample · /, mentions: /\bsample\b/i },
    "zh-TW": { starts: /^示範 · /, mentions: /示範|範例/ },
  };
  for (const locale of locales) {
    const { starts, mentions } = markers[locale];
    const demo = getDemo(locale);
    const reports = [
      ...Object.values(demo.run.reports ?? {}),
      ...Object.values(demo.rerunReport ?? {}),
    ];
    assert.equal(reports.length, 5, locale);
    for (const report of reports) assert.match(report, starts, locale);
    const mentioning = [
      ...demo.run.agents.map((agent) => agent.detail ?? ""),
      ...demo.run.logs.map((log) => log.message),
      ...demo.team.tasks.map((task) => task.report ?? ""),
      ...(demo.draftPreparation.context?.warnings ?? []),
      ...(demo.prFeedback?.warnings ?? []),
      ...getSampleDiscoveryJob(locale).warnings,
      demo.publishedCard?.note ?? "",
    ];
    for (const text of mentioning) assert.match(text, mentions, `${locale}: ${text}`);
  }
});

test("the Lead's report keeps the machine-read review order in every locale", () => {
  for (const locale of locales) {
    const { run, files } = getDemo(locale);
    const order = parseReviewOrder(run.reports?.implementer ?? "");
    assert.deepEqual(
      order.map((entry) => entry.path),
      ["src/types.ts", "src/utils/retry.ts", "src/client.ts", "tests/retry.test.ts", "README.md"],
      locale,
    );
    assert.deepEqual(
      order.map((entry) => entry.path).sort(),
      files.map((file) => file.path).sort(),
    );
    assert.ok(order.every((entry) => entry.reason), locale);
  }
});

test("every recommendation cites files from the demo diff", () => {
  for (const locale of locales) {
    const demo = getDemo(locale);
    const paths = demo.files.map((file) => file.path);
    for (const recommendation of [
      ...demo.insights.recommendations,
      ...(demo.extraRecommendations ?? []),
    ]) {
      assert.ok(recommendation.evidence.length, recommendation.id);
      for (const path of recommendation.evidence)
        assert.ok(paths.includes(path), `${recommendation.id}: ${path}`);
      assert.ok(recommendation.acceptance.length, recommendation.id);
    }
  }
});

test("every draft rule quotes its sample source word for word", () => {
  for (const locale of locales) {
    const { context, proposal } = getDemo(locale).draftPreparation;
    assert.ok(context && proposal, locale);
    for (const rule of proposal.rules) {
      const source = context.sources.find((item) => item.id === rule.sourceId);
      assert.ok(source, rule.sourceId);
      assert.ok(source.content.includes(rule.quote), `${locale}: ${rule.quote}`);
    }
  }
});

/** The text of each new-file line of a demo patch, by line number. */
function newFileLines(file: DiffFile) {
  const lines = (file.patch ?? "").split("\n");
  const body = lines.slice(lines.findIndex((line) => line.startsWith("@@")) + 1);
  return body
    .filter((line) => line !== "" && !line.startsWith("-"))
    .map((line) => line.slice(1));
}

test("the sample PR feedback is fictional and points at the demo diff", () => {
  for (const locale of locales) {
    const { prFeedback, files, draftPreparation } = getDemo(locale);
    assert.ok(prFeedback, locale);
    const urls = prFeedback.items.map((item) => item.url);
    assert.equal(new Set(urls).size, urls.length, "urls identify the items");
    for (const item of prFeedback.items) {
      // Never a link to GitHub, and never a login that could exist there.
      assert.match(item.url, /^#demo-pr-/);
      assert.match(item.author, /_/);
      if (item.kind !== "thread") continue;
      const file = files.find((entry) => entry.path === item.path);
      assert.ok(file && item.line, `${item.path}:${item.line}`);
      // The comment is about Retry-After on 429 and 503, so it sits on the
      // line that lists the retryable status codes.
      assert.match(newFileLines(file)[item.line - 1] ?? "", /429.*503/);
    }
    for (const check of prFeedback.checks ?? []) assert.equal(check.url, undefined);
    const drafted = Date.parse(draftPreparation.context?.checkedAt ?? "");
    const fetched = Date.parse(prFeedback.fetchedAt);
    for (const item of prFeedback.items) {
      const created = Date.parse(item.createdAt);
      assert.ok(drafted < created && created <= fetched, item.createdAt);
    }
  }
});

// Character budgets for the English copy, at about 1440 px: titles, chips,
// task titles and card headings fit on one line, and one-line card summaries
// in about two. Long-form bodies are not budgeted: the explanation cards
// after their summary, the reports, the PR draft, the source documents, the
// answers and the maintainer's comments.
const titleBudget = 72;
const summaryBudget = 180;
// The review panel shows a module's purpose after its path on one 340 px line.
const modulePurposeBudget = 25;
// In the changes tab, the run title shares one line with the status badge and
// the repository line; with the English labels, about 18 characters fit.
const runTitleBudget = 18;

type Strings = (string | undefined)[];
const recommendationsOf = (demo: DemoContent) => [
  ...demo.insights.recommendations,
  ...(demo.extraRecommendations ?? []),
];
const budgets: {
  field: string;
  budget: number;
  values: (demo: DemoContent, job: DiscoveryJob) => Strings;
}[] = [
  { field: "run title", budget: runTitleBudget, values: (d) => [d.run.title] },
  {
    field: "agent role chips",
    budget: titleBudget,
    values: (d) => d.run.agents.map((agent) => agent.role),
  },
  {
    field: "project card heading",
    budget: titleBudget,
    values: (d) => [d.insights.summary],
  },
  {
    field: "audience chips",
    budget: titleBudget,
    values: (d) => d.insights.audience,
  },
  {
    field: "recommendation titles",
    budget: titleBudget,
    values: (d) => recommendationsOf(d).map((item) => item.title),
  },
  {
    field: "beneficiary chips",
    budget: titleBudget,
    values: (d) => d.contributionBrief.beneficiaries,
  },
  {
    field: "task titles",
    budget: titleBudget,
    values: (d) => d.team.tasks.map((task) => task.title),
  },
  {
    field: "draft source labels",
    budget: titleBudget,
    values: (d) => (d.draftPreparation.context?.sources ?? []).map((s) => s.label),
  },
  {
    field: "draft proposal title",
    budget: titleBudget,
    values: (d) => [d.draftPreparation.proposal?.title],
  },
  {
    field: "concept card headings",
    budget: titleBudget,
    values: (d) => d.files.map((f) => f.explanation?.concept.split("\n")[0]),
  },
  {
    field: "lookup chips",
    budget: titleBudget,
    values: (d) => d.files.flatMap((f) => f.explanation?.lookup ?? []),
  },
  {
    field: "discovery interests",
    budget: titleBudget,
    values: (_, job) => [job.preferences.interests],
  },
  {
    field: "opportunity titles",
    budget: titleBudget,
    values: (_, job) => job.opportunities.map((item) => item.title),
  },
  {
    field: "import and analysis steps",
    budget: titleBudget,
    values: (d) => [...(d.importSteps ?? []), ...(d.analysisSteps ?? [])],
  },
  {
    field: "published card title",
    budget: titleBudget,
    values: (d) => [d.publishedCard?.title],
  },
  {
    field: "CI check names",
    budget: titleBudget,
    values: (d) => (d.prFeedback?.checks ?? []).map((check) => check.name),
  },
  {
    field: "module purposes",
    budget: modulePurposeBudget,
    values: (d) => d.insights.modules.map((item) => item.purpose),
  },
  {
    field: "mission brief",
    budget: summaryBudget,
    values: (d) => [d.run.prompt],
  },
  {
    field: "agent card details",
    budget: summaryBudget,
    values: (d) => d.run.agents.map((agent) => agent.detail),
  },
  {
    field: "activity log lines",
    budget: summaryBudget,
    values: (d) => d.run.logs.map((log) => log.message),
  },
  {
    field: "project card summaries",
    budget: summaryBudget,
    values: (d) => [
      d.insights.purpose,
      ...d.insights.userJourney,
      ...(d.insights.readingPath ?? []).flatMap((s) => [s.why, s.lookFor]),
      ...d.insights.evidence.map((item) => item.note),
    ],
  },
  {
    field: "recommendation card summaries",
    budget: summaryBudget,
    values: (d) =>
      recommendationsOf(d).flatMap((item) => [
        item.problem,
        item.userImpact,
        item.approach,
        ...item.acceptance,
      ]),
  },
  {
    field: "contribution brief",
    budget: summaryBudget,
    values: ({ contributionBrief: brief }) => [
      brief.problem,
      brief.motivation,
      brief.before,
      brief.after,
      ...brief.validation,
      ...brief.risks,
    ],
  },
  {
    field: "team plan, tasks and messages",
    budget: summaryBudget,
    values: (d) => [
      d.team.planSummary,
      ...d.team.tasks.flatMap((task) => [task.description, task.report]),
      ...d.team.messages.map((message) => message.content),
    ],
  },
  {
    field: "draft guidance summaries",
    budget: summaryBudget,
    values: ({ draftPreparation: { context, proposal } }) => [
      ...(context?.warnings ?? []),
      proposal?.summary,
      ...(proposal?.rules ?? []).map((rule) => rule.text),
      ...(proposal?.checklist ?? []),
      proposal?.commitMessageSuggestion?.rationale,
    ],
  },
  {
    field: "explanation summaries and self-check questions",
    budget: summaryBudget,
    values: (d) =>
      d.files.flatMap(({ explanation }) => [
        explanation?.summary,
        // Only some files have a self-check.
        ...(explanation?.selfCheck ? [explanation.selfCheck.question] : []),
      ]),
  },
  {
    field: "discovery summaries",
    budget: summaryBudget,
    values: (_, job) => [
      job.message,
      ...job.warnings,
      ...job.opportunities.flatMap((item) => [
        item.summary,
        item.userNeed,
        item.contributionRules,
        item.popularity,
        item.feasibility,
        item.effort,
        ...item.firstSteps,
        ...item.acceptanceChecks,
        ...item.risks,
        ...item.evidence.map((evidence) => evidence.reason),
      ]),
    ],
  },
  {
    field: "PR feedback notice and published card note",
    budget: summaryBudget,
    values: (d) => [...(d.prFeedback?.warnings ?? []), d.publishedCard?.note],
  },
];

test("the English copy fits its card budgets", () => {
  const demo = getDemo("en");
  const job = getSampleDiscoveryJob("en");
  const over: string[] = [];
  for (const { field, budget, values } of budgets) {
    const found = values(demo, job);
    assert.ok(found.length, `${field} has values`);
    for (const value of found) {
      assert.equal(typeof value, "string", field);
      const length = Array.from(value as string).length;
      assert.ok(length > 0, `${field} is empty`);
      if (length > budget) over.push(`${field} (${length} > ${budget}): ${value}`);
    }
  }
  assert.deepEqual(over, []);
});
