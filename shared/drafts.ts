export interface DraftSource {
  id: string;
  kind:
    | "contributing"
    | "template"
    | "documentation"
    | "maintainer"
    | "example"
    /** A repository workflow that checks pull requests automatically. */
    | "automation";
  label: string;
  url?: string;
  path?: string;
  content: string;
}

export interface DraftContext {
  sources: DraftSource[];
  warnings: string[];
  checkedAt: string;
  baseSha: string;
}

export interface DraftRule {
  text: string;
  sourceId: string;
  quote: string;
}

export interface DraftProposal {
  title: string;
  body: string;
  policy: "repository" | "linux";
  summary: string;
  rules: DraftRule[];
  checklist: string[];
  templateSourceId: string;
  /**
   * A commit message following the conventions found in the supplied sources
   * (type(scope) subjects, body wrapping, issue references). The human applies
   * it by choice; it never carries Signed-off-by or any other person trailer.
   */
  commitMessageSuggestion?: CommitMessageSuggestion;
}

export interface CommitMessageSuggestion {
  message: string;
  rationale: string;
  /** Ids of the supplied sources whose rules shaped the message. */
  sources: string[];
}

export interface DraftPreparation {
  status: "generating" | "ready" | "failed" | "stale";
  fingerprint: string;
  context?: DraftContext;
  proposal?: DraftProposal;
  error?: string;
  generatedAt?: string;
}

export const linuxContributionUrl =
  "https://docs.kernel.org/process/submitting-patches.html";

/**
 * Lines of a Markdown body with fenced code, inline code and HTML comments
 * blanked out, so line numbers still match the body. Text inside code is
 * quoted material, not prose the PR is saying.
 */
export function markdownProse(markdown: string) {
  let fence = "";
  let comment = false;
  return markdown.split("\n").map((line) => {
    // Any indentation: fences inside nested list items are still code.
    if (fence) {
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (closing && closing[1][0] === fence[0] && closing[1].length >= fence.length)
        fence = "";
      return "";
    }
    const opening = /^\s*(`{3,}|~{3,})/.exec(line);
    if (opening && !comment) {
      fence = opening[1];
      return "";
    }
    let rest = line;
    let prose = "";
    while (rest) {
      if (comment) {
        const end = rest.indexOf("-->");
        if (end < 0) return prose;
        comment = false;
        rest = rest.slice(end + 3);
        continue;
      }
      // "<!--" quoted inside a code span does not open a comment.
      const start = rest
        .replace(/(`+)[\s\S]*?\1/g, (span) => " ".repeat(span.length))
        .indexOf("<!--");
      if (start < 0) {
        prose += rest;
        break;
      }
      prose += rest.slice(0, start);
      comment = true;
      rest = rest.slice(start + 4);
    }
    return prose.replace(/(`+)[\s\S]*?\1/g, "");
  });
}

/**
 * An issue line left as a template slot: "Closes #", "Fixes # (issue)",
 * "> **Resolves** #[number]", "Issue: #___". A number after "#" is a real link.
 */
const emptyIssueSlot =
  /^\s*(?:>\s*)?(?:[-*+]\s+)?(?:\*\*|__)?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|(?:related\s+)?issues?)(?:\*\*|__)?\s*:?(?:\*\*|__)?\s*#\s*(?:\([^)\n]*\)|\[[^\]\n]*\]|<[^>\n]*>|_+|x+|\.{3}|…)?\s*$/i;

/**
 * Marker shapes only, so prose that mentions a TODO comment or TODO.md, or a
 * template item about TODO comments, is not mistaken for an open slot.
 */
const markerWord = "(?:TODO|TBD|FIXME)";
const placeholderPatterns = [
  // Emphasised: _TODO_, *TBD*, _TODO: link an issue_.
  // `\b` would miss "_TODO_": the underscore counts as a word character.
  new RegExp(`(?<![A-Za-z0-9])[_*]+${markerWord}(?![A-Za-z0-9.])`),
  // Bracketed: (TODO), [TBD: owner].
  new RegExp(`[([]\\s*${markerWord}\\s*(?:[:)\\]]|$)`),
  // Leading a line or list item: "TODO: add output", "- TBD".
  new RegExp(
    `^\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s+)?|\\d+[.)]\\s+)?${markerWord}\\s*(?::|$)`,
  ),
  // Standing in for a value: "Exit code: TBD".
  new RegExp(`:\\s*${markerWord}\\s*\\.?\\s*$`),
  /\b(?:results?|output|details?|text|answer)s? (?:go|goes) here\b/i,
  emptyIssueSlot,
];

/** Lines of the PR body that are unfinished: TODO markers, "goes here" slots, an empty "Closes #". */
export function findDraftPlaceholders(body: string) {
  const lines = body.split("\n");
  return markdownProse(body).flatMap((prose, index) =>
    placeholderPatterns.some((pattern) => pattern.test(prose))
      ? [{ line: index + 1, text: lines[index].trim().slice(0, 80) }]
      : [],
  );
}

export interface DraftTaskItem {
  /** 1-based line in the body. */
  line: number;
  checked: boolean;
  text: string;
  /** The nearest heading above the item; empty when there is none. */
  heading: string;
}

const taskItemPattern = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

/** Markdown task-list items outside code and comments, with the heading each one sits under. */
export function draftTaskItems(body: string): DraftTaskItem[] {
  const lines = body.split("\n");
  let heading = "";
  return markdownProse(body).flatMap((prose, index) => {
    const title = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(prose);
    if (title) heading = title[1].trim();
    const item = prose.trim() ? taskItemPattern.exec(lines[index]) : null;
    return item
      ? [
          {
            line: index + 1,
            checked: item[2] !== " ",
            text: item[4].trim(),
            heading,
          },
        ]
      : [];
  });
}

/** The body with one task item ticked or cleared; other lines are untouched. */
export function setDraftTaskItem(body: string, line: number, checked: boolean) {
  const lines = body.split("\n");
  if (!draftTaskItems(body).some((item) => item.line === line)) return body;
  lines[line - 1] = lines[line - 1].replace(
    taskItemPattern,
    (_match, before: string, _mark: string, after: string, text: string) =>
      `${before}${checked ? "x" : " "}${after}${text}`,
  );
  return lines.join("\n");
}

export interface DraftRuleQuote {
  sourceId: string;
  label: string;
  quote: string;
}

function findRule(sources: DraftSource[], pattern: RegExp) {
  for (const source of sources) {
    if (source.kind !== "contributing" && source.kind !== "template") continue;
    const line = markdownProse(source.content).find((text) => pattern.test(text));
    if (line)
      return {
        sourceId: source.id,
        label: source.label,
        quote: line
          .replace(/\*\*|__/g, "")
          .trim()
          .replace(/^[-*>#\s]+/, "")
          .slice(0, 200),
      };
  }
}

/** True when two bodies differ at most in which task items are ticked; ticking is not a rewrite. */
export function sameDraftProse(a: string, b: string) {
  const prose = (body: string) =>
    body
      .split("\n")
      .map((line) =>
        line.replace(
          taskItemPattern,
          (_match, before: string, _mark: string, after: string, text: string) =>
            `${before} ${after}${text}`,
        ),
      )
      .join("\n")
      .trim();
  return prose(a) === prose(b);
}

/** A contributing or template line asking for short descriptions written by the contributor. */
export function brevityRule(sources: DraftSource[]): DraftRuleQuote | undefined {
  return findRule(
    sources,
    /own words|short,? (?:and )?focused descriptions?|walls? of text|(?:large|long)\b[^.\n]{0,40}\bAI[- ]generated|AI[- ]generated\b[^.\n]{0,40}\b(?:descriptions?|text)\b/i,
  );
}

/** A template issue slot, or a contributing rule that every PR must be linked to an issue. */
export function issueRule(sources: DraftSource[]): DraftRuleQuote | undefined {
  return findRule(
    sources,
    new RegExp(
      `${emptyIssueSlot.source}|${
        /\b(?:all|every|each|any)\s+(?:pull requests?|PRs?)\b[^.\n]{0,80}\b(?:must|should|needs?)\b[^.\n]{0,60}\b(?:(?:reference[sd]?|link(?:ed)?|mention(?:ed)?)\b[^.\n]{0,40}\b|have an? (?:linked |open |existing |associated )?)issues?\b|\b(?:pull requests?|PRs?)\b[^.\n]{0,20}\bwithout an? (?:linked |associated )?issues?\b/
          .source
      }`,
      "i",
    ),
  );
}

/** True when the body cites an issue as #N, owner/repo#N or an issue URL. */
export function referencesIssue(body: string) {
  return markdownProse(body).some((prose) =>
    /(?:^|[\s(:])(?:[\w.-]+\/[\w.-]+)?#\d+\b|https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+/.test(
      prose,
    ),
  );
}

/** Words of prose, ignoring headings, task items, code and comments. A CJK character counts as one word. */
export function draftProseWords(body: string) {
  return markdownProse(body)
    .filter(
      (prose) =>
        !/^ {0,3}#{1,6}\s/.test(prose) && !taskItemPattern.test(prose),
    )
    .reduce(
      (total, prose) =>
        total +
        (prose.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
          ?.length ?? 0) +
        (prose
          .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, " ")
          .match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu)?.length ?? 0),
      0,
    );
}

/**
 * BELL's own target for prose length, not a repository rule: tighter when the
 * repository asks for short descriptions. The numbers are writing defaults,
 * not measured thresholds.
 */
export function draftWordBudget(sources: DraftSource[]) {
  return brevityRule(sources) ? 150 : 300;
}

export interface DraftCheck {
  id: "placeholder" | "unchecked" | "issue" | "brevity";
  /** block stops approval and publishing; confirm needs the person's acknowledgement before publishing. */
  kind: "block" | "confirm";
  message: string;
  details: string[];
}

/**
 * Checks the text that will be sent to GitHub. Shared by the draft tab, the
 * publish dialog and the server so all three agree. It reports what is still
 * open; it never ticks a box or edits the text.
 */
export function draftPreflight(input: {
  body: string;
  sources?: DraftSource[];
  proposalBody?: string;
}): DraftCheck[] {
  const sources = input.sources ?? [];
  const checks: DraftCheck[] = [];
  const placeholders = findDraftPlaceholders(input.body);
  if (placeholders.length)
    checks.push({
      id: "placeholder",
      kind: "block",
      message: `PR 說明還有 ${placeholders.length} 處待填寫的內容。這段文字會原樣送到 GitHub；請改成目前的事實或刪除，待辦事項留在核對清單。若是在描述 TODO 註解或檔案本身，請用反引號包起來，例如 \`TODO\`。`,
      details: placeholders
        .slice(0, 5)
        .map((item) => `第 ${item.line} 行：「${item.text}」`),
    });
  const groups = new Map<string, DraftTaskItem[]>();
  for (const item of draftTaskItems(input.body))
    groups.set(item.heading, [...(groups.get(item.heading) ?? []), item]);
  const empty = [...groups].filter(([, items]) =>
    items.every((item) => !item.checked),
  );
  if (empty.length)
    checks.push({
      id: "unchecked",
      kind: "confirm",
      message:
        "這些段落的勾選項目全部沒有勾，會原樣送出。專案的範本或自動檢查可能要求勾選；只勾你真正完成或確認的項目。",
      details: empty.map(
        ([heading, items]) =>
          `${heading || "（無標題）"}：${items.length} 項都未勾`,
      ),
    });
  const issue = issueRule(sources);
  if (issue && !referencesIssue(input.body))
    checks.push({
      id: "issue",
      kind: "confirm",
      message:
        "專案規範要求 PR 連結既有的 issue，這份說明沒有引用任何 issue。",
      details: [`${issue.label}：「${issue.quote}」`],
    });
  const brevity = brevityRule(sources);
  if (brevity) {
    const words = draftProseWords(input.body);
    const budget = draftWordBudget(sources);
    const unrevised =
      !!input.proposalBody?.trim() &&
      sameDraftProse(input.body, input.proposalBody);
    if (unrevised || words > budget)
      checks.push({
        id: "brevity",
        kind: "confirm",
        message: unrevised
          ? "這份說明仍是未改寫的 BELL 建議原文，而專案要求用自己的話寫簡短的說明。"
          : `這份說明約 ${words} 字，超過 BELL 建議的 ${budget} 字；專案要求簡短的說明。`,
        details: [`${brevity.label}：「${brevity.quote}」`],
      });
  }
  return checks;
}

/**
 * A conservative subset of Git branch names that GitHub accepts: ASCII words
 * joined by "/", ".", "_" or "-"; no "..", no ".lock" or "." at the end, not HEAD.
 */
export function validBranchName(name: string) {
  // Comparing with the target branch happens where it is known (Workbench.draft and publish).
  return (
    name.length <= 100 &&
    name !== "HEAD" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name) &&
    !name.includes("..") &&
    !/(?:\.lock|\.)$/.test(name) &&
    !/\.lock\//.test(name)
  );
}
