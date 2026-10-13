/**
 * App-wide settings stored in `<dataDir>/app-settings.json` and edited in
 * the settings page.
 *
 * Every field is optional and the schema strips unknown keys instead of
 * rejecting them, so an older build still reads a file written by a newer
 * one. Client code imports the types only (`import type`), which keeps zod
 * out of the UI bundle.
 */
import { z } from "zod";
import { locales } from "./i18n/locale.js";

export const appSettingsSchema = z.object({
  locale: z.enum(locales).optional(),
  /** Runs that may execute at once (Free is still limited to 1). */
  maxActiveRuns: z.number().int().min(1).max(8).optional(),
  /** Agent CLI processes that may run at once across all work. */
  maxAgentProcesses: z.number().int().min(1).max(32).optional(),
  /** Multiplies every agent turn timeout. */
  agentTimeoutScale: z.number().min(0.5).max(10).optional(),
  /** ISO time the welcome flow was finished. */
  onboardingCompletedAt: z.string().datetime({ offset: true }).optional(),
  /** The `eulaVersion` (shared/product.ts) the user accepted. */
  eulaAcceptedVersion: z.string().max(64).optional(),
  showSampleProject: z.boolean().optional(),
  /** Lets Claude Code write agents run without the OS sandbox when it is unavailable. */
  allowUnsandboxedAgents: z.boolean().optional(),
  /** Days to keep finished runs' worktrees before cleanup removes them. */
  retentionDays: z.number().int().min(1).max(365).optional(),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface AppSettingsView {
  settings: AppSettings;
  /**
   * Settings fixed by the environment (for example an environment variable)
   * and therefore read-only in the UI, with the name of what locks each one.
   */
  lockedBy: Partial<Record<keyof AppSettings, string>>;
}
