/** Where a commit on the PR branch came from, by BELL's own records. */
export type CommitSource =
  /** The first commit BELL pushed when the PR was opened. */
  | "initial"
  /** A round of changes made after maintainers reviewed the PR. */
  | "review"
  /** The target branch merged into the PR. */
  | "sync"
  /** Pushed to the PR branch on GitHub outside BELL, then taken over. */
  | "adopted"
  | "other";

/** One commit of a published contribution, oldest first in a list. */
export interface CommitSummary {
  sha: string;
  parents: string[];
  author: string;
  /** ISO 8601 author date. */
  date: string;
  subject: string;
  body: string;
  source: CommitSource;
  /** For a review round: which one, counting review rounds only. */
  round?: number;
  /** Against the first parent; a merge counts what it brought in. */
  files: number;
  additions: number;
  deletions: number;
}

export interface CommitFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
  /** Empty when blocked. */
  patch: string;
  /** Why the patch is not shown (sensitive file, credential, binary, size). */
  blocked?: string;
}

export interface CommitDetail {
  files: CommitFile[];
  /** Files left out once the size or file limit was reached. */
  omitted: number;
}
