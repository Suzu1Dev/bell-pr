/**
 * A local stand-in for GitHub in tests. Git commands that name
 * https://github.com/<owner>/<name> run against a local bare repository, so
 * fetch, push (including non-fast-forward rejection) and ls-remote behave
 * like the real thing; gh answers the few API calls BELL makes for PRs.
 * Nothing leaves the machine.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { command, git } from "../server/process.js";

export interface FakeGitHub {
  url: string;
  bare: string;
  /** Commits files on the default branch, as if upstream merged something. */
  upstreamCommit(files: Record<string, string>, message?: string): Promise<string>;
  /** Commits files on a branch of the remote, as if someone pushed to it. */
  pushToBranch(branch: string, files: Record<string, string>, message?: string): Promise<string>;
  head(branch: string): Promise<string>;
  setPrState(state: "OPEN" | "MERGED" | "CLOSED"): Promise<void>;
  calls(): Promise<string[][]>;
  restore(): void;
}

export async function fakeGitHub(
  directory: string,
  options: {
    owner?: string;
    name?: string;
    defaultBranch?: string;
    files: Record<string, string>;
  },
): Promise<FakeGitHub> {
  const owner = options.owner ?? "test-owner";
  const name = options.name ?? "example";
  const defaultBranch = options.defaultBranch ?? "main";
  const root = path.join(directory, "github");
  const bare = path.join(root, owner, `${name}.git`);
  const scratch = path.join(directory, "upstream");
  const bin = path.join(directory, "fake-bin");
  const calls = path.join(directory, "fake-calls");
  const prs = path.join(directory, "fake-prs.json");
  await mkdir(path.dirname(bare), { recursive: true });
  await mkdir(bin, { recursive: true });
  await git(root, ["init", "-q", "--bare", "-b", defaultBranch, bare]);
  await git(directory, ["clone", "-q", bare, scratch]);
  await git(scratch, ["config", "user.name", "Upstream"]);
  await git(scratch, ["config", "user.email", "upstream@example.invalid"]);
  await git(scratch, ["checkout", "-q", "-b", defaultBranch]);
  const commitFiles = async (files: Record<string, string>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
      await writeFile(path.join(scratch, file), content);
    }
    await git(scratch, ["add", "-A"]);
    await git(scratch, ["commit", "-q", "-m", message]);
    return (await git(scratch, ["rev-parse", "HEAD"])).stdout.trim();
  };
  await commitFiles(options.files, "initial");
  await git(scratch, ["push", "-q", "origin", `HEAD:refs/heads/${defaultBranch}`]);
  await writeFile(prs, "[]");

  const realGit = (await command("which", ["git"])).stdout.trim();
  const node = process.execPath;
  await writeFile(
    path.join(bin, "git"),
    `#!${node}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
const mapped = [];
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  // BELL's network options: the local stand-in needs the file transport.
  if (arg === '-c' && /^(protocol\\.file\\.allow|credential\\.helper)=/.test(args[index + 1] ?? '')) { index++; continue; }
  mapped.push(arg.replace(/^https:\\/\\/github\\.com\\/([^/]+)\\/([^/]+?)(\\.git)?$/, (_, o, n) => ${JSON.stringify(root)} + '/' + o + '/' + n + '.git'));
}
if (mapped.some((arg) => ['fetch', 'push', 'ls-remote', 'clone'].includes(arg)))
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['git', ...args]) + '\\n');
const result = spawnSync(${JSON.stringify(realGit)}, mapped, { stdio: 'inherit', env: process.env });
process.exit(result.status ?? 1);
`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(bin, "gh"),
    `#!${node}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(['gh', ...args]) + '\\n');
const bare = ${JSON.stringify(bare)};
const git = (...a) => spawnSync(${JSON.stringify(realGit)}, ['--git-dir=' + bare, ...a], { encoding: 'utf8' }).stdout.trim();
const prs = () => JSON.parse(fs.readFileSync(${JSON.stringify(prs)}, 'utf8'));
const value = (flag) => args[args.indexOf(flag) + 1];
if (args[0] === 'api' && args[1] === 'user') console.log(${JSON.stringify(owner)});
else if (args[0] === 'api' && /\\/git\\/ref\\/heads\\//.test(args[1])) console.log(git('rev-parse', 'refs/heads/' + args[1].split('/git/ref/heads/')[1]));
else if (args[0] === 'api' && /\\/pulls\\/\\d+\\/commits$/.test(args[1])) {
  const pr = prs().find((entry) => args[1].includes('/pulls/' + entry.number + '/'));
  if (pr) console.log(git('rev-list', '--reverse', pr.base + '..refs/heads/' + pr.branch));
} else if (args[0] === 'repo' && args[1] === 'view') console.log(JSON.stringify({ viewerPermission: 'WRITE', defaultBranchRef: { name: ${JSON.stringify(defaultBranch)} } }));
else if (args[0] === 'pr' && args[1] === 'list') {
  const branch = value('--head').split(':')[1];
  console.log(JSON.stringify(prs().filter((pr) => pr.branch === branch && pr.state === 'OPEN').map((pr) => ({ url: pr.url, headRefOid: git('rev-parse', 'refs/heads/' + pr.branch) }))));
} else if (args[0] === 'pr' && args[1] === 'create') {
  const list = prs();
  const number = list.length + 1;
  const url = 'https://github.com/${owner}/${name}/pull/' + number;
  list.push({ number, url, branch: value('--head').split(':')[1], base: git('rev-parse', 'refs/heads/' + value('--base')), state: 'OPEN' });
  fs.writeFileSync(${JSON.stringify(prs)}, JSON.stringify(list));
  console.log(url);
} else if (args[0] === 'pr' && args[1] === 'view') console.log(prs().find((pr) => pr.url === args[2])?.state ?? 'CLOSED');
else process.exit(97);
`,
    { mode: 0o700 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previousPath}`;
  return {
    url: `https://github.com/${owner}/${name}`,
    bare,
    upstreamCommit: async (files, message = "upstream change") => {
      await git(scratch, ["fetch", "-q", "origin"]);
      await git(scratch, ["checkout", "-q", "-B", defaultBranch, `origin/${defaultBranch}`]);
      const sha = await commitFiles(files, message);
      await git(scratch, ["push", "-q", "origin", `HEAD:refs/heads/${defaultBranch}`]);
      return sha;
    },
    pushToBranch: async (branch, files, message = "someone else's commit") => {
      await git(scratch, ["fetch", "-q", "origin"]);
      await git(scratch, ["checkout", "-q", "-B", `remote-${branch.replaceAll("/", "-")}`, `origin/${branch}`]);
      const sha = await commitFiles(files, message);
      await git(scratch, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
      return sha;
    },
    head: async (branch) =>
      (await git(root, ["--git-dir", bare, "rev-parse", `refs/heads/${branch}`])).stdout.trim(),
    setPrState: async (state) => {
      const list = JSON.parse(await readFile(prs, "utf8")) as { state: string }[];
      for (const pr of list) pr.state = state;
      await writeFile(prs, JSON.stringify(list));
    },
    calls: async () =>
      (await readFile(calls, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
    restore: () => {
      process.env.PATH = previousPath;
    },
  };
}
