/** Structured teaching content, shared by generated and demo explanations. */
export interface ChangeExplanation {
  summary: string;
  reason: string;
  concept: string;
  tip: string;
  /** Optional only for explanations saved before examples were introduced. */
  example?: { scenario: string; before: string; after: string };
  /**
   * Another viable approach, why it was not taken and when to prefer it.
   * Optional only for explanations saved before this card was introduced;
   * older cards are not regenerated for it.
   */
  alternatives?: string;
  /** At most three searchable keywords (English terms kept) for the alternatives. */
  lookup?: string[];
  /** One retrieval question about the core intent or an edge condition. */
  selfCheck?: { question: string; answer: string };
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
/** The learner's own words about one file, saved with the diff version it described. */
export interface LearnerNote {
  text: string;
  fingerprint: string;
  updatedAt: string;
}

/**
 * Splits a concept into its first-line title and the teaching body.
 * The explanation prompt asks for a title of at most 25 characters; the same
 * 100-character tolerance the review panel uses keeps slightly longer model
 * output readable. Without a usable title the whole concept becomes the body.
 */
export function splitConceptHeading(concept: string): {
  heading: string;
  body: string;
} {
  const [firstLine = "", ...rest] = concept.split("\n");
  const heading = firstLine.trim();
  const body = rest.join("\n").trim();
  if (heading.length > 0 && heading.length <= 100 && body.length > 0)
    return { heading, body };
  return { heading: "", body: concept.trim() };
}
