/**
 * Puts the person's own words into the PR description (DESIGN F3): their
 * Explain-it-back summary at the start of the first section, and their
 * not-tested answer in the Testing section. Pure, so the card and its
 * tests agree on where the text goes.
 */
import {
  aiDisclosureLine,
  withAiDisclosure,
  withoutAiDisclosure,
} from "../../shared/drafts";

/**
 * The label of the paragraph that holds the not-tested answer when the
 * description has no Testing heading. It is PR text, which stays English
 * unless the project's rules ask otherwise (product rule 2), so it is not
 * in the UI dictionaries.
 */
export const notTestedLabel = "**Not tested:**";

/** Han, Kana or Hangul: text the English PR description should not carry as is. */
const cjkScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function hasCjk(text: string) {
  return cjkScript.test(text);
}

/** An ATX heading's level, or 0 when the line is not one. */
function headingLevel(line: string) {
  return /^ {0,3}(#{1,6})(?:\s|$)/.exec(line)?.[1].length ?? 0;
}

/** Each heading's line index and level, outside fenced code. */
function headings(lines: readonly string[]) {
  const found: { index: number; level: number; text: string }[] = [];
  let fence: string | undefined;
  lines.forEach((line, index) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      return;
    }
    if (marker) {
      fence = marker;
      return;
    }
    const level = headingLevel(line);
    if (level)
      found.push({
        index,
        level,
        text: line.replace(/^ {0,3}#{1,6}/, "").replace(/#+\s*$/, "").trim(),
      });
  });
  return found;
}

const trimBlankStart = (lines: string[]) => {
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines;
};
const trimBlankEnd = (lines: string[]) => {
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
};

/**
 * Edits the description without BELL's AI-disclosure line and puts the
 * line back at the end, so inserted text never lands after it.
 */
function keepingDisclosure(body: string, edit: (body: string) => string) {
  const disclosed = body.split("\n").some((line) => line.trim() === aiDisclosureLine);
  if (!disclosed) return edit(body);
  return withAiDisclosure(edit(withoutAiDisclosure(body)));
}

/** Whether the description already holds `text` (ignoring surrounding space). */
export function includesText(body: string, text: string) {
  const wanted = text.trim();
  return !!wanted && body.includes(wanted);
}

/**
 * The description with `summary` at the start of its first section: right
 * after the first heading, or at the top when there is none.
 */
export function insertSummary(body: string, summary: string) {
  const text = summary.trim();
  if (!text) return body;
  const lines = body.split("\n");
  const first = headings(lines)[0];
  if (!first) {
    const rest = trimBlankStart(lines).join("\n");
    return rest ? `${text}\n\n${rest}` : text;
  }
  const before = lines.slice(0, first.index + 1).join("\n");
  const after = trimBlankStart(lines.slice(first.index + 1)).join("\n");
  return after ? `${before}\n\n${text}\n\n${after}` : `${before}\n\n${text}`;
}

/**
 * The description with the not-tested `answer` at the end of the first
 * section whose heading mentions testing (`/test/i`), or as a "Not tested"
 * paragraph at the end. BELL's AI-disclosure line stays last.
 */
export function insertUntested(body: string, answer: string) {
  const text = answer.trim();
  if (!text) return body;
  return keepingDisclosure(body, (current) => {
    const lines = current.split("\n");
    const all = headings(lines);
    const testing = all.find((heading) => /test/i.test(heading.text));
    if (!testing) {
      const kept = trimBlankEnd([...lines]).join("\n");
      const paragraph = `${notTestedLabel} ${text}`;
      return kept ? `${kept}\n\n${paragraph}` : paragraph;
    }
    const next = all.find(
      (heading) => heading.index > testing.index && heading.level <= testing.level,
    );
    const end = next ? next.index : lines.length;
    const section = trimBlankEnd(lines.slice(0, end));
    const rest = lines.slice(end);
    return [...section, "", text, ...(rest.length ? ["", ...rest] : [])].join("\n");
  });
}
