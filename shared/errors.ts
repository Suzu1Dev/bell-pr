/**
 * The error contract between the server and its clients (UI and CLI). The
 * `error` text is for people and follows the request's locale; clients
 * branch on `code`, never on the text.
 */
import type { LicenseReason, Plan, ProFeature } from "./plans.js";

export const errorCodes = [
  "pro_required",
  "auth_required",
  "server_unreachable",
  "git_missing",
  "git_identity_missing",
  "gh_missing",
  "gh_unauthenticated",
  "gh_workflow_scope",
  "github_auth_required",
  "codex_missing",
  "codex_unauthenticated",
  "claude_missing",
  "claude_unauthenticated",
  "claude_sandbox_unavailable",
  "clone_timeout",
  "already_running",
  "workspace_removed",
  "license_invalid",
  "license_env_locked",
  "trial_unavailable",
  "git_config_unsafe",
  "understanding_check_required",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return (errorCodes as readonly unknown[]).includes(value);
}

/** A command that fixes the problem, shown with a copy button. */
export interface Fix {
  label: string;
  command: string;
  /** Only show the fix on this platform; absent means every platform. */
  platform?: "darwin" | "linux" | "win32";
}

/** The JSON body of every error response. */
export interface ApiErrorBody {
  /** Human-readable message in the request's locale. */
  error: string;
  code?: ErrorCode;
  /** Values for clients that render their own message for `code`. */
  params?: Record<string, string | number>;
  fixes?: Fix[];
  /** pro_required: the feature that needs Pro. */
  feature?: ProFeature;
  /** pro_required: the plan in effect. */
  plan?: Plan;
  /** pro_required: why the plan is not Pro. */
  reason?: LicenseReason;
  /** pro_required: where to buy; absent while the purchase URL is undecided. */
  upgradeUrl?: string;
}
