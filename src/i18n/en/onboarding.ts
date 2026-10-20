/** The first-run welcome flow (English). */
import { product } from "../../../shared/product";

export default {
  title: `Welcome to ${product.name}`,
  intro:
    "A few steps get you ready: your language, the tools on this computer and the AI provider your agents use.",
  progress: "Setup steps",
  stepOf: ({ step, total }: { step: number; total: number }) =>
    `Step ${step} of ${total}`,
  steps: {
    language: "Language",
    environment: "Environment",
    provider: "AI provider",
    start: "Get started",
  },
  next: "Continue",
  back: "Back",
  language: {
    title: "Choose your language",
    text: `${product.name} shows its pages, explanations and agent reports in this language. You can change it any time in Settings.`,
    label: "Language",
  },
  environment: {
    title: "Check your environment",
    text: `${product.name} needs Git and at least one AI provider. The GitHub CLI is needed to publish pull requests and to find projects.`,
    later: "You can continue now and fix the rest later in Settings.",
  },
  provider: {
    title: "Your AI provider",
    text: "Agents use the provider you choose here for runs and project analysis. You can change it later in the model settings.",
    auto: ({ provider }: { provider: string }) =>
      `${provider} is installed and signed in, so your agents use it.`,
    choose: "Both providers are ready. Which one should your agents use?",
    none: "No provider is ready yet. Install and sign in to the Codex CLI or Claude Code (see the previous step), then check again. You can still take the sample tour.",
    checking: "Checking which providers are ready…",
    saving: "Saving…",
    saved: ({ provider }: { provider: string }) => `Your agents use ${provider}.`,
    saveFailed: ({ message }: { message: string }) =>
      `The provider could not be saved: ${message}`,
    codexNote:
      "Uses the Codex CLI you installed and signed in to. Usage counts against your own account.",
    claudeNote:
      "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
  },
  start: {
    title: "Where do you want to start?",
    tour: "Take the 2-minute sample tour",
    tourText: "See a finished contribution on a sample project, with no setup.",
    import: "Import a repository",
    /**
     * Also says that every contribution ends with the understanding check:
     * the step has no line of its own under its title.
     */
    importText:
      "Bring a project from GitHub or from this computer and start contributing. Every contribution ends with you explaining the change back; you can change that in Settings → Learning.",
    /** While BELLPR_REQUIRE_UNDERSTANDING_CHECK keeps the check on: Settings can't change it. */
    importTextLocked:
      "Bring a project from GitHub or from this computer and start contributing. Every contribution ends with you explaining the change back.",
    discover: "Find a project to contribute to",
    discoverText: "Search GitHub for projects that welcome the kind of help you want to give.",
    discoverDisabled: "Install and sign in to the GitHub CLI first.",
    finishFailed: ({ message }: { message: string }) =>
      `Setup could not be finished: ${message}`,
  },
};
