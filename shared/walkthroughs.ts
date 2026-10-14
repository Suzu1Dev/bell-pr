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
 * numbers are in the current (changed) version of the file.
 */
export interface FunctionWalkthrough {
  name: string;
  /** In Traditional Chinese: 函式、方法、測試… */
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

/** Cached per diff version, like change explanations; regenerated when the fingerprint changes. */
export interface StoredWalkthrough {
  fingerprint: string;
  status: ExplanationStatus;
  content?: FileWalkthrough;
  /** Why it failed, or why the file has no walkthrough. */
  error?: string;
  generatedAt?: string;
}
