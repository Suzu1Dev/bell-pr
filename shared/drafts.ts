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
