import assert from "node:assert/strict";
import test from "node:test";
import { defaultDiscoveryPreferences } from "../shared/discovery.js";
import { collectDiscoveryCandidates } from "./discovery-sources.js";
import { command } from "./process.js";

const sha = "a".repeat(40);
const preferences = {
  ...defaultDiscoveryPreferences,
  interests: "terminal",
  language: "TypeScript",
};
const searchRepo = (name = "one", extra = {}) => ({
  full_name: `owner/${name}`,
  private: false,
  archived: false,
  disabled: false,
  fork: false,
  stargazers_count: 500,
  language: "TypeScript",
  ...extra,
});
const issue = (name = "one", number = 1) => ({
  number,
  state: "OPEN",
  title: "Explain a confusing error",
  body: "Users do not know which setting caused this error.",
  url: `https://github.com/owner/${name}/issues/${number}`,
  locked: false,
  updatedAt: "2026-10-02T00:00:00Z",
  reactions: { totalCount: 5 },
  assignees: { totalCount: 0 },
  labels: { nodes: [{ name: "good first issue" }] },
  comments: {
    nodes: [
      {
        body: "Please add a test for the error message.",
        url: `https://github.com/owner/${name}/issues/${number}#issuecomment-${number}`,
        authorAssociation: "OWNER",
      },
      {
        body: "Unverified suggestion.",
        url: `https://github.com/owner/${name}/issues/${number}#issuecomment-${number + 10}`,
        authorAssociation: "CONTRIBUTOR",
      },
    ],
  },
});
const metadata = (name = "one", extra = {}) => ({
  data: {
    repository: {
      nameWithOwner: `owner/${name}`,
      description: "A terminal tool.",
      isPrivate: false,
      isArchived: false,
      isDisabled: false,
      stargazerCount: 501,
      forkCount: 30,
      pushedAt: "2026-10-01T00:00:00Z",
      primaryLanguage: { name: "TypeScript" },
      defaultBranchRef: { target: { oid: sha } },
      openIssues: { totalCount: 7 },
      issues: { nodes: [issue(name)] },
      ...extra,
    },
  },
});
const document = (
  file: string,
  content = "Describe why the change helps users.",
) => ({
  path: file,
  type: "file",
  encoding: "base64",
  size: Buffer.byteLength(content),
  content: Buffer.from(content).toString("base64"),
});
const profile = (name = "one") => ({
  files: {
    readme: {
      url: `https://api.github.com/repos/owner/${name}/contents/README.md`,
    },
    contributing: {
      url: `https://api.github.com/repos/owner/${name}/contents/.github/CONTRIBUTING.md`,
    },
    pull_request_template: {
      url: `https://api.github.com/repos/owner/${name}/contents/docs/PULL_REQUEST_TEMPLATE.md`,
    },
  },
});

function fakeGithub(handler?: (endpoint: string, args: string[]) => unknown) {
  const calls: { args: string[]; options: Parameters<typeof command>[2] }[] =
    [];
  const execute: typeof command = async (executable, args, options) => {
    assert.equal(executable, "gh");
    assert.deepEqual(args.slice(0, 3), ["api", "--hostname", "github.com"]);
    const endpoint = args[3] === "graphql" ? "graphql" : args[5];
    if (endpoint !== "graphql")
      assert.deepEqual(args.slice(3, 5), ["--method", "GET"]);
    else
      assert.ok(
        args.some((arg) => arg.startsWith("query=query BellDiscovery")),
      );
    assert.ok(options?.timeoutMs && options.timeoutMs <= 12_000);
    assert.ok(options?.maxBytes && options.maxBytes <= 500_000);
    calls.push({ args, options });
    let response = handler?.(endpoint, args);
    if (response === undefined) {
      if (endpoint === "search/repositories")
        response = { items: [searchRepo()] };
      else if (endpoint === "graphql")
        response = metadata(
          args.find((arg) => arg.startsWith("name="))!.slice(5),
        );
      else {
        const match = /^repos\/owner\/([^/]+)\/(.*)$/.exec(endpoint)!;
        if (match[2] === "community/profile") response = profile(match[1]);
        else if (match[2] === "readme") response = document("README.md");
        else
          response = document(
            decodeURIComponent(match[2].replace(/^contents\//, "")),
          );
      }
    }
    return { stdout: JSON.stringify(response), stderr: "", code: 0 };
  };
  return { execute, calls };
}

test("discovery filters public repositories and returns verified metrics, immutable files and maintainer evidence", async () => {
  const stub = fakeGithub((endpoint) =>
    endpoint === "search/repositories"
      ? {
          incomplete_results: true,
          items: [
            searchRepo("private", { private: true }),
            searchRepo("archived", { archived: true }),
            searchRepo("disabled", { disabled: true }),
            searchRepo("fork", { fork: true }),
            searchRepo("small", { stargazers_count: 1 }),
            searchRepo("language", { language: "Go" }),
            searchRepo(),
            searchRepo(),
          ],
        }
      : undefined,
  );
  const phases: string[] = [];
  const result = await collectDiscoveryCandidates(preferences, {
    command: stub.execute,
    onProgress: (phase) => phases.push(phase),
  });
  assert.deepEqual(phases, ["searching", "screening"]);
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.stars, 501);
  assert.equal(candidate.openIssues, 7);
  assert.ok(
    candidate.sources.some(
      (source) =>
        source.kind === "issue" &&
        source.content.includes("更新時間：2026-10-02T00:00:00Z") &&
        source.content.includes("表情回應總數：5"),
    ),
  );
  assert.equal(
    candidate.sources.filter((source) => source.kind === "comment").length,
    1,
  );
  assert.equal(
    new Set(candidate.sources.map((source) => source.id)).size,
    candidate.sources.length,
  );
  assert.ok(
    candidate.sources
      .filter((source) =>
        ["readme", "contributing", "template"].includes(source.kind),
      )
      .every((source) => source.url.includes(`/blob/${sha}/`)),
  );
  assert.ok(
    stub.calls
      .filter((call) => call.args.some((arg) => arg.includes("/contents/")))
      .every((call) => call.args.includes(`ref=${sha}`)),
  );
  assert.ok(
    stub.calls[0].args.some(
      (arg) =>
        arg.includes("good-first-issues:>0") &&
        arg.includes('language:"TypeScript"'),
    ),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("部分搜尋結果")),
  );
  assert.ok(
    result.warnings.some((warning) => warning.includes("帳號共用規範")),
  );
});

test("keywords cannot inject search qualifiers or shell commands and invalid filters make no request", async () => {
  const stub = fakeGithub(() => ({ items: [] }));
  await collectDiscoveryCandidates(
    {
      ...preferences,
      interests: 'repo:private/project OR is:private; $(id) "x"',
      difficulty: "intermediate",
    },
    { command: stub.execute },
  );
  const query = stub.calls[0].args.find((arg) => arg.startsWith("q="))!;
  assert.ok(
    query.includes('"repo" "private" "project" "OR" "is" "private" "id" "x"'),
  );
  assert.ok(query.includes("help-wanted-issues:>0"));
  assert.ok(!query.includes("is:private"));
  assert.ok(!query.includes("repo:"));
  assert.ok(!query.includes("$("));
  const count = stub.calls.length;
  for (const invalid of [
    { interests: "a".repeat(301) },
    { interests: "hello\0world" },
    { language: "Go repo:private" },
    { language: "x\nGo" },
    { minStars: -1 },
    { minStars: Infinity },
  ]) {
    await assert.rejects(
      collectDiscoveryCandidates(
        { ...preferences, ...invalid },
        { command: stub.execute },
      ),
    );
  }
  assert.equal(stub.calls.length, count);
});

test("partial failures preserve verified candidates and distinguish missing results from unavailable data", async () => {
  const stub = fakeGithub((endpoint, args) => {
    if (endpoint === "search/repositories")
      return { items: [searchRepo(), searchRepo("two")] };
    if (endpoint === "graphql" && args.includes("name=two"))
      return { errors: [{ message: "unavailable" }] };
    if (endpoint.endsWith("community/profile")) throw new Error("HTTP 503");
    if (endpoint.endsWith("readme")) throw new Error("HTTP 404");
  });
  const result = await collectDiscoveryCandidates(preferences, {
    command: stub.execute,
  });
  assert.equal(result.candidates.length, 1);
  assert.ok(
    result.candidates[0].sources.some((source) => source.kind === "issue"),
  );
  assert.ok(
    result.candidates[0].warnings.some((warning) =>
      warning.includes("不能據此判定沒有規範"),
    ),
  );
  assert.ok(result.warnings.some((warning) => warning.includes("owner/two")));
  const empty = fakeGithub(() => ({ items: [] }));
  const none = await collectDiscoveryCandidates(preferences, {
    command: empty.execute,
  });
  assert.equal(empty.calls.length, 1);
  assert.ok(
    none.warnings.some((warning) => warning.includes("未找到符合條件")),
  );
  const offline = fakeGithub(() => {
    throw new Error("offline");
  });
  const failed = await collectDiscoveryCandidates(preferences, {
    command: offline.execute,
  });
  assert.ok(
    failed.warnings.some((warning) => warning.includes("尚不能判定沒有")),
  );
});

test("remote content cannot redirect requests and sensitive or foreign evidence is removed", async () => {
  const stub = fakeGithub((endpoint) => {
    if (endpoint === "graphql")
      return metadata("one", {
        issues: {
          nodes: [
            {
              ...issue(),
              body: "A public report with ghp_abcdefghijklmnopqrstuvwxyz",
              comments: {
                nodes: [
                  {
                    body: "Foreign reply.",
                    authorAssociation: "OWNER",
                    url: "https://github.com/other/project/issues/1#issuecomment-12",
                  },
                  {
                    body: "Please include a test.",
                    authorAssociation: "MEMBER",
                    url: "https://github.com/owner/one/issues/1#issuecomment-13",
                  },
                ],
              },
            },
            {
              ...issue("one", 2),
              url: "https://github.com.evil.test/owner/one/issues/2",
            },
          ],
        },
      });
    if (endpoint.endsWith("community/profile"))
      return {
        files: {
          contributing: { url: "https://evil.test/steal" },
          pull_request_template: {
            url: "https://api.github.com/repos/owner/one/contents/.env",
          },
        },
      };
    if (endpoint.endsWith("readme"))
      return document("README.md", "Binary\0data");
  });
  const result = await collectDiscoveryCandidates(preferences, {
    command: stub.execute,
  });
  const sources = result.candidates[0].sources;
  assert.equal(sources.length, 2);
  assert.ok(sources.some((source) => source.content.includes("[REDACTED]")));
  assert.ok(
    sources.every(
      (source) =>
        !source.content.includes("ghp_") && !source.content.includes("Foreign"),
    ),
  );
  assert.ok(
    stub.calls.every(
      (call) =>
        !call.args.some(
          (arg) => arg.includes("evil.test") || arg.endsWith("/.env"),
        ),
    ),
  );
  assert.ok(
    result.candidates[0].warnings.some((warning) => warning.includes("遮蔽")),
  );
});

test("candidate count, source size and requests stay bounded while issues retain context", async () => {
  const stub = fakeGithub((endpoint, args) => {
    if (endpoint === "search/repositories")
      return {
        items: Array.from({ length: 12 }, (_, i) => searchRepo(`repo${i}`)),
      };
    if (endpoint === "graphql") {
      const name = args.find((arg) => arg.startsWith("name="))!.slice(5);
      return metadata(name, {
        issues: {
          nodes: [1, 2, 3].map((number) => ({
            ...issue(name, number),
            body: "Issue context. ".repeat(1_000),
          })),
        },
      });
    }
    if (endpoint.includes("/contents/"))
      return document(
        decodeURIComponent(endpoint.split("/contents/")[1]),
        "Document. ".repeat(2_000),
      );
  });
  const result = await collectDiscoveryCandidates(preferences, {
    command: stub.execute,
  });
  assert.equal(result.candidates.length, 6);
  assert.ok(stub.calls.length <= 36);
  const ids = result.candidates.flatMap((candidate) =>
    candidate.sources.map((source) => source.id),
  );
  assert.equal(ids.length, new Set(ids).size);
  for (const candidate of result.candidates) {
    assert.ok(candidate.sources.length <= 15);
    assert.ok(
      candidate.sources.reduce(
        (total, source) => total + Buffer.byteLength(source.content),
        0,
      ) <= 30_000,
    );
    assert.equal(
      candidate.sources.filter((source) => source.kind === "issue").length,
      3,
    );
    assert.ok(
      candidate.sources
        .filter((source) => source.kind === "issue")
        .every((source) => source.content.includes("受指派人數：0")),
    );
    assert.ok(
      candidate.warnings.some((warning) =>
        warning.includes("尚未讀取完整內容"),
      ),
    );
  }
});

test("abort stops discovery rather than returning a misleading no-results response", async () => {
  const before = new AbortController();
  before.abort();
  const unused = fakeGithub();
  await assert.rejects(
    collectDiscoveryCandidates(preferences, {
      command: unused.execute,
      signal: before.signal,
    }),
    /取消/,
  );
  assert.equal(unused.calls.length, 0);
  const during = new AbortController();
  const stub = fakeGithub(() => {
    during.abort();
    throw new Error("aborted");
  });
  await assert.rejects(
    collectDiscoveryCandidates(preferences, {
      command: stub.execute,
      signal: during.signal,
    }),
    /取消/,
  );
  assert.equal(stub.calls.length, 1);
});
