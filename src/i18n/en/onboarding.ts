/** The first-run welcome flow (English). */
import { product } from "../../../shared/product";

export default {
  title: `Welcome to ${product.name}`,
  intro: "A few steps get you ready.",
  progress: "Setup steps",
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
    text: `${product.name} shows its pages, explanations and Agent reports in this language. You can change it any time in Settings.`,
    label: "Language",
  },
  environment: {
    title: "Check your environment",
    text: `${product.name} needs Git and at least one AI provider. The GitHub CLI is needed to publish pull requests and to find projects.`,
    later: "You can continue now and fix the rest later in Settings.",
  },
  provider: {
    title: "Your AI provider",
    text: "Agents use the AI provider you choose here for runs and project analysis. You can change it later in the model settings.",
    choose: "More than one AI provider is ready. Which one should your Agents use?",
    none: "No AI provider is ready yet. Install and sign in to a CLI from the previous step, then check again, or take the sample tour.",
    checking: "Checking which AI providers are ready…",
    saving: "Saving…",
    saved: ({ provider }: { provider: string }) => `Your Agents use ${provider}.`,
    saveFailed: ({ message }: { message: string }) =>
      `The AI provider could not be saved: ${message}`,
    codexNote:
      "Uses the Codex CLI you installed and signed in to. Usage counts against your own account.",
    claudeNote:
      "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
    antigravityNote:
      "Uses the Antigravity CLI (agy) you installed and signed in to (Google account, Gemini API key or Google Cloud credentials). Usage counts against your own account.",
  },
  start: {
    title: "Where do you want to start?",
    tour: "Take the 2-minute sample tour",
    tourText: "See a finished contribution on a sample project, with no setup.",
    import: "Import a project",
    /**
     * Also says that every contribution ends with the understanding check:
     * the step has no line of its own under its title.
     */
    importText:
      "Import from GitHub or this computer. Each contribution ends with you explaining the change back; turn that off in Settings → Learning.",
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
