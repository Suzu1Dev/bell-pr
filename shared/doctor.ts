/**
 * The environment check report (`bell-pr doctor`, GET /api/doctor and the
 * setup checklist): which tools BELL PR needs and whether they are ready.
 */
import type { Fix } from "./errors.js";

export const doctorCheckIds = [
  "node",
  "git",
  "git-identity",
  "gh",
  "gh-auth",
  "gh-scopes",
  "codex",
  "codex-auth",
  "claude",
  "claude-auth",
  "claude-sandbox",
  "provider-ready",
  "data-dir",
  "app",
  "platform",
] as const;
export type DoctorCheckId = (typeof doctorCheckIds)[number];

/** "skip" means the check did not apply, for example an absent optional CLI. */
export type DoctorCheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: DoctorCheckId;
  status: DoctorCheckStatus;
  /** A failed required check makes the report not ready. */
  required: boolean;
  /** The detected tool version, when there is one. */
  version?: string;
  /** Human-readable detail in the request's locale. */
  detail?: string;
  /**
   * Why the check has its status, as a stable id such as "missing",
   * "signed-out", "offline" or "too-old"; clients branch on it, never on
   * the detail text.
   */
  reason?: string;
  /**
   * Values behind the detail that clients format or mask themselves, such
   * as `login` (gh-auth), `path` and `freeBytes` (data-dir) or `email`
   * and `noreply` (git-identity: the guessed and the suggested address).
   */
  params?: Record<string, string | number>;
  fixes?: Fix[];
  docsUrl?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** True when no required check failed. */
  ready: boolean;
  /** ISO time of the check. */
  checkedAt: string;
  platform: NodeJS.Platform | string;
}
