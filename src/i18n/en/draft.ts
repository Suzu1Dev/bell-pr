/**
 * The PR draft tab's panels (English): the rule-aware draft guidance, syncing
 * with the target branch and the rounds of changes made after maintainer
 * review. Messages whose parameters are elements (a `<code>` branch name, a
 * link) are rendered with `rich()` from src/draft/rich.tsx.
 */
import type { DraftSource } from "../../../shared/drafts";
import type { FollowUpRound } from "../../../shared/followups";
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type { ReviewabilityBand } from "../../../shared/reviewability";

const fmt = formatters("en");

const draft = {
  /** DraftGuidancePanel: the project's rules, the suggested draft and its sources. */
  guidance: {
    eyebrow: "CONTRIBUTION GUIDE",
    title: "Write a PR that maintainers can follow",
    intro:
      "Read the contribution rules and the template first, then turn this contribution into a clear draft.",
    status: {
      generating:
        "Reading the contribution guidelines and the PR template and matching them against this change. You can keep editing the draft below.",
      failed:
        "The draft suggestion could not be prepared this time. Try again later; your edits below are kept.",
      stale:
        "The changes were updated, so this suggestion needs to be prepared again. Generate a new suggestion before you apply it.",
    },
    generate: {
      generating: "Preparing…",
      retry: "Try again",
      refresh: "Refresh the suggestion",
      demo: "View the sample draft suggestion",
      first: "Suggest a draft from the project's rules",
    },
    demoBadge: "Sample data",
    policy: {
      repository: "Follows the project's rules",
      linux: "Linux principles · adapted for PRs",
    },
    empty: {
      rules: "Checks the rules and the template",
      sources: "Cites a source for each suggestion",
      choice: "You choose what to apply",
      demo: "Try the whole flow with sample documents; nothing is read from or changed in a remote project.",
      real: "For runs whose changes are done; older runs can add a draft suggestion here too.",
    },
    warnings: "What was read and what to confirm",
    rules: {
      title: "What this draft is based on",
      defaultTitle: "Default writing principles",
      noSource: "No source to check against",
      quote: "View the original wording",
      /** The fallback principles, adapted from the Linux kernel's patch guidelines. */
      linuxPrinciples: [
        "A specific, concise title that says what changes.",
        "The problem and how it affects users.",
        "The reasoning, design trade-offs and limitations of the change.",
        "An honest record of what was verified and what is still open.",
      ],
      template: ({ template }: { template: string }) =>
        `Sections follow the template “${template}”. The template adds no further writing rules, so check that each section fits this change.`,
      noRules:
        "No further writing rules were found; check the draft's sections against the source documents.",
    },
    checks: {
      title: "Confirm before you publish",
      intro: "These are reminders to check, not checks that were done.",
    },
    preview: "Preview the suggested draft",
    apply: {
      appliedNote:
        "The editor below holds this suggestion's text unchanged. The description is sent to GitHub as it is, so put it in your own words before you publish.",
      note: "You can still edit after applying; the draft is updated when you save.",
      applied: "Applied",
      apply: "Apply the suggested draft",
    },
    commit: {
      title: "Suggested commit message",
      /** Label in front of the source links. */
      sources: "Based on:",
      /** Code examples shown inside `why`. */
      code: {
        typeScope: "type(scope)",
        subject: "type(scope): summary",
        signOff: "Signed-off-by: Your Name <email>",
      },
      why: ({
        typeScope,
        subject,
        signOff,
      }: {
        typeScope: string;
        subject: string;
        signOff: string;
      }) =>
        `Why do projects ask for ${typeScope} or a sign-off? Projects that use Conventional Commits generate their changelog and choose the version number from subjects such as ${subject}, and commitlint rejects commits in any other format in CI. Projects that use the DCO require every commit to carry ${signOff}, which states that you have the right to contribute the code under the project's license; the DCO bot checks the commit trailer, not the PR description. This suggestion only lays out the format the rules ask for. The sign-off is your own statement, so type it into the commit message field yourself; the model never fills it in.`,
    },
    meta: {
      base: ({ commit }: { commit: string }) => `Base ${commit}`,
      checked: ({ time }: { time: string }) => `Checked ${time}`,
    },
    sources: {
      title: "Source documents",
      count: ({ count }: { count: number }) =>
        count === 1 ? "1 document" : `${count} documents`,
      kinds: {
        contributing: "Contribution guidelines",
        template: "PR template",
        documentation: "Project documentation",
        maintainer: "Maintainer guidance",
        example: "Reference example",
        automation: "Automated check",
      } satisfies Record<DraftSource["kind"], string>,
      usedTemplate: "Template used for this draft",
      open: "Open the source document",
      textLabel: ({ label }: { label: string }) => `${label}, original text`,
    },
    etiquette: {
      title: "Before you publish, say hello to the community",
      intro:
        "Open-source communities care about these two things because maintainers' time is limited: commenting first keeps two people from fixing the same problem, and lets the maintainers say “this direction works” or “we don't take this kind of change” before you put in the work. These checkboxes are reminders for you only; they are not saved and do not block publishing.",
      reminders: {
        claimed: {
          text: "Did you comment on the issue to say you are working on it?",
          why: "It avoids duplicate work and lets the maintainers know someone has picked it up.",
        },
        discussed: {
          text: "Does the project ask you to open an issue for discussion first?",
          why: "Some projects want to agree on the direction, and on whether AI-assisted work is welcome, before they take a PR. Asking first can save both sides from reviewing a PR that will not be accepted.",
        },
      },
      /** Bold label in front of the quoted rule; it ends with its own separator. */
      rule: "This project's rule: ",
      quote: ({ quote }: { quote: string }) => `“${quote}”`,
      ruleSource: ({ source }: { source: string }) =>
        `Source: ${source}. Without a linked issue, you are asked to confirm once more before publishing.`,
      openIssue: "Open the issue you linked",
    },
    linux: {
      note: ({ guide }: { guide: string }) =>
        `The motivation, change and verification principles in the ${guide} serve as a fallback, adapted to the GitHub PR format. Sign-off lines such as Signed-off-by must be confirmed by you and are never filled in automatically.`,
      guide: "Linux kernel's patch submission guidelines",
    },
    /** The run is published: the panel stays for reference, without actions. */
    readOnly:
      "This pull request is published. The guidance stays here for reference.",
    /**
     * The AI-assistance disclosure: off unless the person's setting or the
     * project's rules ask for it. The line itself is English PR text.
     */
    disclosure: {
      title: "AI-assistance disclosure",
      /** The switch's label. */
      label: "Add an AI-assistance line to the description",
      on: "On",
      off: "Off",
      lineOn: ({ line }: { line: string }) =>
        `The description ends with this line: “${line}” You can reword it in the description like any other text.`,
      lineOff:
        "The description does not mention AI. Whether to disclose AI help is your decision.",
      /** Why the toggle started on. */
      setting:
        "On by default because of your setting “Always add an AI-assistance note to my pull requests”.",
      /** Bold label in front of the quoted rule; it ends with its own separator. */
      rule: "This project asks for a disclosure: ",
      quote: ({ quote }: { quote: string }) => `“${quote}”`,
      ruleSource: ({ source }: { source: string }) => `Source: ${source}`,
      /** Shown when the choice only shapes what "Apply" puts in the editor. */
      applyHint:
        "The preview below follows this choice, and applying the suggestion puts it in the editor. Save the draft to keep it.",
    },
    /** The publish preflight for the saved draft. */
    preflight: {
      title: "Checks before publishing",
      intro:
        "Publishing runs the same checks on the saved draft. A blocking check stops publishing until you fix it; the others ask you to confirm.",
      block: "Blocks publishing",
      confirm: "Confirm before publishing",
      clear: "No check needs your attention in the saved draft.",
    },
  },
  /**
   * YourWordsCard: the person's own explanation and not-tested answer from
   * the understanding check, put into the description only on a click.
   */
  yourWords: {
    title: "Your words in the PR",
    lead: "Your explanation from the understanding check. Nothing goes into the description until you click, and you edit it from there.",
    summary: "Your explanation",
    untested: "What you did not test, and why",
    useExplanation: "Use my explanation",
    addUntested: "Add my not-tested answer to Testing",
    inserted: "In the description",
    english:
      "The PR description is in English; write it in English using your explanation.",
    copy: "Copy",
    copied: "Copied",
    copyFailed: "Couldn't copy. Select the text and copy it yourself.",
  },
  /**
   * ReviewabilitySnapshot: how reviewable the change is. The bands are
   * BELL defaults; the project's own merged pull requests are the
   * reference.
   */
  reviewability: {
    title: "How reviewable is this change?",
    bands: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      "very-large": "Very large",
    } satisfies Record<ReviewabilityBand, string>,
    /** The band chip; `band` is one of `bands`. */
    band: ({ band }: { band: string }) => `${band} · ${product.name} default`,
    bandHelp: `${product.name}'s size bands are defaults after Google's guidance on small changes, not this project's rule: small up to 100 changed lines, medium up to 400, large up to 1,000, very large above 1,000 lines or 20 files. The project's own merged pull requests are the real reference.`,
    lines: "Changed lines",
    files: "Files",
    tests: "Test files changed",
    dependencies: "New dependencies",
    outsidePlan: "Outside the plan",
    whitespace: "Whitespace-only changes",
    linesNote: "Lockfiles and generated files are not counted.",
    merged: "The project's last merged pull requests",
    mergedSize: ({
      number,
      additions,
      deletions,
      files,
    }: {
      number: number;
      additions: number;
      deletions: number;
      files: number;
    }) =>
      `#${number}: +${fmt.number(additions)} −${fmt.number(deletions)} in ${fmt.plural(files) === "one" ? "1 file" : `${fmt.number(files)} files`}`,
    mergedNone: "The sizes of the project's recent merged pull requests were not read.",
    split: "Is this one logical change?",
    splitLead:
      "A change that a maintainer can review in one sitting gets reviewed sooner. If this one does several things, ask the agent how it could be split.",
    askSplit: "Ask how to split it",
    weakened: "Weakened tests",
    weakenedLead:
      "Each skipped, deleted or loosened test needs a one-line reason before you publish: why is the change right?",
    weakenedCount: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? "1 weakened test needs a reason."
        : `${fmt.number(count)} weakened tests need a reason.`,
    deleted: ({ path }: { path: string }) => `${path}: test file deleted`,
    added: ({ path, line }: { path: string; line: number }) => `${path}:${line}, added`,
    removed: ({ path, line }: { path: string; line: number }) => `${path}:${line}, removed`,
    reason: "Your reason",
    reasonHint: "3 words or more.",
    save: "Save reasons",
    saving: "Saving…",
    saved: "Offered for your Testing section",
    copy: "Copy for the Testing section",
    saveFailed: ({ reason }: { reason: string }) =>
      `The reasons were not saved: ${reason}`,
  },
  /** SyncPanel: where the contribution stands against its target branch. */
  sync: {
    title: "Target branch",
    intro: {
      published: ({ branch, commit }: { branch: string; commit: string }) =>
        `This contribution is based on ${branch} at ${commit}. Syncing merges the latest version into the PR: after your review a merge commit is pushed, nothing is force-pushed and the PR description stays the same.`,
      unpublished: ({ branch, commit }: { branch: string; commit: string }) =>
        `This contribution is based on ${branch} at ${commit}. Syncing moves these changes onto the latest version; files that the target branch changed need another review, and you can undo the sync.`,
    },
    lastSync: ({ from, to, date }: { from: string; to: string; date: string }) =>
      `Last sync: ${from} to ${to}, ${date}`,
    waitConflicts:
      "Resolve the conflicts from the last sync before you sync again.",
    waitStatus:
      "Only runs in review, approved or waiting for plan approval can sync to the latest target branch.",
    roundOpen:
      "A follow-up round is in progress on this PR; finish or discard it before you sync.",
    sync: "Sync to the latest target branch",
    undo: "Undo sync",
    conflicts: "Merge conflicts",
    /** A conflicted file's state, written next to it. */
    resolved: "Resolved",
    unresolved: "Conflict markers left",
    openCount: ({ open, total }: { open: number; total: number }) =>
      open === total
        ? total === 1
          ? "Conflict markers remain in the file."
          : `Conflict markers remain in all ${total} files.`
        : `Conflict markers remain in ${open} of ${total} files.`,
    conflictHelp: {
      published: ({ latest, ours }: { latest: string; ours: string }) =>
        `In each file, the side marked ${latest} is the target branch's current content and the side marked ${ours} is this pull request. You cannot approve until every conflict marker is removed: edit the files in the working directory yourself and then refresh the diff on the Code changes tab, or ask the agent to resolve them. Changed files still need a file-by-file review.`,
      unpublished: ({ latest, ours }: { latest: string; ours: string }) =>
        `In each file, the side marked ${latest} is the target branch's current content and the side marked ${ours} is this contribution. You cannot approve until every conflict marker is removed: edit the files in the working directory yourself and then refresh the diff on the Code changes tab, or ask the agent to resolve them. Changed files still need a file-by-file review.`,
    },
    allResolved:
      "All conflict markers are removed; changed files still need a file-by-file review.",
    resolving: "The agent is resolving the conflicts…",
    resolve: "Ask the agent to resolve the conflicts",
  },
  /** FollowUpRounds: the rounds of changes after maintainer review. */
  followUps: {
    title: "Changes made after review",
    intro:
      "Each round you review and approve becomes a new commit on the PR branch. The PR title and description stay as they are, and you still reply to reviewers on GitHub yourself.",
    status: {
      running: "Making changes",
      review: "Waiting for review and push",
      published: "Pushed",
      failed: "Not completed",
      cancelled: "Stopped",
      discarded: "Discarded",
    } satisfies Record<FollowUpRound["status"], string>,
    round: ({ number }: { number: number }) => `Round ${number}`,
    /** Follows the round number for commits made on GitHub that the app took over. */
    adopted: "Picked up from GitHub",
    /** Follows the round number for a round that merged the target branch. */
    syncRound: "Target branch sync",
    /** Names an item that came from the person's own note rather than a review. */
    yourNote: "Your note",
    /** Names a review item that is no longer in the latest feedback. */
    feedback: "Feedback",
    note: ({ note }: { note: string }) => `Your note: ${note}`,
    conflicts: "Merge conflicts",
    addressed: "Addressed",
    notAddressed: "Not changed; needs your judgment",
    checks: "Commands that actually ran",
    pushed: ({ commit, date }: { commit: string; date: string }) =>
      `${commit} pushed ${date}`,
    notPushed: ({ commit }: { commit: string }) =>
      `${commit} created; the push is not confirmed yet`,
    discard: "Discard this round",
  },
};

export default draft;
