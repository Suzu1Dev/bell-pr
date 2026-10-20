/**
 * Messages of the PR text checks in shared/draft-checks.ts (English). The
 * server, the draft tab and the publish dialog all show them.
 */
import { formatters } from "./locale.js";
import { product } from "../product.js";

const fmt = formatters("en");

/** The Learn-by-hand claim (DESIGN v1.2 §15), word for word wherever this copy states it. */
const claim = `${product.name}'s agents had no write access and gave you no code for this change.`;

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
    areaReserved: `The project keeps issues like this one for people learning to contribute without AI. ${product.name} will not publish this change; you can practise on it locally or pick an issue that isn't reserved.`,
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
    unknownPart: ({
      part,
      reason,
    }: {
      part: "door" | "issue" | "pacing" | "rules" | "orgDefaults" | "other";
      reason?: string;
    }) => {
      const what = {
        door: "whether pull requests are open to you",
        issue: "the linked issue",
        pacing: "your open pull requests here",
        rules: "the project's rules",
        orgDefaults: "the account's default contribution files",
        other: "a GitHub fact",
      }[part];
      return reason ? `Couldn't check ${what}: ${reason}` : `Couldn't check ${what}.`;
    },
    rulesUnread: `Couldn't check the project's rules: ${product.name} hasn't read them yet.`,
    /**
     * Why a GitHub fact could not be read, by the code stored with the
     * facts (shared/contribution.ts unknownReasonText). Each follows
     * "Couldn't check <what>:" in the language of whoever reads it.
     */
    reasons: {
      "gh-missing": "The GitHub CLI (gh) is not installed.",
      "signed-out": "The GitHub CLI is not signed in. Run gh auth login, then check again.",
      timeout: "GitHub did not answer in time.",
      "rate-limited": "GitHub's rate limit was reached. Wait a few minutes, then check again.",
      "not-found": "GitHub did not find it, or it is not visible to your account.",
      forbidden: "GitHub refused the request for your account.",
      "github-error": "GitHub answered with an error.",
      "invalid-answer": "GitHub's answer could not be read.",
      "no-github-origin": "This project has no GitHub origin, so there is nothing to check on GitHub.",
      "not-an-issue": "The link is not a GitHub issue.",
      "files-unreadable": "The project's files could not be read at its current commit.",
      "folder-import": "It isn't read when a project is imported from a folder. Choose Check again to read it from GitHub.",
    },
    /**
     * A clean Learn-by-hand run (DESIGN v1.2 F12): the block copy by the
     * rule's reach, the failed condition of the quoted confirm, and the
     * `by-hand-rules` confirm. BELL quotes the project; the maintainers
     * decide.
     */
    byHand: {
      claim,
      why: `Maintainers decide what their rules cover; ${product.name} only quotes them. If you're not sure, ask the project's people.`,
      /** The kinds of help, as lists name them. */
      kinds: {
        explain: "explanations",
        answer: "answers",
        plan: "planning help",
        review: "reviews",
        test: "test help",
      },
      /** Why the quoted confirm doesn't apply: the failed condition. */
      clauses: {
        reach: `its rule restricts AI help itself, or ${product.name} can't tell what it covers`,
        "no-carve-out": "its text doesn't say which uses of AI are fine",
        "kind-not-named": ({ kinds }: { kinds: string }) => `its text doesn't name ${kinds}`,
        "registry-stale": ({ date }: { date: string }) =>
          `${product.name}'s checked list entry is more than 90 days old (${date})`,
        "rules-unread": "its rules weren't read since this run started (check them again)",
        "not-fitted": "this run wasn't fitted to its rules when it started",
        "rules-changed": "its rules changed since this run started",
        "too-few-kinds": "its text doesn't name explanations and answers",
        /** A finding that passes while another rule of the project blocks. */
        held: "another of its AI rules applies",
      },
      /** A rule from BELL's checked list of off-repository rules. */
      registryQuote: ({ date, url, quote }: { date: string; url: string; quote: string }) =>
        `${product.name}'s checked list, ${date}, ${url}: "${quote}"`,
      /** ai-ban: a ban on AI help itself, or one on AI output with the failed condition. */
      aiBan: ({ condition }: { condition?: string }) =>
        condition
          ? `The project's rules decline AI-generated content. ${claim} ${product.name} publishes here only through the project's own text, and ${condition}.`
          : `The project's rules restrict AI help itself, so ${product.name} won't publish a run its guide helped with.`,
      /** area-reserved: worded around AI-generated pull requests with the failed condition, or around using AI. */
      areaReserved: ({ condition }: { condition?: string }) =>
        condition
          ? `The project closes AI-generated pull requests for issues like this one. ${product.name} publishes them only through the project's own text, and ${condition}.`
          : `The project keeps this issue for people learning without AI tools, so ${product.name} won't publish a run its guide helped with.`,
      ambiguousBan: ({ path, line, quote, kinds }: { path: string; line: number; quote: string; kinds: string }) =>
        `${path}:${line}: "${quote}" (it may cover the help you used: ${kinds})`,
      agent: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
        `${path}:${line}: "${quote}" (addressed to AI agents. ${claim})`,
      aiDisclosure: ({ kinds }: { kinds: string }) =>
        `The project asks you to say how you used AI. This run used ${product.name}'s guide: ${kinds}.`,
      /** The `by-hand-rules` confirm, for a ban or a reserved issue. */
      rulesConfirm: ({ area }: { area: boolean }) =>
        `The project ${area ? "closes AI-generated pull requests for issues like this one" : "declines AI-generated contributions"}, and its own text says some uses of AI are fine. ${product.name} is quoting the project, not deciding for it: the maintainers decide whether your change fits.`,
      /** A carve-out of the same document. */
      sameRules: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
        `The same rules say: ${path}:${line}: "${quote}"`,
      /** Another AI rule of the same document, quoted beside the confirm (never a condition). */
      alsoSay: ({ path, line, quote }: { path: string; line: number; quote: string }) =>
        `They also say: ${path}:${line}: "${quote}"`,
      /** The help this run used; the record beside the confirm states the claim and what BELL can't see. */
      helpRecord: ({ fitted, used }: { fitted?: string; used: string }) =>
        `${fitted ? `Fitted at the start, the guide offered only ${fitted}. ` : ""}You used: ${used}.`,
      noHelp: "none",
      /** disclosure-accuracy: the person's line, quoted; never called true or false. */
      denial: ({ line, kinds }: { line: string; kinds: string }) =>
        `Your text says "${line}". In this run ${product.name}'s guide gave you ${kinds}. If that line means something else, confirm; otherwise reword it.`,
    },
  },
};

export default messages;
