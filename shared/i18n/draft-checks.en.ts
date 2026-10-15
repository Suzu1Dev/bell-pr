/**
 * Messages of the PR text checks in shared/draft-checks.ts (English). The
 * server, the draft tab and the publish dialog all show them.
 */
import { formatters } from "./locale.js";
import { product } from "../product.js";

const fmt = formatters("en");

const messages = {
  placeholder: ({ count }: { count: number }) =>
    `The PR description still has ${fmt.plural(count) === "one" ? "1 unfinished spot" : `${count} unfinished spots`}. This text is sent to GitHub exactly as written: replace it with the current facts or delete it, and keep to-dos in the checklist. If you are describing a TODO comment or file itself, wrap it in backticks, for example \`TODO\`.`,
  placeholderLine: ({ line, text }: { line: number; text: string }) =>
    `Line ${line}: "${text}"`,
  unchecked:
    "Every checkbox in these sections is unticked and will be sent as it is. The project's template or automated checks may require ticking them; tick only what you actually did or confirmed.",
  uncheckedSection: ({ heading, count }: { heading: string; count: number }) =>
    fmt.plural(count) === "one"
      ? `${heading}: its 1 item is unticked`
      : `${heading}: all ${count} items are unticked`,
  /** Stands in for the heading of task items above the first heading. */
  noHeading: "(no heading)",
  issue:
    "The project's rules ask for every PR to link an existing issue, and this description does not reference one.",
  /** A rule quoted from a contributing file or template, after its source label. */
  ruleQuote: ({ label, quote }: { label: string; quote: string }) =>
    `${label}: "${quote}"`,
  brevityUnrevised:
    `This description is still ${product.name}'s suggested text, unrevised, and the project asks for a short description in your own words.`,
  brevityOver: ({ words, budget }: { words: number; budget: number }) =>
    `This description is about ${words} words, more than the ${budget} ${product.name} suggests, and the project asks for short descriptions.`,
  /**
   * The respect checks (shared/contribution.ts). Each check's first detail
   * says why maintainers care; the details after it name the source: a
   * quote with its file and line, or the GitHub field.
   */
  respect: {
    why: {
      prClosed:
        "Maintainers decide who may open pull requests here, and GitHub would refuse this one anyway.",
      aiBan:
        "These maintainers have said they will not review AI-assisted contributions, so sending one spends their time against their wishes.",
      aiDisclosure:
        "Maintainers who ask for a disclosure use it to decide how closely to review a change.",
      ownWords:
        "A description in your own words shows maintainers what you understood, which suggested text cannot.",
      issueClosed:
        "Work on a closed issue usually repeats a fix or goes against a decision the maintainers already made.",
      issueHasPr:
        "Two pull requests for one issue split the maintainers' review time; reviewing or testing the open one often helps more.",
      areaReserved:
        "Maintainers keep these issues for people who learn to contribute by doing the work themselves.",
      testsWeakened:
        "Maintainers rely on the tests to catch regressions, so a skipped, deleted or loosened test needs a reason they can check.",
      pacingMax:
        "Every open pull request waits on a maintainer's time, so answering the ones you have comes before opening more.",
      projectRules: `${product.name} quotes these rules as written; only you can decide how they apply to this change.`,
      issueState:
        "Maintainers coordinate work on the issue itself, and working past a claim or an open decision costs everyone time.",
      reviewability:
        "Small, focused changes with tests get reviewed sooner, because a maintainer can hold the whole change in mind.",
      pacing:
        "Answering the reviews you already have helps maintainers more than another pull request does.",
      factsUnknown: `${product.name} never counts an unknown as a pass, so check these facts on GitHub yourself before you publish.`,
    },
    prClosed: `This repository does not take pull requests from you right now, so ${product.name} will not publish this one. You can keep practising on the change locally.`,
    aiBan: `The project's rules do not accept AI-assisted contributions, and AI agents wrote this change. ${product.name} will not publish it; you can keep practising on it locally.`,
    aiDisclosure:
      "The project asks contributors to disclose AI assistance, and the description does not say so yet. Write it in your own words, or turn on the AI-assistance line.",
    ownWordsRequired: `The project asks for descriptions in the contributor's own words, and this one is still ${product.name}'s suggested text. Rewrite it before you publish.`,
    ownWords: `This description is still ${product.name}'s suggested wording. Many projects ask for descriptions in the contributor's own words.`,
    issueClosed:
      "The linked issue is closed. Link an open issue, or remove the link if your work is about something else.",
    issueHasPr:
      "Someone else's open pull request would already close the linked issue. Review or test their pull request instead, or give your reason to publish anyway.",
    areaReserved: `The project keeps issues like this one for people learning to contribute without AI. ${product.name} will not publish this change; you can practise on it locally or write it by hand.`,
    testsWeakened: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? "This change weakens a test. Give a one-line reason for it before you publish."
        : `This change weakens tests in ${count} places. Give a one-line reason for each before you publish.`,
    pacingMax: ({ open, budget }: { open: number; budget: number }) =>
      `You already have ${open} open pull requests in this repository, at least twice ${product.name}'s budget of ${budget} for you here. Finish or close one before you open another.`,
    projectRules: "The project's rules say something to read before you publish.",
    issueState: "The linked issue may not be ready for a pull request from you.",
    reviewability: "This change may be hard to review.",
    pacing:
      "Close the loop on your open pull requests here before you open another.",
    factsUnknown: `${product.name} couldn't check some facts on GitHub.`,
    /** A rule quoted from a project file. */
    quote: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
      `${path}:${line}: "${quote}"`,
    /** A fact as GitHub reports it. */
    githubField: ({ field, value }: { field: string; value: string }) =>
      `GitHub ${field}: ${value}`,
    otherPr: ({ number, author }: { number: number; author: string }) =>
      `GitHub closedByPullRequestsReferences: #${number} by @${author}`,
    learningLabels: ({ labels }: { labels: string[] }) =>
      `GitHub labels: ${fmt.list(labels)}`,
    weakenedFile: ({ path }: { path: string }) => `${path}: test file deleted`,
    weakenedLine: ({
      path,
      line,
      text,
      removed,
    }: {
      path: string;
      line: number;
      text: string;
      removed: boolean;
    }) => `${path}:${line} ${removed ? "removed" : "added"}: ${text}`,
    pacingCounts: ({ open, merged, budget }: { open: number; merged: number; budget: number }) =>
      `GitHub search: your pull requests here, ${open} open and ${merged} merged. Budget: ${budget} open (${product.name} default: 1 before your first merged pull request in a repository, 2 after; the same on every plan).`,
    atBudget: ({ open, budget }: { open: number; budget: number }) =>
      open > budget
        ? `You have ${open} open pull requests here, over your budget of ${budget}.`
        : fmt.plural(open) === "one"
          ? `You have 1 open pull request here, your budget of ${budget}.`
          : `You have ${open} open pull requests here, your budget of ${budget}.`,
    waiting: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? "A maintainer asked for changes on 1 of your pull requests here more than 7 days ago. Answer that review first."
        : `Maintainers asked for changes on ${count} of your pull requests here more than 7 days ago. Answer those reviews first.`,
    ambiguousBan: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
      `${path}:${line}: "${quote}" (it may cover AI-assisted contributions; decide whether it applies)`,
    understandOff: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
      `${path}:${line}: "${quote}" (your understanding check is off)`,
    agent: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
      `${path}:${line}: "${quote}" (addressed to AI agents; you are the author, so decide whether it applies)`,
    issueFirst: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
      `${path}:${line}: "${quote}" (no issue is linked to this run)`,
    assigned: ({ names }: { names: string[] }) =>
      `Assigned to ${fmt.list(names.map((name) => `@${name}`))}.`,
    claimed: ({ author, date, bot }: { author: string; date: string; bot: boolean }) =>
      bot
        ? `Claimed by @${author} (a bot) on ${date}.`
        : `Claimed by @${author} on ${date}.`,
    notReady: ({ labels }: { labels: string[] }) =>
      `Labelled ${fmt.list(labels)}: the maintainers may not be ready for a fix yet.`,
    locked: "The issue is locked.",
    closedPr: ({ number, author }: { number: number; author: string }) =>
      `A pull request for this issue, #${number} by @${author}, was closed without merging. Read why before you publish yours.`,
    sayHello:
      "The project asks for an issue first, and you have not commented on this one. Say hello on the issue before you publish.",
    split: ({ lines, files }: { lines: number; files: number }) =>
      `${fmt.number(lines)} changed lines in ${fmt.number(files)} files is above ${product.name}'s default of 1,000 lines or 20 files. Could this be split into separate changes?`,
    noTests: "Source code changed, but no test did.",
    outsidePlan: ({ files }: { files: string[] }) =>
      `Outside every task of the plan: ${fmt.list(files)}.`,
    whitespace: ({ files }: { files: string[] }) =>
      `Changes that only touch whitespace: ${fmt.list(files)}.`,
    dependencies: ({ names }: { names: string[] }) =>
      `New dependencies: ${fmt.list(names)}.`,
    mergedSizes: ({ sizes }: { sizes: number[] }) =>
      `For comparison, the project's last merged pull requests changed ${fmt.list(sizes.map((size) => fmt.number(size)))} lines.`,
    unknownPart: ({ part, reason }: { part: "door" | "issue" | "pacing" | "other"; reason?: string }) => {
      const what = {
        door: "whether pull requests are open to you",
        issue: "the linked issue",
        pacing: "your open pull requests here",
        other: "a GitHub fact",
      }[part];
      return reason ? `Couldn't check ${what}: ${reason}` : `Couldn't check ${what}.`;
    },
  },
};

export default messages;
