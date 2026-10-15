import {
  discoverySorts,
  type DiscoveryCandidate,
  type DiscoveryPreferences,
  type DiscoverySort,
  type DiscoverySource,
} from "../shared/discovery.js";
import { formatters } from "../shared/i18n/locale.js";
import { learningLabel } from "../shared/contribution.js";
import { parseGitHubSource, safeRelativePath, sensitivePath } from "./git.js";
import { currentLocale, sm } from "./i18n/index.js";
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
    throw new AppError(
      (m) => m.analysis.discoverySources.invalidInterests,
      422,
    );
  if (
    typeof preferences.language !== "string" ||
    preferences.language.length > 40 ||
    (preferences.language &&
      !/^[\p{L}\p{N}][\p{L}\p{N} +#._-]*$/u.test(preferences.language))
  )
    throw new AppError((m) => m.analysis.discoverySources.invalidLanguage, 422);
  if (
    !Number.isSafeInteger(preferences.minStars) ||
    preferences.minStars < 0 ||
    preferences.minStars > 1_000_000
  )
    throw new AppError((m) => m.analysis.discoverySources.invalidMinStars, 422);
  if (!["any", "beginner", "intermediate"].includes(preferences.difficulty))
    throw new AppError(
      (m) => m.analysis.discoverySources.invalidDifficulty,
      422,
    );
  if (!discoverySorts.includes(preferences.sort))
    throw new AppError((m) => m.analysis.discoverySources.invalidSort, 422);
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
    // Good first issues are how newcomers learn by doing the work
    // themselves; BELL's agent team works on help-wanted issues instead.
    ...(preferences.difficulty === "beginner" ||
    preferences.difficulty === "intermediate"
      ? ["help-wanted-issues:>0"]
      : []),
  ].join(" ");
}

// GitHub's best match has no sort parameter; the other orders are explicit and descending.
function sortArguments(sort: DiscoverySort) {
  return sort === "relevance" ? [] : ["-f", `sort=${sort}`, "-f", "order=desc"];
}

function repositoryQuery(difficulty: DiscoveryPreferences["difficulty"]) {
  const label =
    difficulty === "beginner" || difficulty === "intermediate"
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

/**
 * Public, read-only discovery. Fetched text is evidence, never executable
 * instructions. `learningIssues` lists the issue sources whose labels mark
 * them for people learning to contribute (good first issue and the like),
 * so the opportunities quoting them become practice to write by hand.
 */
export async function collectDiscoveryCandidates(
  preferences: DiscoveryPreferences,
  options: {
    command?: typeof command;
    signal?: AbortSignal;
    onProgress?: (phase: "searching" | "screening", message: string) => void;
  } = {},
): Promise<{
  candidates: DiscoveryCandidate[];
  warnings: string[];
  learningIssues?: string[];
}> {
  const query = searchQuery(preferences);
  const messages = sm().analysis.discoverySources;
  const number = formatters(currentLocale()).number;
  const execute = options.command ?? command;
  const candidates: DiscoveryCandidate[] = [];
  const warnings: string[] = [];
  const learningIssues: string[] = [];
  const deadline = AbortSignal.timeout(90_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  let requests = 0;
  const active = () => {
    if (options.signal?.aborted)
      throw new AppError((m) => m.analysis.discoverySources.cancelled, 409);
  };
  const limited = () => deadline.aborted || requests >= maximumRequests;
  const api = async (args: string[], maxBytes = 500_000) => {
    active();
    if (limited())
      throw new AppError((m) => m.analysis.discoverySources.limitReached, 422);
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
      candidate.warnings.push(messages.unreadableText({ title: source.title }));
      return;
    }
    const cleaned = redact(source.content);
    if (cleaned !== source.content)
      candidate.warnings.push(messages.maskedCredentials({ title: source.title }));
    const used = candidate.sources.reduce(
      (total, item) => total + Buffer.byteLength(item.content),
      0,
    );
    const available = Math.min(limit, maximumCandidateBytes - used);
    if (available <= 0) return;
    const bytes = Buffer.from(cleaned);
    if (bytes.length > available)
      candidate.warnings.push(
        messages.truncatedSource({
          title: source.title,
          bytes: number(available),
        }),
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
  options.onProgress?.("searching", messages.searching);
  let search: any;
  try {
    search = await api(
      [
        "--method",
        "GET",
        "search/repositories",
        "-f",
        `q=${query}`,
        ...sortArguments(preferences.sort),
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
      warnings: [messages.searchFailed],
      learningIssues,
    };
  }
  if (search.incomplete_results)
    warnings.push(messages.partialResults);
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
      warnings: [...warnings, messages.noRepositories],
      learningIssues,
    };
  warnings.push(messages.samplingScope({ sort: preferences.sort }));
  for (const found of repositories) {
    active();
    if (limited()) break;
    const remote = parseGitHubSource(`https://github.com/${found.full_name}`)!;
    options.onProgress?.(
      "screening",
      messages.screening({ repository: remote.fullName }),
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
        messages.repositoryUnconfirmed({ repository: remote.fullName }),
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
      candidate.warnings.push(messages.profileFailed);
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
        candidate.warnings.push(messages.noBaseCommit);
        break;
      }
      if (!file && (kind !== "readme" || indexed)) {
        candidate.warnings.push(messages.documentNotIndexed({ document: kind }));
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
          messages.documentFailed({ path: file ?? "README" }),
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
      const names: string[] = Array.isArray(issue.labels?.nodes)
        ? issue.labels.nodes
            .slice(0, 5)
            .map((item: any) =>
              typeof item?.name === "string" ? item.name : "",
            )
            .filter(Boolean)
        : [];
      const labels = names.join(", ");
      if (names.some(learningLabel))
        learningIssues.push(`${remote.fullName}:issue:${issue.number}`);
      // Undefined when GitHub did not confirm the value.
      const assignees: number | undefined = Number.isSafeInteger(
        issue.assignees?.totalCount,
      )
        ? issue.assignees.totalCount
        : undefined;
      const updatedAt =
        typeof issue.updatedAt === "string" &&
        Number.isFinite(Date.parse(issue.updatedAt))
          ? issue.updatedAt
          : undefined;
      const reactions: number | undefined = Number.isSafeInteger(
        issue.reactions?.totalCount,
      )
        ? issue.reactions.totalCount
        : undefined;
      addSource(
        candidate,
        {
          id: `${remote.fullName}:issue:${issue.number}`,
          kind: "issue",
          title: `#${issue.number} ${issue.title}`,
          url: issue.url,
          content: `${issue.title}\n\n${messages.issueHeader({
            labels,
            updatedAt,
            assignees,
            locked: issue.locked === true,
            reactions,
          })}\n\n${issue.body}`,
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
          title: messages.commentTitle({
            number: issue.number,
            association: comment.authorAssociation,
          }),
          url: comment.url,
          content: comment.body,
        });
      }
    }
    for (const source of maintainerComments)
      addSource(candidate, source, 1_500);
    if (!candidate.sources.some((source) => source.kind === "issue"))
      candidate.warnings.push(messages.noMatchingIssue);
    if (!candidate.pushedAt) candidate.warnings.push(messages.noPushTime);
    if (
      candidate.sources.reduce(
        (bytes, source) => bytes + Buffer.byteLength(source.content),
        0,
      ) >= maximumCandidateBytes
    )
      candidate.warnings.push(messages.candidateBytesLimit);
  }
  active();
  if (limited())
    warnings.push(messages.requestLimit);
  if (!candidates.length) warnings.push(messages.noCandidates);
  return { candidates, warnings, learningIssues };
}
