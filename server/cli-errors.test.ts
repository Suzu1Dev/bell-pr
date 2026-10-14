import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setupError, setupFixes, withCliSetupHint } from "./cli-errors.js";
import { withLocale } from "./i18n/index.js";
import { command } from "./process.js";
import { AppError } from "./types.js";

const enoent = () =>
  Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT", errno: -2 });

/** A failed run the way command() reports it: raw stderr in the details. */
const failedRun = (stderr: string, exitCode = 1) =>
  new AppError("translated text that is never matched", 422, {
    details: { stderr, exitCode },
  });

test("a spawn error with cause.code ENOENT maps to <tool>_missing in any locale", () => {
  const original = withLocale("zh-TW", () =>
    new AppError((m) => m.run.command.spawnFailed({ executable: "git", reason: "spawn git ENOENT" }), 503, {
      cause: enoent(),
    }),
  );
  // The localized message has nothing to match; the cause decides.
  assert.match(original.message, /git/);
  const hinted = withLocale("zh-TW", () => withCliSetupHint(original, "git"));
  assert.ok(hinted instanceof AppError);
  assert.equal(hinted.code, "git_missing");
  assert.equal(hinted.statusCode, 503);
  assert.equal(hinted.cause, original);
  assert.match(hinted.message, /Git/);
  assert.ok(hinted.fixes?.length);
  // The fixes are for this platform only.
  assert.ok(hinted.fixes!.every((fix) => !fix.platform || fix.platform === process.platform));

  for (const [executable, code] of [
    ["gh", "gh_missing"],
    ["/usr/local/bin/codex", "codex_missing"],
    ["claude.exe", "claude_missing"],
  ] as const) {
    const error = withLocale("en", () =>
      withCliSetupHint(new AppError("x", 503, { cause: enoent() }), executable),
    ) as AppError;
    assert.equal(error.code, code, executable);
  }
  // A plain spawn error (no AppError around it) maps too.
  assert.equal((withCliSetupHint(enoent(), "gh") as AppError).code, "gh_missing");
});

test("raw stderr fixtures map to their codes", () => {
  const cases: [string, string, string][] = [
    ["gh", "To get started with GitHub CLI, please run:  gh auth login", "gh_unauthenticated"],
    ["gh", "HTTP 401: Bad credentials (https://api.github.com/user)", "gh_unauthenticated"],
    [
      "git",
      "Author identity unknown\n\n*** Please tell me who you are.\n\nfatal: unable to auto-detect email address",
      "git_identity_missing",
    ],
    ["git", "Committer identity unknown\n\n*** Please tell me who you are.", "git_identity_missing"],
    [
      "git",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "github_auth_required",
    ],
    [
      "git",
      " ! [remote rejected] HEAD -> fix (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)",
      "gh_workflow_scope",
    ],
    ["claude", "Invalid API key · Please run /login", "claude_unauthenticated"],
    ["claude", "OAuth token has expired. Please run /login", "claude_unauthenticated"],
    ["codex", "ERROR: unexpected status 401 Unauthorized: Missing bearer", "codex_unauthenticated"],
  ];
  for (const [executable, stderr, code] of cases) {
    const original = failedRun(stderr);
    const hinted = withLocale("en", () => withCliSetupHint(original, executable));
    assert.ok(hinted instanceof AppError, stderr);
    assert.equal(hinted.code, code, stderr);
    assert.equal(hinted.statusCode, 422);
    // The raw tail and the exit code stay for callers and the log.
    assert.deepEqual(hinted.details, original.details);
    assert.equal(hinted.cause, original);
    assert.ok(hinted.fixes?.length, code);
  }
  assert.deepEqual(
    withLocale("en", () => setupFixes("gh_workflow_scope")),
    [{ label: "Allow pushing workflow changes", command: "gh auth refresh -h github.com -s workflow" }],
  );
});

test("unknown failures, other tools and classified errors stay as they are", () => {
  const unrelated = failedRun("fatal: not a git repository");
  assert.equal(withCliSetupHint(unrelated, "git"), unrelated);
  // A pattern only counts for the tool that prints it.
  const wrongTool = failedRun("HTTP 401");
  assert.equal(withCliSetupHint(wrongTool, "git"), wrongTool);
  const other = new AppError("x", 503, { cause: enoent() });
  assert.equal(withCliSetupHint(other, "bwrap"), other);
  // Matching never looks at BELL's own message text.
  const textOnly = new AppError("Author identity unknown", 422);
  assert.equal(withCliSetupHint(textOnly, "git"), textOnly);
  const coded = new AppError("unsafe", 409, { code: "git_config_unsafe", cause: enoent() });
  assert.equal(withCliSetupHint(coded, "git"), coded);
  assert.equal(withCliSetupHint("not an error", "git"), "not an error");
});

test("setup errors are worded in the locale in effect", () => {
  const en = withLocale("en", () => setupError("git_identity_missing", 409));
  const zh = withLocale("zh-TW", () => setupError("git_identity_missing", 409));
  assert.equal(en.code, zh.code);
  assert.notEqual(en.message, zh.message);
  assert.match(zh.message, /Git/);
  assert.deepEqual(
    en.fixes?.map((fix) => fix.command),
    ['git config --global user.name "Your Name"', 'git config --global user.email "you@example.com"'],
  );
  assert.equal(
    withLocale("en", () => setupError("clone_timeout", 504, { url: "https://github.com/o/r" }))
      .fixes?.[0].command,
    "git clone https://github.com/o/r.git",
  );
});

test("command() keeps the spawn error as cause and the raw stderr and exit code as details", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-cli-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const missingGit = path.join(directory, "bin", "git");
  await assert.rejects(
    withLocale("zh-TW", () => command(missingGit, ["--version"])),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "git_missing");
      const cause = error.cause as AppError;
      assert.equal((cause.cause as NodeJS.ErrnoException).code, "ENOENT");
      return true;
    },
  );
  const script = path.join(directory, "gh");
  await writeFile(
    script,
    "#!/bin/sh\necho 'partial output'\necho 'HTTP 401: Bad credentials ghp_0123456789abcdefghij0123456789abcdef' >&2\nexit 4\n",
    { mode: 0o700 },
  );
  await assert.rejects(
    withLocale("en", () => command(script, [])),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, "gh_unauthenticated");
      assert.equal(error.details?.exitCode, 4);
      // Redacted before it is kept.
      assert.equal(error.details?.stderr, "HTTP 401: Bad credentials [REDACTED]");
      return true;
    },
  );
});
