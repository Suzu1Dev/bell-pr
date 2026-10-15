/**
 * A local stand-in for GitHub in tests. Git commands that name
 * https://github.com/<owner>/<name> run against a local bare repository, so
 * fetch, push (including non-fast-forward rejection) and ls-remote behave
 * like the real thing; gh answers the few API calls BELL makes for PRs, and
 * the read-only respect facts (the door, the linked issue, the person's
 * pace) by query name, from what `setFacts` sets, including the ways a read
 * fails. Nothing leaves the machine.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { command, git } from "../server/process.js";

/** How a fact read fails: exit 1 with GitHub's HTTP status, an answer that is not JSON, or no answer at all. */
export type FakeFailure = "exit" | "not-found" | "rate-limited" | "invalid" | "timeout";

/** Text the fake gh prints when `pr create` meets GitHub's open-PR cap (`prCreate: "cap"`). */
export const prCapMessage =
  "pull request create failed: GraphQL: You have reached the maximum number of open pull requests allowed for users without write access in this repository. Close or merge an existing pull request before opening another one. (createPullRequest)";

/** What gh answers about the respect facts; anything left out has a clean default. */
export interface FakeFacts {
  /** The person (`viewer.login`); defaults to the owner. */
  login?: string;
  /** REST `repos/{o}/{r}` fields and GraphQL `viewerPermission` (default WRITE). */
  door?: {
    has_pull_requests?: boolean;
    pull_request_creation_policy?: string;
    archived?: boolean;
    disabled?: boolean;
    viewerPermission?: string | null;
  };
  mergedSizes?: { number: number; additions: number; deletions: number; changedFiles: number }[];
  /** GraphQL issue objects by number; a number left out is not found. */
  issues?: Record<number, Record<string, unknown>>;
  pacing?: { open?: number; merged?: number; waiting?: string[]; viewerPermission?: string };
  /** The account's `<owner>/.github` files by path; absent means GitHub's 404. */
  accountDefaults?: Record<string, string>;
  /** Reads that fail, by name. */
  fail?: Partial<Record<"door" | "doorGraph" | "issue" | "pacing" | "viewer" | "accountDefaults", FakeFailure>>;
  /** `pr create` meets GitHub's limit on open pull requests. */
  prCreate?: "cap";
}

export interface FakeGitHub {
  url: string;
  bare: string;
  /** Commits files on the default branch, as if upstream merged something; null deletes. */
  upstreamCommit(files: Record<string, string | null>, message?: string): Promise<string>;
  /** Commits files on a branch of the remote, as if someone pushed to it. */
  pushToBranch(branch: string, files: Record<string, string>, message?: string): Promise<string>;
  head(branch: string): Promise<string>;
  setPrState(state: "OPEN" | "MERGED" | "CLOSED"): Promise<void>;
  /** Sets what gh answers about the door, issues, pacing and account defaults. */
  setFacts(facts: FakeFacts): Promise<void>;
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
  const factsFile = path.join(directory, "fake-facts.json");
  await mkdir(path.dirname(bare), { recursive: true });
  await mkdir(bin, { recursive: true });
  await git(root, ["init", "-q", "--bare", "-b", defaultBranch, bare]);
  await git(directory, ["clone", "-q", bare, scratch]);
  await git(scratch, ["config", "user.name", "Upstream"]);
  await git(scratch, ["config", "user.email", "upstream@example.invalid"]);
  await git(scratch, ["checkout", "-q", "-b", defaultBranch]);
  const commitFiles = async (files: Record<string, string | null>, message: string) => {
    for (const [file, content] of Object.entries(files)) {
      if (content === null) {
        await rm(path.join(scratch, file));
        continue;
      }
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
  await writeFile(factsFile, "{}");

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
  if (arg === '-c' && /^(protocol\\.(?:[a-z]+\\.)?allow|credential\\.helper)=/.test(args[index + 1] ?? '')) { index++; continue; }
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
const facts = JSON.parse(fs.readFileSync(${JSON.stringify(factsFile)}, 'utf8'));
const login = facts.login ?? ${JSON.stringify(owner)};
const fail = (name) => {
  const how = (facts.fail ?? {})[name];
  if (!how) return false;
  if (how === 'timeout') { setTimeout(() => process.exit(0), 60000); return true; }
  if (how === 'invalid') { console.log('<html>Service unavailable</html>'); process.exit(0); }
  console.error(how === 'not-found' ? 'gh: Not Found (HTTP 404)' : how === 'rate-limited' ? 'gh: API rate limit exceeded for user. (HTTP 403)' : 'gh: Bad Gateway (HTTP 502)');
  process.exit(1);
};
const api = args[0] === 'api' ? args.filter((arg, index) => !(arg === '--hostname' || args[index - 1] === '--hostname' || arg === '--method' || args[index - 1] === '--method')).slice(1) : [];
const query = args.find((arg) => arg.startsWith('query='));
const queryName = query ? (/query\\s+(\\w+)/.exec(query) ?? [])[1] : undefined;
const variable = (name) => { const arg = args.find((entry) => entry.startsWith(name + '=')); return arg ? arg.slice(name.length + 1) : undefined; };
const answer = (data) => console.log(JSON.stringify({ data }));
const fullName = ${JSON.stringify(`${owner}/${name}`)};
if (queryName === 'BellDoor') {
  if (!fail('doorGraph')) {
    const door = facts.door ?? {};
    answer({ viewer: { login }, repository: { viewerPermission: 'viewerPermission' in door ? door.viewerPermission : 'WRITE', pullRequests: { nodes: facts.mergedSizes ?? [] } } });
  }
} else if (queryName === 'BellIssueCheck') {
  if (!fail('issue')) answer({ viewer: { login }, repository: { issue: (facts.issues ?? {})[Number(variable('number'))] ?? null } });
} else if (queryName === 'BellPacing') {
  if (!fail('pacing')) {
    const pacing = facts.pacing ?? {};
    const waiting = pacing.waiting ?? [];
    answer({
      repository: { viewerPermission: pacing.viewerPermission ?? (facts.door ?? {}).viewerPermission ?? 'WRITE' },
      open: { issueCount: pacing.open ?? 0 },
      merged: { issueCount: pacing.merged ?? 0 },
      waiting: { issueCount: waiting.length, nodes: waiting.map((url) => ({ url })) },
    });
  }
} else if (queryName === 'BellViewer') {
  if (!fail('viewer')) answer({ viewer: { login } });
} else if (api.length === 1 && api[0].toLowerCase() === 'repos/' + fullName.toLowerCase()) {
  if (!fail('door')) {
    const door = facts.door ?? {};
    console.log(JSON.stringify({ full_name: fullName, private: false, owner: { login: ${JSON.stringify(owner)}, type: 'Organization' }, has_pull_requests: door.has_pull_requests ?? true, pull_request_creation_policy: door.pull_request_creation_policy ?? 'all', archived: door.archived ?? false, disabled: door.disabled ?? false }));
  }
} else if (api.length === 1 && /^repos\\/[^/]+\\/\\.github(\\/|$)/.test(api[0])) {
  if (!fail('accountDefaults')) {
    const files = facts.accountDefaults;
    const sha = (text) => require('node:crypto').createHash('sha1').update(text).digest('hex');
    const commit = 'c'.repeat(40);
    if (!files) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
    else if (/\\.github$/.test(api[0])) console.log(JSON.stringify({ private: false, default_branch: 'main' }));
    else if (api[0].includes('/git/ref/heads/')) console.log(JSON.stringify({ object: { type: 'commit', sha: commit } }));
    else if (api[0].includes('/git/trees/')) console.log(JSON.stringify({ sha: commit, truncated: false, tree: Object.entries(files).map(([file, text]) => ({ path: file, mode: '100644', type: 'blob', sha: sha(text), size: Buffer.byteLength(text) })) }));
    else if (api[0].includes('/git/blobs/')) {
      const found = Object.values(files).find((text) => api[0].endsWith('/' + sha(text)));
      if (found === undefined) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
      console.log(JSON.stringify({ encoding: 'base64', content: Buffer.from(found).toString('base64') }));
    } else { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  }
} else if (args[0] === 'api' && args[1] === 'user') console.log(${JSON.stringify(owner)});
else if (args[0] === 'api' && /\\/git\\/ref\\/heads\\//.test(args[1])) console.log(git('rev-parse', 'refs/heads/' + args[1].split('/git/ref/heads/')[1]));
else if (args[0] === 'api' && /\\/pulls\\/\\d+\\/commits$/.test(args[1])) {
  const pr = prs().find((entry) => args[1].includes('/pulls/' + entry.number + '/'));
  if (pr) console.log(git('rev-list', '--reverse', pr.base + '..refs/heads/' + pr.branch));
} else if (args[0] === 'repo' && args[1] === 'view') console.log(JSON.stringify({ viewerPermission: 'WRITE', defaultBranchRef: { name: ${JSON.stringify(defaultBranch)} } }));
else if (args[0] === 'pr' && args[1] === 'list') {
  const branch = value('--head').split(':')[1];
  console.log(JSON.stringify(prs().filter((pr) => pr.branch === branch && pr.state === 'OPEN').map((pr) => ({ url: pr.url, headRefOid: git('rev-parse', 'refs/heads/' + pr.branch) }))));
} else if (args[0] === 'pr' && args[1] === 'create' && facts.prCreate === 'cap') {
  console.error(${JSON.stringify(prCapMessage)});
  process.exit(1);
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
    setFacts: async (facts) => {
      await writeFile(factsFile, JSON.stringify(facts));
    },
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
