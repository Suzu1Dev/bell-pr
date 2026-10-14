/** GitHub-wide discovery of contribution opportunities (English). */
import type {
  ContributionOpportunity,
  DiscoveryJob,
  DiscoveryPreferences,
} from "../../../shared/discovery";
import type { PonytailMode } from "../../../shared/efficiency";
import { formatters } from "../../../shared/i18n/locale";

const fmt = formatters("en");

const discovery = {
  eyebrow: "FIND YOUR NEXT CONTRIBUTION",
  /** The page heading in two lines; the second line is emphasized. */
  title: {
    lead: "Find the next contribution",
    emphasis: "worth your time.",
  },
  /**
   * The introduction in two parts. Wide screens break the line between them;
   * narrow screens do not, so `lead` ends with the space that separates them.
   */
  intro: {
    lead: "Start from real user needs, and let AI help you read the rules and judge the effort, ",
    rest: "so you find work that teaches you something and makes a difference.",
  },
  heroCaption: "GitHub → your next step",
  form: {
    heading: "Where do you want to start?",
    hint: "You can leave everything blank; we'll suggest a direction first.",
    interests: "Areas of interest",
    interestsPlaceholder: "For example: accessibility, developer tools",
    interestsHint:
      "Searched as GitHub keywords. With several words, a project must match all of them.",
    language: "Programming language",
    languagePlaceholder: "Any, e.g. TypeScript",
    difficulty: "Difficulty you'll take on",
    difficulties: {
      beginner: "Beginner-friendly",
      intermediate: "Up to intermediate",
      any: "Any difficulty",
    } satisfies Record<DiscoveryPreferences["difficulty"], string>,
    sort: "Sort search by",
    sortHint:
      "Recently updated: reflects recent activity, but the results change as projects are updated. Relevance: GitHub's best match. It can include projects that have not been maintained for a while; archived projects are left out and the last push date is shown. Stars: well-known projects, with more competition and a higher review bar.",
    minStars: "Minimum stars",
    advanced: "Model and efficiency settings",
    agent: "Agent",
    model: "Analysis model",
    defaultModel: ({ provider }: { provider: string }) =>
      `Use the ${provider} default model`,
    /** A saved model that the provider's catalog does not list. */
    modelNotInCatalog: ({ model }: { model: string }) =>
      `${model} (not in the catalog)`,
    reasoningEffort: "Reasoning effort",
    modelDefault: "Model default",
    /** A saved effort that the selected model's catalog entry does not list. */
    effortNotInCatalog: ({ effort }: { effort: string }) =>
      `${effort} (saved, not in the catalog)`,
    ponytailMode: "Ponytail mode",
    ponytailModes: {
      lite: "Lite · default",
      full: "Full",
      off: "Off",
    } satisfies Record<PonytailMode, string>,
    accountHint: ({ provider }: { provider: string }) =>
      `The analysis uses your ${provider} sign-in and counts against your model usage. The catalog lists models that exist; your account may not have access to all of them.`,
    publicDataOnly:
      "Reads public data only. Planning starts after you choose an item.",
    submit: "Recommend contributions",
  },
  sorts: {
    updated: "Recently updated",
    relevance: "Relevance",
    stars: "Stars",
  } satisfies Record<DiscoveryPreferences["sort"], string>,
  reload: "Reload status",
  loading: "Loading your discovery history…",
  progress: {
    label: "Discovery progress",
    eyebrow: "RESEARCH IN PROGRESS",
    stop: "Stop discovery",
    phases: {
      searching: {
        title: "Search projects",
        detail: "Public projects and active issues",
      },
      screening: {
        title: "Check the rules and needs",
        detail: "Contribution docs, claimed issues and maintainer replies",
      },
      analyzing: {
        title: "AI sorts the recommendations",
        detail: "Feasibility, value to users and a first step",
      },
    } satisfies Record<Exclude<DiscoveryJob["phase"], "complete">, unknown>,
  },
  /** When the shown discovery ran; `date` is missing on damaged records. */
  searchedAt: ({ date }: { date?: string }) =>
    date ? `Searched ${date}` : "Search time not recorded",
  limitations: ({ count }: { count: number }) =>
    `Scope and limits of this search · ${fmt.number(count)}`,
  empty: {
    title: "Good contributions start with understanding the need.",
    body: "When you ask for recommendations, we read public GitHub projects and issues and weigh each opportunity from these four angles.",
    /** After a discovery that found nothing suitable. */
    retryTitle: "Change the criteria and look for the next opportunity.",
    retryBody:
      "There isn't enough evidence for a suitable item yet. Try fewer keywords, a wider difficulty or a lower minimum star count.",
    angles: {
      rules: {
        title: "Project rules",
        detail: "Learn how to take part first",
      },
      activity: {
        title: "Popularity and activity",
        detail: "See signs of active maintenance",
      },
      needs: {
        title: "User needs",
        detail: "Check who the change helps",
      },
      barrier: {
        title: "Barrier to entry",
        detail: "Find a first step you can manage",
      },
    },
  },
  results: {
    label: "Recommended contributions",
    eyebrow: "YOUR CONTRIBUTION SHORTLIST",
    previousEyebrow: "PREVIOUS RESULTS",
    title: "Take your first step with one of these.",
    previousTitle: "Your previous recommendations are still here.",
    note: ({ sort }: { sort: string }) =>
      `We took 12 candidates in the "${sort}" order you chose and kept at most 6 after checking them. The order comes from the analysis, not from a GitHub-wide ranking. Before you start, check the issue's latest status and whether the maintainers want the change.`,
    previousNote: ({ date }: { date?: string }) =>
      date
        ? `These results are from ${date} and do not reflect your latest search.`
        : "These are earlier results and do not reflect your latest search.",
    count: ({ count }: { count: number }) =>
      `${fmt.number(count)} ${fmt.plural(count) === "one" ? "opportunity" : "opportunities"}`,
  },
  difficulties: {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advanced: "Advanced",
  } satisfies Record<ContributionOpportunity["difficulty"], string>,
  card: {
    languageUnknown: "Language not specified",
    lastPush: ({ date }: { date?: string }) =>
      date ? `Last push ${date}` : "Last push unknown",
    whoItHelps: "Who does this contribution help?",
    whyItFits: "Why it's worth your time",
    effort: "Estimated effort",
    effortNote: "AI estimate; the full code has not been reviewed yet.",
    rulesSummary: "Contribution rules and activity",
    rules: "Read these rules before you take part",
    popularity: "Activity snapshot",
    planSummary: "First steps, acceptance checks and open questions",
    firstSteps: "Start here",
    acceptanceChecks: "How to confirm it's done (not run yet)",
    risks: "Check before you commit",
    evidence: ({ count }: { count: number }) =>
      `Evidence and quoted sources · ${fmt.number(count)}`,
    chooseHint:
      "Choosing it imports the project and fills in contribution settings you can edit.",
    choose: "Choose this opportunity",
    importing: "Importing the project…",
  },
  runtime: {
    summary: "Model and usage for this discovery",
    usageTitle: "Discovery AI usage",
  },
};

export default discovery;
