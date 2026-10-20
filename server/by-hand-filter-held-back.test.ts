// A Learn-by-hand turn never reads what the review holds back
// (server/by-hand-filter.ts turnFiles): a tracked link to an ignored .env,
// an untracked .env.local, or a worktree file holding a credential. Such a
// file has no lines, so no quote, ref or "verbatim" code block can carry
// its secret into the guide's thread, the stored run, a chat answer or the
// learning export.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { filterGuideAnswer, filterStoredText, turnFiles } from "./by-hand-filter.js";
import { git } from "./process.js";

const token = `ghp_${"0123456789abcdef".repeat(3)}`;

async function repository(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-held-back-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worktreePath = path.join(directory, "repo");
  await mkdir(path.join(worktreePath, "src"), { recursive: true });
  await git(worktreePath, ["init", "-b", "main"]);
  await git(worktreePath, ["config", "user.name", "BELL Test"]);
  await git(worktreePath, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(worktreePath, ".gitignore"), ".env\n");
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 1;\n");
  await writeFile(path.join(worktreePath, "src", "keys.ts"), "export const key = process.env.KEY;\n");
  // A link the project tracks, to a file Git ignores.
  await symlink("../.env", path.join(worktreePath, "src", "config.ts"));
  await git(worktreePath, ["add", "--", "."]);
  await git(worktreePath, ["commit", "-m", "initial"]);
  const baseSha = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
  // The person's own secrets: the ignored .env behind the link, an untracked .env.local, a token pasted into a tracked file.
  await writeFile(path.join(worktreePath, ".env"), `GITHUB_TOKEN=${token}\n`);
  await writeFile(path.join(worktreePath, ".env.local"), `GITHUB_TOKEN=${token}\n`);
  await writeFile(path.join(worktreePath, "src", "keys.ts"), `export const key = "${token}";\n`);
  await writeFile(path.join(worktreePath, "src", "retry.ts"), "export const attempts = 3;\n");
  return { baseSha, worktreePath };
}

test("a turn reads no linked, sensitive or credential-holding file of the worktree, and still reads the others", async (t) => {
  const run = await repository(t);
  const sources = await turnFiles(run).sources(["src/config.ts", ".env.local", "src/keys.ts", "src/retry.ts"]);
  assert.equal(sources.worktree["src/config.ts"], undefined);
  assert.equal(sources.worktree[".env.local"], undefined);
  assert.equal(sources.worktree["src/keys.ts"], undefined);
  assert.doesNotMatch(JSON.stringify(sources), new RegExp(token));
  // The committed versions, and the person's other edits, are read as before.
  assert.deepEqual(sources.base["src/keys.ts"], ["export const key = process.env.KEY;"]);
  assert.deepEqual(sources.worktree["src/retry.ts"], ["export const attempts = 3;"]);
});

test("no quote, ref or verbatim block of the guide carries a held-back secret into what BELL stores", async (t) => {
  const run = await repository(t);
  const files = turnFiles(run);
  const answer = await filterGuideAnswer(
    files,
    {
      text: `Your config reads:\n\`\`\`\nGITHUB_TOKEN=${token}\n\`\`\`\nand keys.ts has \`export const key = "${token}";\``,
      question: null,
      refs: [
        { path: "src/config.ts", line: 1, endLine: null },
        { path: ".env.local", line: 1, endLine: null },
      ],
      quotes: [
        { path: "src/config.ts", startLine: 1, endLine: 1, from: "change", anchor: null },
        { path: ".env.local", startLine: 1, endLine: 1, from: "change", anchor: null },
        { path: "src/keys.ts", startLine: 1, endLine: 1, from: "change", anchor: null },
      ],
      options: null,
      topic: "project",
      askedForCode: false,
    },
    { changed: ["src/keys.ts", "src/retry.ts"] },
  );
  assert.doesNotMatch(JSON.stringify(answer), new RegExp(token));
  assert.deepEqual(answer.value.quotes, []);
  // A stored text (a report, a chat answer) quoting the secret as "verbatim" code loses it too.
  const stored = await filterStoredText(files, `\`\`\`\nGITHUB_TOKEN=${token}\n\`\`\``, { changed: [], cited: ["src/config.ts", ".env.local"] });
  assert.doesNotMatch(stored.value, new RegExp(token));
});
