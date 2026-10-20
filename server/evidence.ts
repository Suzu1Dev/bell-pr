/**
 * Whether a model-supplied quote appears in the source it cites.
 *
 * Exact substring first; otherwise both sides with runs of whitespace
 * collapsed to one space and trimmed, so a quote that only re-wraps or
 * re-indents a line still counts. Case, punctuation and Unicode are never
 * normalized: a quote that differs there is not the source text.
 */
export function quoteMatches(content: string, quote: string): boolean {
  if (content.includes(quote)) return true;
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
  return collapse(content).includes(collapse(quote));
}
