/** Section names that say what a PR draft left undone or unverified. */
// i18n-allow: parser
const limitationsLabel = /limitation|限制|未完成|not run/i;
const validationLabel =
  // i18n-allow: parser
  /^(?:validation|verification|testing|tests?|test (?:plan|results)|驗證(?:結果)?|測試(?:結果)?)[:：]?$/i;
const separateLimitationsLabel =
  // i18n-allow: parser
  /^(?:limitations?|known limitations?|not run|限制|已知限制|未完成)[:：]?$/i;
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
 * Each matching heading or bold label, through the
 * next heading of the same or a higher level (nested subheadings stay in).
 * `start` is the heading line, `end` the first line after the section.
 * Empty sections are omitted unless the caller is locating editable targets.
 */
function findSections(
  body: string,
  matches: (label: string) => boolean,
  allowEmpty = false,
) {
  const lines = body.split(/\r?\n/);
  const marks = sectionMarks(lines);
  const found: { lines: string[]; start: number; end: number }[] = [];
  for (const [start, mark] of marks) {
    if (!matches(mark.label)) continue;
    let end = start + 1;
    while (
      end < lines.length &&
      (marks.get(end)?.level ?? Infinity) > mark.level
    )
      end++;
    if (!allowEmpty && !lines.slice(start + 1, end).some((line) => line.trim()))
      continue;
    found.push({ lines, start, end });
  }
  return found;
}

/**
 * The part of a PR description that lists what was not done or not verified,
 * heading line included; undefined when the description has none.
 */
export function limitationsSection(body: string): string | undefined {
  const found = findSections(body, (label) => limitationsLabel.test(label))[0];
  return found && found.lines.slice(found.start, found.end).join("\n").trim();
}

type CheckSection = "validation" | "limitations";
type Section = ReturnType<typeof findSections>[number];

/** Only separate, unambiguous sections may be rewritten; combined template headings stay intact. */
function separateSections(
  body: string,
): Partial<Record<CheckSection, Section>> {
  const validation = findSections(
    body,
    (label) => validationLabel.test(label.trim()),
    true,
  );
  const limitations = findSections(
    body,
    (label) => separateLimitationsLabel.test(label.trim()),
    true,
  );
  const found = {
    ...(validation.length === 1 ? { validation: validation[0] } : {}),
    ...(limitations.length === 1 ? { limitations: limitations[0] } : {}),
  };
  if (
    found.validation &&
    found.limitations &&
    found.validation.start < found.limitations.end &&
    found.limitations.start < found.validation.end
  )
    return {};
  // Whole-body replacements cannot preserve a template's nested headings.
  for (const kind of ["validation", "limitations"] as const) {
    const section = found[kind];
    if (section && sectionMarks(section.lines.slice(section.start + 1, section.end)).size)
      delete found[kind];
  }
  return found;
}

/** The sections the agent may update, heading included; missing or combined headings are left out. */
export function draftCheckSections(body: string) {
  return Object.fromEntries(
    Object.entries(separateSections(body)).map(([kind, section]) => [
      kind,
      section.lines.slice(section.start, section.end).join("\n").trim(),
    ]),
  ) as Partial<Record<CheckSection, string>>;
}

/**
 * Replaces the supplied bodies as one edit. Every nonempty replacement must
 * have a separate existing target; an invalid or overlapping group changes
 * nothing. Original headings, other sections and their ordering are retained.
 */
export function replaceDraftCheckSections(
  body: string,
  updates: Partial<Record<CheckSection, string>>,
) {
  const sections = separateSections(body);
  const edits: { section: Section; text: string }[] = [];
  for (const kind of ["validation", "limitations"] as const) {
    const text = updates[kind]?.trim();
    if (!text) continue;
    const section = sections[kind];
    // Only section bodies: an injected heading/label could reshape the person's other sections.
    if (!section || sectionMarks(text.split(/\r?\n/)).size) return undefined;
    edits.push({ section, text });
  }
  if (!edits.length) return undefined;
  edits.sort((a, b) => a.section.start - b.section.start);
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const before = edits
    .map(({ section: { start, end } }) =>
      lines.slice(start, end).join("\n").trim(),
    )
    .join("\n\n");
  const replacement = ({
    section: { start, end },
    text,
  }: (typeof edits)[number]) => [
    ...(lines[start + 1]?.trim() === "" ? [""] : []),
    ...text.split(/\r?\n/),
    ...(lines[end - 1]?.trim() === "" ? [""] : []),
  ];
  const after = edits
    .map((edit) =>
      [lines[edit.section.start], ...replacement(edit)].join("\n").trim(),
    )
    .join("\n\n");
  // Offsets refer to the original draft, so replace the last section first.
  for (const edit of [...edits].reverse()) {
    const { start, end } = edit.section;
    lines.splice(start + 1, end - start - 1, ...replacement(edit));
  }
  const updated = lines.join(newline);
  return updated === body ? undefined : { body: updated, before, after };
}
