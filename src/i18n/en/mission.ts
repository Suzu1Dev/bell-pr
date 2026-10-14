/**
 * The project overview, the contribution direction and model form, and the
 * project analysis state (English).
 *
 * Messages that take a count get the raw number and format it themselves, so
 * they can pick the singular or plural noun.
 */
import type { PonytailMode } from "../../../shared/efficiency";
import { formatters } from "../../../shared/i18n/locale";
import type {
  ContributionDirection,
  ContributionRecommendation,
  RecommendationVerification,
} from "../../../shared/insights";
import type { AgentProvider } from "../../../shared/models";
import { product } from "../../../shared/product";

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
    note: "Until the analysis is done, nothing is guessed about what this project does and no change is recommended.",
  },
  project: {
    sourceDemo: "Sample analysis",
    sourceAi: "AI project analysis",
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
    sampleCount: ({ count }: { count: number }) =>
      amount(count, "sample", "samples"),
    recommendationCount: ({ count }: { count: number }) =>
      amount(count, "recommendation", "recommendations"),
    more: ({ count }: { count: number }) => `Generate ${n(count)} more`,
    generating: ({ count }: { count: number }) =>
      `Generating ${n(count)} more…`,
    limitReached: "Recommendation limit reached",
    moreDemo:
      "The sample uses prewritten recommendations. Import a real project to have the Agent generate more contribution directions.",
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
      effortHelp: `Only the efforts the selected model supports are listed. Higher efforts take longer per turn and use more; ${product.name} waits longer for Claude Code and for the xhigh and max efforts.`,
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
      label: "Ponytail development mode",
      modes: {
        lite: "Lite · default",
        full: "Full",
        off: "Off",
      } satisfies Record<PonytailMode, string>,
      help: "Lite: a short rule set that curbs overbuilding. Full: more rules, preferring existing code and native features. Off: lets you compare results and usage across modes.",
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
};

export default mission;
