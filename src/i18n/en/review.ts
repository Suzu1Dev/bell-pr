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
import type {
  Confidence,
  RoadChoice,
  SelfGrade,
} from "../../../shared/understanding";

const { plural } = formatters("en");

/** The first and last line number of a selection in one version of a file. */
type LineRange = { first: number; last: number };

/** "line 9" or "lines 8–9". */
const lineSpan = ({ first, last }: LineRange) =>
  first === last ? `line ${first}` : `lines ${first}–${last}`;

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
    /**
     * Read out with the list of lines: how to use it from the keyboard.
     * `button` is askSelection; Enter selects the line when nothing is
     * selected yet and moves to that button, which then asks.
     */
    keyboardHint: ({ button }: { button: string }) =>
      `Use the arrow keys to move between lines and Shift with an arrow key to select several. Press Enter to go to “${button}” for the selection, and Escape to clear it.`,
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
    /** The unchanged code a modified file's patch leaves out, read from the run's base. */
    gap: {
      showBelow: ({ count }: { count: number }) =>
        plural(count) === "one"
          ? "Show 1 more line below the change above"
          : `Show ${count} more lines below the change above`,
      showAbove: ({ count }: { count: number }) =>
        plural(count) === "one"
          ? "Show 1 more line above this change"
          : `Show ${count} more lines above this change`,
      showAll: ({ count }: { count: number }) =>
        plural(count) === "one" ? "Show the 1 line here" : `Show all ${count} lines here`,
      showToEnd: "Show the rest of the file",
      hidden: ({ count }: { count: number }) =>
        plural(count) === "one" ? "1 unchanged line" : `${count} unchanged lines`,
      toEnd: "More unchanged code follows to the end of the file",
      /** The accessible name of the gap after the last change. */
      endLabel: "Unchanged code after the last change",
      wholeFile: "Whole file",
      wholeFileTitle: "Show the whole file between the changes",
      loadFailed: "Could not read the code around the changes.",
    },
  },
  /** The question DiffView sends about the selected lines. */
  selection: {
    question: ({ path, count }: { path: string; count: number }) =>
      plural(count) === "one"
        ? `Explain the selected line of code in ${path} in plain language: what it does, why it changed and what to watch out for.`
        : `Explain the ${count} selected lines of code in ${path} in plain language: what they do, why they changed and what to watch out for.`,
    /**
     * The line between the question and the code block: the file (`path` is
     * Markdown code) and the selected lines in the old and the new version.
     * A version without selected lines (only additions or only removals) is
     * left out; at least one is given.
     */
    lines: ({
      path,
      oldLines,
      newLines,
    }: {
      path: string;
      oldLines?: LineRange;
      newLines?: LineRange;
    }) =>
      oldLines && newLines
        ? `${path}, old ${lineSpan(oldLines)}, new ${lineSpan(newLines)}:`
        : oldLines
          ? `${path}, old ${lineSpan(oldLines)}:`
          : `${path}, new ${lineSpan(newLines!)}:`,
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
      walkthrough: "Walkthrough",
      reports: "Reviews",
      chat: "Ask",
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
  /**
   * Try first, on the explanation tab: the "Quiz yourself" card asks for an
   * answer and a confidence before it shows the reference, then a
   * self-grade; the "What if it were done differently?" card asks for a
   * guess before it shows the alternative, then a choice. The confidence,
   * grade and choice words are the shared vocabulary: the understanding
   * check in the workspace uses the same ones.
   */
  tryFirst: {
    /** The badge on both cards. */
    badge: "Try first",
    confidences: {
      sure: "Sure",
      think: "Think so",
      guess: "Guessing",
    } satisfies Record<Confidence, string>,
    grades: {
      got: "Got it",
      partly: "Partly",
      missed: "Missed",
    } satisfies Record<SelfGrade, string>,
    /** One line under each grade: what it means. */
    gradeHints: {
      got: "You named the same cause and effect.",
      partly: "You had part of it.",
      missed: "It was something else.",
    } satisfies Record<SelfGrade, string>,
    /** Demo only: types the sample text into the field. */
    fill: "Fill with the sample answer",
    saving: "Saving…",
    /**
     * A save answered 409: the diff moved on, the attempt is already final,
     * or the run no longer takes attempts (only a run waiting for review or
     * approval does, and not while it publishes).
     */
    fileChanged:
      "This wasn't saved: the file, your saved attempt or the run changed since you opened it. The latest version is shown here.",
    quiz: {
      answerLabel: "Your answer",
      answerPlaceholder: "A sentence or two, in your own words",
      confidenceLabel: "How sure are you?",
      /** Shown while an answer has no confidence yet. */
      confidenceHint:
        "Pick how sure you are, so this answer can count toward the understanding check.",
      /** With the field empty, it skips the question. */
      reveal: "Show answer",
      dontKnow: "I don't know",
      yourAnswer: "Your answer",
      skipped: "You skipped this one, so there is nothing to grade.",
      dontKnowAnswer: "You said you didn't know.",
      reference: "Reference answer",
      referenceLabel: "AI-written; the diff is the authority",
      referenceLabelDemo:
        "A sample of an AI-written answer; the diff is the authority",
      gradeLabel: "How did your answer compare?",
      graded: {
        got: "Your grade: Got it.",
        partly: "Your grade: Partly.",
        missed: "Your grade: Missed.",
      } satisfies Record<SelfGrade, string>,
      /** Partly or Missed at Sure or Think so. */
      confidentMiss:
        "This is the most useful kind of miss: it comes back in your practice deck.",
    },
    road: {
      guessLabel: "Before you look: how else could this be done?",
      guessPlaceholder: "Optional, one line",
      reveal: "Show the alternative",
      yourGuess: "Your guess",
      choiceLabel: "For this project, which would you choose?",
      choices: {
        keep: "Keep this approach",
        switch: "Prefer the other",
        depends: "It depends",
      } satisfies Record<RoadChoice, string>,
      whyLabel: "Why? (optional, one line)",
      saveWhy: "Save",
      saved: "Saved",
    },
  },
  /**
   * The code walkthrough tab: the function, method or test around each
   * change, explained as it works now, part by part.
   */
  walkthrough: {
    lines: ({ start, end }: { start: number; end: number }) =>
      start === end ? `Line ${start}` : `Lines ${start}–${end}`,
    none: "None found.",
    unavailableTitle: "This file has no code walkthrough",
    /** `paths` lists the sample's files that have one, each shown as code. */
    demoOnly: ({ paths }: { paths: string }) =>
      `The sample has a code walkthrough for ${paths} only; open it from the file list to see one.`,
    failedTitle: "The code walkthrough isn't finished",
    failedBody:
      "Something went wrong while preparing the code walkthrough; the changes can still be reviewed.",
    retry: "Prepare the code walkthrough again",
    busy: "Another code walkthrough is being prepared…",
    generatingTitle: "Reading this file and its callers",
    generatingBody:
      "Finding the function that holds each change and taking apart how it works now.",
    pendingTitle: "The code walkthrough will be ready on its own",
    pendingBody:
      "One is prepared for each modified code file in turn, starting with the one you're reading.",
    onlyNewTitle: "Every change in this file is new code",
    noneTitle: "No function holds these changes",
    noneBody:
      "The changes may be in top-level settings or declarations. Expand the code around them, or ask about them in the Ask tab.",
    readyDemo: "Sample walkthrough · prewritten learning content",
    readyLive: "Read the current file and its callers",
    locate: "Mark this range in the code",
    locateStep: "Mark these lines in the code",
    change: "How this change affects it",
    steps: "Step by step",
    callers: "Who calls it",
    callees: "What it calls",
    analogy: "Another way to see it",
    selfCheck: ({ question }: { question: string }) => `Check yourself: ${question}`,
    /** `names` is the list of new units, each shown as code. */
    newUnits: ({ names }: { names: string }) =>
      `The new code has no earlier logic to take apart: ${names}. See the explanation for it.`,
  },
  /** The commit history tab of a published contribution. */
  commits: {
    title: "Commit history",
    sources: {
      initial: "First push",
      review: ({ round }: { round: string }) => `Review round ${round}`,
      sync: "Merged the target branch",
      adopted: "Taken over from GitHub",
      other: "Other commit",
    },
    files: ({ count }: { count: number }) =>
      plural(count) === "one" ? "1 file" : `${count} files`,
    mergeNote:
      "Merge commit: the changes below are against the PR's previous version and include what the target branch brought in.",
    show: "See what changed",
    hide: "Hide",
    loadingDetail: "Reading what this commit changed…",
    omitted: ({ count }: { count: number }) =>
      plural(count) === "one"
        ? "1 more file is past the display limit; see the full diff on GitHub."
        : `${count} more files are past the display limit; see the full diff on GitHub.`,
    unpublished: `This contribution has not sent its PR yet. ${product.name} keeps the changes uncommitted until you publish and makes the first commit then; every review round and every sync with the target branch adds one more commit here.`,
    unpublishedDemo:
      "The sample has not sent a PR, so it has no commits yet. Below is the sample's history as it looks after the first push, one review round and a merge of the target branch.",
    publishedDemo:
      "The sample PR's commits: the first push, one review round and a merge of the target branch. Nothing was sent to GitHub.",
    loading: "Reading the commit history…",
    intro: ({ count }: { count: number }) =>
      plural(count) === "one"
        ? `The PR branch's 1 commit; the label says where it came from in ${product.name}.`
        : `The PR branch's ${count} commits, oldest first; each label says where the commit came from in ${product.name}.`,
  },
};

export default review;
