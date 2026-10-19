import { formatters } from "../../shared/i18n/locale";
import { buildDemoContent } from "./shared";
import type { DemoContent } from "./types";

const { plural } = formatters("en");
const answerPrefix = "Sample · prewritten, no AI call.\n\n";

const en: DemoContent = buildDemoContent({
  locale: "en",
  explanations: {
    "src/utils/retry.ts": {
      example: {
        scenario:
          "You and many others refresh the train times at once, and the service is briefly overloaded. After a request fails, the code has to decide when to try again.",
        before:
          "It always waits a fixed **1 second** before the next try. If everyone fails together, the next wave of requests lands at the same moment too.",
        after:
          "Each wait is now drawn at random: under **1 second** at first, then under **2 seconds**, so requests spread out. Errors that are not worth retrying stop right away. This raises the odds of recovery; the request can still fail once the retries run out.",
      },
      summary:
        "Instead of always waiting 1 second after a failure, the wait grows each time and gets a little randomness. A brief network problem now has a chance to clear up on its own.",
      reason:
        "If many users fail and retry at the same moment, the server is flooded again. Spreading the retries out breaks that chain reaction.",
      concept:
        "Exponential backoff\nThe wait ceiling doubles each round: 1 second, 2 seconds, 4 seconds. Full jitter picks a random wait between 0 and that ceiling, and maxDelay keeps the ceiling at 30 seconds or less.",
      tip: "Not every error deserves a retry. shouldRetry lets the caller decide which failures may try again. Write requests with side effects also need to be idempotent before you retry them.",
      alternatives:
        "Another option is a fixed interval with a little random jitter, such as 1 second ± 0.3 seconds. It is simpler and its waits are predictable, but when many clients fail together they still retry at about the same time. This change skips it because the scenario is exactly an overloaded server. With very few retries and a hard response deadline, a fixed interval would be the better choice.",
      lookup: ["exponential backoff", "full jitter", "idempotency"],
      selfCheck: {
        question:
          "On the third retry (attempt = 2), what is the wait ceiling in seconds? Why is the real wait shorter?",
        answer:
          "The ceiling is min(30, 1 × 2²) = 4 seconds. Full jitter picks a random wait between 0 and that ceiling, so the real wait can be anything under 4 seconds.",
      },
    },
    "src/client.ts": {
      example: {
        scenario:
          "You open your account page. The code reads your data with a GET request, but the server briefly answers `503` with an error message.",
        before:
          "The code never checks whether the HTTP call succeeded. It reads the reply as JSON right away, and a `503` does not lead to a retry.",
        after:
          "The code now recognizes `503` as a retryable error and hands it to the retry helper. If the service recovers in time, your data arrives; past the limit, the failure is still reported. Problems such as `401` are reported at once, with no retry.",
      },
      summary:
        "Wires retries into GET requests. Temporary server errors and network errors can try again. Problems the user has to fix, such as 401 or 404, are reported right away.",
      reason:
        "fetch still resolves with a Response on HTTP 500; it does not throw. Checking response.ok first is how the retry helper learns that the request failed.",
      concept:
        "Error classification\nThe HTTP status code tells you why a request failed. Keeping the Response inside HttpError lets the caller decide from the status whether to retry, and keeps the details for debugging.",
      tip: "This sample enables retries for GET only. Before production it should also handle Retry-After, cancellation and JSON parse errors, so that different kinds of failure stay apart.",
      alternatives:
        "You could skip HttpError and check `error.status` inside shouldRetry. The code is shorter, but you lose type safety, and callers no longer get the full Response for debugging. If the project already has a shared error class, reuse it instead of adding another one.",
      lookup: ["custom error class", "retryable HTTP status codes"],
      selfCheck: {
        question:
          "Does this code retry when the server returns 404? Which line of the diff decides that?",
        answer:
          "No. shouldRetry returns true only for 408, 429, 500, 502, 503 and 504. 404 is not on the list, so the HttpError is thrown right away.",
      },
    },
    "src/types.ts": {
      example: {
        scenario:
          "A site maintainer wants the first retry to wait at most 500 ms, and every later wait to stay under 5 seconds. They need to know how to fill in the options.",
        before:
          "The old type listed only the retry count and a fixed `delay`. `ClientOptions` had no `retry` field, so the interface gave no hint of the new settings.",
        after:
          "With the new types, the editor can suggest `retry: { baseDelay: 500, maxDelay: 5000 }`. This file only describes the options; other code does the actual waiting and retrying.",
      },
      summary:
        "Defines the retry count, the wait ceilings and the error check as an explicit TypeScript interface. People using the SDK see the documentation right in their editor.",
      reason:
        "Keeping the option types in one place stops modules from defining slightly different versions of the same settings. It also shows where to update things when a feature is added.",
      concept:
        "unknown and type narrowing\nAn error is not always an Error object. Typing it as unknown makes the code check the type before it reads a property, instead of assuming one.",
      tip: "Renaming delay to baseDelay is a breaking change. A real PR should include migration notes, or keep the old name for a while, marked deprecated, so users have time to upgrade.",
      alternatives:
        "Another option is to keep `delay` as a deprecated alias next to `baseDelay`. Existing configs would keep working for a release, at the cost of two names for one setting. This change renames it outright because the sample is small and young; a widely used SDK should usually keep the alias for a release.",
      lookup: ["TypeScript Omit", "deprecation"],
      selfCheck: {
        question:
          "Why does ClientOptions.retry leave out shouldRetry? What could go wrong if callers could set it there?",
        answer:
          "The client decides which HTTP statuses are worth retrying through its own shouldRetry. A caller's version would be overwritten and silently ignored, so the type leaves it out instead.",
      },
    },
    "tests/retry.test.ts": {
      example: {
        scenario:
          "You want proof that retries work as designed, without tests that need a real network or wait several seconds every run.",
        before:
          "This new test file did not exist yet. Retry code that looks reasonable is not evidence that either case works.",
        after:
          'One test sets up "fail once, then succeed", moves virtual time forward by 500 ms and checks that the result is `ok`. The other checks that a disallowed retry calls the operation only once. These tests add checks; they do not change user requests, and they have not actually been run.',
      },
      summary:
        "Adds two repeatable tests: a temporary failure that then succeeds, and an excluded error that runs only once. The tests use virtual time, so nothing really waits.",
      reason:
        "Retries involve time and randomness, so real timers make tests slow or flaky. Pinning the random value and controlling the clock lets the tests count calls exactly.",
      concept:
        "Fake timers and test doubles\nvi.useFakeTimers takes over the timers, and mockReturnValue(0.5) pins the random value. The first ceiling is 1 second, so moving time forward by 500 ms triggers the second call.",
      tip: "These are sample tests, not full coverage. They still need cases for the retry limit, the longest wait, repeated failures, option validation and the status codes the client retries.",
      alternatives:
        "The tests could pass a fake `sleep` into withRetry and record each requested wait instead of using fake timers. That checks the waits directly without mocking timers, but it changes the helper's public signature for the tests alone. Fake timers keep the API as it is.",
      lookup: ["fake timers", "dependency injection"],
      selfCheck: {
        question:
          "Why does the first test move time forward by exactly 500 ms? What could happen if Math.random were not pinned?",
        answer:
          "With Math.random pinned to 0.5 and a first ceiling of 1 second, the wait is 500 ms. Unpinned, the wait would be random, so the test could fail or pass by luck.",
      },
    },
    "README.md": {
      example: {
        scenario:
          "An engineer upgrading the SDK finds `delay: 1000` in their old config. They want to know what to change, and what the retry count really means.",
        before:
          "The README only introduced the HTTP client. It said nothing about retry settings, which errors are retried or how to replace the old field.",
        after:
          'The docs give a complete config example, switch to `baseDelay`, and spell out the default as "3 retries after the first attempt". Upgrading gets easier; the docs themselves do not change how the code runs.',
      },
      summary:
        "Adds usage, default behavior and upgrade notes. Without reading the source, users learn which errors are retried, how long the waits can get and how to configure it.",
      reason:
        'When behavior changes, the docs are part of the interface. Writing "3 retries after the first attempt" keeps readers from taking it as 3 attempts in total.',
      concept:
        "Docs from the user's side\nSay what the feature does first, then give a config example people can adapt, and finish with the limits and how to migrate.",
      tip: "When you review docs, check every default against the code. The example should also show how to import the client, and say that retries do not replace the app's own error handling.",
      alternatives:
        "The retry settings could live on a separate guide page linked from the README. The README would stay short, but people upgrading often read only the README and could miss the migration note. For a small SDK, one README section is easier to find.",
      lookup: ["migration guide", "semantic versioning"],
      selfCheck: {
        question:
          "With the default settings, how many requests can one GET make in total, and which statuses fail at once?",
        answer:
          "Up to 4: the first attempt and 3 retries. Statuses outside 408, 429, 500, 502, 503 and 504, such as 404, fail without a retry.",
      },
    },
  },
  run: {
    title: "Smart GET retries",
    prompt:
      "Add exponential backoff and jitter to the SDK's GET requests. Keep the retry count configurable, and add tests and usage docs.",
    agents: {
      lead: { role: "Planning", detail: "Wrote the sample plan" },
      "member-1": {
        role: "Coding",
        detail: "Wrote sample changes to 3 core files",
      },
      "member-2": {
        role: "Coding",
        detail: "Wrote the sample change to src/client.ts",
      },
      "member-3": {
        role: "Coding",
        detail: "Wrote the sample change to README.md",
      },
      reviewer: { role: "Code review", detail: "Listed sample review points" },
      tester: {
        role: "Testing",
        detail: "Prepared sample tests; they were not run",
      },
    },
    logs: {
      plan: "Sample: split the work into the retry helper, HTTP wiring, tests and docs.",
      implement:
        "Sample: used exponential backoff with full jitter, and capped the longest wait.",
      review:
        "Sample: flagged API compatibility and test coverage for a person to confirm.",
    },
    reports: {
      implementer:
        "Sample · Lead integration summary (prewritten)\n\nThe four tasks are integrated. `withRetry` in `src/utils/retry.ts` now uses exponential backoff with full jitter and gains the `baseDelay`, `maxDelay` and `shouldRetry` options. `src/client.ts` turns retries on for GET requests only. `tests/retry.test.ts` adds two cases, and README.md documents the new settings.\n\nStatic check: what each task reported matches the integrated diff. The project's tests were not run in this sample.\n\nStill open: renaming `retry.delay` to `retry.baseDelay` is a breaking change. A maintainer still has to confirm the version bump and the migration notes.\n\n## Suggested review order:\n\nRead the types first to learn the new options, then the implementation and its caller to see how they are used. Leave the tests for last, to check what you understood.\n\n1. `src/types.ts` — defines the new `baseDelay`, `maxDelay` and `shouldRetry`; the other files depend on it.\n2. `src/utils/retry.ts` — the backoff and jitter logic, the core of this change.\n3. `src/client.ts` — the caller, which retries GET requests only.\n4. `tests/retry.test.ts` — two cases that match the behavior you just read.\n5. `README.md` — check last that the settings users read about match the code.",
      reviewer:
        "Sample · Independent review (prewritten)\n\n**Correctness**: `src/utils/retry.ts` computes each wait as `Math.floor(Math.random() * ceiling)`, and `ceiling` is capped at `maxDelay`, so no wait goes past the limit. But `maxRetries` is never validated: a negative value rethrows the first error without saying why, and `NaN` never reaches the limit, so the call would retry forever.\n\n**Compatibility**: `src/client.ts` now reads `retry.baseDelay`. A `retry.delay` that callers still pass is silently ignored; a warning in the types or at runtime would help.\n\n**Maintainability**: the retry decision lives in `shouldRetry` alone, so supporting `Retry-After` later means changing one place.\n\nThis review read the diff statically. No code was run.",
      tester:
        "Sample · Test analysis (prewritten)\n\n`tests/retry.test.ts` has two cases: a temporary failure that succeeds on the second call, and a single call that keeps the original error when `shouldRetry` returns false.\n\nMissing cases:\n\n1. Once `maxRetries` is used up, the last error is thrown.\n2. With `Math.random` pinned, no wait goes past `maxDelay`.\n3. `src/client.ts` retries a 503 but fails a 404 after one call.\n\nRegression risk: after the `retry.delay` rename, old configs silently run with the default `baseDelay`. The current tests cannot catch that.\n\nThis analysis did not run the tests; it is a static reading.",
    },
  },
  insights: {
    summary: "A typed HTTP client that keeps API calls simple.",
    purpose:
      "Open Fetch wraps the native fetch in a typed HTTP client with shared settings, so dashboards, search results and lists all read API data the same way.",
    audience: [
      "Front-end developers who call APIs",
      "Teams that maintain a shared SDK",
    ],
    userJourney: [
      "A developer sets the API URL and creates a shared client.",
      "Someone opens a dashboard or list, and the page sends a GET request.",
      "The client gets JSON back and hands it to the page.",
      "A brief failure should have a predictable way to recover.",
    ],
    modules: {
      // Short: the review panel shows each one on a single 340px line.
      "src/client.ts": "Sends GET requests.",
      "src/utils/retry.ts": "Retries with waits.",
      "src/types.ts": "Client and retry options.",
      "tests/retry.test.ts": "Sample tests.",
    },
    readingPath: {
      "README.md": {
        why: "Learn who the client is for and what it solves, so the code has context.",
        lookFor:
          "How to install it, the example that creates a client, and its promise of types.",
      },
      "src/types.ts": {
        why: "Every module shares these option types. Reading them first means reading the contract.",
        lookFor:
          "Which fields the client and retry options have, and which are optional.",
      },
      "src/client.ts": {
        why: "This is the entry point people call; every request goes in and out here.",
        lookFor:
          "How GET builds the URL and calls fetch, and where retry is not wired in yet.",
      },
      "src/utils/retry.ts": {
        why: "Every suggested direction centers on it. Know its wait strategy before you judge a fix.",
        lookFor:
          "The retry count, the fixed wait, and how it decides whether to try again.",
      },
    },
    howItFitsTogether:
      'Callers create the client in src/client.ts with options typed in src/types.ts. Its GET calls fetch directly and hands the JSON to the page. src/utils/retry.ts is a separate helper: before this change, the client imports it but never calls it. "The client will wrap retry" is the suggested direction, not the current state.',
    evidence: {
      "README.md":
        "The sample project calls itself a small, typed HTTP client for modern apps.",
      "src/client.ts":
        "In the sample diff, the original GET calls fetch directly, without the retry helper.",
      "src/utils/retry.ts":
        "The existing helper waits a fixed time and never checks whether an error is worth retrying.",
    },
    recommendations: {
      "demo-smart-retry": {
        title: "Let read requests recover from brief failures",
        problem:
          "GET requests cannot recover from a brief network or server error. The existing retry helper is not part of the request flow yet.",
        userImpact:
          "Lists and dashboards built on this client can still load after a brief error, so people refresh by hand less often.",
        approach:
          "Turn on capped exponential backoff with random waits for GET only, and separate retryable status codes from the rest.",
        acceptance: [
          "After a temporary failure, the next success returns the data.",
          "Errors not worth retrying, such as 401 or 404, are reported at once.",
          "It stops at the limit and keeps the original error.",
        ],
      },
      "demo-retry-boundaries": {
        title: "Put the time and count limits under test too",
        problem:
          "The sample tests cover recovery and an excluded error. The retry limit, the wait ceiling and repeated failures are not fully checked yet.",
        userImpact:
          "When maintainers change the retry policy, endless retries or overlong waits show up in tests before users feel them.",
        approach:
          "Add edge cases with virtual time and a pinned random value, so no test depends on real waiting.",
        acceptance: [
          "Repeated failures stop after the configured count.",
          "No backoff wait goes past maxDelay.",
          "Timers and mocks are restored after each test.",
        ],
      },
      "demo-upgrade-guide": {
        title: "Show developers on the old config how to upgrade",
        problem:
          "Renaming delay to baseDelay affects existing callers. A new config example alone may not explain how the behavior changed.",
        userImpact:
          "Developers who integrate the SDK see how a fixed wait differs from a backoff ceiling, and misconfigure retries less often when they upgrade.",
        approach:
          "Add a before-and-after migration, the total retry count, the cases that never retry, and the compatibility trade-off.",
        acceptance: [
          "Clearly separates the first request from the extra retries.",
          "Shows a migration from delay to baseDelay.",
          "Reminds readers to retry only safe operations, to avoid duplicate writes.",
        ],
      },
    },
  },
  contributionBrief: {
    problem:
      "When people load a list or dashboard, even a brief network error can make the data request fail outright. The GET client does not use the retry helper yet.",
    motivation:
      "Brief errors usually need no action from the user. Bounded recovery in the shared client gives every screen the same policy.",
    beneficiaries: [
      "People waiting for data to load",
      "Developers who build on this SDK",
    ],
    before:
      "After one failed GET, the client reports the error. The app may have to show it and let the user retry by hand.",
    after:
      "On a retryable error, the client tries again with growing, staggered waits, and reports the failure once it hits the limit. 401s, 404s and POST requests never retry.",
    validation: [
      "Recovers after a temporary failure and returns the right data.",
      "A non-retryable error never triggers a second request.",
      "Check the count and wait limits; the sample tests do not cover every edge yet.",
    ],
    risks: [
      "Retries add requests and waiting time before a final failure.",
      "Renaming delay to baseDelay affects existing configs and needs migration notes.",
      "Retry-After and cancellation still need handling; this sample does not do it.",
    ],
  },
  team: {
    planSummary:
      "Four scoped tasks: shared types first, then the client and the docs in parallel, then tests and a cross-review to confirm that retries cover only recoverable GET failures.",
    premise: {
      statement:
        "The request takes for granted that GET requests do not retry today, so one brief failure fails the request outright.",
      evidence:
        "src/client.ts:12 sends a single fetch and reads the JSON without checking the status. src/utils/retry.ts:6 defines withRetry, but nothing calls it yet.",
    },
    tasks: {
      "task-1": {
        title: "Define the retry policy and types",
        description:
          "Build backoff, jitter and retry conditions, and keep the generic return type.",
        report:
          "Sample report: added a configurable retry policy and its types. For real evidence, rely on a real task's report.",
      },
      "task-2": {
        title: "Wire retries into users' GET requests",
        description:
          "Keep HTTP error details, and separate temporary failures from statuses that must never retry.",
        report:
          "Sample report: only GET requests retry. Writes, such as payments, are never resent.",
      },
      "task-3": {
        title: "Document usage and limits",
        description:
          "Show SDK users how to configure retries, and when they do not apply.",
        report:
          "Sample report: documented the defaults, the error classes and compatibility.",
      },
      "task-4": {
        title: "Verify the limits and the integration",
        description:
          "Check the retry limit, the errors that never retry and what the last failure returns.",
        report:
          "This is a sample test plan. No tests were run against a real repository.",
      },
    },
    messages: {
      m1: "Goal: give brief network failures a chance to recover. Change GET behavior only, and keep the existing interface.",
      m2: "RetryOptions is ready. Pass the HTTP classification in through shouldRetry, and keep HTTP out of the retry helper.",
    },
  },
  draftPreparation: {
    warnings: [
      "This is an interface sample. The source documents, rules and draft are sample data; no real project was read.",
    ],
    sources: {
      "demo-contributing": {
        label: "Contributing guide (sample)",
      },
      "demo-template": {
        label: "PR template (sample)",
        content:
          "## Motivation\n\n## Changes\n\n## Validation and limits\n\nSeparate the checks you ran from the items still to verify.",
      },
    },
    proposal: {
      title: "Help read requests recover from temporary failures",
      summary:
        "This sample follows the project template: first the problem people hit, then the retry scope and the limits still to confirm.",
      body: "## Motivation\n\nWhen a read request hits a temporary network problem, people have to repeat what they did before they can continue. This sample shows how eligible read requests get a chance to recover on their own.\n\n## Changes\n\n- Limit retries to eligible requests and error types.\n- Cap the wait time and the number of retries.\n- Keep the error message when the request finally fails.\n\n## Validation and limits\n\nThis is a sample of the draft interface. **No tests have been run.** Before you send it, confirm:\n\n- A temporary failure followed by a success.\n- The error is still reported correctly past the retry limit.\n- Write operations that must not retry are never sent twice.",
      rules: [
        {
          sourceId: "demo-contributing",
          text: "The title states the improvement this contribution brings.",
          quote: "Titles should describe the improvement users get.",
        },
        {
          sourceId: "demo-template",
          text: "Validation status and limits go in the template, so pending checks never read as passed.",
          quote: "Separate the checks you ran from the items still to verify.",
        },
      ],
      checklist: [
        "Check that each template section matches the actual diff.",
        "Fill in the test commands you really ran, with their results.",
        "Confirm the retry limit and which operations must never retry.",
      ],
      commitRationale:
        "The sample contributing guide asks for a type(scope): summary subject, then a blank line and the reason. This suggestion adds no sign-off line.",
    },
  },
  answers: [
    {
      topic: "test",
      keywords: /\b(?:test|verify|check|confirm)/i,
      text: ({ file }) =>
        `${answerPrefix}For ${file.path}, start with behavior you can observe:\n\n1. When the first call succeeds, the operation runs once.\n2. After a temporary failure it tries again, but never more than maxRetries + 1 calls in total.\n3. When shouldRetry returns false, it stops at once and keeps the original error.\n4. Pin the random value and use fake timers to check each wait against its ceiling and maxDelay.\n\nThe sample tests cover only recovery and the no-retry case. The other edge cases still need tests.`,
    },
    {
      topic: "jitter",
      keywords: /\b(?:jitter|random|backoff|exponential)/i,
      text: () =>
        `${answerPrefix}Picture a crowd leaving a traffic jam in small groups instead of all at once.\n\nThe wait ceilings for rounds 1, 2 and 3 are 1, 2 and 4 seconds. The code computes baseDelay × 2^attempt and caps it with maxDelay.\n\nMath.random() then spreads the real wait between 0 and that ceiling; this is full jitter. If it always returned 0.5, the three waits would be 0.5, 1 and 2 seconds.\n\nRandom waits spread out retries that would otherwise arrive together. They do not guarantee that any one request succeeds.`,
    },
    {
      topic: "risk",
      keywords: /\b(?:risk|caveat|improve|compat|better|problem)/i,
      text: ({ file }) =>
        `${answerPrefix}${file.explanation?.tip ?? "Start by checking this change's inputs, outputs and error handling."}\n\nThis sample still needs checks for negative or non-finite settings, cancelled requests, Retry-After, and whether the original error survives once the retries run out. In a real contribution, the target repository's conventions and test results have the final say.`,
    },
    {
      topic: "why",
      keywords: /\b(?:why|reason)/i,
      text: ({ file }) =>
        `${answerPrefix}${file.explanation?.reason ?? "This sample keeps the recovery logic for temporary failures in one place."}\n\n${file.explanation?.concept ?? ""}\n\nCompare it with the diff: red lines were removed, green lines were added, and unmarked lines give context.`,
    },
    {
      topic: "generic",
      // The fallback: demoAnswer() uses it when no other topic matches.
      keywords: /(?:)/,
      text: ({ file }) =>
        `${answerPrefix}${file.path}\n\n${file.explanation?.summary ?? "This file holds code changes from this task."}\n\n${file.explanation?.concept ?? ""}\n\nThis teaching sample was picked by file and keyword; it is not a live reading of the code you selected. In a real task, follow-up questions go to the model you set up.`,
    },
  ],
  discovery: {
    interests: "Developer tools, documentation, accessibility",
    message: ({ count }) =>
      plural(count) === "one"
        ? `Sample: found ${count} source-backed opportunity to contribute. Maintainer interest and scope still need confirming.`
        : `Sample: found ${count} source-backed opportunities to contribute. Maintainer interest and scope still need confirming.`,
    warnings: [
      "This is a sample result: the projects, issues and quotes are fictional. GitHub was not searched and no AI model was called.",
    ],
    popularity: ({ stars, forks, pushedAt }) =>
      `Sample snapshot: ${stars} stars, ${forks} forks, last pushed ${pushedAt}. Popularity does not guarantee that a proposal is accepted.`,
    opportunities: {
      "markwell-link-positions": {
        title: "Show the line and column in broken-link warnings",
        summary:
          "Broken-link warnings name only the file, so readers search long pages by hand. The heading rules already print `file:line:column`, and the link rule can do the same.",
        userNeed:
          "People who maintain documentation sites can jump straight to the broken line instead of searching the whole page.",
        contributionRules:
          "Claim the issue in a comment before you start. Every rule change needs a fixture in `test/fixtures/` and a `CHANGELOG.md` entry. Run `npm test` and `npm run lint` first.",
        feasibility:
          "The issue spells out the expected output, and the heading rules show how to get positions. The change stays inside one rule and its tests, which suits a first contribution here.",
        effort:
          "About half a day to a day: see how the heading rules get positions, change the link rule's output, then add a test fixture.",
        firstSteps: [
          "Comment on #57 that you plan to reuse the heading rules' position format.",
          "Find where the heading rules get the line and column, and check that the link rule can reach the same position.",
          "Add a sample document with a broken link to `test/fixtures/`.",
        ],
        acceptanceChecks: [
          "Broken-link warnings start with `file:line:column`, and the position matches the link.",
          "All existing link and heading tests pass.",
          "`CHANGELOG.md` records the change to the output format.",
        ],
        risks: [
          "The new format may break CI scripts that parse the old one. Ask whether maintainers count it as a breaking change.",
          "Before you start, make sure nobody else has claimed the issue.",
        ],
        reasons: [
          "The issue asks for this directly and points to the heading rules' format as a model.",
          "The guide requires a fixture and a CHANGELOG entry for rule changes, which sets the full scope of the work.",
        ],
      },
      "cronwise-wrapping-ranges": {
        title: "Fix next run times for day ranges that wrap the weekend",
        summary:
          "The README says `5-1` means Friday through Monday, and the text explanation agrees, but the next-run preview skips Saturday and Sunday. Range expansion is the likely cause.",
        userNeed:
          "People read cronwise's preview to see when a job will run. Missing days make them think it never runs on weekends.",
        contributionRules:
          "Open or claim an issue before you send a pull request. Every expression you fix needs a test in `tests/test_schedule.py`, and CI runs `pytest` and `ruff`.",
        feasibility:
          "The issue names the suspect function, and the README defines how wrapping ranges behave. Expect to follow range expansion and the schedule math: a step up from a starter task.",
        effort:
          "About one to two days: reproduce it, fix the range expansion, and add tests for a wrapping range and a normal one.",
        firstSteps: [
          "Reproduce #112 locally with `0 22 * * 5-1`.",
          "Read `expand_range()` and see what it does when the start is greater than the end.",
          "Claim #112 in a comment and describe the fix you have in mind.",
        ],
        acceptanceChecks: [
          "Next run times for `5-1` include Friday, Saturday, Sunday and Monday, in order.",
          "Results for normal ranges such as `1-5` stay the same.",
          "`pytest` and `ruff` pass locally.",
        ],
        risks: [
          "The minute and hour fields may share the same range expansion; make sure the fix leaves them unchanged.",
          "Ask whether maintainers want wrapping ranges in other fields, such as months, fixed in the same change.",
        ],
        reasons: [
          "The reporter points to the likely code, which gives the investigation a clear starting point.",
          "The guide asks for a test with every fix, so the work includes new test cases.",
          "The README defines what `5-1` means, which shows the expected behavior is Friday through Monday.",
        ],
      },
      "huecheck-skipped-variables": {
        title: "Report which CSS-variable declarations were skipped",
        summary:
          "Colors set with `var(--name)` are skipped silently, and the tool still exits with 0. The issue suggests a warning that lists them, a far smaller step than resolving variables.",
        userNeed:
          "Teams on a design system believe every check passed, while some colors were never checked. A warning shows them the blind spot.",
        contributionRules:
          "The project has no CONTRIBUTING file. Comment on the issue first to confirm that maintainers accept a warning as the first step, then follow the existing code style.",
        feasibility:
          "The issue proposes a small first step, and the README admits CSS variables are unsupported. You only list the skipped declarations; resolving variables can wait.",
        effort:
          "About half a day: find where `var()` is skipped, collect the declarations, print a warning and add one test.",
        firstSteps: [
          "Comment on #88 to confirm that maintainers prefer a warning first over resolving variables.",
          "Find the code that skips `var()` while it reads colors.",
          "Prepare a CSS test file that uses `var(--text-muted)`.",
        ],
        acceptanceChecks: [
          "A color set with `var()` prints a warning that names the file and the declaration.",
          "Output for files without CSS variables stays the same.",
        ],
        risks: [
          "Agree with the maintainers first on whether skipped declarations should change the exit code.",
          "With no CONTRIBUTING file, infer the test and commit conventions from past pull requests.",
        ],
        reasons: [
          "The issue suggests a warning as the first step, which sets the scope of this contribution.",
          "The README confirms that CSS variables are not resolved, so this is a known limit, not a usage error.",
        ],
      },
    },
  },
  prFeedback: {
    bodies: {
      review:
        "Thanks, this is a clean change and the tests read well. Two things before we merge:\n\n1. Renaming `retry.delay` breaks existing configs. Please keep `delay` working for one more minor release, and log a deprecation warning when it is set.\n2. Please add a test for the exhausted case: after `maxRetries`, the last error should be thrown.",
      "retry-after":
        "429 and 503 responses often carry a `Retry-After` header. Could the wait honor it when it is present? A follow-up issue is fine too.",
    },
    warnings: [
      "Sample feedback: the maintainer, the review and the CI check are fictional. Nothing was read from GitHub.",
    ],
  },
  extraRecommendations: {
    "demo-retry-after": {
      title: "Wait as long as Retry-After asks before retrying",
      problem:
        "On a 429 or 503, servers often send Retry-After. The client ignores it, so a retry can arrive before the server is ready.",
      userImpact:
        "Rate-limited pages recover on the first well-timed retry instead of using up attempts, and the server gets the pause it asked for.",
      approach:
        "Read Retry-After from the HttpError response and use it as the shortest wait, still capped by maxDelay.",
      acceptance: [
        "A 503 with Retry-After: 2 waits at least 2 seconds.",
        "No wait goes past maxDelay, even when the header asks for more.",
        "Responses without the header keep the current backoff.",
      ],
    },
    "demo-retry-cancel": {
      title: "Stop retrying when the user leaves the page",
      problem:
        "withRetry cannot be cancelled. After the page that needed the data closes, the request keeps waiting and retrying.",
      userImpact:
        "Leaving a page stops its background requests, so stale data never shows up and no traffic is wasted.",
      approach:
        "Accept an AbortSignal, pass it to fetch, and end the wait between attempts as soon as the signal aborts.",
      acceptance: [
        "Aborting during a wait stops further attempts at once.",
        "The caller gets an AbortError, not the last HTTP error.",
        "Requests without a signal behave as before.",
      ],
    },
    "demo-validate-options": {
      title: "Reject retry settings that make no sense",
      problem:
        "withRetry accepts any number. A negative maxRetries quietly turns retries off, and NaN never reaches the limit, so it retries forever.",
      userImpact:
        "A typo in the config fails fast with a clear message, instead of a hang or a confusing error in production.",
      approach:
        "Check maxRetries, baseDelay and maxDelay before the first attempt, and throw a RangeError that names the bad option.",
      acceptance: [
        "maxRetries must be a whole number, 0 or more.",
        "baseDelay and maxDelay must be finite and not negative.",
        "The error message names the option and its value.",
      ],
    },
    "demo-delay-deprecation": {
      title: "Keep the old delay option working for one release",
      problem:
        "Renaming delay to baseDelay silently drops existing settings. People who upgrade get the default wait with no warning.",
      userImpact:
        "Teams upgrade on their own schedule: the old setting keeps working, and a warning tells them what to change.",
      approach:
        "Accept retry.delay as a deprecated alias of baseDelay, log one warning, and name the removal version in the README.",
      acceptance: [
        "retry.delay still sets the first wait ceiling.",
        "Each client logs the deprecation warning only once.",
        "The type marks delay as @deprecated.",
      ],
    },
    "demo-client-status-tests": {
      title: "Test which HTTP statuses the client retries",
      problem:
        "The tests cover withRetry alone. Nothing checks that the client retries a 503 but stops at once on a 404.",
      userImpact:
        "A later edit to the status list cannot quietly start retrying user errors, or stop retrying outages.",
      approach:
        "Replace fetch with a stub that returns a planned sequence of responses, and count the calls for each kind of status.",
      acceptance: [
        "A 503 followed by a 200 returns the data on the second call.",
        "A 404 throws HttpError after one call.",
        "A network TypeError is retried.",
      ],
    },
  },
  rerunReport: {
    reviewer:
      "Sample · Re-review (prewritten)\n\nRe-read the current diff: the same 5 files, with no new edits since the first review.\n\n**Still open**: `retry.delay` is still silently ignored, and `maxRetries` is still not validated. Fix these two first.\n\n**Confirmed**: no wait goes past `maxDelay`, and `HttpError` keeps the full `Response` for callers.\n\n**New this pass**: in `src/client.ts`, `shouldRetry` comes after `...options.retry`, so a caller cannot override the status check. That matches `ClientOptions`, which leaves `shouldRetry` out of `retry`.\n\nThis review read the diff statically. No code was run.",
    tester:
      "Sample · Test re-analysis (prewritten)\n\nThe same two cases as before; no test was added since the first analysis.\n\nThe most valuable next test: make the operation fail every time, then check that it runs `maxRetries + 1` times and throws the last error. It would also catch a `maxRetries` setting that never stops.\n\nStill missing: a `maxDelay` check with `Math.random` pinned, and a client test that retries a 503 but fails a 404 after one call.\n\nThis analysis did not run the tests; it is a static reading.",
  },
  importSteps: [
    "Cloning openfetch-sample/open-fetch…",
    "Checking out the main branch…",
    "Reading the repository…",
    "Listing the tracked files…",
  ],
  analysisSteps: [
    "Reading the README and main modules…",
    "Checking how people use it…",
    "Tracing a request through the client…",
    "Looking for places you can help…",
    "Checking each suggestion against the code…",
  ],
  publishedCard: {
    title: "Draft PR opened",
    note: "Sample: not created on GitHub",
  },
  understanding: {
    summary:
      "This change makes failed GET requests retry with growing, randomized waits instead of a fixed one-second pause. Only temporary failures such as a 503 or a network error are retried, and no wait goes past maxDelay. Renaming delay to baseDelay could break existing configs.",
    answers: {
      "selfCheck:src/utils/retry.ts": {
        answer: "The ceiling is 2 seconds, and the real wait is a random value below it.",
        correction: "The ceiling doubles from 1 second, so attempt 2 caps at 4 seconds.",
      },
      untested: {
        answer:
          "I didn't test a server that sends Retry-After, because the client ignores it today.",
      },
    },
    forecastQuestion: "They'll ask whether the retry cap is tested.",
  },
  quizzes: {
    "src/utils/retry.ts":
      "Up to 4 seconds; jitter makes each real wait random and usually shorter.",
    "src/client.ts":
      "No. 404 is not in the retry list, so the HttpError fails right away.",
    "src/types.ts":
      "So callers can't replace the client's own check of which statuses retry.",
    "tests/retry.test.ts":
      "The pinned random value halves the first one-second ceiling to 500 ms.",
    "README.md": "Three requests, and a 404 fails at once.",
  },
  roads: {
    "src/utils/retry.ts": {
      guess: "Wait the same short time between tries, with a little randomness.",
      why: "A fixed wait still sends a wave of retries when the server is overloaded.",
    },
    "src/client.ts": {
      guess: "Check error.status inside shouldRetry instead of a new error class.",
      why: "HttpError keeps the whole response, which helps when debugging.",
    },
    "src/types.ts": {
      guess: "Keep delay as a deprecated alias for one release.",
      why: "Existing configs would keep working while people upgrade.",
    },
    "tests/retry.test.ts": {
      guess: "Pass a fake sleep function into withRetry.",
      why: "Simpler to read, but it changes the public signature for tests only.",
    },
    "README.md": {
      guess: "Put the retry settings on a separate guide page.",
      why: "People upgrading read the README first.",
    },
  },
  feedbackLessons: {
    "retry-after":
      "Read what the server asks for, such as Retry-After, before choosing a wait.",
  },
  practice: {
    "retry-check": {},
    "retry-after-feedback": {
      question:
        "A maintainer asked about 429 and 503 responses in src/client.ts. What should the wait honor when the server sends one?",
      reference:
        "The Retry-After header: the server says how long to wait, and the client should wait at least that long, still capped by maxDelay.",
    },
    "types-self-check": {},
  },
  debrief: {
    quotes: [
      "Please add a test for the exhausted case: after `maxRetries`, the last error should be thrown.",
    ],
    drills: [
      {
        context: "Choosing how withRetry waits between attempts.",
        optionA: "Wait a fixed 1 second, plus or minus 0.3 seconds.",
        optionB:
          "Wait a random time under a ceiling that doubles each attempt, capped by maxDelay.",
        question: "Which fits this project, and why?",
        reveal:
          "B: many screens share this client, so failures arrive together, and a growing random wait spreads the retries out. A is simpler and fine when only a few clients retry.",
      },
    ],
    nextStep:
      "Before your next pull request here, write the test for the last allowed attempt first.",
  },
  restatement:
    "Keep the old delay option working for one release, and add a test that the last error is thrown.",
  walkthrough: {
    kind: "function",
    summary:
      "Takes the settings (`baseURL` and `retry`) and returns an object with a `get` method. `get` builds the full URL from `baseURL`, sends the request and reads the reply as JSON. Before this change, `get` sent one request and read the JSON without looking at the status code, so a `503` reply was read as data too.",
    change:
      "The change wraps the body of `get` in `withRetry` and checks `response.ok` before reading the JSON. A failure throws an `HttpError`, so `shouldRetry` can decide from the status code whether to try again; how you call `createClient` stays the same.",
    steps: [
      "A factory function: it keeps `options` in a closure, so every later call to `get` on the returned object reads the same settings.",
      "The heart of `get`: build the URL, send the request, make sure the status code is a success, then parse the JSON. These lines sit inside the function passed to `withRetry`, so every retry sends the request again.",
      "The retry settings: start from the caller's `retry`, then add which errors are worth retrying. Temporary server errors and network errors try again; errors that need a fix, such as `401` or `404`, do not.",
      "The wrap-up: it closes the `withRetry` call and the returned object.",
    ],
    callers: [
      {
        name: "The README's usage example",
        note: "Shows how to create a client with `baseURL` and `retry`.",
      },
    ],
    callees: [
      "Owns the number of retries and the waits; `get` only tells it what to do and which errors may try again.",
      "Keeps the failed Response, so `shouldRetry` can see its status code.",
      "The HTTP request built into browsers and Node.js; on a `500` it still returns a Response instead of throwing.",
    ],
    analogy:
      "Like asking an assistant to book tables: you hand over the list of restaurants once (`baseURL`), then just name the one you want (`path`). On a busy line the assistant calls again by your rules (`withRetry`), but when the place says it doesn't exist, there's no point redialing.",
    selfCheck: {
      question:
        "Why does the `fetch` line sit inside the function passed to `withRetry`, instead of calling `fetch` once and handing the result to `withRetry`?",
      answer:
        "`withRetry` calls the function it was given again on every retry. With `fetch` inside it, every retry really sends a new request; calling `fetch` first would only re-read the same failed result.",
    },
  },
});

export default en;
