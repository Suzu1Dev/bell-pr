/** The first-run welcome flow (English). */
import { product } from "../../../shared/product";

export default {
  title: `Welcome to ${product.name}`,
  intro:
    "A few steps get you ready: your language, the license terms, the tools on this computer and the AI provider your agents use.",
  progress: "Setup steps",
  stepOf: ({ step, total }: { step: number; total: number }) =>
    `Step ${step} of ${total}`,
  steps: {
    language: "Language",
    license: "License",
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
  license: {
    title: "License agreement",
    text: `Please read the ${product.name} End User License Agreement. In short:`,
    summary: [
      `You may use ${product.name} on computers you own or control; Pro features need a license key or the trial.`,
      `${product.name} works through tools you install and sign in to yourself (Git, the GitHub CLI, and the Codex CLI or Claude Code), under your own accounts, so their terms and usage limits apply.`,
      "AI output can be wrong. You review every change, and nothing is published until you approve it.",
      "Agents run commands, including the imported project's own code, on this computer. Import only projects you are willing to run here.",
      `${product.name} sends no telemetry: your data stays on this computer.`,
      "The software is provided as is; the agreement sets out the warranty disclaimer and the limits of liability.",
    ],
    notice: "This summary is not the agreement. The full text decides.",
    read: "Read the full agreement",
    version: ({ version }: { version: string }) => `Agreement version ${version}`,
    accept: `I accept the ${product.name} End User License Agreement`,
    acceptButton: "Accept and continue",
    accepted: ({ version }: { version: string }) =>
      `You accepted version ${version} of the agreement.`,
    saveFailed: ({ message }: { message: string }) =>
      `Your acceptance could not be saved: ${message}`,
  },
  /**
   * The blocking prompt when onboarding is done but this build's agreement
   * version was not accepted yet. It reuses `license.summary`.
   */
  eulaPrompt: {
    title: "Accept the license agreement to continue",
    text: ({ version }: { version: string }) =>
      `Version ${version} of the ${product.name} End User License Agreement applies to this build. Read it and accept it to keep using ${product.name}. In short:`,
    accept: "Accept and continue",
    accepting: "Saving…",
    docs: "Read the documentation",
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
    importText: "Bring a project from GitHub or from this computer and start contributing.",
    discover: "Find a project to contribute to",
    discoverText: "Search GitHub for projects that welcome the kind of help you want to give.",
    /** On Free: discovery shows sample results only. */
    discoverTextFree:
      "See sample results on Free. Searching GitHub for projects needs Pro or the 14-day trial.",
    discoverDisabled: "Install and sign in to the GitHub CLI first.",
    finishFailed: ({ message }: { message: string }) =>
      `Setup could not be finished: ${message}`,
  },
};
