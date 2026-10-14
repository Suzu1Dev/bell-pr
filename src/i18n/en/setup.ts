/**
 * The environment checklist, copyable fix commands and readiness notices
 * (English).
 */
import type { DoctorCheckId, DoctorCheckStatus } from "../../../shared/doctor";
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";

const fmt = formatters("en");

export default {
  checklist: {
    title: "Environment",
    intro: `What ${product.name} needs on this computer, and how to fix what is missing.`,
    recheck: "Re-check",
    rechecking: "Checking…",
    checking: "Checking your environment…",
    checkedAt: ({ time }: { time: string }) => `Checked at ${time}`,
    loadFailed: ({ message }: { message: string }) =>
      `The environment check did not answer: ${message}`,
    required: "Required",
    fixesTitle: "To fix it, run:",
    dataDir: ({ path }: { path: string }) => `Folder: ${path}`,
    labels: {
      node: "Node.js",
      git: "Git",
      "git-identity": "Git name and e-mail",
      gh: "GitHub CLI",
      "gh-auth": "GitHub sign-in",
      "gh-scopes": "GitHub permissions",
      codex: "Codex CLI",
      "codex-auth": "Codex sign-in",
      claude: "Claude Code",
      "claude-auth": "Claude Code sign-in",
      "claude-sandbox": "Claude Code sandbox",
      "provider-ready": "AI provider",
      "data-dir": "Data directory",
      app: product.name,
      platform: "Platform",
    } satisfies Record<DoctorCheckId, string>,
    status: {
      ok: "Ready",
      warn: "Check",
      fail: "Not ready",
      skip: "Not used",
    } satisfies Record<DoctorCheckStatus, string>,
    summaryReady: `Everything ${product.name} needs is ready.`,
    summaryNotReady: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? `${count} required item needs your attention.`
        : `${count} required items need your attention.`,
    summaryWarnings: ({ count }: { count: number }) =>
      fmt.plural(count) === "one"
        ? `Ready, with ${count} item worth a look.`
        : `Ready, with ${count} items worth a look.`,
    openDetails: "Open the environment settings",
  },
  copy: {
    copy: "Copy",
    copied: "Copied",
    copyCommand: ({ command }: { command: string }) =>
      `Copy the command: ${command}`,
    selected:
      "The command is selected. Press Ctrl+C (⌘C on a Mac) to copy it.",
  },
  readiness: {
    checking: "Checking your environment…",
    provider:
      "This needs an AI provider: install and sign in to the Codex CLI or Claude Code.",
    gh: "This needs the GitHub CLI, installed and signed in.",
    "git-identity":
      "This needs your Git name and e-mail address, which every commit carries.",
    unavailable: "Unavailable until this is fixed.",
    detail: ({ check, detail }: { check: string; detail: string }) =>
      `${check}: ${detail}`,
  },
};
