/**
 * Free/Pro table copy (English). Rows and tiers come from
 * `planFeatureTable` in shared/plans.ts; the app, the site and the READMEs
 * render this copy, so keep it customer-facing.
 */
import type { PlanFeatureId, PlanTier } from "../plans.js";

const plans = {
  columns: { feature: "Feature", tier: "Plan", limit: "Limits" },
  tiers: {
    free: "Free",
    "free-limited": "Free (limited)",
    pro: "Pro",
  } satisfies Record<PlanTier, string>,
  features: {
    runs: {
      label: "Repositories and contribution runs",
      limit: "Unlimited repositories and runs",
    },
    analysis: {
      label: "Project analysis with verified recommendations",
      limit:
        "Up to 5 recommendations per analysis; re-analysis is allowed. Recommendations you already generated (up to 30) stay visible after a downgrade.",
    },
    moreRecommendations: {
      label: 'More recommendations ("Generate 5 more", up to 30 per project)',
      limit: "Free: 5. Pro: up to 30 per project.",
    },
    teamSize: {
      label: "Agent team size",
      limit:
        "Free: Lead, 2 teammates, Reviewer and Test analyst. Pro and trial: 3 or 4 teammates.",
    },
    parallelRuns: {
      label: "Work on more than one contribution at a time",
      limit:
        "Free: one contribution at a time; others wait in the queue. Pro: up to your configured limit (2 by default, at most 8). Publishing is paced the same on every plan.",
    },
    planApproval: {
      label: "Plan approval and revision, team inbox, retry of failed subtasks",
      limit: "Up to 3 plan revisions",
    },
    review: {
      label:
        "Diff review, explanations, try-first questions, follow-up chat, notes, suggested review order",
      limit: "No limit",
    },
    understandingCheck: {
      label: "Explain it back before approval",
      limit:
        "On by default; you can turn it off in Settings → Learning, and runs approved without it are marked",
    },
    reviewRerun: {
      label: "Re-run Reviewer and Test analyst",
      limit: "No limit (part of the human review safety gate)",
    },
    reading: {
      label:
        "Code walkthroughs, the unchanged code around each change, the premise check, commit history, setup guidance",
      limit: "No limit",
    },
    publish: {
      label: "Rule-aware PR draft, preflight checks, publishing a Draft PR",
      limit: "Human approval is required on every plan",
    },
    respectChecks: {
      label: "Project-rule, issue, reviewability and pacing checks",
      limit: "On every plan; no plan can skip them",
    },
    sync: {
      label:
        "Syncing a run onto the latest target branch, agent conflict resolution, updating a project's local clone",
      limit: "No limit (unpublished runs and published PRs)",
    },
    learningNotes: {
      label: "Learning notes page",
      limit: "No limit",
    },
    practice: {
      label: "Practice deck and learning counts",
      limit: "No limit",
    },
    learningExport: {
      label: "Complete learning record export (Markdown)",
      limit: "Free: not available (the learning page stays Free)",
    },
    coachDebrief: {
      label: "Coach debrief from your own records",
      limit:
        "Free: not available; the sample project shows an example labelled PRO. Debriefs you already have stay readable after a downgrade.",
    },
    maintainerFeedback: {
      label: "Read maintainer feedback and compare it with your forecast",
      limit: "No limit",
    },
    prFeedback: {
      label: "AI follow-up rounds on maintainer feedback",
      limit:
        "Free: not available. Follow-up rounds already on a run stay readable after a downgrade, and an open round can still be reviewed, pushed, stopped or discarded.",
    },
    discovery: {
      label: "Discovery (GitHub-wide recommendations)",
      limit:
        "Free: labelled sample results only. Results you already have stay readable, and a running discovery can still be cancelled.",
    },
    webAccess: {
      label: "Web access for agents",
      limit:
        "Free: off. Pro: off until you turn it on. Claude Code may then open pages on GitHub's own sites only; the Codex CLI uses OpenAI's web search.",
    },
    deepReasoning: {
      label: "Deep reasoning efforts (xhigh, max, ultra)",
      limit:
        'Free: choose none to high. Leaving the effort on "Default" uses the model\'s own default effort on every plan.',
    },
    providers: {
      label: "Providers, model choice, Efficiency modes",
      limit: "Codex CLI and Claude Code, all models, all efficiency modes",
    },
    demo: {
      label: "Sample project / demo (Pro features shown with sample data)",
      limit: "Sample data in your browser only",
    },
    trial: {
      label: "14-day Pro trial",
      limit:
        "One per data directory, started only when you choose (in the app or with bell-pr license trial)",
    },
    licenseTerm: {
      label: "Pro license term and updates",
      limit:
        "Per named user; perpetual, with 12 months of updates from the date your key is issued",
    },
  } satisfies Record<PlanFeatureId, { label: string; limit: string }>,
};

export default plans;
