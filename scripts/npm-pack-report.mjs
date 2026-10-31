/** Finds npm's pack report among lifecycle output and bracketed build warnings. */
export function parsePackReport(stdout) {
  const offsets = (regex) => [...stdout.matchAll(regex)].map((match) => match.index);
  const starts = offsets(/^\[/gm);
  const ends = [stdout.length, ...offsets(/^\]/gm).map((index) => index + 1).reverse()];
  for (const start of starts)
    for (const end of ends) {
      if (end <= start) continue;
      try {
        const report = JSON.parse(stdout.slice(start, end));
        if (Array.isArray(report) && Array.isArray(report[0]?.files)) return report[0];
      } catch {
        // Not the report; try the next candidate.
      }
    }
  throw new Error("could not read the JSON report of npm pack.");
}
