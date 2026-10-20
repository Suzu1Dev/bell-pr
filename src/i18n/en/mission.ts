/**
 * The project overview, the contribution direction and model form, and the
 * project analysis state (English).
 *
 * Messages that take a count get the raw number and format it themselves, so
 * they can pick the singular or plural noun.
 */
import type { PolicyKind } from "../../../shared/contribution";
import type { PonytailMode } from "../../../shared/efficiency";
import { formatters, type Locale } from "../../../shared/i18n/locale";
import type {
  ContributionDirection,
  ContributionRecommendation,
  RecommendationVerification,
} from "../../../shared/insights";
import type { AgentProvider } from "../../../shared/models";
import { product } from "../../../shared/product";
import type { ProviderState } from "../../mission/readiness";

const fmt = formatters("en");
const n = (value: number) => fmt.number(value);
/** "1 file" or "3 files". */
const amount = (value: number, one: string, other: string) =>
  `${n(value)} ${fmt.plural(value) === "one" ? one : other}`;
const since = (sha?: string) =>
  sha ? `since the analyzed version ${sha}` : "since the analyzed version";

type DroppedPathField = NonNullable<
  RecommendationVerification["droppedPaths"]
>[number]["field"];

const mission = {
  overview: {
    kicker: "PROJECT CONTEXT",
    title: "Understand the project first, then decide what to change.",
    lead: "See the reason behind every contribution from the user's side.",
    update: "Update to the latest version",
    updating: "Updating…",
    /** `updatedAt` arrives formatted for the locale. */
    updateHelp: ({
      branch,
      updatedAt,
    }: {
      branch: string;
      updatedAt?: string;
    }) =>
      `Fetches the latest ${branch} from GitHub, and the overview and analysis follow it. New contributions always start from the latest version.${updatedAt ? ` Last updated: ${updatedAt}` : ""}`,
    analyze: "Analyze the project",
    reanalyze: "Re-analyze",
    analyzing: "Analyzing the project…",
  },
  empty: {
    loadingTitle: "Turning the code into a project overview.",
    title: "Your next contribution starts with understanding.",
    loadingLead:
      "The Agent reads the project's docs and main modules, then sums up its purpose, how people use it, and improvements backed by evidence.",
    lead: "Let the Agent read this repository and answer three questions first, then decide where your effort is worth it.",
    questions: {
      problem: "What problem does it solve?",
      users: "Who uses it?",
      improve: "What is worth improving?",
    },
    start: "Start the project analysis",
    progressLabel: "Analysis progress",
    note: "Until the analysis is done, nothing is guessed about what this project does and no change is recommended.",
  },
  project: {
    sourceDemo: "Sample analysis",
    sourceAi: "AI-generated analysis",
    audience: "Main users",
    /** `date` arrives formatted for the locale. */
    updatedAt: ({ date }: { date: string }) => `Updated ${date}`,
    version: "Version",
    demoNote: "Prewritten sample, no AI call",
    coverage: ({
      sampled,
      tracked,
      kilobytes,
      truncated,
    }: {
      sampled: number;
      tracked: number;
      kilobytes: number;
      truncated: number;
    }) =>
      `Read ${n(sampled)} of ${amount(tracked, "tracked file", "tracked files")} (about ${n(kilobytes)} KB${truncated > 0 ? `, ${n(truncated)} only in part` : ""}); the inferences still need checking`,
    coverageUnknown:
      "What was sampled was not recorded; re-analyze to see it. The inferences still need checking",
    usageTitle: "Usage of this project analysis",
  },
  /**
   * How far the repository moved from the analyzed version. Every variant
   * still asks for a re-analysis. `sha` is the short analyzed commit.
   */
  stale: {
    unknown:
      "The project has been updated. This analysis comes from an earlier version and the changes cannot be listed; re-analyze before you settle on a direction.",
    sameContent:
      "The version changed, but the files this analysis cites are the same. Other changes may still affect the overview; re-analyze before you settle on a direction.",
    uncited: ({ changed, sha }: { changed: number; sha?: string }) =>
      `At least ${amount(changed, "file", "files")} changed ${since(sha)}. The files this analysis cites did not change, but other changes may still affect the overview; re-analyze before you settle on a direction.`,
    /** `files` arrives as a list formatted for the locale; `capped` means the server listed its maximum. */
    cited: ({
      changed,
      sha,
      cited,
      capped,
      files,
    }: {
      changed: number;
      sha?: string;
      cited: number;
      capped: boolean;
      files: string;
    }) =>
      `At least ${amount(changed, "file", "files")} changed ${since(sha)}, including ${capped ? `${n(cited)} or more files` : amount(cited, "file", "files")} that this analysis cites: ${files}. Re-analyze before you settle on a direction.`,
  },
  /** The sticky nav that links to the overview's sections. */
  sections: {
    label: "On this page",
    purpose: "Purpose",
    journey: "How people use it",
    reading: "Where to start reading",
    contribution: "This contribution",
    directions: "Directions",
  },
  /** Language names, in the UI language. */
  languages: {
    en: "English",
    "zh-TW": "Traditional Chinese",
  } satisfies Record<Locale, string>,
  /** An analysis written in another language than the UI's. */
  localeNotice: {
    analyzedIn: ({ language }: { language: string }) => `Analyzed in ${language}.`,
    reanalyze: ({ language }: { language: string }) => `Re-analyze in ${language}`,
  },
  journey: {
    kicker: "THE USER JOURNEY",
    title: "How do people use this project?",
  },
  reading: {
    kicker: "WHERE TO START READING",
    title: "New to this project? Read it in this order",
    lead: "Ordered from the sampled files the Agent read; each step says why to read it first and what to look for.",
    flow: "How the modules fit together",
    unsampled: "Not sampled; content not read",
    lookFor: "Look for",
    context: "More about this file in the analysis",
    showAll: ({ count }: { count: number }) => `Show all ${n(count)} steps`,
    showFirst: ({ count }: { count: number }) =>
      `Show only the first ${n(count)}`,
  },
  details: {
    modules: "What do the main modules do?",
    moduleCount: ({ count }: { count: number }) =>
      amount(count, "module", "modules"),
    sources: "Sources and evidence behind the analysis",
    sourceCount: ({ count }: { count: number }) =>
      amount(count, "source", "sources"),
  },
  /** The analysis fields a dropped citation came from. */
  fields: {
    modules: "Module roles",
    readingPath: "Reading order",
    evidence: "Analysis evidence",
  } satisfies Record<DroppedPathField, string>,
  brief: {
    kicker: "THIS CONTRIBUTION",
    title: "What difference will this change make?",
    problem: "The problem to solve",
    motivation: "Why it is worth improving now",
    beneficiaries: "Who benefits",
    before: "BEFORE",
    beforeCaption: "Today's experience",
    after: "AFTER",
    afterCaption: "The improvement we hope for",
    impactNote:
      "These are the goals of this contribution; whether they are met still depends on the implementation and how it is verified.",
    validation: "How will we know the change helps?",
    risks: "Trade-offs to keep in mind",
    request: "Your request",
    /** On the cards that copy the request's wording when its assumption was checked. */
    premiseRefuted: "Based on an assumption the check refuted",
    premiseUnclear: "Based on an unconfirmed assumption",
    impactRefuted:
      "The premise check found that the assumption does not hold: the problem and impact described above from it do not happen. Go by the check and the lead's integration report.",
    premiseMissing:
      "This contribution was made before premise checks, so whether the request's assumption holds was not recorded. The lead can check it once against the current code and the review reports; the code walkthroughs, and the explanations you have not answered yet, are then made again with the verdict.",
    premiseCheck: "Check the premise against the review",
    premiseRecheck: "Check the premise again",
    premiseChecking: "Checking the premise…",
    premiseRecheckNote:
      "If the verdict changes, the code walkthroughs, and the explanations you have not answered yet, are made again with it.",
    pending:
      "The user impact of this contribution has not been analyzed yet. Your original request is kept here; once the analysis is done, it is tied to a concrete motivation and acceptance checks.",
  },
  evidence: {
    none: "No file evidence yet; confirm it before you start.",
    filesLabel: "Referenced files",
    quotes: "View the source quotes",
    quotesNote:
      "The quotes support the observation; the suggested approach and the user impact still need checking.",
    why: "Why this quote",
  },
  ideas: {
    kicker: "WHERE YOU CAN HELP",
    title: "Contribution directions worth exploring",
    lead: "Look at the problem and its value to users first, then decide whether to hand it to the team.",
    /** Marks the recommendations as written by AI. */
    aiGenerated: "AI-generated",
    sampleCount: ({ count }: { count: number }) =>
      amount(count, "sample", "samples"),
    recommendationCount: ({ count }: { count: number }) =>
      amount(count, "recommendation", "recommendations"),
    more: ({ count }: { count: number }) => `Generate ${n(count)} more`,
    generating: ({ count }: { count: number }) =>
      `Generating ${n(count)} more…`,
    limitReached: "Recommendation limit reached",
    moreDemo:
      "In the sample this adds prewritten recommendations, without calling an AI. Import a real project to have the Agent generate more contribution directions.",
    moreDemoShown:
      "The sample's extra recommendations are all shown. Import a real project to have the Agent generate more contribution directions.",
    moreStale:
      "The project has a newer version. Re-analyze it before you generate more recommendations.",
    moreLimit: ({ max }: { max: number }) =>
      `This analysis has reached its limit of ${n(max)} recommendations. Pick a direction, or re-analyze the project.`,
    moreHint:
      "The Agent uses the model settings saved for this project to look for different problems and value to users. The existing recommendations stay, and you decide when development starts.",
    generatingStatus:
      "Reading the project and steering clear of the existing directions. You can keep reading the recommendations below.",
    viewAdded: ({ added, requested }: { added: number; requested?: number }) =>
      `View this batch's new recommendations (${n(added)}${requested !== undefined ? ` of ${n(requested)}` : ""})`,
    addedHidden: ({
      added,
      requested,
    }: {
      added: number;
      requested?: number;
    }) =>
      requested !== undefined
        ? `This batch added ${n(added)} of ${amount(requested, "recommendation", "recommendations")}; ${added === 1 ? "it is" : "they are all"} hidden.`
        : `This batch added ${amount(added, "recommendation", "recommendations")}; ${added === 1 ? "it is" : "they are all"} hidden.`,
    addedNone: ({ requested }: { requested: number }) =>
      `This batch added 0 of ${amount(requested, "recommendation", "recommendations")}.`,
    noneAdded:
      "This batch found no new recommendation that is different and well supported; the existing list is unchanged.",
    shortfall: "This batch fell short of its target; the existing list is kept.",
    provenance: "Model and usage of the latest batch",
    /** `date` arrives formatted for the locale. */
    generatedAt: ({ date }: { date: string }) => `Generated ${date}`,
    usageTitle: "Usage of this recommendation batch",
    retry: "Retry generating",
    savingPreferences: "Saving the order and visibility…",
    hiddenCount: ({ count }: { count: number }) =>
      `${amount(count, "recommendation", "recommendations")} hidden`,
    restore: "Show again",
    restoreLabel: ({ title }: { title: string }) => `Show again: ${title}`,
    droppedIdeas: ({ count }: { count: number }) =>
      `Skipped ${amount(count, "recommendation", "recommendations")} whose quotes failed the check`,
    droppedIdeasNote:
      "These recommendations quoted text that was not in the excerpts sent to the model, so only their title and reason are kept. The rest of the analysis is saved as usual, and you can generate more recommendations to make up for them.",
    droppedPaths: ({ count }: { count: number }) =>
      `Skipped ${amount(count, "note", "notes")} citing unsampled or missing files`,
    droppedPathsNote:
      "The model read only the sampled files; of the other paths it only knows that they exist. Evidence must come from files it read, and paths that are not in the tree cannot be checked. The rest of the analysis is saved as usual.",
    /** Where a dropped recommendation came from. */
    rounds: {
      analysis: "Project analysis",
      expansion: "Latest batch",
    },
    navigationHint: "Swipe sideways, or focus the list and use the arrow keys",
    showing: ({
      first,
      last,
      total,
    }: {
      first: number;
      last: number;
      total: number;
    }) =>
      `Showing ${n(first)}${last > first ? `–${n(last)}` : ""} of ${amount(total, "visible recommendation", "visible recommendations")}`,
    previous: "Previous recommendation",
    next: "Next recommendation",
    railLabel: "Contribution recommendations, scrolling sideways",
    manageLabel: ({ title }: { title: string }) =>
      `Manage recommendation: ${title}`,
    dragLabel: ({ title }: { title: string }) =>
      `Drag to reorder: ${title}. You can also use the move left and move right buttons.`,
    dragTitle: "Drag to reorder, or use the left and right buttons next to it",
    moveLeft: "Move left",
    moveLeftLabel: ({ title }: { title: string }) => `Move left: ${title}`,
    moveRight: "Move right",
    moveRightLabel: ({ title }: { title: string }) => `Move right: ${title}`,
    hide: "Hide",
    hideLabel: ({ title }: { title: string }) => `Hide: ${title}`,
    hideTitle: "Hide this recommendation; you can show it again later",
    newBadge: "New in this batch",
    userImpact: "How it helps users",
    approach: "See the suggested approach and acceptance checks",
    choose: "Start with this direction",
    allHidden: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? "You hid the only recommendation. Open the hidden list above to show it again."
        : `You hid all ${n(count)} recommendations. Open the hidden list above to show them again.`,
    none: "This analysis has not found a well-supported recommendation yet. You can name the direction you want to improve and let the team confirm the scope.",
  },
  effort: {
    small: "Small scope",
    medium: "Medium scope",
    large: "Large scope",
  } satisfies Record<ContributionRecommendation["effort"], string>,
  confidence: {
    high: "Well supported",
    medium: "Needs more checking",
    low: "Early idea",
  } satisfies Record<ContributionRecommendation["confidence"], string>,
  nextStep: {
    codeTitle: "Back to the code, with the reasons in mind.",
    codeLead: "Compare the improvement you expect for users with each actual change.",
    codeAction: "Review the code changes",
    ideaTitle: "Have an idea of your own? You can start here too.",
    ideaLead: "Say who benefits, the outcome you expect and the boundaries for the work.",
    ideaAction: "Set a contribution direction",
  },
  directions: {
    bugfix: { label: "Fix a bug", hint: "Make existing behavior work as intended" },
    feature: { label: "Add a feature", hint: "Let users do something new" },
    performance: {
      label: "Improve performance",
      hint: "Less waiting and fewer resources",
    },
    ux: { label: "User experience", hint: "Make it more intuitive and smoother" },
    testing: { label: "Add tests", hint: "Protect key behavior and edge cases" },
    docs: { label: "Improve docs", hint: "Make it easier to understand and start" },
    maintenance: {
      label: "Maintenance",
      hint: "Make future changes easier",
    },
  } satisfies Record<ContributionDirection, { label: string; hint: string }>,
  settings: {
    directionLegend: "Which direction do you want to contribute in?",
    directionNote: "Pick one main direction so the team works toward the same goal.",
    optional: "Optional",
    targetUser: {
      label: "Who will benefit?",
      placeholder:
        "For example: front-end developers who build dashboards with this SDK",
    },
    outcome: {
      label: "What will be different for users when it is done?",
      placeholder:
        "For example: after a brief network drop, the list retries loading on its own instead of needing a manual refresh.",
    },
    constraints: {
      label: "Boundaries",
      placeholder:
        "For example: keep the existing API compatible; handle GET only; add no packages.",
      help: "Note the behavior that must not change, compatibility needs, or limits on the scope.",
    },
    acceptance: {
      label: "What counts as done?",
      placeholder:
        "For example:\nA temporary failure succeeds on retry\nNo retry on 401\nAll existing tests pass",
      help: "Describe observable results or tests, one per line.",
    },
    issue: {
      label: "Related issue link",
      help: "Only GitHub issue page URLs are accepted. With one, the PR draft can write Fixes or Refs #number and link back to the issue. Before you submit, comment on the issue to say you will work on it.",
    },
    model: {
      heading: "Model and reasoning",
      note: "All projects and Agents share these settings. Each new run records its own settings, so later changes do not affect runs that already exist.",
      agent: "Agent",
      providerHelp: {
        codex: "Uses the Codex CLI you installed and signed in to.",
        claude:
          "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account. Available models depend on your plan.",
      } satisfies Record<AgentProvider, string>,
      /** A provider in the list with its state, for example "Codex — not signed in". */
      providerOption: ({ provider, state }: { provider: string; state: string }) =>
        `${provider} — ${state}`,
      providerStates: {
        ready: "ready",
        missing: "not installed",
        broken: "not working",
        "signed-out": "not signed in",
      } satisfies Record<ProviderState, string>,
      model: "Model",
      providerDefault: ({ provider, model }: { provider: string; model?: string }) =>
        `${provider} default${model ? ` · ${model}` : ""}`,
      /** A saved model or effort that the loaded list does not offer. */
      unconfirmed: ({ value }: { value: string }) =>
        `${value} · saved, not confirmed yet`,
      loading: ({ provider }: { provider: string }) =>
        `Reading the models your local ${provider} offers…`,
      unknownModel:
        "This saved model cannot be checked right now. Choose again or reload the list.",
      defaultModelHelp: ({ provider }: { provider: string }) =>
        `Uses your local ${provider}'s default model.`,
      effort: "Reasoning effort",
      defaultEffortNote: "Default uses the model's own default effort.",
      /** `effort` is the model's default effort, already labelled. */
      modelDefault: ({ effort }: { effort?: string }) =>
        `Model default${effort ? ` · ${effort}` : ""}`,
      unknownEffort:
        "The saved effort is not in this model's list. Choose again.",
      effortHelp: `Only the efforts the selected model supports are listed. Higher efforts take longer per turn and use more of your account's usage; ${product.name} waits longer for Claude Code and for the xhigh and max efforts.`,
      webAccess: "Let Agents search the web and read pages",
      webAccessHelp:
        "Applies to the Lead, Teammates, Reviewer, Test analyst and the follow-up tutor; project analysis and discovery stay offline. Web content is treated as untrusted data, and Claude Code's curl and wget stay blocked.",
      /** `message` is the reason the list could not be loaded. */
      error: ({ message }: { message: string }) =>
        `${message} Your saved choice is kept.`,
      loadFailed: ({ provider }: { provider: string }) =>
        `Could not load the ${provider} model list.`,
      reload: "Reload",
    },
    ponytail: {
      label: "Efficiency mode",
      credit: "Efficiency mode is based on Ponytail by DietrichGebert (MIT).",
      modes: {
        lite: "Lean · default",
        full: "Full",
        off: "Off",
      } satisfies Record<PonytailMode, string>,
      help: "Lean: a short rule set that curbs overbuilding. Full: more rules, preferring existing code and native features. Off: lets you compare results and usage across modes.",
      link: "About Ponytail",
    },
    team: {
      legend: "Team size",
      teammates: "teammates",
      note: "Sets the most teammates the team may use; the run's plan decides the actual split.",
    },
    planApproval: {
      label: "Let me approve the plan before development",
      help: "Review the split, scope and acceptance checks first; implementation starts once you approve.",
    },
  },
  /** Project analysis loading and saving, shown where the action failed. */
  insights: {
    loadFailed: "Could not load the project analysis. Try again.",
    demoAnalysis:
      "The sample project uses a prewritten analysis. Import your repository to have AI read real source code.",
    demoMore: "Import a real project to generate more contribution recommendations.",
    reanalyzeFirst:
      "Re-analyze the project before you generate more recommendations.",
    limit: ({ max }: { max: number }) =>
      `This analysis already has ${n(max)} recommendations.`,
    /** `reason` is the error message of the failed save. */
    preferencesReverted: ({ reason }: { reason: string }) =>
      `The order and visibility were not saved and have been restored: ${reason}`,
    preferencesRevertedRetry:
      "The order and visibility were not saved and have been restored. Try again.",
    moreFailed:
      "No more recommendations were generated; the existing list is kept. Try again.",
    analysisFailed: "The project analysis did not finish. Try again.",
  },
  /**
   * ContributionRulesCard, "Before you contribute": the project's own rules
   * quoted from its files, whether its pull requests are open to the
   * person, and what publishing does about each rule. It never says that a
   * project has no rules, only where it looked.
   */
  rules: {
    kicker: "THE PROJECT'S OWN RULES",
    title: "Before you contribute",
    lead: `What this project asks of contributors, quoted from its own files, and what ${product.name} does about each rule when you publish.`,
    door: {
      open: "Pull requests: open to you",
      collaborators:
        "Pull requests: collaborators only (you can practise here, not publish)",
      off: "Pull requests: turned off (you can practise here, not publish)",
      archived:
        "Archived: the project takes no changes (you can practise here, not publish)",
      unknown: ({ reason }: { reason?: string }) =>
        reason
          ? `Couldn't check whether pull requests are open to you: ${reason}`
          : "Couldn't check whether pull requests are open to you.",
    },
    kinds: {
      ban: "AI-assisted contributions",
      disclose: "Saying that AI helped",
      understand: "Explaining your change",
      area: "Issues kept for newcomers",
      agent: "Notes addressed to AI agents",
      "own-words": "Descriptions in your own words",
      "issue-first": "An issue before the work",
    } satisfies Record<PolicyKind, string>,
    /** What publishing does about a rule, shown as a chip before `effect`. */
    effects: {
      block: "Blocks publishing",
      confirm: "Asks you to confirm",
      info: "For your information",
    },
    effect: {
      ban: `${product.name}'s agents write every change, so it won't publish one here. You can still practise locally.`,
      banAmbiguous:
        "Publishing asks you to decide whether it covers AI-assisted contributions.",
      disclose: "Publishing waits until the description says that AI helped.",
      understand:
        "Your understanding check covers it. With the check turned off, publishing asks you to confirm.",
      area: "Publishing is blocked when the linked issue carries a label for newcomers.",
      agent:
        "It is addressed to AI agents. You are the author, so publishing asks you to decide whether it applies.",
      "own-words": `Publishing waits while the description is still ${product.name}'s suggested text.`,
      "issue-first": "Publishing asks you to confirm when no issue is linked.",
    } satisfies Record<PolicyKind | "banAmbiguous", string>,
    found: ({ count, files }: { count: number; files: number }) =>
      `${amount(count, "rule", "rules")} quoted from the ${amount(files, "file", "files")} ${product.name} read.`,
    notFound: ({ files }: { files: number }) =>
      `Not found in the ${amount(files, "file", "files")} ${product.name} read. Some projects publish their rules on a website or wiki; check before you publish.`,
    noFiles:
      "No contributing guide, policy or pull request template was there to read. Some projects publish their rules on a website or wiki; check before you publish.",
    couldntCheck: ({ reason }: { reason: string }) => `Couldn't check: ${reason}`,
    notRead: `${product.name} hasn't read this project's rules yet. It reads them when the project is imported or updated, and when you check again.`,
    filesRead: ({ count }: { count: number }) =>
      `Files ${product.name} read · ${n(count)}`,
    orgDefaults: ({ repository }: { repository: string }) =>
      `Includes the default files of ${repository}.`,
    unread: ({ part, reason }: { part: "rules" | "orgDefaults" | "other"; reason?: string }) => {
      const what = {
        rules: "the project's rule files",
        orgDefaults: "the account's default contribution files",
        other: "part of the project's rules",
      }[part];
      return reason ? `Couldn't read ${what}: ${reason}` : `Couldn't read ${what}.`;
    },
    checkedAt: ({ date }: { date: string }) => `Checked ${date}`,
    checkAgain: "Check again",
    checking: "Checking…",
    sample:
      "Sample: the project and its CONTRIBUTING.md are fictional, and nothing was read from GitHub.",
  },
  /**
   * BeforeYouStart, under the task dialog's issue field: the issue's state,
   * who is on it and the person's open pull requests here, read once per
   * issue link. Nothing here stops a run from starting.
   */
  start: {
    title: "Before you start",
    lead: "Read once for this issue link. Nothing here stops you from practising; publishing checks again.",
    noIssue: `Link the issue you will work on, and ${product.name} checks whether it is still open and whether someone else is already on it.`,
    notGitHub:
      "Issue facts are read for GitHub issue links, such as https://github.com/owner/repo/issues/123.",
    checking: "Checking the issue on GitHub…",
    issue: ({ number }: { number: number }) => `Issue #${number}`,
    sampleIssue: ({ number }: { number: number }) => `#${number} (sample)`,
    open: "Open",
    closed: ({ reason }: { reason?: string }) =>
      reason ? `Closed (${reason})` : "Closed",
    closedReasons: {
      COMPLETED: "completed",
      NOT_PLANNED: "not planned",
      DUPLICATE: "duplicate",
    } as Record<string, string>,
    unassigned: "Unassigned",
    assigned: ({ names }: { names: string[] }) =>
      `Assigned to ${fmt.list(names.map((name) => `@${name}`))}`,
    claimed: ({ author, date, bot }: { author: string; date: string; bot: boolean }) =>
      bot
        ? `Claimed by @${author} (a bot) on ${date}`
        : `Claimed by @${author} on ${date}`,
    noOtherPr: "No other open PR",
    otherPr: ({ author, number }: { author: string; number: number }) =>
      `@${author}'s PR #${number} would close this`,
    closedPr: ({ author, number }: { author: string; number: number }) =>
      `@${author}'s PR #${number} was closed without merging`,
    maintainer: ({ quote, date }: { quote: string; date: string }) =>
      `A maintainer said: “${quote}” (${date})`,
    learning: ({ labels }: { labels: string[] }) =>
      `Labelled for newcomers: ${fmt.list(labels)}`,
    pacing: ({ open, budget }: { open: number; budget: number }) =>
      `Your open PRs here: ${n(open)} of ${n(budget)}`,
    pacingHelp: `The budget is a ${product.name} default: 1 open pull request before your first one is merged in a repository, 2 after.`,
    pacingExempt: "You can write to this repository, so publishing isn't paced here",
    doorClosed: "This repository doesn't take pull requests from you",
    ban: "The project's rules don't accept AI-assisted contributions",
    unknown: ({ part, reason }: { part: "door" | "issue" | "pacing" | "other"; reason?: string }) => {
      const what = {
        door: "whether pull requests are open to you",
        issue: "the issue",
        pacing: "your open pull requests here",
        other: "a GitHub fact",
      }[part];
      return reason ? `Couldn't check ${what}: ${reason}` : `Couldn't check ${what}`;
    },
    couldntCheck: ({ reason }: { reason: string }) => `Couldn't check: ${reason}`,
    checkAgain: "Check again",
    sample: "Sample facts; nothing was read from GitHub.",
  },
  /** The task dialog asks once before Start when the facts say publishing will wait. */
  startConfirm: {
    title: "Before the team starts",
    practise: {
      "issue-closed": `You can practise this locally; ${product.name} won't publish it while the linked issue is closed.`,
      door: `You can practise this locally; ${product.name} won't publish it while this repository doesn't take pull requests from you.`,
      ban: `You can practise this locally; ${product.name} won't publish it while the project's rules don't accept AI-assisted contributions.`,
      area: `You can practise this locally; ${product.name} won't publish it while the project keeps issues labelled for newcomers for people learning without AI tools.`,
    },
    otherPr: ({ author, number }: { author: string; number: number }) =>
      `You can practise this locally; ${product.name} won't publish it while @${author}'s pull request #${number} would close the same issue, unless you give your reason when you publish.`,
    pacing: ({ open, budget }: { open: number; budget: number }) =>
      `You can practise this locally; ${product.name} won't publish it while you have ${n(open)} open pull requests here, at least twice your budget of ${n(budget)}.`,
    lesson:
      "Issues labelled for newcomers are how people learn a project by writing the fix themselves. When an agent team takes one, the next newcomer loses that chance. Consider a help-wanted issue instead.",
    practiseLocally: "Start and practise locally",
    startAnyway: "Start anyway",
    back: "Back",
  },
};

export default mission;
