/**
 * Checks on the PR text that will be sent to GitHub, shared by the server
 * (parser, approve, publish) and the draft tab and publish dialog. Kept apart
 * from shared/drafts.ts so the browser can load the Markdown parser lazily.
 */
import type { Nodes as MdastNode } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { withoutAiDisclosure, type DraftSource } from "./drafts.js";
import en from "./i18n/draft-checks.en.js";
import zhTW from "./i18n/draft-checks.zh-TW.js";
import type { Locale } from "./i18n/locale.js";
import {
  respectChecks,
  type ContributionFacts,
  type ContributionRules,
  type GuardOverride,
} from "./contribution.js";
import type { ReviewabilitySnapshot } from "./reviewability.js";
import type { HelpKind, HelpLock } from "./by-hand.js";
// The secret shapes and the safety-check messages have one source each,
// kept with the server; both modules are plain data and load in the browser.
import { secretInPatch } from "../server/secrets.js";
import safetyEn from "../server/i18n/en/security-draft-checks.js";
import safetyZhTW from "../server/i18n/zh-TW/security-draft-checks.js";

const dictionaries: Record<Locale, typeof en> = { en, "zh-TW": zhTW };
const safetyDictionaries: Record<Locale, typeof safetyEn> = {
  en: safetyEn,
  "zh-TW": safetyZhTW,
};

/**
 * Lines of a Markdown body with code (fenced, indented and inline) and HTML
 * comments blanked out, so line numbers still match the body. Text inside
 * code is quoted material, not prose the PR is saying. The GFM parser decides
 * what is code or a comment the way GitHub renders it, so an odd indent or an
 * unclosed "<!--" cannot hide the rest of the body from the checks.
 */
export function markdownProse(markdown: string) {
  if (markdown === lastProse.markdown) return lastProse.lines;
  const hidden = markdown.split("");
  const visit = (node: MdastNode) => {
    const hide =
      node.type === "code" ||
      node.type === "inlineCode" ||
      (node.type === "html" && node.value.trimStart().startsWith("<!--"));
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (hide && start !== undefined && end !== undefined) {
      for (let index = start; index < end; index++)
        if (hidden[index] !== "\n") hidden[index] = " ";
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(
    fromMarkdown(markdown, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    }),
  );
  const lines = hidden
    .join("")
    .split("\n")
    .map((line) => (line.trim() ? line : ""));
  // The draft tab re-checks the same body several times per keystroke.
  lastProse = { markdown, lines };
  return lines;
}
let lastProse: { markdown: string; lines: string[] } = {
  markdown: "",
  lines: [""],
};

/**
 * An issue line left as a template slot: "Closes #", "Fixes # (issue)",
 * "> **Resolves** #[number]", "Issue: #___". A number after "#" is a real link.
 */
const emptyIssueSlot =
  /^\s*(?:>\s*)?(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\*\*|__)?(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|(?:related\s+)?issues?)(?:\*\*|__)?\s*:?(?:\*\*|__)?\s*#\s*(?:\([^)\n]*\)|\[[^\]\n]*\]|<[^>\n]*>|_+|x+|\.{3}|…)?\s*$/i;

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
    `^\\s*(?:(?:[-*+]|\\d{1,9}[.)])\\s+(?:\\[[ xX]\\]\\s+)?)?${markerWord}\\s*(?::|$)`,
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

// Bulleted or ordered ("1. [ ]") task items; GitHub renders both as checkboxes.
const taskItemPattern = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+\[)([ xX])(\]\s+)(.*)$/;

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
    const index = markdownProse(source.content).findIndex((text) =>
      pattern.test(text),
    );
    const line = index < 0 ? undefined : source.content.split("\n")[index];
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
  return undefined;
}

/**
 * True when two bodies differ at most in which task items are ticked and
 * in BELL's AI-disclosure line; neither is a rewrite of the text.
 */
export function sameDraftProse(a: string, b: string) {
  const prose = (body: string) =>
    withoutAiDisclosure(body)
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
  /**
   * Not persisted, so the union can grow. The respect checks (DESIGN §5.4)
   * come from respectChecks() in shared/contribution.ts. Unrevised
   * suggested text is `own-words`: a block when the project's quoted rules
   * ask for the contributor's own words, a confirm on every other project,
   * except that a project with a brevity rule keeps its `brevity` confirm
   * for it, which quotes that rule.
   */
  id:
    | "placeholder"
    | "unchecked"
    | "issue"
    | "brevity"
    | "secret"
    | "local-paths"
    | "workflows"
    | "author-email"
    // Blocks
    | "pr-closed"
    | "ai-ban"
    | "ai-disclosure"
    | "own-words"
    | "issue-closed"
    | "issue-has-pr"
    | "area-reserved"
    | "tests-weakened"
    | "pacing-max"
    // Confirms (own-words above is one too)
    | "project-rules"
    | "issue-state"
    | "reviewability"
    | "pacing"
    | "facts-unknown"
    // The quoted confirm of a clean Learn-by-hand run (DESIGN v1.2 F12);
    // never an override, never a typed reason.
    | "by-hand-rules"
    // Headroom item 2 (DESIGN v1.2 F13): a line that says no AI helped.
    | "disclosure-accuracy";
  /** block stops approval and publishing; confirm needs the person's acknowledgement before publishing. */
  kind: "block" | "confirm";
  message: string;
  details: string[];
}

/**
 * Continuous-integration configuration: GitHub Actions workflows and
 * actions, and the CI files of other services. A change to them is
 * published only after the person confirms it (the `workflows` check); it
 * is not held back like a sensitive file.
 */
export function ciConfigPath(filePath: string) {
  return (
    /^\.github\/(?:workflows|actions)\//.test(filePath) ||
    /^(?:\.gitlab-ci\.ya?ml|\.travis\.ya?ml|azure-pipelines\.ya?ml|appveyor\.ya?ml|\.appveyor\.ya?ml|bitbucket-pipelines\.ya?ml|\.drone\.ya?ml|Jenkinsfile|\.cirrus\.ya?ml)$/.test(
      filePath,
    ) ||
    /^(?:\.circleci|\.buildkite|\.woodpecker|\.gitlab\/ci)\//.test(filePath)
  );
}

/**
 * A home directory as it appears in a path on Linux or macOS (the second
 * group). It must start a path, so a repository folder such as
 * `src/home/components/` or a URL such as `https://example.com/home/docs/`
 * is not taken for one.
 */
const homePathPattern =
  /(^|[^A-Za-z0-9._~%+-])(\/(?:home|Users)\/[A-Za-z0-9._-]+\/)/g;

/** Whether `text` names `directory` itself, not a longer name that starts like it. */
function mentionsDirectory(text: string, directory: string) {
  for (
    let at = text.indexOf(directory);
    at >= 0;
    at = text.indexOf(directory, at + 1)
  ) {
    const next = text.charAt(at + directory.length);
    if (!/[A-Za-z0-9._-]/.test(next)) return true;
  }
  return false;
}

/** An address GitHub hides behind: 12345+name@users.noreply.github.com. */
export function noreplyEmail(email: string) {
  return /@users\.noreply\.github\.com$/i.test(email.trim());
}

/**
 * Names that can never be a real mailbox (RFC 2606 and RFC 6761): test
 * identities and BELL's own internal one publish nothing personal.
 */
function reservedEmail(email: string) {
  return /\.(?:invalid|test|example|localhost)$|@(?:[^@]+\.)?example\.(?:com|net|org)$/i.test(
    email.trim(),
  );
}

export interface DraftPreflightInput {
  /** The PR description. */
  body: string;
  /** The PR title, checked for credentials and local paths. */
  title?: string;
  /** The commit message, checked like the title. */
  commitMessage?: string;
  sources?: DraftSource[];
  proposalBody?: string;
  /**
   * Directories of this computer that must not appear in the text, such as
   * the home and data directories; the server passes them.
   */
  localDirectories?: string[];
  /** The repository paths the PR changes. */
  changedPaths?: string[];
  /**
   * The e-mail addresses the commit will carry (author and committer). The
   * server leaves out an address the person already confirmed once.
   */
  commitEmails?: string[];
  /** The change's reviewability snapshot (shared/reviewability.ts). */
  changes?: ReviewabilitySnapshot;
  /** The project's quoted rules (`Repository.contributionRules`). */
  rules?: ContributionRules;
  /** The GitHub facts; absent means none were read, and no fact-based check runs. */
  facts?: ContributionFacts;
  /** Blocks the person lifted with a reason (`run.guardOverrides`). */
  overrides?: GuardOverride[];
  /** The person's reason for each weakened-test item, by its id. */
  testReasons?: Record<string, string>;
  /** The person turned the understanding check off. */
  understandingOff?: boolean;
  /** The issue the run is for (`contributionSettings.issueUrl`); empty or absent means none. */
  issueUrl?: string;
  /**
   * A Learn-by-hand run whose history is clean (`byHandPreflight` in
   * shared/by-hand.ts, the same at both server callers and both client
   * mirrors): the kinds of help it used, the help set fixed when it
   * started, when it started (only where publishing is checked) and the
   * time of the check. Absent for agent runs and for a Learn-by-hand run
   * whose history withdrew the claim; both get the agent run's checks. Not
   * persisted.
   */
  learnByHand?: ByHandPreflightInput;
}

/** `DraftPreflightInput.learnByHand`. */
export interface ByHandPreflightInput {
  helps: HelpKind[];
  helpLock?: HelpLock;
  createdAt?: string;
  now: string;
}

/**
 * Checks the text that will be sent to GitHub. Shared by the draft tab, the
 * publish dialog and the server so all three agree. It reports what is still
 * open; it never ticks a box or edits the text. `locale` chooses the language
 * of the messages; the ids and kinds are the same in every locale. Checks
 * that need facts only the server has (local directories, changed paths,
 * the commit e-mail) run when those facts are passed in, and so do the
 * respect checks (project rules, GitHub facts, reviewability, pacing),
 * which come last.
 */
export function draftPreflight(
  input: DraftPreflightInput,
  locale: Locale = "en",
): DraftCheck[] {
  const m = dictionaries[locale];
  const safety = safetyDictionaries[locale];
  const sources = input.sources ?? [];
  const checks: DraftCheck[] = [];
  const fields = (["title", "body", "commitMessage"] as const).filter(
    (field) => !!input[field],
  );
  // Credentials block wherever they are; only the person can take them out.
  const leaking = fields.filter((field) => secretInPatch(input[field]!));
  if (leaking.length)
    checks.push({
      id: "secret",
      kind: "block",
      message: safety.secret,
      details: leaking.map((field) => safety.secretIn({ field })),
    });
  const placeholders = findDraftPlaceholders(input.body);
  if (placeholders.length)
    checks.push({
      id: "placeholder",
      kind: "block",
      message: m.placeholder({ count: placeholders.length }),
      details: placeholders
        .slice(0, 5)
        .map((item) => m.placeholderLine({ line: item.line, text: item.text })),
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
      message: m.unchecked,
      details: empty.map(([heading, items]) =>
        m.uncheckedSection({
          heading: heading || m.noHeading,
          count: items.length,
        }),
      ),
    });
  const issue = issueRule(sources);
  if (issue && !referencesIssue(input.body))
    checks.push({
      id: "issue",
      kind: "confirm",
      message: m.issue,
      details: [m.ruleQuote(issue)],
    });
  const brevity = brevityRule(sources);
  if (brevity) {
    const words = draftProseWords(input.body);
    const budget = draftWordBudget(sources);
    const unrevised =
      !!input.proposalBody?.trim() &&
      sameDraftProse(input.body, input.proposalBody);
    // Where the project's quoted rules ask for the contributor's own words,
    // unrevised text is the own-words block instead (respectChecks).
    const ownWordsRule = input.rules?.findings.some(
      (finding) => finding.kind === "own-words",
    );
    if ((unrevised && !ownWordsRule) || (!unrevised && words > budget))
      checks.push({
        id: "brevity",
        kind: "confirm",
        message: unrevised
          ? m.brevityUnrevised
          : m.brevityOver({ words, budget }),
        details: [m.ruleQuote(brevity)],
      });
  }
  const text = fields.map((field) => input[field]!).join("\n");
  const found = new Set<string>();
  for (const directory of input.localDirectories ?? []) {
    const trimmed = directory.replace(/\/+$/, "");
    // The root or a one-segment directory such as /tmp says nothing about the person.
    if (trimmed.split("/").filter(Boolean).length < 2) continue;
    if (mentionsDirectory(text, trimmed)) found.add(trimmed);
  }
  for (const match of text.matchAll(homePathPattern)) {
    // A home directory already reported above is not listed twice.
    const home = match[2];
    if (![...found].some((directory) => home.startsWith(`${directory}/`)))
      found.add(home);
  }
  if (found.size)
    checks.push({
      id: "local-paths",
      kind: "confirm",
      message: safety.localPaths,
      details: [...found]
        .slice(0, 5)
        .map((value) => safety.localPath({ path: value.slice(0, 120) })),
    });
  const workflows = (input.changedPaths ?? []).filter(ciConfigPath);
  if (workflows.length)
    checks.push({
      id: "workflows",
      kind: "confirm",
      message: safety.workflows,
      details: workflows
        .slice(0, 5)
        .map((value) => safety.workflowFile({ path: value })),
    });
  const emails = [
    ...new Set(
      (input.commitEmails ?? [])
        .map((email) => email.trim())
        .filter((email) => email && !noreplyEmail(email) && !reservedEmail(email)),
    ),
  ];
  if (emails.length)
    checks.push({
      id: "author-email",
      kind: "confirm",
      message: safety.authorEmail({ emails }),
      details: [],
    });
  checks.push(...respectChecks(input, locale));
  return checks;
}
