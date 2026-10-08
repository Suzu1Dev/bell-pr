import type { DraftContext, DraftSource } from "../shared/drafts.js";
import {
  parseGitHubSource,
  safeRelativePath,
  secretInPatch,
  sensitivePath,
} from "./git.js";
import { command, redact } from "./process.js";
import { AppError, type Repository, type Run } from "./types.js";

const maximumFiles = 16;
const maximumFileBytes = 12_000;
const maximumReadBytes = 128_000;
const maximumTotalBytes = 80_000;
const allowedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const shaPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
type DocumentKind = "contributing" | "template" | "documentation";
type Entry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size: number;
};

function documentKind(file: string): DocumentKind | undefined {
  if (!safeRelativePath(file) || sensitivePath(file)) return;
  const parts = file.toLowerCase().split("/");
  if (
    parts.length > 5 ||
    (parts.length > 1 &&
      ![".github", "docs", "documentation"].includes(parts[0]))
  )
    return;
  const name = parts.at(-1)!;
  const stem = name.replace(/\.(?:md|markdown|rst|txt|adoc|org)$/i, "");
  if (stem === "contributing") return "contributing";
  if (
    stem === "pull_request_template" ||
    (parts.includes("pull_request_template") &&
      /\.(?:md|markdown|rst|txt)$/i.test(name))
  )
    return "template";
  if (
    /^(?:readme|contribution(?:s|-guide)?|contributing[-_]guide|submitting(?:[-_](?:patches|pull[-_]requests))?|maintainer(?:s|[-_]guide)?)$/.test(
      stem,
    )
  )
    return "documentation";
}

const priority = (file: Entry) => {
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

function parseTree(output: string): Entry[] {
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
    throw new AppError("草稿規範需要有效的基準版本。", 422);
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
      throw new AppError("草稿規範讀取已取消。", 409);
  };
  const addSource = (source: DraftSource, limit = maximumFileBytes) => {
    active();
    if (!source.content.trim()) return;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(source.content)) {
      warn(`${source.label} 不是可安全讀取的文字，已略過。`);
      return;
    }
    if (
      secretInPatch(source.content) ||
      redact(source.content) !== source.content
    ) {
      warn(`${source.label} 疑似包含敏感資訊，已略過。`);
      return;
    }
    const bytes = Buffer.from(source.content);
    const allowed = Math.min(limit, maximumTotalBytes - total);
    if (allowed <= 0) {
      warn("規範來源達到 80 KB 上限；尚未完整檢查所有文件與討論。");
      return;
    }
    const content = bytes
      .subarray(0, allowed)
      .toString("utf8")
      .replace(/\ufffd$/, "");
    if (bytes.length > allowed)
      warn(
        `${source.label} 僅讀取前 ${allowed.toLocaleString("en-US")} bytes；後續內容尚未檢查。`,
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
  ) => {
    const label = source === "base" ? entry.path : `共用預設 · ${entry.path}`;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      warn(`${label} 不是一般檔案，已略過符號連結或子模組。`);
      return;
    }
    if (
      !Number.isSafeInteger(entry.size) ||
      entry.size > maximumReadBytes ||
      entry.size < 0
    ) {
      warn(`${label} 超過單檔讀取上限或大小不明，尚未檢查其內容。`);
      return;
    }
    if (documentCount >= maximumFiles || total >= maximumTotalBytes) {
      warn("文件取樣達到 16 份或 80 KB 上限；尚未完整檢查所有規範。");
      return;
    }
    documentCount++;
    try {
      addSource({
        id: `${source}:${entry.path}`,
        kind: documentKind(entry.path)!,
        label,
        path: entry.path,
        url,
        content: await read(),
      });
    } catch {
      active();
      warn(`${label} 讀取失敗，尚未確認其規範。`);
    }
  };

  warn(
    "本機規範搜尋範圍為基準版本的根目錄、.github、docs 與 documentation 內常見貢獻指南、README、維護者文件及 PR 模板；未追蹤文件中的外部連結。",
  );
  const localKinds = new Set<DocumentKind>();
  let localChecked = false;
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
    for (const entry of candidates) {
      localKinds.add(documentKind(entry.path)!);
      const url = remote
        ? `${remote.url}/blob/${run.baseSha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`
        : undefined;
      await readDocument(
        entry,
        "base",
        async () =>
          (
            await gitRead(
              [
                "show",
                "--no-ext-diff",
                "--no-textconv",
                `${run.baseSha}:${entry.path}`,
              ],
              maximumReadBytes + 2_000,
            )
          ).stdout,
        url,
      );
    }
  } catch {
    active();
    warn("無法讀取任務基準版本的規範文件；不能據此判定專案沒有規範。");
  }
  active();
  if (!remote) {
    warn(
      "未提供可驗證的 github.com 專案網址，尚未檢查 GitHub 維護者討論與帳號共用預設規範。",
    );
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
    warn(
      "GitHub 維護者討論與帳號共用資訊讀取失敗（可能是權限、連線或 API 限制）；不能據此判定沒有額外規範。",
    );
  }

  if (
    ["Organization", "User"].includes(metadata?.owner?.__typename) &&
    localChecked &&
    (!localKinds.has("contributing") || !localKinds.has("template"))
  ) {
    let foundDefaults = false;
    try {
      const defaults = await github(
        ["--method", "GET", `repos/${remote.owner}/.github`],
        80_000,
      );
      foundDefaults = true;
      if (
        defaults.private === false &&
        typeof defaults.default_branch === "string"
      ) {
        const ref = await github(
          [
            "--method",
            "GET",
            `repos/${remote.owner}/.github/git/ref/heads/${encodeURIComponent(defaults.default_branch)}`,
          ],
          40_000,
        );
        if (ref.object?.type !== "commit" || !shaPattern.test(ref.object.sha))
          throw new Error("Invalid default ref");
        const commitSha = ref.object.sha;
        const tree = await github(
          [
            "--method",
            "GET",
            `repos/${remote.owner}/.github/git/trees/${commitSha}?recursive=1`,
          ],
          2_000_000,
        );
        if (!shaPattern.test(tree.sha) || !Array.isArray(tree.tree))
          throw new Error("Invalid default tree");
        if (tree.truncated)
          warn("帳號共用 .github 的檔案清單已截斷；尚未完整檢查預設規範。");
        const candidates: Entry[] = tree.tree
          .filter((entry: Entry) => {
            const kind =
              typeof entry.path === "string"
                ? documentKind(entry.path)
                : undefined;
            return (
              (kind === "contributing" || kind === "template") &&
              !localKinds.has(kind)
            );
          })
          .sort(
            (a: Entry, b: Entry) =>
              priority(a) - priority(b) || a.path.localeCompare(b.path),
          );
        for (const entry of candidates) {
          if (!shaPattern.test(entry.sha)) continue;
          await readDocument(
            entry,
            "org",
            async () => {
              const blob = await github(
                [
                  "--method",
                  "GET",
                  `repos/${remote.owner}/.github/git/blobs/${entry.sha}`,
                ],
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
            `https://github.com/${remote.owner}/.github/blob/${commitSha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
          );
        }
      } else if (defaults.private !== false) {
        warn("帳號共用 .github 未確認為公開 repository，未採用其預設規範。");
      } else {
        warn("帳號共用 .github 沒有可讀取的預設分支，尚未確認預設規範。");
      }
    } catch (error) {
      active();
      if (
        foundDefaults ||
        !(
          error instanceof Error && /(?:HTTP\s+404|\(404\))/.test(error.message)
        )
      )
        warn("帳號共用 .github 預設規範讀取失敗；尚未確認是否存在適用規範。");
    }
  }

  if (metadata) {
    warn(
      "維護者偏好僅取樣最近更新的 3 個已合併 PR，各最多 5 則留言及 5 則 review；已合併不等於規範認可，仍需人工確認適用性。",
    );
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
          addSource(
            {
              id: `${type}:${pr.number}:${new URL(comment.url).hash.slice(1)}`,
              kind: "maintainer",
              label: `PR #${pr.number} · ${comment.authorAssociation} ${type === "review" ? "審查" : "留言"}`,
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
            label: `PR #${pr.number} · 已合併範例（非規範）`,
            url: pr.url,
            content: `${pr.title}\n\n${pr.body}`,
          },
          4_000,
        );
    }
  }
  return context;
}
