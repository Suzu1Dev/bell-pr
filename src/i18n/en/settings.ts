/**
 * Settings (English): the connections page and the shared model settings
 * dialog. The Claude Code and concurrency copy stays neutral about the
 * person's provider account and plan.
 */
import { product } from "../../../shared/product";

const settings = {
  eyebrow: "CONNECTIONS",
  title: "Get your workspace ready.",
  intro:
    "Uses the sign-in of the CLIs on this computer; credentials are never stored in the browser.",
  recheck: "Check connections again",
  rechecked: "Connection status updated",
  status: {
    ready: "Ready",
    signedOut: "Not signed in",
    missing: "Not installed",
    connected: "Connected",
  },
  signInHint: "Sign in from a terminal",
  authorizeHint: "Authorize from a terminal",
  general: {
    title: "General",
    text: "The language of the interface, and of new contributions, analyses and answers to your questions. A contribution that already started keeps working in the language it started in, and existing text is not translated.",
    language: "Language",
  },
  codex: {
    description: "Runs the agent team, code explanations and follow-up questions",
  },
  claude: {
    description:
      "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
  },
  models: {
    title: "Models and reasoning effort",
    text: "Every project shares one set of settings; existing tasks keep the settings they started with.",
    configure: "Set contribution models",
    current: "View the current task's models",
  },
  github: {
    connectedAs: ({ user }: { user: string }) => `Connected as ${user}`,
    description: "Import projects, push branches and open Draft PRs",
  },
  local: {
    title: "Local workspace",
    text: "Repositories and task data stay on the computer that runs this service",
    badge: "Local-first",
  },
  concurrency: {
    title: "Work running at the same time",
    text: "Work on several projects (or on the same one) can run at the same time, and each publishes its own PR.",
    maxActiveRuns: "Maximum runs at the same time",
    maxAgentProcesses: "Maximum agent CLI processes",
    maxQueued: "Queue limit (running, queued and awaiting plan approval combined)",
    explanation:
      "Each run's teammates, Reviewer and Test analyst need one CLI process each, so the agent CLI process limit decides how much really runs at once. Runs on the same repository are independent, each with its own worktree and branch.",
    usage:
      "Running many agents at once uses your provider account faster. Heavy parallel use of a personal plan may exceed its intended individual use.",
    advanced: "Advanced: environment variables",
    advancedText: `Set environment variables and restart ${product.name}.`,
    /** The documentation link; hidden while the product has no docs URL. */
    documentation: "See the documentation.",
  },
  modelDialog: {
    title: "Set contribution models",
    subtitle:
      "The agent, model and reasoning effort that every project shares, used by the tasks and project analyses you create from now on.",
    loading: "Loading model settings…",
    reload: "Reload model settings",
    close: "Close",
    saving: "Saving…",
    save: "Save settings",
  },
};

export default settings;
