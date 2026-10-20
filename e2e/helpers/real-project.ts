// A real (not sample) project on a spec-local server, against a local
// stand-in for GitHub (test/fake-github.ts): Git commands that name
// https://github.com/e2e-org/widgets run against a bare repository on this
// machine, and gh answers the respect facts (the door, the issue, the
// person's pace) from what setFacts() sets, the ways a read fails
// included, and opens pull requests there. Nothing leaves the machine.
//
// Around the stand-in, gh also answers the environment check as a
// signed-in CLI and, when a spec sets them, the maintainer feedback of a
// pull request; codex and claude answer the environment check only, and
// codex answers an agent turn only with the text a spec sets (setAgentAnswer,
// or setAgentAnswers by the words of the turn's prompt), after
// holdAgent(false) when a spec holds it, so no real agent can run. Both log
// the arguments of every call (agentCalls), so a spec can check that no
// turn had write access.
//
// The project's clone holds CONTRIBUTING.md, two source files and a test,
// and one run in review whose worktree changes all three (the test's
// assertion is loosened), with an explanation of each file, so the
// understanding check asks two file questions and what was not tested.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FakeFacts, FakeGitHub } from "../../test/fake-github";
import { fakeGitHub } from "../../test/fake-github";
import { readDiff } from "../../server/git";
import { launchServer, type LaunchedServer } from "../start-server.mjs";
import { startTrial } from "./ready-server";

export const owner = "e2e-org";
export const name = "widgets";
export const repoUrl = `https://github.com/${owner}/${name}`;
/** A UUID, as BELL gives an imported repository (the task form checks it). */
export const repoId = "3f1c1a52-6b1e-4c58-9d2f-1a2b3c4d5e6f";
export const runId = "e2e-widgets-run";
export const issueUrl = `${repoUrl}/issues/7`;
/** The person, as gh names them. */
export const login = "sample-contributor";

/** The quoted rules: an issue first, and explaining the change. */
const contributing = [
  "# Contributing to widgets",
  "",
  "Open an issue before changing behavior.",
  "",
  "You must be able to explain your change in review.",
  "",
].join("\n");

const greetingBefore = 'export function greeting(name: string) {\n  return `Hello, ${name}!`;\n}\n';
/** Greets in the person's language, falling back to English: 60 lines. */
const greetingAfter = [
  "export type Language = string;",
  "",
  "/** The greeting of each language, with the name in place of {name}. */",
  "const greetings: Record<Language, string> = {",
  ...Array.from({ length: 40 }, (_, index) => `  lang${index}: "Greeting ${index}, {name}!",`),
  '  en: "Hello, {name}!",',
  "};",
  "",
  "/** The greeting for `name` in `language`, or in English when there is none. */",
  'export function greeting(name: string, language: Language = "en") {',
  "  const template = greetings[language] ?? greetings.en;",
  '  const trimmed = name.trim() || "there";',
  '  return template.replace("{name}", trimmed);',
  "}",
  "",
  "/** The languages that have a greeting. */",
  "export function languages() {",
  "  return Object.keys(greetings).sort();",
  "}",
  "",
].join("\n");
const formatBefore = "export const separator = ', ';\n";
/** Joins names the way a sentence lists them: 45 lines. */
const formatAfter = [
  "export const separator = ', ';",
  "",
  "/** Names as a sentence lists them: \"A\", \"A and B\", \"A, B and C\". */",
  "export function listNames(names: readonly string[]) {",
  "  const clean = names.map((name) => name.trim()).filter(Boolean);",
  "  if (clean.length <= 1) return clean.join('');",
  "  const last = clean[clean.length - 1];",
  "  return `${clean.slice(0, -1).join(separator)} and ${last}`;",
  "}",
  "",
  ...Array.from({ length: 34 }, (_, index) => `export const example${index} = listNames(["a${index}", "b${index}"]);`),
  "",
].join("\n");
export const testFile = "test/greeting.test.ts";
const testBody = (assertion: string) =>
  [
    'import { expect, test } from "vitest";',
    'import { greeting } from "../src/greeting";',
    "",
    'test("greets", () => {',
    `  ${assertion}`,
    "});",
    "",
  ].join("\n");

export const files = {
  greeting: "src/greeting.ts",
  format: "src/format.ts",
  test: testFile,
} as const;

/** What the agents wrote about each file: its explanation card. */
export const explanations = {
  [files.greeting]: {
    summary: "The greeting now comes from a table of languages and falls back to English.",
    reason: "People asked to be greeted in their own language.",
    concept: "Lookup tables\nA table keyed by language replaces a chain of conditions.",
    tip: "Check the fallback whenever a key may be missing.",
    example: {
      scenario: "Greeting Ada in a language the table does not have.",
      before: "greeting(\"Ada\") always said Hello, Ada!",
      after: "greeting(\"Ada\", \"xx\") still says Hello, Ada!",
    },
    alternatives: "A switch statement per language would work too, but every new language would mean new code.",
    lookup: ["lookup table", "fallback"],
    selfCheck: {
      question: "What does greeting return for a language the table does not have, and why?",
      answer: "It returns the English greeting, because the lookup falls back to greetings.en when the language is missing.",
    },
  },
  [files.format]: {
    summary: "listNames joins names the way a sentence lists them.",
    reason: "Lists of names read better with 'and' before the last one.",
    concept: "Edge cases\nEmpty and single-item lists need their own answer.",
    tip: "Test the empty list and a list of one.",
    example: {
      scenario: "Listing three names.",
      before: "a, b, c",
      after: "a, b and c",
    },
    alternatives: "Intl.ListFormat could do this, but its output depends on the runtime's locale data.",
    lookup: ["Intl.ListFormat"],
    selfCheck: {
      question: "What does listNames return for a list with one name, and why?",
      answer: "The name alone, because a list of one or none is joined without a separator or 'and'.",
    },
  },
  [files.test]: {
    summary: "The test only checks that a greeting comes back.",
    reason: "The greeting text now depends on the language table.",
    concept: "Test strength\nA weaker assertion catches fewer mistakes.",
    tip: "Say why an assertion was loosened.",
    alternatives: "The test could check one greeting per language instead.",
    selfCheck: {
      question: "Which mistake would the loosened assertion no longer catch?",
      answer: "A wrong greeting text, since it only checks that something is returned.",
    },
  },
} as const;

/** A GraphQL issue as the stand-in answers it: open, unassigned, with a maintainer's go-ahead. */
export const issueNode = (overrides: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Greet people in their own language",
  url: issueUrl,
  state: "OPEN",
  stateReason: null,
  locked: false,
  author: { login: "reporter" },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  comments: {
    totalCount: 1,
    nodes: [
      {
        author: { login: "maintainer", __typename: "User" },
        authorAssociation: "MEMBER",
        body: "PRs welcome for this one.",
        createdAt: "2026-10-01T09:00:00Z",
        url: `${issueUrl}#issuecomment-1`,
      },
    ],
  },
  closedByPullRequestsReferences: { nodes: [] },
  timelineItems: { nodes: [] },
  ...overrides,
});

/** Another person's open pull request that would close the issue. */
export const otherPr = {
  closedByPullRequestsReferences: {
    nodes: [
      {
        number: 9,
        state: "OPEN",
        isDraft: false,
        merged: false,
        url: `${repoUrl}/pull/9`,
        author: { login: "other_dev" },
      },
    ],
  },
};

/** Facts under which the project welcomes the change: everything passes. */
export const welcomeFacts: FakeFacts = {
  login,
  door: { viewerPermission: "READ" },
  issues: { 7: issueNode() },
  pacing: { open: 0, merged: 0 },
};

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    // The person's own Git settings (signing, hooks) stay out of it.
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

/**
 * The run's diff as the server reads it, for its files' fingerprints:
 * server/git.ts readDiff with the server's Git settings.
 */
async function fingerprints(worktreePath: string, baseSha: string, gitconfig: string) {
  const saved = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  try {
    const diff = await readDiff({ worktreePath, baseSha, locale: "en" });
    return Object.fromEntries(diff.map((file) => [file.path, file.fingerprint]));
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saved;
  }
}

/** The run in review as state.json holds it. */
function reviewRun(
  worktreePath: string,
  baseSha: string,
  prints: Record<string, string>,
  extra: Record<string, unknown>,
) {
  const at = "2026-10-14T09:00:00.000Z";
  return {
    id: runId,
    repoId,
    title: "Greet people in their own language",
    prompt: "Greet people in their own language, falling back to English.",
    status: "review",
    branch: "fix/greet-languages",
    baseBranch: "main",
    baseSha,
    worktreePath,
    createdAt: at,
    locale: "en",
    agents: [],
    logs: [],
    draft: {
      title: "Greet people in their own language",
      body: "## Summary\n\nGreetings now come from a table of languages.\n\n## Testing\n\nRan the greeting test.",
    },
    reviewedFiles: [],
    reviewedFingerprints: {},
    reports: {
      tester: "Ran the greeting test. The empty name and listNames with one name have no test.",
    },
    contributionSettings: {
      direction: "feature",
      targetUser: "",
      outcome: "",
      constraints: "",
      acceptance: "",
      maxTeammates: 2,
      requirePlanApproval: true,
      ponytailMode: "lite",
      model: "",
      reasoningEffort: "",
      issueUrl,
    },
    explanations: Object.fromEntries(
      Object.entries(explanations).map(([file, content]) => [
        file,
        { fingerprint: prints[file], status: "ready", generatedAt: at, content },
      ]),
    ),
    ...extra,
  };
}

/** One call of the stand-in codex or claude: its arguments, and for a codex turn the start of its prompt. */
export interface AgentCall {
  cli: "codex" | "claude";
  args: string[];
  prompt?: string;
}

/** An answer of the stand-in codex for a turn whose prompt contains `when` (the first that matches wins). */
export interface AgentAnswer {
  when: string;
  text: string;
}

export interface RealProject extends LaunchedServer {
  github: FakeGitHub;
  /** Sets what gh answers about the door, the issue and the pace. */
  setFacts(facts: FakeFacts): Promise<void>;
  /** The gh calls BELL made, in order (the environment check's aside). */
  ghCalls(): Promise<string[][]>;
  /** The maintainer feedback gh answers for the run's pull request (BellPrFeedback). */
  setPrFeedback(response: unknown): Promise<void>;
  /** What codex answers an agent turn: the JSON text of its last message. */
  setAgentAnswer(text: string): Promise<void>;
  /** Answers by the words of the turn's prompt; a turn none matches gets setAgentAnswer's text. */
  setAgentAnswers(answers: AgentAnswer[]): Promise<void>;
  /** Every call of the stand-in codex and claude so far, in order. */
  agentCalls(): Promise<AgentCall[]>;
  /** While held, an agent turn waits before codex answers (a turn still running). */
  holdAgent(held: boolean): Promise<void>;
}

export interface RealProjectOptions {
  /** gh's answers at the start; welcomeFacts when absent. */
  facts?: FakeFacts;
  /** app-settings.json, for example { skipUnderstandingCheck: true }. */
  appSettings?: Record<string, unknown>;
  /** Fields that replace the seeded run's. */
  run?: Record<string, unknown>;
  /** No run at all: the project only, for a run started from the task dialog. */
  withoutRun?: boolean;
  /** Fields that replace the seeded repository's, for example its stored contributionRules or testCommand. */
  repo?: Record<string, unknown>;
  /** The project's files, replacing the defaults by path (null leaves one out), for example CONTRIBUTING.md. */
  files?: Record<string, string | null>;
  /** Writes more files into the data dir after state.json, before the server starts (discovery.json, say). */
  seedData?(dataDir: string): Promise<void>;
  /** Starts the 14-day trial. */
  trial?: boolean;
  /**
   * Every file already ticked Reviewed at its current version, and the
   * loosened test's reason written, so the run can be approved at once.
   */
  reviewed?: boolean;
  /** More files: `before` in the project, `after` in the run's worktree. */
  extraFiles?: { path: string; before: string; after: string }[];
  /**
   * The run's changes committed on its branch as its first push, and the
   * run published with that commit as a Draft PR.
   */
  published?: boolean;
}

/** The seeded run's pull request when it is published. */
export const prUrl = `${repoUrl}/pull/12`;

/** The loosened assertion's weakened-test item (the removed line 5). */
export const weakenedItem = `${testFile}#-5`;

/** Starts a server with the project and its run in review; stop() removes everything. */
export async function startRealProject(options: RealProjectOptions = {}): Promise<RealProject> {
  const temp = await mkdtemp(path.join(os.tmpdir(), "bellpr-e2e-real-"));
  const removeTemp = () => rm(temp, { recursive: true, force: true });
  let server: LaunchedServer | undefined;
  try {
    const github = await fakeGitHub(temp, {
      owner,
      name,
      files: Object.fromEntries(
        Object.entries({
          "README.md": "# widgets\n",
          "CONTRIBUTING.md": contributing,
          [files.greeting]: greetingBefore,
          [files.format]: formatBefore,
          [files.test]: testBody('expect(greeting("Ada")).toBe("Hello, Ada!");'),
          ...Object.fromEntries((options.extraFiles ?? []).map((file) => [file.path, file.before])),
          ...options.files,
        }).filter((entry): entry is [string, string] => entry[1] !== null),
      ),
    });
    // The stand-in put its bin first on this process's PATH; only the server uses it.
    github.restore();
    await github.setFacts(options.facts ?? welcomeFacts);
    const fakeBin = path.join(temp, "fake-bin");
    const readyBin = path.join(temp, "ready-bin");
    await mkdir(readyBin, { recursive: true });
    const feedbackFile = path.join(temp, "pr-feedback.json");
    const answerFile = path.join(temp, "agent-answer.txt");
    const answersFile = path.join(temp, "agent-answers.json");
    const callsFile = path.join(temp, "agent-calls.jsonl");
    const holdFile = path.join(temp, "agent-hold");
    /** Appends this call's arguments (and a codex turn's prompt start) to the calls log. */
    const logCall = (cli: string) =>
      `require("node:fs").appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ cli: ${JSON.stringify(cli)}, args: process.argv.slice(2), ...(prompt ? { prompt: prompt.slice(0, 2000) } : {}) }) + "\\n");`;
    await writeFile(
      path.join(readyBin, "gh"),
      `#!/bin/sh
case "$1" in
  --version) echo "gh version 2.46.0 (2024-03-13)"; exit 0 ;;
  auth) echo "gho_sample"; exit 0 ;;
esac
if [ "$1" = api ] && [ "$2" = --include ] && [ "$3" = user ]; then
  printf 'HTTP/2.0 200 OK\\r\\nX-Oauth-Scopes: repo, workflow, read:org\\r\\n\\r\\n${login}\\n1\\n'
  exit 0
fi
case "$*" in
  *BellPrFeedback*) if [ -f "${feedbackFile}" ]; then cat "${feedbackFile}"; exit 0; fi ;;
esac
exec "${path.join(fakeBin, "gh")}" "$@"
`,
      { mode: 0o755 },
    );
    await writeFile(
      path.join(readyBin, "claude"),
      `#!${process.execPath}
const prompt = undefined;
${logCall("claude")}
const args = process.argv.slice(2);
if (args[0] === "--version") console.log("2.1.292 (Claude Code)");
else if (args[0] === "auth") console.log('{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "pro"}');
else process.exit(1);
`,
      { mode: 0o755 },
    );
    // codex exec reads its prompt on stdin; an answer whose words appear in it is given, else the default one.
    await writeFile(
      path.join(readyBin, "codex"),
      `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const prompt = args[0] === "exec" ? fs.readFileSync(0, "utf8") : undefined;
${logCall("codex")}
if (args[0] === "--version") console.log("codex-cli 0.159.0");
else if (args[0] === "login") console.log("Logged in using ChatGPT");
else if (args[0] !== "exec") process.exit(1);
else {
  const answer = () => {
    if (fs.existsSync(${JSON.stringify(holdFile)})) return setTimeout(answer, 200);
    const answers = fs.existsSync(${JSON.stringify(answersFile)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(answersFile)}, "utf8")) : [];
    const matched = answers.find((entry) => prompt.includes(entry.when));
    const text = matched ? matched.text : fs.existsSync(${JSON.stringify(answerFile)}) ? fs.readFileSync(${JSON.stringify(answerFile)}, "utf8") : undefined;
    if (text === undefined) process.exit(1);
    process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\\n");
  };
  answer();
}
`,
      { mode: 0o755 },
    );
    const gitconfig = path.join(temp, "gitconfig");
    await writeFile(gitconfig, "[user]\n\tname = Sample Contributor\n\temail = contributor@example.com\n");

    server = await launchServer({
      env: {
        PATH: [readyBin, fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
        GIT_CONFIG_GLOBAL: gitconfig,
      },
      async seed(dataDir) {
        const checkout = path.join(dataDir, "repos", name);
        await mkdir(path.dirname(checkout), { recursive: true });
        execFileSync("git", ["clone", "-q", github.bare, checkout], {
          env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
        });
        git(checkout, "remote", "set-url", "origin", `${repoUrl}.git`);
        const baseSha = git(checkout, "rev-parse", "HEAD");
        const worktreePath = path.join(dataDir, "worktrees", runId);
        await mkdir(path.dirname(worktreePath), { recursive: true });
        git(checkout, "worktree", "add", "-q", "-b", "fix/greet-languages", worktreePath, baseSha);
        await writeFile(path.join(worktreePath, files.greeting), greetingAfter);
        await writeFile(path.join(worktreePath, files.format), formatAfter);
        await writeFile(path.join(worktreePath, files.test), testBody("expect(greeting(\"Ada\")).toBeDefined();"));
        for (const file of options.extraFiles ?? []) {
          await mkdir(path.dirname(path.join(worktreePath, file.path)), { recursive: true });
          await writeFile(path.join(worktreePath, file.path), file.after);
        }
        const prints = await fingerprints(worktreePath, baseSha, gitconfig);
        let published: Record<string, unknown> = {};
        if (options.published) {
          git(worktreePath, "add", "-A");
          git(
            worktreePath,
            "-c",
            "user.name=Sample Contributor",
            "-c",
            "user.email=contributor@example.com",
            "commit",
            "-q",
            "-m",
            "Greet people in their own language",
          );
          const publishCommit = git(worktreePath, "rev-parse", "HEAD");
          published = {
            status: "published",
            prUrl,
            publishedBranch: "fix/greet-languages",
            publishCommit,
            reviewedFiles: Object.keys(prints),
            reviewedFingerprints: prints,
          };
        }
        await writeFile(
          path.join(dataDir, "state.json"),
          JSON.stringify({
            version: 1,
            repos: [
              {
                id: repoId,
                name,
                owner,
                fullName: `${owner}/${name}`,
                path: checkout,
                defaultBranch: "main",
                url: repoUrl,
                ...options.repo,
              },
            ],
            runs: options.withoutRun ? [] : [
              reviewRun(worktreePath, baseSha, prints, {
                ...(options.reviewed
                  ? {
                      reviewedFiles: Object.keys(prints),
                      reviewedFingerprints: prints,
                      reviewability: {
                        testReasons: { [weakenedItem]: "The greeting text now depends on the language table." },
                      },
                    }
                  : {}),
                ...published,
                ...options.run,
              }),
            ],
          }),
        );
        if (options.appSettings)
          await writeFile(path.join(dataDir, "app-settings.json"), JSON.stringify(options.appSettings));
        await options.seedData?.(dataDir);
      },
    });
    if (options.trial) await startTrial(server);
    const { stop } = server;
    return {
      ...server,
      github,
      setFacts: (facts) => github.setFacts(facts),
      ghCalls: async () => (await github.calls()).filter((call) => call[0] === "gh"),
      setPrFeedback: (response) => writeFile(feedbackFile, JSON.stringify(response)),
      setAgentAnswer: (text) => writeFile(answerFile, text),
      setAgentAnswers: (answers) => writeFile(answersFile, JSON.stringify(answers)),
      agentCalls: async () =>
        (await readFile(callsFile, "utf8").catch(() => ""))
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as AgentCall),
      holdAgent: (held) => (held ? writeFile(holdFile, "") : rm(holdFile, { force: true })),
      stop: async () => {
        await stop();
        await removeTemp();
      },
    };
  } catch (error) {
    await server?.stop();
    await removeTemp();
    throw error;
  }
}
