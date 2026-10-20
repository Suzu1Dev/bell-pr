/**
 * App-wide settings saved in `<dataDir>/app-settings.json`: the language,
 * the run and process limits, onboarding, the agent safety opt-ins and the
 * retention period.
 *
 * Environment variables win over the file: a setting that one of them sets
 * is reported in `lockedBy` and cannot be changed through the API. The
 * file is read leniently, so one written by a newer build (unknown keys,
 * or a value this build does not accept) still loads: what this build
 * cannot use is left out.
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  appSettingsSchema,
  type AppSettings,
  type AppSettingsView,
} from "../shared/app-settings.js";
import type { Locale } from "../shared/i18n/locale.js";
import { parseActiveRunLimit, parseAgentProcessLimit } from "./agent-slots.js";
import { parseAgentTimeoutScale } from "./agent-timeouts.js";
import { setRetentionDaysSource } from "./cleanup.js";
import { setAlwaysDiscloseAiSource } from "./drafts.js";
import { writeDurable } from "./fs-atomic.js";
import { setDefaultLocaleSource, type ServerMessages } from "./i18n/index.js";
import { log } from "./log.js";
import { lenientRead } from "./persisted-schema.js";
import { setAllowUnsandboxedAgentsSource } from "./sandbox.js";
import { AppError } from "./types.js";
import { setSkipUnderstandingCheckSource } from "./understanding.js";

type SettingKey = keyof AppSettings;

/** Keeps the understanding check on when set to 1; it can never turn the check off. */
export const requireUnderstandingVariable = "BELLPR_REQUIRE_UNDERSTANDING_CHECK";

/**
 * The environment variables that fix a setting, with how each value is
 * read. A variable that is unset, empty or invalid locks nothing (the
 * server refuses to start with an invalid limit, see config.ts).
 * BELLPR_LOCALE is not here: it is only the default when no language was
 * chosen.
 *
 * BELLPR_REQUIRE_UNDERSTANDING_CHECK can only keep the understanding check
 * on: "1" locks `skipUnderstandingCheck` to false, and any other value
 * locks nothing (a warning says so at start). No variable turns it off.
 */
const environmentLocks = {
  maxActiveRuns: {
    variable: "BELLPR_MAX_ACTIVE_RUNS",
    parse: parseActiveRunLimit,
  },
  maxAgentProcesses: {
    variable: "BELLPR_MAX_AGENT_PROCESSES",
    parse: parseAgentProcessLimit,
  },
  agentTimeoutScale: {
    variable: "BELLPR_AGENT_TIMEOUT_SCALE",
    parse: parseAgentTimeoutScale,
  },
  // sandbox.ts reads "1" as allowed; any other value keeps agents sandboxed.
  allowUnsandboxedAgents: {
    variable: "BELLPR_ALLOW_UNSANDBOXED_AGENTS",
    parse: (value: string) => value === "1",
  },
  retentionDays: {
    variable: "BELLPR_RETENTION_DAYS",
    parse: (value: string) =>
      appSettingsSchema.shape.retentionDays.unwrap().parse(Number(value)),
  },
  skipUnderstandingCheck: {
    variable: requireUnderstandingVariable,
    parse: (value: string) => {
      if (value !== "1")
        throw new RangeError(`${requireUnderstandingVariable} only accepts 1.`);
      return false;
    },
  },
} satisfies Partial<
  Record<SettingKey, { variable: string; parse: (value: string) => unknown }>
>;

const settingKeys = Object.keys(appSettingsSchema.shape) as SettingKey[];

/** Reads a file that a newer build may have written. */
const persistedSchema = lenientRead(appSettingsSchema);

/**
 * What PUT /api/app-settings accepts: any of the settings, each valid on
 * its own, and `null` to remove a saved value (the default then applies).
 * Unknown keys are refused.
 */
export const appSettingsPatchSchema = z
  .object(
    Object.fromEntries(
      settingKeys.map((key) => [
        key,
        appSettingsSchema.shape[key].unwrap().nullable().optional(),
      ]),
    ) as {
      [K in SettingKey]: z.ZodOptional<
        z.ZodNullable<(typeof appSettingsSchema.shape)[K]["_def"]["innerType"]>
      >;
    },
  )
  .strict();

export type AppSettingsPatch = z.infer<typeof appSettingsPatchSchema>;

/**
 * Parses the saved file. When the whole file does not fit, each setting is
 * read on its own, so one value this build does not accept (for example
 * a limit a later build raised) does not discard the others.
 */
export function parseSavedAppSettings(value: unknown): AppSettings {
  const whole = persistedSchema.safeParse(value);
  if (whole.success) return whole.data;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const settings: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const key of settingKeys) {
    if (!(key in value)) continue;
    const field = persistedSchema.safeParse({
      [key]: (value as Record<string, unknown>)[key],
    });
    if (field.success && field.data[key] !== undefined)
      settings[key] = field.data[key];
    else dropped.push(key);
  }
  if (dropped.length) log.warn("app_settings.ignored", { settings: dropped });
  return settings as AppSettings;
}

export class AppSettingsService {
  /** `<dataDir>/app-settings.json` */
  readonly file: string;
  private saved: AppSettings;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    readonly dataDir: string,
    options: {
      /** Where locks come from; process.env by default. */
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {
    this.file = path.join(dataDir, "app-settings.json");
    this.env = options.env ?? process.env;
    this.saved = this.read();
    // Nothing is silent: a value that cannot lock the check says so.
    const requireCheck = this.env[requireUnderstandingVariable]?.trim();
    if (requireCheck && requireCheck !== "1")
      log.warn("app_settings.lock_ignored", {
        variable: requireUnderstandingVariable,
        reason: "only 1 keeps the understanding check on; nothing is locked",
      });
  }

  private read(): AppSettings {
    let text: string;
    try {
      text = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        log.warn("app_settings.unreadable", { error });
      return {};
    }
    try {
      return parseSavedAppSettings(JSON.parse(text));
    } catch (error) {
      // A damaged file must not stop the server; the defaults apply until
      // the next change writes a whole file again.
      log.warn("app_settings.unreadable", { error });
      return {};
    }
  }

  /** The value each locked setting gets from its environment variable. */
  private locked(): Partial<Record<SettingKey, { variable: string; value: unknown }>> {
    const locks: Partial<Record<SettingKey, { variable: string; value: unknown }>> = {};
    for (const [key, { variable, parse }] of Object.entries(environmentLocks)) {
      const raw = this.env[variable]?.trim();
      if (!raw) continue;
      try {
        locks[key as SettingKey] = { variable, value: parse(raw) };
      } catch {
        // Invalid: nothing is locked. config.ts refuses to start with an
        // invalid limit; the constructor warns about the understanding lock.
      }
    }
    return locks;
  }

  /** The settings in effect: the saved ones, with the environment's on top. */
  get(): AppSettings {
    const settings: Record<string, unknown> = { ...this.saved };
    for (const [key, lock] of Object.entries(this.locked()))
      settings[key] = lock.value;
    return settings as AppSettings;
  }

  /** The language chosen in the app, if any; the environment never sets it. */
  locale(): Locale | undefined {
    return this.saved.locale;
  }

  /** Settings fixed by the environment, with the variable that fixes each. */
  lockedBy(): AppSettingsView["lockedBy"] {
    return Object.fromEntries(
      Object.entries(this.locked()).map(([key, lock]) => [key, lock.variable]),
    );
  }

  view(): AppSettingsView {
    return { settings: this.get(), lockedBy: this.lockedBy() };
  }

  /**
   * Saves the settings in `input` (a partial object; `null` removes a
   * value) and returns the new view. A setting an environment variable
   * locks is refused with 409; unknown keys and invalid values with 400.
   */
  async update(input: unknown): Promise<AppSettingsView> {
    const patch = appSettingsPatchSchema.parse(input ?? {});
    const lockedBy = this.lockedBy();
    const refused = settingKeys.find(
      (key) => patch[key] !== undefined && lockedBy[key],
    );
    if (refused)
      throw new AppError(
        (m) =>
          m.setup.settings.locked({
            // Only environmentLocks' settings can be locked.
            setting: lockedSettingName(m, refused as keyof typeof environmentLocks),
            variable: lockedBy[refused]!,
          }),
        409,
        { params: { setting: refused, variable: lockedBy[refused]! } },
      );
    const write = this.writes
      .catch(() => undefined)
      .then(async () => {
        const next: Record<string, unknown> = { ...this.saved };
        for (const key of settingKeys) {
          const value = patch[key];
          if (value === null) delete next[key];
          else if (value !== undefined) next[key] = value;
        }
        const settings = appSettingsSchema.parse(next);
        mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
        await writeDurable(this.file, `${JSON.stringify(settings, null, 2)}\n`, {
          mode: 0o600,
        });
        this.saved = settings;
      });
    this.writes = write;
    await write;
    return this.view();
  }
}

/** The name of a setting an environment variable can lock, as the settings page shows it. */
function lockedSettingName(
  m: ServerMessages,
  key: keyof typeof environmentLocks,
) {
  return key === "skipUnderstandingCheck"
    ? m.understanding.settingName
    : m.setup.settings.names[key];
}

let active: AppSettingsService | undefined;

/**
 * Makes `service` the source of the server-wide defaults: the language of
 * work no request asked for (store recovery, resumed runs, retention, the
 * CLI), the unsandboxed-agents opt-in, the retention period, the AI
 * disclosure choice and the understanding-check switch. The last service
 * activated wins.
 */
export function activateAppSettings(service: AppSettingsService) {
  active = service;
  setDefaultLocaleSource(() => service.locale());
  setAllowUnsandboxedAgentsSource(() => service.get().allowUnsandboxedAgents);
  setRetentionDaysSource(() => service.get().retentionDays);
  setAlwaysDiscloseAiSource(() => service.get().alwaysDiscloseAi);
  setSkipUnderstandingCheckSource(() => service.get().skipUnderstandingCheck);
}

/** Removes the sources again, unless another service replaced them since. */
export function deactivateAppSettings(service: AppSettingsService) {
  if (active !== service) return;
  active = undefined;
  setDefaultLocaleSource();
  setAllowUnsandboxedAgentsSource();
  setRetentionDaysSource();
  setAlwaysDiscloseAiSource();
  setSkipUnderstandingCheckSource();
}

/**
 * Runs `fn` with `service` active (see activateAppSettings), then gives
 * the sources back to the service that was active before, if any. The
 * command line uses it, so its output follows the saved language and its
 * checks the saved opt-ins.
 */
export async function withAppSettings<T>(
  service: AppSettingsService,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = active;
  activateAppSettings(service);
  try {
    return await fn();
  } finally {
    if (active === service) {
      if (previous) activateAppSettings(previous);
      else deactivateAppSettings(service);
    }
  }
}
