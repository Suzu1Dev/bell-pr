import type { ExplanationStatus } from "./explanations.js";

/** A run of consecutive lines in the current file, with what they do. */
export interface WalkthroughStep {
  startLine: number;
  endLine: number;
  explanation: string;
}

/** Code the function calls or is called from; line is null for library code. */
export interface CodeReference {
  name: string;
  path: string;
  line: number | null;
  note: string;
}

/**
 * The function, method or test around a change, explained as it works now so
 * the person can read the original logic before judging the change. Line
 * numbers are in the current (changed) version of the file; the text is in
 * the run's language.
 */
export interface FunctionWalkthrough {
  name: string;
  /** What the unit is: function, method, test… */
  kind: string;
  startLine: number;
  endLine: number;
  /** How it works: inputs, outputs, side effects. */
  summary: string;
  /** What this diff changes in it, and why that matters. */
  change: string;
  steps: WalkthroughStep[];
  callers: CodeReference[];
  callees: CodeReference[];
  analogy: string;
  selfCheck: { question: string; answer: string };
}

export interface FileWalkthrough {
  functions: FunctionWalkthrough[];
  /**
   * Units the diff adds whole: they have no earlier logic to read, so the
   * change explanation covers them. Absent on walkthroughs made before this.
   */
  newUnits?: string[];
}

/**
 * A file's walkthrough as Run.walkthroughs keeps it, cached per diff version
 * like change explanations and made again when the fingerprint changes.
 */
export interface StoredWalkthrough {
  fingerprint: string;
  status: ExplanationStatus;
  content?: FileWalkthrough;
  /** Why it failed, or why the file has no walkthrough, in the run's language. */
  error?: string;
  generatedAt?: string;
}
