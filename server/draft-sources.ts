import type { DraftContext, DraftSource } from "../shared/drafts.js";
import {
  parseGitHubSource,
  safeRelativePath,
  secretInPatch,
  sensitivePath,
} from "./git.js";
import { formatters } from "../shared/i18n/locale.js";
import { currentLocale, sm } from "./i18n/index.js";
import { command, redact } from "./process.js";
import { AppError, type Repository, type Run } from "./types.js";

const maximumFiles = 16;
const maximumFileBytes = 12_000;
const maximumReadBytes = 128_000;
const maximumTotalBytes = 80_000;
const maximumWorkflowScans = 40;
const maximumAutomationSources = 3;
const allowedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const shaPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
export type DocumentKind = "contributing" | "template" | "documentation";
export type Entry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size: number;
};

/** Folders whose guidance is read besides the root. */
const documentFolders = [".github", "docs", "doc", "documentation"];
/** AI policies by name: AI_POLICY*, AI-POLICY*, AI_USAGE*, *AIToolPolicy*, LLM*POLICY*, GENERATIVE*AI*. */
const aiPolicyName = /^(?:ai[-_](?:policy|usage)|.*aitoolpolicy|llm.*policy|generative.*ai)/;
/**
 * Policy-named documents in the docs folders: "ai-", "llm",
 * "generated-content", "code-provenance", "coding-assistant", "contribut".
 */
const policyName =
  /(?:^|[-_.])(?:ai|llms?|genai)(?:[-_.]|$)|generated[-_]content|code[-_]provenance|coding[-_]assistants?|contribut/;

/**
 * The kind of guidance a repository file is, by its name and place, or
 * undefined for files neither the PR draft nor the rules card reads:
 * - contributing: CONTRIBUTING and CONTRIBUTE files, and AI policies (also
 *   in a sub-project's docs folder, such as `llvm/docs/AIToolPolicy.md`);
 * - template: pull request templates, including the folder of them;
 * - documentation: README, agent guides (AGENTS.md, CLAUDE.md,
 *   `.github/copilot-instructions.md`), codes of conduct, other submission
 *   guides, and policy-named documents three folders deep or less.
 * Only the root, `.github/`, `docs/`, `doc/` and `Documentation/` count.
 * The kinds are those `DraftSource.kind` already has.
 */
export function documentKind(file: string): DocumentKind | undefined {
  if (!safeRelativePath(file) || sensitivePath(file)) return;
  const parts = file.toLowerCase().split("/");
  const name = parts.at(-1)!;
  const stem = name.replace(/\.(?:md|markdown|rst|txt|adoc|org)$/i, "");
  // A text document: a known extension, or none.
  const text = stem !== name || !name.includes(".");
  if (
    text &&
    aiPolicyName.test(stem) &&
    (parts.length === 1 ||
      (parts.length <= 5 && documentFolders.includes(parts[0])) ||
      (parts.length <= 3 &&
        parts.slice(0, -1).some((part) => documentFolders.includes(part))))
  )
    return "contributing";
  if (
    parts.length > 5 ||
    (parts.length > 1 && !documentFolders.includes(parts[0]))
  )
    return;
  if (stem === "contributing" || /^contribute(?:$|[-_.])/.test(stem))
    return "contributing";
  // Agent guides such as AGENTS.md often hold the branch and commit rules CONTRIBUTING links to.
  if (
    (parts.length === 1 || (parts.length === 2 && parts[0] === ".github")) &&
    (stem === "agents" || stem === "claude")
  )
    return "documentation";
  if (parts.join("/") === ".github/copilot-instructions.md")
    return "documentation";
  if (
    stem === "pull_request_template" ||
    (parts.includes("pull_request_template") &&
      /\.(?:md|markdown|rst|txt)$/i.test(name))
  )
    return "template";
  if (
    /^(?:readme|contribution(?:s|-guide)?|contributing[-_]guide|submitting(?:[-_](?:patches|pull[-_]requests))?|maintainer(?:s|[-_]guide)?|code[-_]of[-_]conduct)$/.test(
      stem,
    )
  )
    return "documentation";
  if (
    text &&
    parts.length > 1 &&
    parts.length <= 3 &&
    parts[0] !== ".github" &&
    policyName.test(stem)
  )
    return "documentation";
  return undefined;
}

/**
 * The kind of community file an account's `<owner>/.github` defaults stand
 * in for when the repository has none of its own: CONTRIBUTING and pull
 * request templates. An AI policy or CONTRIBUTE file is guidance too, but
 * GitHub does not fall back for it.
 */
export function defaultsKind(file: string): DocumentKind | undefined {
  const kind = documentKind(file);
  if (kind === "template") return kind;
  const stem = file
    .split("/")
    .at(-1)!
    .toLowerCase()
    .replace(/\.(?:md|markdown|rst|txt|adoc|org)$/, "");
  return kind === "contributing" && stem === "contributing" ? kind : undefined;
}

/**
 * True when the workflow's top-level `on` lists pull_request or
 * pull_request_target, inline (`on: [push, pull_request]`) or as a block key
 * or sequence item. A `pull_request:` key elsewhere, such as a dispatch input,
 * a step's `with:` or a comment, is not a trigger.
 */
function runsOnPullRequests(content: string) {
  const lines = content.replace(/\r/g, "").split("\n");
  const key = /^(?:on|"on"|'on')\s*:/;
  const start = lines.findIndex((line) => key.test(line));
  if (start < 0) return false;
  const inline = lines[start]
    .replace(key, "")
    .replace(/\s#.*$/, "")
    .trim();
  if (inline)
    return /(?:^|[\s[{,])["']?pull_request(?:_target)?["']?(?=[\s\]},:]|$)/.test(
      inline,
    );
  let indent = -1;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const depth = line.length - line.trimStart().length;
    if (depth === 0) break;
    if (indent < 0) indent = depth;
    if (
      depth === indent &&
      /^\s*(?:-\s+)?["']?pull_request(?:_target)?["']?\s*(?::|$|\s#)/.test(line)
    )
      return true;
  }
  return false;
}

/**
 * A workflow that runs on pull requests and inspects their title or body,
 * labels them, or lints titles and commits: machine-enforced submission rules.
 */
export function pullRequestGate(content: string) {
  return (
    runsOnPullRequests(content) &&
    /\b(?:pull_request|pr)\.(?:body|title)\b|closingIssuesReferences|\baddLabels\b|semantic-pull-request|commitlint/.test(
      content,
    )
  );
}

export const priority = (file: Entry) => {
  const kind = documentKind(file.path);
  const parts = file.path.toLowerCase().split("/");
  const location =
    parts[0] === ".github"
      ? 0
      : parts.length === 1
        ? 1
        : parts[0] === "docs"
          ? 2
          : 3;
  return (
    (kind === "contributing" ? 0 : kind === "template" ? 100 : 200) +
    location * 10 +
    parts.length
  );
};

export function parseTree(output: string): Entry[] {
  return output
    .split("\0")
    .filter(Boolean)
    .flatMap((line) => {
      const match =
        /^(\d{6}) (blob|tree|commit) ([a-f0-9]{40,64})\s+(\d+|-)\t(.+)$/.exec(
          line,
        );
      return match
        ? [
            {
              mode: match[1],
              type: match[2],
              sha: match[3],
              size: Number(match[4]),
              path: match[5],
            },
          ]
        : [];
    });
}

/** True when `value` is the PR's own URL, or (with `comment`) a review/comment anchor on it. */
export function validPrUrl(
  value: unknown,
  repositoryUrl: string,
  number: number,
  comment = false,
): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const expected = new URL(`${repositoryUrl}/pull/${number}`);
    return (
      url.origin === expected.origin &&
      !url.username &&
      !url.password &&
      !url.search &&
      url.pathname.toLowerCase() === expected.pathname.toLowerCase() &&
      (comment
        ? /^#(?:issuecomment-|pullrequestreview-|discussion_r)\d+$/.test(
            url.hash,
          )
        : !url.hash)
    );
  } catch {
    return false;
  }
}

/** An answer of `gh api`, as JSON.parse returns it. */
type GitHubJson = ReturnType<typeof JSON.parse>;

/** An account's public default community files (`<owner>/.github`). */
export type AccountDefaults =
  | { status: "missing" | "private" | "no-branch" }
  | {
      status: "found";
      /** The default branch's commit the files are read at. */
      commitSha: string;
      /** GitHub listed only part of the tree. */
      truncated: boolean;
      /** The wanted files, in reading order. */
      entries: Entry[];
      read(entry: Entry): Promise<string>;
      url(entry: Entry): string;
    };

/**
 * The default community files of the account's public `<owner>/.github`
 * repository whose kind `wanted` accepts, pinned to its default branch's
 * commit, or why there are none: "missing" when the account has no such
 * repository (GitHub's 404), "private" or "no-branch". Other failures
 * reject. `github` runs `gh api --hostname github.com` and parses JSON.
 */
export async function accountDefaults(
  owner: string,
  wanted: (kind: DocumentKind) => boolean,
  github: (args: string[], maxBytes?: number) => Promise<GitHubJson>,
): Promise<AccountDefaults> {
  let defaults: GitHubJson;
  try {
    defaults = await github(
      ["--method", "GET", `repos/${owner}/.github`],
      80_000,
    );
  } catch (error) {
    if (error instanceof Error && /(?:HTTP\s+404|\(404\))/.test(error.message))
      return { status: "missing" };
    throw error;
  }
  if (defaults.private !== false) return { status: "private" };
  if (typeof defaults.default_branch !== "string")
    return { status: "no-branch" };
  const ref = await github(
    [
      "--method",
      "GET",
      `repos/${owner}/.github/git/ref/heads/${encodeURIComponent(defaults.default_branch)}`,
    ],
    40_000,
  );
  if (ref.object?.type !== "commit" || !shaPattern.test(ref.object.sha))
    throw new Error("Invalid default ref");
  const commitSha: string = ref.object.sha;
  const tree = await github(
    [
      "--method",
      "GET",
      `repos/${owner}/.github/git/trees/${commitSha}?recursive=1`,
    ],
    2_000_000,
  );
  if (!shaPattern.test(tree.sha) || !Array.isArray(tree.tree))
    throw new Error("Invalid default tree");
  const entries: Entry[] = tree.tree
    .filter((entry: Entry) => {
      const kind =
        typeof entry.path === "string" ? documentKind(entry.path) : undefined;
      return !!kind && wanted(kind) && shaPattern.test(entry.sha);
    })
    .sort(
      (a: Entry, b: Entry) =>
        priority(a) - priority(b) || a.path.localeCompare(b.path),
    );
  return {
    status: "found",
    commitSha,
    truncated: !!tree.truncated,
    entries,
    read: async (entry) => {
      const blob = await github(
        ["--method", "GET", `repos/${owner}/.github/git/blobs/${entry.sha}`],
        180_000,
      );
      if (
        blob.encoding !== "base64" ||
        typeof blob.content !== "string" ||
        !/^[A-Za-z0-9+/=\s]*$/.test(blob.content)
      )
        throw new Error("Invalid blob");
      return Buffer.from(blob.content, "base64").toString("utf8");
    },
    url: (entry) =>
      `https://github.com/${owner}/.github/blob/${commitSha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
  };
}

const metadataQuery = `query BellDraftContext($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    owner { __typename }
    pullRequests(first: 3, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title body url
        comments(last: 5) { nodes { id body url authorAssociation } }
        reviews(last: 5) { nodes { id body url authorAssociation } }
      }
    }
  }
}`;

/** Read-only evidence; repository text is source material, never application configuration. */
export async function collectDraftContext(
  repo: Repository,
  run: Pick<Run, "baseSha" | "worktreePath">,
  options: { signal?: AbortSignal; execute?: typeof command } = {},
): Promise<DraftContext> {
  if (!shaPattern.test(run.baseSha))
    throw new AppError((m) => m.analysis.draftSources.invalidBase, 422);
  const messages = sm().analysis.draftSources;
  const execute = options.execute ?? command;
  const context: DraftContext = {
    sources: [],
    warnings: [],
    checkedAt: new Date().toISOString(),
    baseSha: run.baseSha,
  };
  const remote = parseGitHubSource(repo.url);
  let total = 0;
  let documentCount = 0;
  const warn = (message: string) => {
    if (!context.warnings.includes(message) && context.warnings.length < 32)
      context.warnings.push(message);
  };
  const active = () => {
    if (options.signal?.aborted)
      throw new AppError((m) => m.analysis.draftSources.cancelled, 409);
  };
  const addSource = (source: DraftSource, limit = maximumFileBytes) => {
    active();
    if (!source.content.trim()) return;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(source.content)) {
      warn(messages.unreadableText({ label: source.label }));
      return;
    }
    if (
      secretInPatch(source.content) ||
      redact(source.content) !== source.content
    ) {
      warn(messages.sensitive({ label: source.label }));
      return;
    }
    const bytes = Buffer.from(source.content);
    const allowed = Math.min(limit, maximumTotalBytes - total);
    if (allowed <= 0) {
      warn(messages.totalLimit);
      return;
    }
    const content = bytes
      .subarray(0, allowed)
      .toString("utf8")
      .replace(/\ufffd$/, "");
    if (bytes.length > allowed)
      warn(
        messages.truncated({
          label: source.label,
          bytes: formatters(currentLocale()).number(allowed),
        }),
      );
    total += Buffer.byteLength(content);
    context.sources.push({ ...source, content });
  };
  const gitRead = (args: string[], maxBytes = 2_000_000) =>
    execute(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.quotePath=false",
        "--no-pager",
        ...args,
      ],
      {
        cwd: run.worktreePath || repo.path,
        signal: options.signal,
        timeoutMs: 15_000,
        maxBytes,
      },
    );
  const github = async (args: string[], maxBytes = 500_000) => {
    active();
    const result = await execute(
      "gh",
      ["api", "--hostname", "github.com", ...args],
      {
        cwd: repo.path,
        signal: options.signal,
        timeoutMs: 20_000,
        maxBytes,
      },
    );
    return JSON.parse(result.stdout);
  };
  const readDocument = async (
    entry: Entry,
    source: "base" | "org",
    read: () => Promise<string>,
    url?: string,
    kind: DraftSource["kind"] = documentKind(entry.path)!,
  ) => {
    const label =
      source === "base"
        ? entry.path
        : messages.accountDefault({ path: entry.path });
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      warn(messages.notRegularFile({ label }));
      return;
    }
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size > maximumReadBytes ||
      entry.size < 0
    ) {
      warn(messages.tooLarge({ label }));
      return;
    }
    if (documentCount >= maximumFiles || total >= maximumTotalBytes) {
      warn(messages.documentLimit);
      return;
    }
    documentCount++;
    try {
      addSource({
        id: `${source}:${entry.path}`,
        kind,
        label,
        path: entry.path,
        url,
        content: await read(),
      });
    } catch {
      active();
      warn(messages.readFailed({ label }));
    }
  };

  warn(messages.searchScope);
  const localKinds = new Set<DocumentKind>();
  let localChecked = false;
  // Set once the base tree is read; run after all written guidance.
  let scanWorkflows = async () => {};
  try {
    const tree = parseTree(
      (await gitRead(["ls-tree", "--full-tree", "-r", "-l", "-z", run.baseSha]))
        .stdout,
    );
    localChecked = true;
    const candidates = tree
      .filter((entry) => documentKind(entry.path))
      .sort(
        (a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path),
      );
    const show = async (file: string) =>
      (
        await gitRead(
          ["show", "--no-ext-diff", "--no-textconv", `${run.baseSha}:${file}`],
          maximumReadBytes + 2_000,
        )
      ).stdout;
    const blobUrl = (file: string) =>
      remote
        ? `${remote.url}/blob/${run.baseSha}/${file.split("/").map(encodeURIComponent).join("/")}`
        : undefined;
    for (const entry of candidates) {
      const own = defaultsKind(entry.path);
      if (own) localKinds.add(own);
      await readDocument(
        entry,
        "base",
        () => show(entry.path),
        blobUrl(entry.path),
      );
    }
    // Workflows are read after local and account-default written guidance,
    // so they never crowd it out of the shared 16-file and 80 KB limits.
    scanWorkflows = async () => {
      const workflows = tree
        .filter(
          (entry) =>
            /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(entry.path) &&
            entry.type === "blob" &&
            ["100644", "100755"].includes(entry.mode) &&
            Number.isSafeInteger(entry.size) &&
            entry.size >= 0 &&
            entry.size <= maximumReadBytes,
        )
        .sort((a, b) => a.path.localeCompare(b.path));
      let automation = 0;
      for (const [index, entry] of workflows.entries()) {
        if (automation >= maximumAutomationSources) {
          warn(
            messages.automationLimit({
              max: maximumAutomationSources,
              remaining: workflows.length - index,
            }),
          );
          break;
        }
        if (index >= maximumWorkflowScans) {
          warn(
            messages.workflowScanLimit({
              total: workflows.length,
              max: maximumWorkflowScans,
            }),
          );
          break;
        }
        active();
        let content: string;
        try {
          content = await show(entry.path);
        } catch {
          active();
          warn(messages.workflowReadFailed({ path: entry.path }));
          continue;
        }
        if (!pullRequestGate(content)) continue;
        automation++;
        await readDocument(
          entry,
          "base",
          async () => content,
          blobUrl(entry.path),
          "automation",
        );
      }
    };
  } catch {
    active();
    warn(messages.baseUnreadable);
  }
  active();
  if (!remote) {
    warn(messages.noRemote);
    await scanWorkflows();
    return context;
  }

  let metadata: Record<string, any> | undefined;
  try {
    const response = await github([
      "graphql",
      "-f",
      `query=${metadataQuery}`,
      "-f",
      `owner=${remote.owner}`,
      "-f",
      `name=${remote.name}`,
    ]);
    if (response.errors?.length || !response.data?.repository)
      throw new Error("Incomplete metadata");
    metadata = response.data.repository;
  } catch {
    active();
    warn(messages.metadataFailed);
  }

  if (
    ["Organization", "User"].includes(metadata?.owner?.__typename) &&
    localChecked &&
    (!localKinds.has("contributing") || !localKinds.has("template"))
  ) {
    try {
      const defaults = await accountDefaults(
        remote.owner,
        (kind) =>
          (kind === "contributing" || kind === "template") &&
          !localKinds.has(kind),
        github,
      );
      if (defaults.status === "found") {
        if (defaults.truncated) warn(messages.defaultsTruncated);
        for (const entry of defaults.entries)
          await readDocument(
            entry,
            "org",
            () => defaults.read(entry),
            defaults.url(entry),
          );
      } else if (defaults.status === "private") {
        warn(messages.defaultsNotPublic);
      } else if (defaults.status === "no-branch") {
        warn(messages.defaultsNoBranch);
      }
    } catch {
      active();
      warn(messages.defaultsFailed);
    }
  }

  await scanWorkflows();

  if (metadata) {
    warn(messages.maintainerSample);
    const prs = Array.isArray(metadata.pullRequests?.nodes)
      ? metadata.pullRequests.nodes.slice(0, 3)
      : [];
    for (const pr of prs) {
      if (
        !Number.isSafeInteger(pr?.number) ||
        pr.number < 1 ||
        !validPrUrl(pr.url, remote.url, pr.number)
      )
        continue;
      for (const [type, nodes] of [
        ["comment", pr.comments?.nodes],
        ["review", pr.reviews?.nodes],
      ] as const) {
        for (const comment of Array.isArray(nodes) ? nodes.slice(-5) : []) {
          if (
            !allowedAssociations.has(comment?.authorAssociation) ||
            typeof comment.body !== "string" ||
            !validPrUrl(comment.url, remote.url, pr.number, true)
          )
            continue;
          const author = {
            number: pr.number,
            association: comment.authorAssociation,
          };
          addSource(
            {
              id: `${type}:${pr.number}:${new URL(comment.url).hash.slice(1)}`,
              kind: "maintainer",
              label:
                type === "review"
                  ? messages.maintainerReview(author)
                  : messages.maintainerComment(author),
              url: comment.url,
              content: comment.body,
            },
            3_000,
          );
        }
      }
      if (typeof pr.title === "string" && typeof pr.body === "string")
        addSource(
          {
            id: `pr:${pr.number}`,
            kind: "example",
            label: messages.mergedExample({ number: pr.number }),
            url: pr.url,
            content: `${pr.title}\n\n${pr.body}`,
          },
          4_000,
        );
    }
  }
  return context;
}
