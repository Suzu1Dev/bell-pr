/**
 * The review surface (English): the diff view, the explanation panel with
 * its reports and follow-up chat, the questions the client builds for the
 * agent, and the Markdown renderer.
 *
 * When a message's comment says a parameter is shown as an element, the
 * component renders it through src/review/withNodes.tsx: put that parameter
 * where the element belongs in the sentence.
 */
import { formatters } from "../../../shared/i18n/locale";

const { plural } = formatters("en");

/** The line numbers a selected diff line carries; null on the side it lacks. */
type LineNumbers = { oldLine: number | null; newLine: number | null };

const review = {
  /** DiffView: one file's diff, with line selection for follow-up questions. */
  diff: {
    regionLabel: ({ path }: { path: string }) => `Code changes in ${path}`,
    /** The accessible name of one diff line. */
    lineLabel: {
      added: ({ line, text }: { line: number | null; text: string }) =>
        `Added, line ${line}: ${text}`,
      removed: ({ line, text }: { line: number | null; text: string }) =>
        `Removed, line ${line}: ${text}`,
      context: ({ line, text }: { line: number | null; text: string }) =>
        `Unchanged, line ${line}: ${text}`,
    },
    /** Stands in for an empty line's text in its accessible name. */
    blankLine: "blank line",
    lineTitle: "Click a line to ask about it. Hold Shift to select several lines.",
    noteHint: "You haven't noted your understanding yet",
    reviewed: "Reviewed",
    blockedTitle: "This file can't be reviewed right now",
    noTextTitle: "This file has no text changes to show",
    noTextBody:
      "Binary files and files without text changes can't be shown line by line.",
    before: "Before",
    after: "After",
    selectedLines: ({ count }: { count: number }) =>
      plural(count) === "one"
        ? `${count} line selected`
        : `${count} lines selected`,
    idleHint: "Click any line and the agent will explain it",
    /** The name on the Shift key cap. */
    shiftKey: "Shift",
    /** `key` is shown as the Shift key cap. */
    shiftHint: ({ key }: { key: string }) => `Hold ${key} for several lines`,
    clearSelection: "Clear selection",
    askSelection: "Explain this code",
  },
  /** The question DiffView sends about the selected lines. */
  selection: {
    question: ({ path, count }: { path: string; count: number }) =>
      plural(count) === "one"
        ? `Explain the selected line of code in ${path} in plain language: what it does, why it changed and what to watch out for.`
        : `Explain the ${count} selected lines of code in ${path} in plain language: what they do, why they changed and what to watch out for.`,
    /** One quoted line; `text` is the code. */
    addedLine: ({ newLine, text }: LineNumbers & { text: string }) =>
      `Added, new L${newLine}: ${text}`,
    removedLine: ({ oldLine, text }: LineNumbers & { text: string }) =>
      `Removed, old L${oldLine}: ${text}`,
    contextLine: ({ oldLine, newLine, text }: LineNumbers & { text: string }) =>
      `Unchanged, old L${oldLine} / new L${newLine}: ${text}`,
    truncated:
      "[Excerpt] The selection is long, so only part of it is included below. Please explain this excerpt first.",
  },
  /** MarkdownContent: explanations, reports and other agent-written text. */
  markdown: {
    imageOmitted: "Image omitted",
    imageOmittedWithAlt: ({ alt }: { alt: string }) => `Image omitted: ${alt}`,
    tableLabel: "Explanation table",
  },
};

export default review;
