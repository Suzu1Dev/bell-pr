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
  InsightsPhase,
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
    background: "Project background and other contribution ideas",
    title: "Project background",
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
      `Syncs ${branch} for the overview analysis${updatedAt ? ` · Last updated: ${updatedAt}` : ""}`,
    analyze: "Analyze the project",
    reanalyze: "Re-analyze",
    analyzing: "Analyzing the project…",
  },
  empty: {
    loadingTitle: "Turning the code into a project overview.",
    title: "Your next contribution starts with understanding.",
    loadingLead: "The Agent is reading the project's docs and main modules.",
    lead: "Let the Agent read this project and answer three questions.",
    questions: {
      problem: "What problem does it solve?",
      users: "Who uses it?",
      improve: "What is worth improving?",
    },
    start: "Start the project analysis",
    progressLabel: "Analysis progress",
    note: "Until the analysis is done, nothing is guessed about what this project does and no change is recommended.",
  },
  /** The steps of a running analysis; the server reports where the run is. */
  progress: {
    phases: {
      reading: "Reading the project's files",
      agent: "The Agent reads the code and writes the analysis",
      checking: "Checking the answer against the source",
      saving: "Saving the analysis",
    } satisfies Record<InsightsPhase, string>,
    /** `waited` and `limit` arrive as clock times such as "3:05"; the limit is the most this step may take. */
    waited: ({ waited, limit }: { waited: string; limit: string }) =>
      `${waited} of up to ${limit}`,
    attempt: ({ attempt, attempts }: { attempt: number; attempts: number }) =>
      `try ${n(attempt)} of ${n(attempts)}`,
    /** `elapsed` arrives as a clock time such as "3:05". */
    elapsed: ({ elapsed }: { elapsed: string }) => `Running for ${elapsed}`,
    note: "The bar shows time used against this step's limit, not work done. Without a limit, it just moves.",
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
    summaryNotes: "Analysis scope and notes",
  },
  /**
   * How far the repository moved from the analyzed version. Every variant
   * still asks for a re-analysis. `sha` is the short analyzed commit.
   */
  stale: {
    unknown:
      "The project has been updated. This analysis comes from an earlier version and the changes cannot be listed; re-analyze before you settle on a direction.",
    sameContent:
      "The version changed, but no cited file did. Other changes may still affect the overview; re-analyze before choosing a direction.",
    uncited: ({ changed, sha }: { changed: number; sha?: string }) =>
      `At least ${amount(changed, "file", "files")} changed ${since(sha)}, none of them cited. They may still affect the overview; re-analyze before choosing a direction.`,
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
      `At least ${amount(changed, "file", "files")} changed ${since(sha)}, including ${capped ? `${n(cited)} or more cited files` : amount(cited, "cited file", "cited files")}: ${files}. Re-analyze before choosing a direction.`,
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
    title: "How do people use this project?",
  },
  reading: {
    title: "New to this project? Read it in this order",
    lead: "Ordered from the sampled files the Agent read. Each step says why to read it first and what to look for.",
    flow: "How the modules fit together",
    flowStages: "End-to-end flow & stages",
    flowMore: ({ count }: { count: number }) =>
      `Show ${amount(count, "more section", "more sections")}`,
    stageDetails: "Full stage details",
    subsystems: ({ count }: { count: number }) =>
      `Other core & supporting modules (${n(count)})`,
    /** Read by screen readers only, on a flow step outside the repository. */
    flowOutside: "Outside this repository",
    /** Read by screen readers only, before what one flow step passes to the next. */
    flowPasses: "Passes on:",
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
    missingAcceptance: "No completion criteria recorded. Confirm how to verify this change before approving it.",
    validation: "How will we know the change helps?",
    risks: "Trade-offs to keep in mind",
    request: "Your request",
    /** On the cards that copy the request's wording when its assumption was checked. */
    premiseRefuted: "Based on an assumption the check refuted",
    premiseUnclear: "Based on an unconfirmed assumption",
    impactRefuted:
      "The premise check refuted this assumption, so the problem and impact above don't happen. Rely on the check and the Lead's integration report.",
    premiseMissing:
      "This contribution predates premise checks, so its assumption was never checked. The Lead can check it once against current code and review reports. Code walkthroughs and unanswered explanations then update to match.",
    premiseCheck: "Check the premise against the review",
    premiseRecheck: "Check the premise again",
    premiseChecking: "Checking the premise…",
    premiseRecheckNote:
      "If the verdict changes, the code walkthroughs, and the explanations you have not answered yet, are made again with it.",
    pending:
      "User impact is not analyzed yet. Your request is kept here; the analysis will tie it to a motivation and acceptance checks.",
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
      "Uses the saved model settings. Existing recommendations stay.",
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
      "Their quotes weren't in the excerpts the model saw, so only title and reason are kept. The rest is saved; generate more to replace them.",
    droppedPaths: ({ count }: { count: number }) =>
      `Skipped ${amount(count, "note", "notes")} citing unsampled or missing files`,
    droppedPathsNote:
      "The model read only sampled files, so notes citing others couldn't be checked. The rest is saved.",
    /** Where a dropped recommendation came from. */
    rounds: {
      analysis: "Project analysis",
      expansion: "Latest batch",
    },
    navigationHint: "Scroll inside the box, or focus the list and use the arrow keys",
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
    railLabel: "Contribution recommendations",
    manageLabel: ({ title }: { title: string }) =>
      `Manage recommendation: ${title}`,
    dragLabel: ({ title }: { title: string }) =>
      `Drag to reorder: ${title}. You can also use the move up and move down buttons.`,
    dragTitle: "Drag to reorder, or use the up and down buttons next to it",
    moveLeft: "Move up",
    moveLeftLabel: ({ title }: { title: string }) => `Move up: ${title}`,
    moveRight: "Move down",
    moveRightLabel: ({ title }: { title: string }) => `Move down: ${title}`,
    hide: "Hide",
    hideLabel: ({ title }: { title: string }) => `Hide: ${title}`,
    hideTitle: "Hide this recommendation; you can show it again later",
    newBadge: "New in this batch",
    userImpact: "How it helps users",
    problemMore: "Read full problem context",
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
    codeTitle: "Review this contribution",
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
    requirements: "Additional requirements",
    execution: "AI and team settings",
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
      help: "GitHub issue URLs only. The PR draft can then write Fixes or Refs #number. Before publishing, claim the issue in a comment.",
    },
    model: {
      heading: "Model and reasoning effort",
      note: "Defaults apply to new tasks across projects. Existing tasks keep their settings.",
      agent: "AI provider",
      providerHelp: {
        codex: "Uses the Codex CLI you installed and signed in to.",
        claude:
          "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account. Available models depend on your plan.",
        antigravity:
          "Uses the Antigravity CLI (agy) you installed and signed in to (Google account, Gemini API key or Google Cloud credentials). Usage counts against your own account. Listed models depend on it. It won't start in projects shipping Antigravity hooks, MCP servers, plugins, agents or skills.",
      } satisfies Record<AgentProvider, string>,
      /** A provider in the list with its state, for example "Codex — not signed in". */
      providerOption: ({ provider, state }: { provider: string; state: string }) =>
        `${provider} — ${state}`,
      providerStates: {
        ready: "ready",
        missing: "not installed",
        broken: "not working",
        "signed-out": "not signed in",
        disabled: "turned off",
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
      /** `effort` is the model's default effort, already labelled. */
      modelDefault: ({ effort }: { effort?: string }) =>
        `Model default${effort ? ` · ${effort}` : ""}`,
      unknownEffort:
        "The saved effort is not in this model's list. Choose again.",
      effortHelp: "Higher reasoning effort takes longer and uses more of your account’s allowance.",
      webAccess: "Let Agents search the web and read pages",
      webPages: "Let Agents read web pages",
      antigravityWeb: "Antigravity can always search the web, including during project analysis and discovery. This switch only controls reading web pages.",
      webAccessHelp:
        "Only for tasks and follow-ups, not analysis or discovery. Web content is treated as untrusted. Terminal network access still follows your permissions.",
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
      help: "Lean: short rules against overbuilding. Full: more rules, favoring existing code and native features. Off: compare results and usage.",
      link: "About Ponytail",
    },
    team: {
      summary: ({ count }: { count: number }) => `${count} teammates`,
      legend: "Team size",
      teammates: "teammates",
      note: "The most teammates the team may use; the task's plan decides the actual split.",
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
      ban: `${product.name}'s Agents write every change, so it won't publish one here. You can still practise locally.`,
      banAmbiguous: "You decide whether it covers AI-assisted contributions.",
      disclose: "Until the description says that AI helped.",
      understand:
        "Your understanding check covers it. With the check turned off, publishing asks you to confirm.",
      area: "When the linked issue is labelled for newcomers.",
      agent:
        "It is addressed to AI agents. You are the author, so publishing asks you to decide whether it applies.",
      "own-words": `While the description is still ${product.name}'s suggested text.`,
      "issue-first": "When no issue is linked.",
    } satisfies Record<PolicyKind | "banAmbiguous", string>,
    found: ({ count, files }: { count: number; files: number }) =>
      `${amount(count, "rule", "rules")} quoted from the ${amount(files, "file", "files")} ${product.name} read.`,
    notFound: ({ files }: { files: number }) =>
      `Not found in the ${amount(files, "file", "files")} ${product.name} read. Some projects publish their rules on a website or wiki; check before you publish.`,
    noFiles:
      "No contributing guide, policy or pull request template found. Some projects publish their rules on a website or wiki; check before you publish.",
    couldntCheck: ({ reason }: { reason: string }) => `Couldn't check: ${reason}`,
    notRead: "the rules have not been read yet. Choose Check again to read them.",
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
    lead: "Read once for this issue link. Nothing here stops you from practising. Publishing checks again.",
    noIssue: `With a link, ${product.name} checks whether the issue is still open and whether someone else is already on it.`,
    notGitHub:
      "Issue facts are read for GitHub issue links, such as https://github.com/owner/repo/issues/123.",
    oneIssue:
      "This field takes one issue link, so nothing was read. Keep the main issue here and name the others in the task description, as #123.",
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
    pacingHelp: `The limit is a ${product.name} default: 1 open pull request in a repository until your first one is merged, then 2.`,
    pacingExempt: "You can write to this repository, so the open-PR limit doesn't apply here",
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
      "issue-closed": `${product.name} won't publish this while the linked issue is closed.`,
      door: `${product.name} won't publish this while this repository doesn't take pull requests from you.`,
      ban: `${product.name} won't publish this while the project's rules don't accept AI-assisted contributions.`,
      area: `${product.name} won't publish this: the project keeps issues labelled for newcomers for people learning without AI tools.`,
    },
    otherPr: ({ author, number }: { author: string; number: number }) =>
      `${product.name} won't publish this while @${author}'s pull request #${number} would close the same issue, unless you give your reason when you publish.`,
    pacing: ({ open, budget }: { open: number; budget: number }) =>
      `${product.name} won't publish this while you have ${n(open)} open pull requests here, at least twice your limit of ${n(budget)}.`,
    lesson:
      "Newcomer issues teach people a project through their own fix; an Agent team taking one costs the next newcomer that chance. Try a help-wanted issue instead.",
    practiseLocally: "Start and practise locally",
    startAnyway: "Start anyway",
    back: "Back",
  },
};

export default mission;
