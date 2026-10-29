/**
 * What agents that run commands are told about this machine: what they may
 * install, where their commands really run, and how to report the setup a
 * check was missing. Pure functions of the provider and the locale, pinned
 * through the team and round prompt fixtures.
 */
import type { AgentProvider } from "../../shared/models.js";
import type { Locale } from "../../shared/i18n/locale.js";
import { outputLanguage } from "../prompt-language.js";

/**
 * What an agent may install. The machine belongs to the person, and agents
 * read untrusted repository content, so only throwaway places are writable.
 */
export const installBoundaries =
  "Never change this machine: no sudo or system package managers, no global or user-level installs (for example npm -g, pip install --user, cargo install, rustup component add) and no edits outside this working directory, except in a temporary directory you create. Installing inside them is allowed: the project's own lockfile install (such as npm ci) or a package unpacked into a temporary directory that build tools are pointed at. When a check still needs a change to the machine, skip it and report what is missing.";

/**
 * Where an agent's commands really run, so it describes its limits
 * truthfully. A Claude Code agent that edits files runs inside the OS
 * sandbox (sandbox.ts) unless the person allowed agents without it; the
 * turn is refused otherwise, so the prompt names both cases.
 */
export const fullInstallBoundaries =
  "The person explicitly allowed full access for this write turn. Install or configure only what the task needs, including system packages or toolchains outside this worktree; prefer the project documentation and report every machine-level change. Use sudo only when it needs no password; never request, read or bypass a password. Never fetch and execute a script through a shell. Report setup you still cannot complete.";

export function commandEnvironment(provider: AgentProvider = "codex", full = false) {
  if (full) return `${provider === "claude" ? "Claude Code" : "Codex"} runs this write turn with full access: there is no sandbox, and the application command deny rules for git push, gh, curl and wget are lifted. You still must not push, publish, contact anyone or access credentials. ${fullInstallBoundaries}`;
  return provider === "claude"
    ? "Claude Code runs your commands in an OS sandbox: writing outside this worktree and network access are blocked, so a check that needs them is reported as missing setup. Your commands are not sandboxed only when the person allowed agents to run without it; they then run with the person's own account on their machine, which is why the rules about changing the machine matter."
    : "Codex runs your commands in a workspace-write sandbox: writing outside this worktree and network access may be blocked, so a check that needs them is reported as missing setup.";
}

/** The report field that turns missing setup into the person's checklist. */
export function setupInstruction(locale: Locale, full = false) {
  const language = outputLanguage(locale);
  if (full) return `setup lists what this machine still lacks for checks you could not run after trying the permitted installation or configuration: need (what is missing), command (one documented command the person can run; it may use sudo) and reason (which check it blocked), with need and reason in ${language}. Never request or work around a password. Empty when nothing was missing.`;
  return `setup lists what this machine lacks for checks you could not run, so the person can install it: need (what is missing), command (one command the person can run, preferably the one the project's own documentation gives; it may use sudo) and reason (which check it blocked and where the project documents the requirement, if it does), with need and reason in ${language}. List it also when you worked around it in a temporary directory. Empty when nothing was missing.`;
}
