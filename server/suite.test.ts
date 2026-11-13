// The BELL Suite adapter (docs/bell-suite.md): BELLPR_SUITE_LINKS, the
// manifest and the Today feed. Both endpoints only read and stay behind the
// request guard.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { FollowUpRound } from "../shared/followups.js";
import { locales } from "../shared/i18n/locale.js";
import { suiteLimits, type SuiteLinks } from "../shared/suite.js";
import { createApp } from "./app.js";
import { ConfigError, resolveConfig, type StartFlags } from "./config.js";
import en from "./i18n/en/common.js";
import zhTW from "./i18n/zh-TW/common.js";
import { withLocale } from "./i18n/index.js";
import { Store } from "./store.js";
import { parseSuiteLinks, suiteFeedSchema, suiteManifestSchema } from "./suite-contract.js";
import { buildTodayFeed } from "./suite-feed.js";
import type { Run } from "./types.js";
import { Workbench } from "./workbench.js";

const day = (date: number) => `2026-11-0${date}T00:00:00.000Z`;
/** A time that parses, in a year the contract's four-digit form cannot express. */
const farFuture = "+010000-01-01T00:00:00.000Z";

/** A run in review. SENTINEL marks every value the feed must never send. */
function run(id: string, patch: Partial<Run> = {}): Run {
  return {
    id,
    repoId: "repo",
    title: `Run ${id}`,
    prompt: "prompt SENTINEL",
    status: "review",
    branch: "fix/SENTINEL",
    baseBranch: "main",
    baseSha: "a".repeat(40),
    worktreePath: "/nonexistent/SENTINEL",
    createdAt: day(1),
    agents: [],
    logs: [],
    draft: { title: "draft SENTINEL", body: "" },
    reviewedFiles: [],
    reviewedFingerprints: {},
    ...patch,
  };
}

const round = (status: FollowUpRound["status"], requestedAt = day(2)): FollowUpRound => ({
  id: "round",
  requestedAt,
  feedbackUrls: [],
  status,
  parentCommit: "b".repeat(40),
});

async function serve(
  t: TestContext,
  runs: Run[],
  options: { apiToken?: string; suiteLinks?: SuiteLinks } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-suite-"));
  const store = new Store(directory);
  await store.initialize();
  store.data.runs.push(...runs);
  await store.save();
  const workbench = new Workbench(store);
  const app = createApp(workbench, { staticDirectory: path.join(directory, "missing"), ...options });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.locals.insights.shutdown();
    await app.locals.discovery.shutdown();
    await workbench.shutdown();
    await rm(directory, { recursive: true, force: true });
  });
  const send = (endpoint: string, headers: Record<string, string> = {}, method = "GET") =>
    new Promise<{ status: number; headers: IncomingHttpHeaders; text: string }>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: endpoint, method, headers: { host: "127.0.0.1:4311", ...headers } },
        (response) => {
          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => (text += chunk));
          response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, text }));
        },
      );
      req.on("error", reject);
      req.end(method === "GET" ? undefined : "{}");
    });
  return { send, stateFile: path.join(directory, "state.json") };
}

test("BELLPR_SUITE_LINKS is read as the contract's reference parser reads it", async () => {
  // The table holds the reference's own answers (self = pr, no tailnet), for
  // links that are not this BELL PR's port.
  const cases: { value: string; links: SuiteLinks | null }[] = JSON.parse(
    await readFile(path.join(import.meta.dirname, "fixtures", "suite-links.cases.json"), "utf8"),
  );
  assert.ok(cases.length > 50);
  for (const { value, links } of cases) {
    let parsed: SuiteLinks | null;
    try {
      parsed = parseSuiteLinks(value, [], [4311]);
    } catch {
      parsed = null;
    }
    assert.deepEqual(parsed, links, JSON.stringify(value));
  }
});

test("a link outside this computer must be https in this BELL PR's own tailnet", () => {
  // Built from parts, so no tailnet-looking name is written in a tracked file.
  const host = (...labels: string[]) => [...labels, "ts", "net"].join(".");
  const own = [`https://${host("pr", "tail-one")}`];
  const sibling = `https://${host("explain", "tail-one")}`;
  assert.deepEqual(parseSuiteLinks(`explain=${sibling}`, own, [4311]), { explain: sibling });
  const refused: [string, string[]][] = [
    [`https://${host("explain", "tail-two")}`, own],
    [sibling.replace("https", "http"), own],
    [`https://${host("tail-one")}`, own],
    [sibling, []],
    [sibling, ["http://127.0.0.2:4311"]],
    // This BELL PR itself, also with its default port spelled out.
    [own[0], own],
    [`${own[0]}:443`, own],
  ];
  for (const [value, origins] of refused)
    assert.throws(() => parseSuiteLinks(`explain=${value}`, origins, [4311]), /^Error: BELLPR_SUITE_LINKS/, value);
});

test("a link back to this BELL PR stops the start, in the CLI's language and without the value", () => {
  const refused: [StartFlags, NodeJS.ProcessEnv, string][] = [
    [{}, {}, "explain=http://localhost:4311"],
    [{}, {}, "explain=http://127.9.9.9:4311"],
    [{}, {}, "personal=https://[::1]:4311"],
    [{ port: 5000 }, {}, "explain=http://127.0.0.1:5000"],
    // In development the UI's own server is this BELL PR too.
    [{ dev: true }, {}, "explain=http://localhost:4310"],
    [{}, { BELLPR_ALLOWED_ORIGINS: "https://localhost:8443" }, "explain=https://localhost:8443"],
    // A local proxy in front of this BELL PR, under another loopback name or scheme.
    [{}, { BELLPR_ALLOWED_ORIGINS: "https://localhost:8443" }, "explain=https://127.0.0.1:8443"],
    [{}, { BELLPR_ALLOWED_ORIGINS: "https://localhost:8443" }, "explain=http://[::1]:8443"],
    [{}, { BELLPR_PUBLIC_URL: "https://localhost" }, "personal=https://127.0.0.1"],
    [{}, {}, "explain=http://localhost:5173/private-path"],
  ];
  for (const locale of locales)
    withLocale(locale, () => {
      for (const [flags, env, value] of refused)
        assert.throws(
          () => resolveConfig(flags, { ...env, BELLPR_SUITE_LINKS: value }),
          (error: unknown) =>
            error instanceof ConfigError &&
            error.message.startsWith(locale === "en" ? "BELLPR_SUITE_LINKS takes" : "BELLPR_SUITE_LINKS 須為") &&
            !error.message.includes(value.slice(value.indexOf("=") + 1)) &&
            !error.message.includes("private-path"),
          `${locale} ${value}`,
        );
    });
  // Outside development nothing of BELL PR listens on the UI port.
  assert.deepEqual(resolveConfig({}, { BELLPR_SUITE_LINKS: "explain=http://localhost:4310" }).suiteLinks, {
    explain: "http://localhost:4310",
  });
  // Only a loopback address of this BELL PR claims its port on this computer.
  const remote = { BELLPR_PUBLIC_URL: "https://pr.example:8443" };
  assert.deepEqual(
    resolveConfig({}, { ...remote, BELLPR_SUITE_LINKS: "explain=https://localhost:8443" }).suiteLinks,
    { explain: "https://localhost:8443" },
  );
  assert.deepEqual(resolveConfig({}, {}).suiteLinks, {});
});

test("both endpoints stay behind the request guard and answer GET only", async (t) => {
  const { send } = await serve(t, [], { apiToken: "suite-test-token" });
  const bearer = { authorization: "Bearer suite-test-token" };
  for (const endpoint of ["/api/suite/manifest", "/api/suite/today"]) {
    const refused = await send(endpoint, { "x-bell-locale": "en" });
    assert.equal(refused.status, 401, endpoint);
    assert.deepEqual(JSON.parse(refused.text), { error: en.apiTokenRequired });
    assert.equal((await send(endpoint, { ...bearer, host: "evil.example:4311" })).status, 403);
    assert.equal((await send(endpoint, { ...bearer, origin: "https://evil.example" })).status, 403);
    const served = await send(endpoint, bearer);
    assert.equal(served.status, 200, endpoint);
    assert.equal(served.headers["cache-control"], "no-store");
    assert.deepEqual(Object.keys(served.headers).filter((name) => name.startsWith("access-control-")), []);
    const posted = await send(endpoint, { ...bearer, "content-type": "application/json" }, "POST");
    assert.equal(posted.status, 404, endpoint);
  }
});

test("the manifest names BELL PR, its feed and its links in the request's language", async (t) => {
  const links = {
    explain: "http://localhost:5173",
    personal: "http://127.0.0.1:4400",
    reader: "http://127.0.0.1:21104",
    campaign: "http://127.0.0.1:21105",
  };
  const { send } = await serve(t, [], { suiteLinks: links });
  const manifest = async (locale: string) =>
    JSON.parse((await send("/api/suite/manifest", { "x-bell-locale": locale })).text);
  const english = await manifest("en");
  assert.deepEqual(english, {
    schemaVersion: 1,
    appId: "pr",
    displayName: "BELL PR",
    summary: "Contributions and review",
    capabilities: [
      { id: "runs.today", kind: "today-feed", api: "/api/suite/today" },
      { id: "run.open", kind: "object-route", route: "#/runs/{id}" },
    ],
    links,
  });
  assert.deepEqual(await manifest("zh-TW"), { ...english, summary: "貢獻與審查" });
  assert.deepEqual(await manifest("en"), english);
  // What the start refuses: a link that is not an origin, or a field the contract does not have.
  for (const broken of [{ links: { explain: "http://localhost:5173/" } }, { token: "x" }])
    assert.equal(suiteManifestSchema.safeParse({ ...english, ...broken }).success, false);
});

test("each run state gives one feed row, and the first match wins", () => {
  const complete = { phase: "complete" } as Run["team"];
  // Every run BELL PR starts has a team; a Learn-by-hand run's is developing until its first Ready.
  const developing = { phase: "developing" } as Run["team"];
  const rows: [Partial<Run>, ("needs-you" | "waiting")?, string?][] = [
    [{ status: "queued" }, "waiting", "Queued"],
    [{ status: "running" }, "waiting", "In progress"],
    [{ status: "awaiting_plan" }, "needs-you", "Plan ready for your approval"],
    [{ status: "awaiting_plan", learnByHand: true }, "needs-you", "Your turn: write the plan"],
    [{ status: "review" }, "needs-you", "Ready for your review"],
    [{ status: "review", learnByHand: true, team: developing }, "needs-you", "Your turn: make the change"],
    [{ status: "review", learnByHand: true, team: complete }, "needs-you", "Ready for your review"],
    [{ status: "approved" }, "needs-you", "Approved, not published yet"],
    [{ status: "approved", publishing: true }, "waiting", "Publishing"],
    [{ status: "failed" }, "needs-you", "Failed"],
    [{ status: "running", followUps: [round("running")] }, "waiting", "Follow-up in progress"],
    [{ status: "review", followUps: [round("review")] }, "needs-you", "Follow-up ready for you"],
    [{ status: "approved", followUps: [round("review")] }, "needs-you", "Follow-up ready for you"],
    [{ status: "approved", publishing: true, followUps: [round("review")] }, "waiting", "Publishing"],
    // An agent resolves the conflicts of a round that merges the target branch.
    [{ status: "running", followUps: [round("review")] }, "waiting", "Follow-up in progress"],
    [
      { status: "review", learnByHand: true, team: complete, followUps: [round("review")] },
      "needs-you",
      "Follow-up ready for you",
    ],
    // Left out: v1 lists no published run, and a split run's parts are counted instead.
    [{ status: "published" }],
    [{ status: "published", followUps: [round("published")] }],
    [{ status: "cancelled" }],
    [{ workspaceRemovedAt: day(3) }],
    [{ splitInto: [{ runId: "part", title: "Part" }] }],
    [{ createdAt: "yesterday" }],
    [{ createdAt: farFuture }],
    [{ id: "not an id" }],
    [{ id: ".." }],
  ];
  withLocale("en", () => {
    for (const [patch, state, detail] of rows) {
      const feed = buildTodayFeed([run("one", patch)]);
      const seen = JSON.stringify(patch);
      assert.deepEqual(feed.items.map((item) => [item.state, item.detail]), state ? [[state, detail]] : [], seen);
      assert.deepEqual(
        feed.counts,
        { needsYou: Number(state === "needs-you"), waiting: Number(state === "waiting") },
        seen,
      );
    }
  });
  for (const messages of [en, zhTW]) {
    assert.ok([...messages.suite.summary].length <= suiteLimits.summary);
    for (const phrase of Object.values(messages.suite.detail))
      assert.ok([...phrase].length <= suiteLimits.detail, phrase);
  }
});

test("the feed lists five runs, what needs the person first and then the newest", () => {
  const runs = [
    run("waiting-earlier", { status: "running" }),
    run("old"),
    run("logged", { logs: [{ time: day(5), agent: "system", message: "log SENTINEL" }] }),
    run("waiting-new", { status: "queued", createdAt: day(4) }),
    run("same-b", { createdAt: day(3) }),
    run("same-a", { createdAt: day(3) }),
    run("published", { status: "published", createdAt: day(5) }),
    run("round", { followUps: [round("review", day(2))] }),
  ];
  const feed = withLocale("en", () => buildTodayFeed(runs, new Date(day(6))));
  assert.deepEqual(feed.items.map((item) => item.id), ["logged", "same-a", "same-b", "round", "old"]);
  assert.equal(feed.items[0].updatedAt, day(5));
  assert.deepEqual(feed.counts, { needsYou: 5, waiting: 2 });
  assert.equal(feed.truncated, true);
  assert.equal(feed.generatedAt, day(6));
  assert.equal(suiteFeedSchema.safeParse(feed).success, true);
  const few = withLocale("en", () => buildTodayFeed(runs.slice(0, 5)));
  assert.equal(few.truncated, false);
  // The runs that wait for BELL PR come last, the newest of them first (their ids alone give the other order).
  assert.deepEqual(few.items.map((item) => item.id), ["logged", "same-b", "old", "waiting-new", "waiting-earlier"]);
});

test("a later time the contract cannot express is passed over, as one that does not parse", () => {
  const log = (time: string) => ({ logs: [{ time, agent: "system", message: "log" }] });
  const runs = [
    run("year-12345", log("12345")),
    run("not-a-time", log("later")),
    run("round", { followUps: [round("review", farFuture)] }),
    run("round-and-log", { followUps: [round("review", farFuture)], ...log(day(3)) }),
  ];
  const feed = withLocale("en", () => buildTodayFeed(runs));
  assert.deepEqual(
    feed.items.map((item) => [item.id, item.updatedAt]),
    [["round-and-log", day(3)], ["not-a-time", day(1)], ["round", day(1)], ["year-12345", day(1)]],
  );
  assert.equal(suiteFeedSchema.safeParse(feed).success, true);
});

test("a title is sent as one plain line of at most 120 characters", () => {
  const title = (value: string, locale: "en" | "zh-TW" = "en") =>
    withLocale(locale, () => buildTodayFeed([run("one", { title: value })]).items[0].title);
  const bell = String.fromCodePoint(7);
  const rightToLeftOverride = String.fromCodePoint(0x202e);
  const face = String.fromCodePoint(0x1f600);
  assert.equal(title(`  Fix\tthe\n retry ${rightToLeftOverride}loop${bell} `), "Fix the retry loop");
  assert.equal(title("x".repeat(200)), `${"x".repeat(119)}…`);
  assert.equal(title(face.repeat(130)), `${face.repeat(119)}…`);
  // A title cut from the request's first 72 UTF-16 units can end in half a character.
  assert.equal(title(`Add a ${face}`.slice(0, -1)), "Add a");
  assert.equal(title(` ${bell}\n`), "Untitled run");
  // Zero-width space, word joiner and soft hyphen: nothing to read.
  assert.equal(title(` ${String.fromCodePoint(0x200b, 0x2060)} ${String.fromCodePoint(0xad)}`), "Untitled run");
  // An unnamed run's title is the start of the request: a credential in it is masked.
  assert.equal(title(`Push with ghp_${"A".repeat(36)} please`), "Push with [REDACTED] please");
  assert.equal(
    title("Clone https://alice:hunter2pass@git.invalid/repo and fix"),
    "Clone https://[REDACTED]@git.invalid/repo and fix",
  );
  assert.equal(title("", "zh-TW"), "未命名的任務");
});

test("the feed sends a run's id, title, state and time, and writes nothing", async (t) => {
  const { send, stateFile } = await serve(t, [
    run("one", {
      prUrl: "https://github.com/SENTINEL/pull/1",
      error: "error SENTINEL",
      logs: [{ time: day(2), agent: "SENTINEL", message: "log SENTINEL" }],
    }),
    run("not an id"),
  ]);
  const before = await readFile(stateFile, "utf8");
  assert.ok(before.includes("SENTINEL"));
  const response = await send("/api/suite/today", { "x-bell-locale": "zh-TW" });
  assert.equal(response.status, 200);
  assert.equal(response.text.includes("SENTINEL"), false);
  const { generatedAt, ...feed } = JSON.parse(response.text);
  assert.ok(Math.abs(Date.now() - Date.parse(generatedAt)) < 60_000);
  assert.deepEqual(feed, {
    schemaVersion: 1,
    appId: "pr",
    counts: { needsYou: 1, waiting: 0 },
    items: [
      {
        sourceApp: "pr",
        type: "run",
        id: "one",
        title: "Run one",
        href: "#/runs/one",
        state: "needs-you",
        updatedAt: day(2),
        detail: "等你審閱",
      },
    ],
    truncated: false,
  });
  assert.deepEqual(JSON.parse((await send("/api/suite/manifest")).text).links, {});
  assert.equal(await readFile(stateFile, "utf8"), before);
});

test("a feed that breaks the contract is not sent, and the answer says nothing about it", async (t) => {
  const { send } = await serve(t, [run("one")]);
  assert.equal((await send("/api/suite/today")).status, 200);
  // Every stored value is made to fit, so the clock breaks it: a time the contract's form cannot express.
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(farFuture) });
  const response = await send("/api/suite/today", { "x-bell-locale": "en" });
  assert.equal(response.status, 500);
  assert.deepEqual(JSON.parse(response.text), { error: en.internalError });
});
