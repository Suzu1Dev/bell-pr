/**
 * The review surface (English): the diff view, the explanation panel with
 * its reports and follow-up chat, the questions the client builds for the
 * agent, and the Markdown renderer.
 *
 * When a message's comment says a parameter is shown as an element, the
 * component renders it through src/review/withNodes.tsx: put that parameter
 * where the element belongs in the sentence.
 */
import { formatters, type Locale } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";

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
    /** The accessible name of the list of diff lines, one tab stop. */
    listLabel: "Diff lines",
    /** Read out with the list of lines: how to use it from the keyboard. */
    keyboardHint:
      "Use the arrow keys to move between lines and Shift with an arrow key to select several. Press Enter to ask about the selection and Escape to clear it.",
    /** The accessible name of one hunk: where its lines start in each version. */
    hunkLabel: ({ oldLine, newLine }: { oldLine: number; newLine: number }) =>
      `Changes from old line ${oldLine}, new line ${newLine}`,
    /** The same, when the hunk header names the code around it; `context` is code. */
    hunkLabelIn: ({
      oldLine,
      newLine,
      context,
    }: {
      oldLine: number;
      newLine: number;
      context: string;
    }) => `Changes from old line ${oldLine}, new line ${newLine}, in ${context}`,
    lineTitle: "Click a line to ask about it. Hold Shift to select several lines.",
    noteHint: "No note yet",
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
  /**
   * Where agent-written text comes from, shown on explanations, reports and
   * answers: AI output, or the sample project's prewritten text.
   */
  provenance: {
    ai: "AI-generated · may be inaccurate",
    sample: "Sample · prewritten, no AI call",
    /** `language` is one of `languages`, the run's own language. */
    otherLanguage: ({ language }: { language: string }) =>
      `These explanations were generated in ${language}.`,
    /** Each language's name in this language. */
    languages: {
      en: "English",
      "zh-TW": "Traditional Chinese",
    } satisfies Record<Locale, string>,
  },
  /** MarkdownContent: explanations, reports and other agent-written text. */
  markdown: {
    imageOmitted: "Image omitted",
    imageOmittedWithAlt: ({ alt }: { alt: string }) => `Image omitted: ${alt}`,
    tableLabel: "Explanation table",
  },
  /** ExplanationPanel: the frame around the three tabs. */
  panel: {
    label: "Code learning assistant",
    title: "Understand every change",
    subtitle: "What changed, and why",
    /** The mode badge and the badge on demo answers. */
    demoBadge: "Demo",
    liveBadge: "AI",
    tabsLabel: "Learning panel",
    tabs: {
      explain: "Explanation",
      reports: "Reviews",
      chat: "Ask the agent",
    },
    /** `path` is shown as code; `purpose` is the project analysis's words. */
    module: ({ path, purpose }: { path: string; purpose: string }) =>
      `Module ${path}: ${purpose}`,
    askAboutChange: "Ask about this change",
  },
  /** The explanation tab. */
  explain: {
    unavailableTitle: "This file can't be explained right now",
    unavailableBody: "This change has no text diff to explain right now.",
    testFileHint:
      "Tests are behavior specs: read the it/test descriptions first, then check each expect to see which edge case it protects.",
    /** Card titles; the loading skeleton shows them too. */
    cards: {
      example: "A plain-language example",
      summary: "What changed here?",
      reason: "Why was it changed this way?",
      concept: "A development idea to take with you",
      tip: "Think one step further while reviewing",
      alternatives: "What if it were done differently?",
      selfCheck: "Quiz yourself",
    },
    exampleIntro:
      "Start with a scenario to see how things differ before and after the change.",
    exampleScenario: "Picture this",
    exampleBefore: "Before the change",
    exampleAfter: "After the change",
    exampleFailed:
      "The plain-language example isn't ready yet. You can keep reading the rest of the explanation.",
    retryBusy: "Preparing other explanations…",
    retryExample: "Prepare the example again",
    examplePending: "Adding a plain-language example",
    examplePendingBody:
      "It appears here automatically when it's ready. You can read the explanation below in the meantime.",
    lookup: "Look up:",
    showAnswer: "Show answer",
    hideAnswer: "Hide answer",
    evidenceDemo:
      "Sample content isn't live AI output and doesn't represent test results.",
    evidenceLive:
      "The explanation is based on the current diff. Check the source code and tests to confirm the actual behavior.",
    failedTitle: "This explanation isn't ready yet",
    failedBody:
      "Something went wrong while preparing the explanation. You can still review the change as usual.",
    retry: "Prepare the explanation again",
    failedNote: "It will appear right here when it's done",
    generatingTitle: "Turning the change into plain language",
    generatingBody:
      "Comparing against the actual diff to prepare a concrete scenario, the reasons behind the design and what to check while reviewing.",
    pendingTitle: "The explanation will be ready automatically",
    pendingBody:
      "Once the agents finish the change, the explanation is prepared here.",
  },
  /** The learner's own note on the explanation tab. */
  note: {
    label: "My understanding",
    staleBadge: "Diff updated",
    intro:
      "Write down in your own words what this change does and why. The note is saved with the diff version it describes.",
    placeholder:
      "For example: this replaces the fixed wait with exponential backoff because…",
    stale:
      "This note was written for an earlier version of the diff. Its text is kept; check it and save again to update it.",
    demo: "Notes aren't saved in demo mode and disappear when you reload",
    /** `time` is already formatted for the locale. */
    saved: ({ time }: { time: string }) => `Saved · ${time}`,
    unsaved: "Not saved yet",
    saving: "Saving…",
    save: "Save note",
  },
  /** The reports tab: maintainer comments and the team's review reports. */
  reports: {
    sections: {
      implementer: {
        title: "Lead's integration summary",
        author: "Atlas · Team lead",
      },
      reviewer: { title: "Code review", author: "Lens · Reviewer" },
      tester: { title: "Test analysis", author: "Scout · Test analyst" },
    },
    rerun: "Run the review again",
    rerunBusy: "Running the review again…",
    rerunNote:
      "Runs the Reviewer and Test analyst again on the current diff in the workspace (read-only; it counts toward your CLI usage). Reports are only suggestions and don't change what you have reviewed or approved.",
    emptyTitle: "No review reports for this run yet",
    emptyBody:
      "Once the Lead's integration, the Reviewer and the Test analyst have finished, their full reports appear here.",
    intro:
      "These are independent static reviews, not execution results. Each report is shown in full, with the number of paragraphs that mention the current file.",
    orderTitle: "Reading order suggested by the Lead",
    orderIntro:
      "A common approach is to read definitions and interfaces first, then their callers, with tests first or last. The Lead's integration summary explains why this order was chosen. The file list on the left can switch to this suggested order.",
    staticBadge: "Independent static review, not an execution result",
    mentions: ({ count }: { count: number }) =>
      plural(count) === "one"
        ? `Mentions this file in ${count} paragraph`
        : `Mentions this file in ${count} paragraphs`,
    noMentions: "This report doesn't mention this file directly",
    evidenceDemo:
      "Sample reports aren't live AI output and don't represent test results.",
    evidenceLive:
      "Each role wrote its report by reading the code, not running it. Only the commands and output a report lists explicitly count as test results.",
  },
  /** Maintainer comments on the current file from the published PR. */
  feedback: {
    title: "Maintainer comments on this file",
    count: ({ count }: { count: number }) =>
      plural(count) === "one" ? `${count} comment` : `${count} comments`,
    badge: "From GitHub, read-only",
    replyNote: `Reply on the PR page. ${product.name} never comments for you.`,
    line: ({ line }: { line: number }) => `Line ${line}`,
    resolved: "Resolved",
    open: "Open",
  },
  /** Suggested questions; they are sent to the agent as written. */
  presets: {
    why: "Why was it changed this way?",
    risks: "What risks should I watch out for?",
    test: "How can I test this code?",
    elsewhere: "Where else in the project could this idea be used?",
    alternatives:
      "What other ways could this be done, and what are their trade-offs?",
    testFile: "What behavior does this test protect?",
    feedback:
      "Which lines of the diff does this maintainer comment refer to? What are the ways to respond, and their trade-offs?",
  },
  /** The follow-up chat tab and its composer. */
  chat: {
    welcomeTitle: "Take your understanding further",
    welcomeBody:
      "Ask about design reasons or testing, or select some code on the left to discuss it in depth.",
    assistant: "Learning assistant",
    failed: "Answer failed",
    you: "You",
    stale: "About an earlier version",
    loading: "Reading the change…",
    inputLabel: "Question for the agent",
    placeholder: "Which part do you want to explore?",
    placeholderBlocked: "No explanation is available for this file right now",
    contextAttached: "File diff attached",
    contextBlocked: "File context can't be attached",
    send: "Send question",
    disclaimerDemo: "Demo replies are prewritten; no AI model is called",
    disclaimerLive: "Enter to send · Shift + Enter for a new line",
  },
};

export default review;
