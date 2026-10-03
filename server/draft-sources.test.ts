import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { collectDraftContext } from "./draft-sources.js";
import { command, git } from "./process.js";

const json = (value: unknown) => ({
  stdout: JSON.stringify(value),
  stderr: "",
  code: 0,
});
const defaultSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const blobSha = "c".repeat(40);

async function fixture(
  files: Record<string, string | Buffer> = { "README.md": "A test project." },
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "bell-draft-sources-"),
  );
  await git(directory, ["init", "-b", "main"]);
  await git(directory, ["config", "user.name", "BELL Test"]);
  await git(directory, ["config", "user.email", "test@example.invalid"]);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), content);
  }
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "fixture"]);
  const baseSha = (await git(directory, ["rev-parse", "HEAD"])).stdout.trim();
  const repo = {
    id: "test-repo",
    name: "project",
    owner: "owner",
    fullName: "owner/project",
    path: directory,
    defaultBranch: "main",
    url: "https://github.com/owner/project",
  };
  return {
    directory,
    repo,
    run: { baseSha, worktreePath: directory },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function stubGithub(handler: (args: string[]) => unknown) {
  const calls: {
    executable: string;
    args: string[];
    options: Parameters<typeof command>[2];
  }[] = [];
  const execute: typeof command = async (executable, args, options) => {
    calls.push({ executable, args, options });
    if (executable === "git") return command(executable, args, options);
    assert.equal(executable, "gh");
    assert.equal(args[0], "api");
    assert.equal(args[2], "github.com");
    if (!args.includes("graphql"))
      assert.deepEqual(args.slice(3, 5), ["--method", "GET"]);
    return json(handler(args));
  };
  return { execute, calls };
}

function metadata(type = "User", nodes: unknown[] = []) {
  return {
    data: {
      repository: { owner: { __typename: type }, pullRequests: { nodes } },
    },
  };
}

test("draft sources use the immutable base, ignore unsafe files, and preserve GitHub template precedence", async () => {
  const f = await fixture({
    "CONTRIBUTING.md": "Base instructions: include a reproducer.",
    "pull_request_template.md": "Root template.",
    ".github/PULL_REQUEST_TEMPLATE.md": "Preferred template.",
    "docs/SUBMITTING-PATCHES.rst": "Describe the user impact.",
    "docs/MAINTAINERS.txt": "ghp_abcdefghijklmnopqrstuvwxyz",
    "documentation/contributions.md": Buffer.from([65, 0, 66]),
    "src/CONTRIBUTING.md": "Outside the documented lookup scope.",
  });
  try {
    await symlink(
      "../CONTRIBUTING.md",
      path.join(f.directory, ".github/CONTRIBUTING.md"),
    );
    await git(f.directory, ["add", ".github/CONTRIBUTING.md"]);
    await git(f.directory, ["commit", "-m", "unsafe symlink"]);
    f.run.baseSha = (
      await git(f.directory, ["rev-parse", "HEAD"])
    ).stdout.trim();
    await writeFile(
      path.join(f.directory, "CONTRIBUTING.md"),
      "Agent overwrote the rules.",
    );
    await writeFile(
      path.join(f.directory, "docs/CONTRIBUTING.md"),
      "Untracked new rules.",
    );
    const stub = stubGithub(() => metadata());
    const context = await collectDraftContext(f.repo, f.run, {
      execute: stub.execute,
    });
    assert.equal(
      context.sources.find((source) => source.path === "CONTRIBUTING.md")
        ?.content,
      "Base instructions: include a reproducer.",
    );
    assert.deepEqual(
      context.sources
        .filter((source) => source.kind === "template")
        .map((source) => source.path),
      [".github/PULL_REQUEST_TEMPLATE.md", "pull_request_template.md"],
    );
    assert.ok(
      !context.sources.some((source) =>
        /Untracked|overwrote|Outside|ghp_/.test(source.content),
      ),
    );
    assert.ok(context.warnings.some((warning) => warning.includes("符號連結")));
    assert.ok(context.warnings.some((warning) => warning.includes("敏感資訊")));
    assert.ok(
      context.warnings.some((warning) =>
        warning.includes("不是可安全讀取的文字"),
      ),
    );
    assert.ok(
      context.sources.every((source) =>
        source.url?.includes(`/blob/${f.run.baseSha}/`),
      ),
    );
    assert.equal(
      stub.calls.filter((call) => call.executable === "gh").length,
      1,
    );
    assert.ok(
      stub.calls
        .filter((call) => call.executable === "git")
        .every(
          (call) => call.args.includes("ls-tree") || call.args.includes("show"),
        ),
    );
  } finally {
    await f.cleanup();
  }
});

test("maintainer statements require verified repository URLs and roles; merged PRs remain examples", async () => {
  const f = await fixture({
    "CONTRIBUTING.md": "Local rule.",
    "pull_request_template.md": "Local template.",
  });
  try {
    const stub = stubGithub(() =>
      metadata("Organization", [
        {
          number: 42,
          title: "fix: network retry",
          body: "A merged example, not a maintainer policy.",
          url: "https://github.com/owner/project/pull/42",
          comments: {
            nodes: [
              {
                body: "Please include a reproducer.",
                authorAssociation: "OWNER",
                url: "https://github.com/owner/project/pull/42#issuecomment-1",
              },
              {
                body: "Contributor suggestion.",
                authorAssociation: "CONTRIBUTOR",
                url: "https://github.com/owner/project/pull/42#issuecomment-2",
              },
              {
                body: "Foreign repository.",
                authorAssociation: "MEMBER",
                url: "https://github.com/other/project/pull/42#issuecomment-3",
              },
              {
                body: "Malformed foreign URL.",
                authorAssociation: "OWNER",
                url: "https://github.com.evil.test/owner/project/pull/42#issuecomment-4",
              },
            ],
          },
          reviews: {
            nodes: [
              {
                body: "Explain the test coverage.",
                authorAssociation: "COLLABORATOR",
                url: "https://github.com/owner/project/pull/42#pullrequestreview-5",
              },
            ],
          },
        },
      ]),
    );
    const context = await collectDraftContext(f.repo, f.run, {
      execute: stub.execute,
    });
    assert.equal(
      context.sources.filter((source) => source.kind === "maintainer").length,
      2,
    );
    assert.equal(
      context.sources.filter((source) => source.kind === "example").length,
      1,
    );
    assert.ok(
      context.warnings.some((warning) =>
        warning.includes("已合併不等於規範認可"),
      ),
    );
    assert.ok(
      !context.sources.some((source) =>
        /Contributor|Foreign|Malformed/.test(source.content),
      ),
    );
    assert.ok(
      stub.calls
        .find((call) => call.executable === "gh")
        ?.args.some((arg) => arg.startsWith("query=query BellDraftContext")),
    );
  } finally {
    await f.cleanup();
  }
});

test("public account defaults fill only the missing local type and pin source links to the fetched commit", async () => {
  for (const ownerType of ["User", "Organization"]) {
    const f = await fixture({
      ".github/PULL_REQUEST_TEMPLATE.md": "Use the local template.",
    });
    try {
      const stub = stubGithub((args) => {
        if (args.includes("graphql")) return metadata(ownerType);
        const endpoint = args.at(-1)!;
        if (endpoint === "repos/owner/.github")
          return { private: false, default_branch: "main" };
        if (endpoint.includes("/git/ref/"))
          return { object: { type: "commit", sha: defaultSha } };
        if (endpoint.includes("/git/trees/"))
          return {
            sha: treeSha,
            tree: [
              {
                path: "CONTRIBUTING.md",
                type: "blob",
                mode: "100644",
                sha: blobSha,
                size: 36,
              },
              {
                path: "PULL_REQUEST_TEMPLATE.md",
                type: "blob",
                mode: "100644",
                sha: "d".repeat(40),
                size: 30,
              },
              {
                path: ".env",
                type: "blob",
                mode: "100644",
                sha: "e".repeat(40),
                size: 30,
              },
            ],
          };
        assert.equal(endpoint, `repos/owner/.github/git/blobs/${blobSha}`);
        return {
          encoding: "base64",
          content: Buffer.from(
            "Shared rule: describe the motivation.",
          ).toString("base64"),
        };
      });
      const context = await collectDraftContext(f.repo, f.run, {
        execute: stub.execute,
      });
      const shared = context.sources.filter((source) =>
        source.id.startsWith("org:"),
      );
      assert.equal(shared.length, 1);
      assert.equal(shared[0].kind, "contributing");
      assert.equal(
        shared[0].url,
        `https://github.com/owner/.github/blob/${defaultSha}/CONTRIBUTING.md`,
      );
      assert.equal(
        context.sources.filter((source) => source.kind === "template").length,
        1,
      );
    } finally {
      await f.cleanup();
    }
  }
});

test("missing public defaults are distinct from failed or incomplete metadata lookup", async () => {
  const f = await fixture();
  try {
    const missing = stubGithub((args) => {
      if (args.includes("graphql")) return metadata("Organization");
      throw new Error("gh: Not Found (HTTP 404)");
    });
    const absent = await collectDraftContext(f.repo, f.run, {
      execute: missing.execute,
    });
    assert.ok(!absent.warnings.some((warning) => warning.includes("讀取失敗")));
    const unavailable = stubGithub((args) => {
      if (args.includes("graphql")) return metadata("Organization");
      throw new Error("Request timed out");
    });
    const failed = await collectDraftContext(f.repo, f.run, {
      execute: unavailable.execute,
    });
    assert.ok(
      failed.warnings.some((warning) => warning.includes("預設規範讀取失敗")),
    );
    const incomplete = stubGithub(() => ({
      errors: [{ message: "denied" }],
      data: null,
    }));
    const unknown = await collectDraftContext(f.repo, f.run, {
      execute: incomplete.execute,
    });
    assert.ok(
      unknown.warnings.some((warning) =>
        warning.includes("不能據此判定沒有額外規範"),
      ),
    );
    assert.ok(unknown.sources.some((source) => source.path === "README.md"));
  } finally {
    await f.cleanup();
  }
});

test("document excerpts and counts stay bounded with visible limitations", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `.github/PULL_REQUEST_TEMPLATE/${String(index).padStart(2, "0")}.md`,
      "A".repeat(14_000),
    ]),
  );
  const f = await fixture(files);
  try {
    const stub = stubGithub(() => {
      throw new Error("offline");
    });
    const context = await collectDraftContext(f.repo, f.run, {
      execute: stub.execute,
    });
    assert.ok(context.sources.length <= 16);
    assert.ok(
      context.sources.every(
        (source) => Buffer.byteLength(source.content) <= 12_000,
      ),
    );
    assert.ok(
      context.sources.reduce(
        (size, source) => size + Buffer.byteLength(source.content),
        0,
      ) <= 80_000,
    );
    assert.ok(
      context.warnings.some((warning) => warning.includes("後續內容尚未檢查")),
    );
    assert.ok(context.warnings.some((warning) => warning.includes("取樣達到")));
    assert.ok(context.warnings.some((warning) => warning.includes("搜尋範圍")));
  } finally {
    await f.cleanup();
  }
});

test("cancellation and invalid revisions do not turn into absent-rule claims", async () => {
  const f = await fixture();
  try {
    const stub = stubGithub(() => metadata());
    await assert.rejects(
      collectDraftContext(
        f.repo,
        { ...f.run, baseSha: "HEAD:../secret" },
        { execute: stub.execute },
      ),
      /有效的基準版本/,
    );
    assert.equal(stub.calls.length, 0);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      collectDraftContext(f.repo, f.run, {
        execute: stub.execute,
        signal: controller.signal,
      }),
      /取消/,
    );
  } finally {
    await f.cleanup();
  }
});
