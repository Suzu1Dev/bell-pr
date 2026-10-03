/** Structured teaching content, shared by generated and demo explanations. */
export interface ChangeExplanation {
  summary: string;
  reason: string;
  concept: string;
  tip: string;
  /** Optional only for explanations saved before examples were introduced. */
  example?: { scenario: string; before: string; after: string };
}
export type ExplanationStatus =
  "pending" | "generating" | "ready" | "failed" | "unavailable";
export interface StoredExplanation {
  fingerprint: string;
  status: ExplanationStatus;
  content?: ChangeExplanation;
  error?: string;
  generatedAt?: string;
}
