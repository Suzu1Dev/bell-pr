import type {
  DiscoveryCandidate,
  DiscoveryPreferences,
  DiscoverySource,
} from "../shared/discovery.js";
import { parseGitHubSource, safeRelativePath, sensitivePath } from "./git.js";
import { command, redact } from "./process.js";
import { AppError } from "./types.js";

const maximumCandidates = 6;
const maximumRequests = 36;
const maximumCandidateBytes = 30_000;
const shaPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const maintainerRoles = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function searchQuery(preferences: DiscoveryPreferences) {
  if (
    typeof preferences.interests !== "string" ||
    preferences.interests.length > 300 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(preferences.interests)
  )
    throw new AppError("興趣關鍵字最多 300 字，且不能包含控制字元。", 422);
  if (
    typeof preferences.language !== "string" ||
    preferences.language.length > 40 ||
    (preferences.language &&
      !/^[\p{L}\p{N}][\p{L}\p{N} +#._-]*$/u.test(preferences.language))
  )
    throw new AppError("請填寫單一程式語言名稱，最多 40 字。", 422);
  if (
    !Number.isSafeInteger(preferences.minStars) ||
    preferences.minStars < 0 ||
    preferences.minStars > 1_000_000
  )
    throw new AppError("最低 stars 必須介於 0 到 1,000,000。", 422);
  if (!["any", "beginner", "intermediate"].includes(preferences.difficulty))
    throw new AppError("無效的探索難度。", 422);
  // User text is reduced to quoted literal words; qualifiers come only from this code.
  const words =
    preferences.interests.match(/[\p{L}\p{N}][\p{L}\p{N}+#._-]*/gu) ?? [];
  const literals = words.slice(0, 8).map((word) => `"${word.slice(0, 24)}"`);
  return [
    ...literals,
    "is:public",
    "archived:false",
    "fork:false",
    `stars:>=${preferences.minStars}`,
    ...(preferences.language.trim()
      ? [`language:"${preferences.language.trim()}"`]
      : []),
    ...(preferences.difficulty === "beginner"
      ? ["good-first-issues:>0"]
      : preferences.difficulty === "intermediate"
        ? ["help-wanted-issues:>0"]
        : []),
  ].join(" ");
}

function repositoryQuery(difficulty: DiscoveryPreferences["difficulty"]) {
  const label =
    difficulty === "beginner"
      ? ', labels:["good first issue"]'
      : difficulty === "intermediate"
        ? ', labels:["help wanted"]'
        : "";
  return `query BellDiscovery($owner:String!, $name:String!) {
    repository(owner:$owner, name:$name) {
      nameWithOwner description isPrivate isArchived isDisabled stargazerCount forkCount pushedAt
      primaryLanguage { name } defaultBranchRef { target { oid } }
      openIssues:issues(states:OPEN) { totalCount }
      issues(first:3, states:OPEN${label}, orderBy:{field:UPDATED_AT,direction:DESC}) {
        nodes { number state title body url updatedAt locked assignees(first:1) { totalCount } reactions { totalCount }
          labels(first:5) { nodes { name } }
          comments(last:3) { nodes { body url authorAssociation } }
        }
      }
    }
  }`;
}

function canonicalIssueUrl(
  value: unknown,
  fullName: string,
  number: number,
  comment = false,
): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.origin === "https://github.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      url.pathname.toLowerCase() ===
        `/${fullName}/issues/${number}`.toLowerCase() &&
      (comment ? /^#issuecomment-\d+$/.test(url.hash) : !url.hash)
    );
  } catch {
    return false;
  }
}

function documentPath(
  value: unknown,
  fullName: string,
  kind: "readme" | "contributing" | "template",
) {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    const prefix = `/repos/${fullName}/contents/`;
    if (
      url.origin !== "https://api.github.com" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.toLowerCase().startsWith(prefix.toLowerCase())
    )
      return;
    const file = decodeURIComponent(url.pathname.slice(prefix.length));
    if (!safeRelativePath(file) || sensitivePath(file)) return;
    const parts = file.toLowerCase().split("/");
    if (
      parts.length > 3 ||
      (parts.length > 1 && ![".github", "docs"].includes(parts[0]))
    )
      return;
    const stem = parts.at(-1)!.replace(/\.(?:md|markdown|rst|txt|adoc)$/i, "");
    if (kind === "readme" && stem !== "readme") return;
    if (kind === "contributing" && stem !== "contributing") return;
    if (kind === "template" && stem !== "pull_request_template") return;
    return file;
  } catch {
    return;
  }
}

/** Public, read-only discovery. Fetched text is evidence, never executable instructions. */
export async function collectDiscoveryCandidates(
  preferences: DiscoveryPreferences,
  options: {
    command?: typeof command;
    signal?: AbortSignal;
    onProgress?: (phase: "searching" | "screening", message: string) => void;
  } = {},
): Promise<{ candidates: DiscoveryCandidate[]; warnings: string[] }> {
  const query = searchQuery(preferences);
  const execute = options.command ?? command;
  const candidates: DiscoveryCandidate[] = [];
  const warnings: string[] = [];
  const deadline = AbortSignal.timeout(90_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  let requests = 0;
  const active = () => {
    if (options.signal?.aborted) throw new AppError("貢獻探索已取消。", 409);
  };
  const limited = () => deadline.aborted || requests >= maximumRequests;
  const api = async (args: string[], maxBytes = 500_000) => {
    active();
    if (limited()) throw new AppError("探索達到請求或時間上限。", 422);
    requests++;
    const result = await execute(
      "gh",
      ["api", "--hostname", "github.com", ...args],
      { signal, timeoutMs: 12_000, maxBytes },
    );
    return JSON.parse(result.stdout);
  };
  const addSource = (
    candidate: DiscoveryCandidate,
    source: DiscoverySource,
    limit: number,
  ) => {
    if (!source.content.trim() || candidate.sources.length >= 15) return;
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffd]/.test(source.content)) {
      candidate.warnings.push(`${source.title} 不是可安全讀取的文字，已略過。`);
      return;
    }
    const cleaned = redact(source.content);
    if (cleaned !== source.content)
      candidate.warnings.push(`${source.title} 已遮蔽疑似憑證。`);
    const used = candidate.sources.reduce(
      (total, item) => total + Buffer.byteLength(item.content),
      0,
    );
    const available = Math.min(limit, maximumCandidateBytes - used);
    if (available <= 0) return;
    const bytes = Buffer.from(cleaned);
    if (bytes.length > available)
      candidate.warnings.push(
        `${source.title} 僅保留前 ${available.toLocaleString("en-US")} bytes，尚未讀取完整內容。`,
      );
    candidate.sources.push({
      ...source,
      title: redact(source.title).slice(0, 180),
      content: bytes
        .subarray(0, available)
        .toString("utf8")
        .replace(/\ufffd$/, ""),
    });
  };

  active();
  options.onProgress?.(
    "searching",
    "正在搜尋公開、未封存且符合條件的 GitHub 專案。",
  );
  let search: any;
  try {
    search = await api(
      [
        "--method",
        "GET",
        "search/repositories",
        "-f",
        `q=${query}`,
        "-f",
        "sort=updated",
        "-f",
        "order=desc",
        "-f",
        "per_page=12",
      ],
      200_000,
    );
    if (!Array.isArray(search.items))
      throw new Error("Invalid search response");
  } catch {
    active();
    return {
      candidates,
      warnings: [
        "GitHub 搜尋未成功完成，可能受到權限、連線或 API 限制影響；尚不能判定沒有符合條件的專案。",
      ],
    };
  }
  if (search.incomplete_results)
    warnings.push("GitHub 回傳部分搜尋結果，這次探索不是完整清單。");
  const repositories = search.items
    .slice(0, 12)
    .filter((repo: any) => {
      const parsed =
        typeof repo.full_name === "string"
          ? parseGitHubSource(`https://github.com/${repo.full_name}`)
          : null;
      return (
        parsed &&
        repo.private === false &&
        repo.archived === false &&
        repo.disabled === false &&
        repo.fork === false &&
        Number.isSafeInteger(repo.stargazers_count) &&
        repo.stargazers_count >= preferences.minStars &&
        (!preferences.language.trim() ||
          (typeof repo.language === "string" &&
            repo.language.toLowerCase() ===
              preferences.language.trim().toLowerCase()))
      );
    })
    .filter(
      (repo: any, index: number, all: any[]) =>
        all.findIndex(
          (item) =>
            item.full_name.toLowerCase() === repo.full_name.toLowerCase(),
        ) === index,
    )
    .slice(0, maximumCandidates);
  if (!repositories.length)
    return {
      candidates,
      warnings: [
        ...warnings,
        "這次有界搜尋未找到符合條件的公開專案；可減少關鍵字、降低 stars 門檻或調整難度。",
      ],
    };
  warnings.push(
    "最多取樣 6 個最近更新的專案，每個最多 3 個開啟中的 issue 與每則最後 3 則留言；標籤不保證實際難度或仍可認領。文件僅讀取 GitHub community profile 識別的根目錄、.github、docs 內 README、CONTRIBUTING 與 PR 模板，未讀取帳號共用規範、多模板目錄及外部連結。",
  );
  for (const found of repositories) {
    active();
    if (limited()) break;
    const remote = parseGitHubSource(`https://github.com/${found.full_name}`)!;
    options.onProgress?.(
      "screening",
      `正在檢查 ${remote.fullName} 的 issue、貢獻文件與維護者回應。`,
    );
    let data: any;
    try {
      const response = await api([
        "graphql",
        "-f",
        `query=${repositoryQuery(preferences.difficulty)}`,
        "-f",
        `owner=${remote.owner}`,
        "-f",
        `name=${remote.name}`,
      ]);
      data = response.data?.repository;
      if (
        response.errors?.length ||
        !data ||
        data.nameWithOwner?.toLowerCase() !== remote.fullName.toLowerCase() ||
        data.isPrivate !== false ||
        data.isArchived !== false ||
        data.isDisabled !== false ||
        ![
          data.stargazerCount,
          data.forkCount,
          data.openIssues?.totalCount,
        ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        !Array.isArray(data.issues?.nodes)
      )
        throw new Error("Unavailable public repository metadata");
      if (
        data.stargazerCount < preferences.minStars ||
        (preferences.language.trim() &&
          data.primaryLanguage?.name?.toLowerCase() !==
            preferences.language.trim().toLowerCase())
      )
        continue;
    } catch {
      active();
      warnings.push(
        `${remote.fullName} 的公開狀態與 issue 資料未能完整確認，已略過；不代表沒有貢獻機會。`,
      );
      continue;
    }
    const candidate: DiscoveryCandidate = {
      fullName: remote.fullName,
      url: remote.url,
      description: redact(
        typeof data.description === "string" ? data.description : "",
      ).slice(0, 1_000),
      language:
        typeof data.primaryLanguage?.name === "string"
          ? data.primaryLanguage.name.slice(0, 40)
          : "",
      stars: data.stargazerCount,
      forks: data.forkCount,
      pushedAt:
        typeof data.pushedAt === "string" &&
        Number.isFinite(Date.parse(data.pushedAt))
          ? data.pushedAt
          : "",
      openIssues: data.openIssues.totalCount,
      sources: [],
      warnings: [],
    };
    candidates.push(candidate);
    const baseSha = data.defaultBranchRef?.target?.oid;
    let profile: any;
    try {
      profile = await api(
        ["--method", "GET", `repos/${remote.fullName}/community/profile`],
        50_000,
      );
    } catch {
      active();
      candidate.warnings.push("貢獻文件索引讀取失敗，不能據此判定沒有規範。");
    }
    for (const [kind, key] of [
      ["readme", "readme"],
      ["contributing", "contributing"],
      ["template", "pull_request_template"],
    ] as const) {
      if (limited()) break;
      const indexed = profile?.files?.[key];
      const file = documentPath(indexed?.url, remote.fullName, kind);
      if (!shaPattern.test(baseSha ?? "")) {
        candidate.warnings.push("未取得可驗證的預設分支版本，未讀取文件。");
        break;
      }
      if (!file && (kind !== "readme" || indexed)) {
        candidate.warnings.push(
          `${kind === "contributing" ? "CONTRIBUTING" : kind === "template" ? "PR 模板" : "README"} 未在本次允許的索引範圍找到，其他位置仍可能有規範。`,
        );
        continue;
      }
      try {
        const endpoint = file
          ? `repos/${remote.fullName}/contents/${file.split("/").map(encodeURIComponent).join("/")}`
          : `repos/${remote.fullName}/readme`;
        const content = await api(
          ["--method", "GET", endpoint, "-f", `ref=${baseSha}`],
          180_000,
        );
        const actualPath =
          typeof content.path === "string"
            ? documentPath(
                `https://api.github.com/repos/${remote.fullName}/contents/${content.path.split("/").map(encodeURIComponent).join("/")}`,
                remote.fullName,
                kind,
              )
            : undefined;
        if (
          !actualPath ||
          (file && actualPath !== file) ||
          content.type !== "file" ||
          content.encoding !== "base64" ||
          typeof content.content !== "string" ||
          !/^[A-Za-z0-9+/=\s]*$/.test(content.content) ||
          !Number.isSafeInteger(content.size) ||
          content.size > 128_000 ||
          content.size < 0
        )
          throw new Error("Unsupported document");
        addSource(
          candidate,
          {
            id: `${remote.fullName}:file:${actualPath}`,
            kind,
            title: actualPath,
            url: `${remote.url}/blob/${baseSha}/${actualPath.split("/").map(encodeURIComponent).join("/")}`,
            content: Buffer.from(content.content, "base64").toString("utf8"),
          },
          kind === "readme" ? 8_000 : 6_000,
        );
      } catch {
        active();
        candidate.warnings.push(
          `${file ?? "README"} 讀取失敗或超出文字大小限制，尚未確認其完整內容。`,
        );
      }
    }
    const maintainerComments: DiscoverySource[] = [];
    for (const issue of data.issues.nodes.slice(0, 3)) {
      if (
        !Number.isSafeInteger(issue?.number) ||
        issue.number < 1 ||
        issue.state !== "OPEN" ||
        typeof issue.title !== "string" ||
        typeof issue.body !== "string" ||
        !canonicalIssueUrl(issue.url, remote.fullName, issue.number)
      )
        continue;
      const labels = Array.isArray(issue.labels?.nodes)
        ? issue.labels.nodes
            .slice(0, 5)
            .map((item: any) =>
              typeof item?.name === "string" ? item.name : "",
            )
            .filter(Boolean)
            .join(", ")
        : "";
      const assigned = Number.isSafeInteger(issue.assignees?.totalCount)
        ? String(issue.assignees.totalCount)
        : "未確認";
      const updatedAt =
        typeof issue.updatedAt === "string" &&
        Number.isFinite(Date.parse(issue.updatedAt))
          ? issue.updatedAt
          : "未確認";
      const reactions = Number.isSafeInteger(issue.reactions?.totalCount)
        ? String(issue.reactions.totalCount)
        : "未確認";
      addSource(
        candidate,
        {
          id: `${remote.fullName}:issue:${issue.number}`,
          kind: "issue",
          title: `#${issue.number} ${issue.title}`,
          url: issue.url,
          content: `${issue.title}\n\nGitHub 狀態：OPEN；標籤：${labels || "無"}；更新時間：${updatedAt}；受指派人數：${assigned}；討論鎖定：${issue.locked === true ? "是" : "否"}；表情回應總數：${reactions}（不代表支持票）。\n\n${issue.body}`,
        },
        3_000,
      );
      for (const comment of Array.isArray(issue.comments?.nodes)
        ? issue.comments.nodes.slice(-3)
        : []) {
        if (
          !maintainerRoles.has(comment?.authorAssociation) ||
          typeof comment.body !== "string" ||
          !canonicalIssueUrl(comment.url, remote.fullName, issue.number, true)
        )
          continue;
        maintainerComments.push({
          id: `${remote.fullName}:comment:${new URL(comment.url).hash.slice(1)}`,
          kind: "comment",
          title: `#${issue.number} · ${comment.authorAssociation} 留言`,
          url: comment.url,
          content: comment.body,
        });
      }
    }
    for (const source of maintainerComments)
      addSource(candidate, source, 1_500);
    if (!candidate.sources.some((source) => source.kind === "issue"))
      candidate.warnings.push(
        "本次取樣未取得符合難度標籤的開啟中 issue，尚不能確認具體需求或可認領性。",
      );
    if (!candidate.pushedAt)
      candidate.warnings.push("GitHub 未提供可驗證的最後推送時間。");
    if (
      candidate.sources.reduce(
        (bytes, source) => bytes + Buffer.byteLength(source.content),
        0,
      ) >= maximumCandidateBytes
    )
      candidate.warnings.push("來源已達每個專案 30 KB 上限，部分內容未讀取。");
  }
  active();
  if (limited())
    warnings.push(
      "探索達到 36 次請求或 90 秒上限，已保留取得的結果；尚未完整讀取其餘候選來源。",
    );
  if (!candidates.length)
    warnings.push(
      "候選資料未能通過公開狀態與來源驗證，這次沒有可分析的專案；可稍後重試或調整條件。",
    );
  return { candidates, warnings };
}
