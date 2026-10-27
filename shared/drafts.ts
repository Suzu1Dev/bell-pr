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
   * Where the rules ask for an AI trailer, BELL ends it with one naming the
   * agent that wrote the change (`aiTrailerRule`).
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
  /**
   * A suggestion's body the draft still was when a later generation
   * replaced or dropped `proposal`; the checks on unrevised text compare
   * the draft with it too.
   */
  appliedBody?: string;
  /**
   * The bodies of the suggestions later generations replaced or dropped,
   * newest first and at most five, saved into the draft or not; the checks
   * on unrevised text compare the draft with them too.
   */
  earlierBodies?: string[];
}

/**
 * The PR text the person edits, reviews and publishes (`run.draft`). Every
 * field added after title and body is optional, so a draft saved by an
 * older build reads as one with every new choice off.
 */
export interface RunDraft {
  title: string;
  body: string;
  commitMessage?: string;
  publishBranch?: string;
  /**
   * The person chose to say in the PR description that AI coding agents
   * prepared the change. Absent means off: BELL then never mentions AI
   * unless the target project's rules require a disclosure, which the
   * draft's checklist quotes so the person writes it in their own words.
   */
  aiDisclosure?: boolean;
}

/**
 * The editable English line BELL adds to the PR description when the
 * person turns the disclosure on. PR text stays English unless the
 * project's rules say otherwise, so it is not translated.
 */
export const aiDisclosureLine =
  "This change was prepared with AI coding agents and reviewed by me.";

/** The body with the disclosure line appended once, after a blank line. */
export function withAiDisclosure(body: string) {
  if (body.includes(aiDisclosureLine)) return body;
  const trimmed = body.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${aiDisclosureLine}` : aiDisclosureLine;
}

/**
 * The body without BELL's disclosure line. A line the person reworded is
 * theirs and stays.
 */
export function withoutAiDisclosure(body: string) {
  if (!body.includes(aiDisclosureLine)) return body;
  const kept: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() !== aiDisclosureLine) {
      kept.push(line);
      continue;
    }
    // Also drop the blank line withAiDisclosure put before it.
    if (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  }
  return kept.join("\n");
}

export const linuxContributionUrl =
  "https://docs.kernel.org/process/submitting-patches.html";

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
