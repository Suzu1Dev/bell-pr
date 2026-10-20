/**
 * The lead's integration report ends with a "Suggested review order:"
 * section: one line per repo-relative path with a one-sentence reason. This
 * module reads that section back so the file list can offer the order; the
 * report text itself stays the source of truth and is shown unchanged.
 */
export interface ReviewOrderEntry {
  path: string;
  reason: string;
}

const sectionHeading =
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*Suggested review order:?\s*(?:\*\*)?:?\s*$/i;
const nextHeading = /^\s*(?:#{1,6}\s|\*\*[^*\n]+\*\*:?\s*$)/;
const listPrefix = /^\s*(?:[-*+]|\d{1,3}[.)])\s+/;
// A repo-relative path leads the line: either contains "/" or has an extension.
const leadingPath =
  /^[`*_"']*((?:[\w.@-]+\/)+[\w.@-]+\/?|[\w@-]+(?:\.[\w-]+)+)[`*_"']*/;
const reasonSeparator = /^[\s:：—–\-,，、.。]+/; // i18n-allow: parser

/** Tolerates bullets, numbering, Markdown emphasis and backticks; dedupes by path. */
export function parseReviewOrder(report: string): ReviewOrderEntry[] {
  const lines = report.split(/\r?\n/);
  const start = lines.findIndex((line) => sectionHeading.test(line));
  if (start === -1) return [];
  const entries: ReviewOrderEntry[] = [];
  const seen = new Set<string>();
  for (const raw of lines.slice(start + 1)) {
    if (!raw.trim()) continue;
    const line = raw.replace(listPrefix, "");
    const match = line.match(leadingPath);
    if (!match) {
      // Prose inside the section is skipped; the next heading ends it.
      if (nextHeading.test(raw)) break;
      continue;
    }
    const path = match[1].replace(/\/+$/, "");
    if (seen.has(path)) continue;
    seen.add(path);
    entries.push({
      path,
      reason: line.slice(match[0].length).replace(reasonSeparator, "").trim(),
    });
  }
  return entries;
}

/**
 * Files named in the order come first, in that order; every other file keeps
 * its original relative position after them. Paths the diff does not contain
 * are ignored.
 */
export function applyReviewOrder<T extends { path: string }>(
  files: T[],
  order: ReviewOrderEntry[],
): T[] {
  const rank = new Map(order.map((entry, index) => [entry.path, index]));
  const suggested = files
    .filter((file) => rank.has(file.path))
    .sort((a, b) => rank.get(a.path)! - rank.get(b.path)!);
  return [...suggested, ...files.filter((file) => !rank.has(file.path))];
}
