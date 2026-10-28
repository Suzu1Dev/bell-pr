/** Section names that say what a PR draft left undone or unverified. */
// i18n-allow: parser
const limitationsLabel = /limitation|限制|未完成|not run/i;
const fence = /^ {0,3}(`{3,}|~{3,})/;
const closingFence = /^(`{3,}|~{3,})$/;
const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
/** A line holding only a bold label, such as `**Limitations**` or `**Limitations:**`. */
const boldLabel = /^ {0,3}(\*\*|__)(.+?)\1:?[ \t]*$/;
/** Bold labels end at any heading or bold label; they sit below every heading level. */
const boldLevel = 7;

interface Mark {
  level: number;
  label: string;
}

/** Headings and bold labels by line index, skipping fenced code. */
function sectionMarks(lines: string[]) {
  const marks = new Map<number, Mark>();
  let open = "";
  lines.forEach((line, index) => {
    const fenced = line.match(fence);
    if (open) {
      const close = line.trim().match(closingFence);
      if (close && close[1][0] === open[0] && close[1].length >= open.length)
        open = "";
      return;
    }
    if (fenced) {
      open = fenced[1];
      return;
    }
    const title = line.match(heading);
    if (title) {
      marks.set(index, { level: title[1].length, label: title[2] });
      return;
    }
    const bold = line.match(boldLabel);
    if (bold) marks.set(index, { level: boldLevel, label: bold[2] });
  });
  return marks;
}

/**
 * The first heading (any level) or bold label naming limitations, through the
 * next heading of the same or a higher level (nested subheadings stay in).
 * `start` is the heading line, `end` the first line after the section.
 * Undefined when no such section has any text under it.
 */
function findSection(body: string) {
  const lines = body.split(/\r?\n/);
  const marks = sectionMarks(lines);
  for (const [start, mark] of marks) {
    if (!limitationsLabel.test(mark.label)) continue;
    let end = start + 1;
    while (
      end < lines.length &&
      (marks.get(end)?.level ?? Infinity) > mark.level
    )
      end++;
    if (!lines.slice(start + 1, end).some((line) => line.trim())) continue;
    return { lines, start, end };
  }
  return undefined;
}

/**
 * The part of a PR description that lists what was not done or not verified,
 * heading line included; undefined when the description has none.
 */
export function limitationsSection(body: string): string | undefined {
  const found = findSection(body);
  return found && found.lines.slice(found.start, found.end).join("\n").trim();
}

/**
 * The description with the text under the Limitations heading replaced and
 * everything else, heading included, left as written. Undefined when there is
 * no such section.
 */
export function replaceLimitationsBody(
  body: string,
  text: string,
): string | undefined {
  const found = findSection(body);
  if (!found) return undefined;
  const { lines, start, end } = found;
  // Spacing under the heading and before the next section follows the original.
  const replacement = [
    ...(lines[start + 1]?.trim() === "" ? [""] : []),
    ...text.trim().split(/\r?\n/),
    ...(lines[end - 1]?.trim() === "" ? [""] : []),
  ];
  return [
    ...lines.slice(0, start + 1),
    ...replacement,
    ...lines.slice(end),
  ].join("\n");
}
