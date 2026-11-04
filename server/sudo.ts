import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  bellSudoersFile,
  sudoersExpiryPrefix,
  sudoersExpiryState,
  sudoTtlSeconds,
  type SudoStatus,
} from "../shared/sudo.js";
import { command } from "./process.js";
import { redact } from "./secrets.js";
import {
  defaultSchedule,
  SudoAudit,
  type Cancel,
  type Schedule,
  type SudoRequestContext,
} from "./sudo-audit.js";
import { AppError } from "./types.js";

/** The one rule file BELL writes; deleting it undoes what enabling did. */
const sudoersFile = bellSudoersFile;

export const sudoTtlSchema = z
  .number()
  .int()
  .min(sudoTtlSeconds.min)
  .max(sudoTtlSeconds.max);

export const sudoEnableSchema = z
  .object({
    password: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !/[\r\n\0]/.test(value)),
    ttlSeconds: sudoTtlSchema.optional(),
  })
  .strict();

export type SudoRunner = typeof command;

interface PasswordlessSudoOptions {
  run?: SudoRunner;
  now?: () => number;
  user?: string;
  /** Group of the installed rule file, so the service account can read its expiry line. */
  group?: string;
  /** Code-only: the server always writes the default file. */
  file?: string;
  /** Where events are recorded; nothing is recorded without it. */
  audit?: SudoAudit;
  /** Runs the removal at expiry; tests replace it. */
  schedule?: Schedule;
}

const maxFailures = 3;
const lockMs = 15 * 60_000;
const lockMinutes = lockMs / 60_000;
const notInSudoers = /is not in the sudoers file|is not allowed to (?:run|execute)/i;
// Only messages sudo prints after a password was actually checked; a missing password is our bug, not a typo.
const wrongPassword = /Authentication failed|incorrect password attempt|Sorry, try again/i;

/** sudo's messages are matched above, so the locale is forced to C; PATH stays inherited so a test can put a fake sudo first. */
function environment(withSbin = false): NodeJS.ProcessEnv {
  const base = process.env.PATH || "/usr/bin:/bin";
  return {
    PATH: withSbin ? `${base}:/usr/sbin:/sbin` : base,
    LC_ALL: "C",
  };
}

const rule = (user: string, expiresAt: string) =>
  `# Written by BELL PR so full-access agents can use sudo. Delete it in BELL's settings.\n${sudoersExpiryPrefix}${expiresAt}\n${user} ALL=(ALL) NOPASSWD: ALL\n`;

/** An AppError that also says, for the audit log, why enabling stopped. */
class SudoError extends AppError {
  constructor(
    message: ConstructorParameters<typeof AppError>[0],
    statusCode: number,
    readonly reason: string,
  ) {
    super(message, statusCode);
  }
}

type RuleFile =
  | { state: "absent" | "unknown"; expiresAt?: undefined }
  | { state: "valid" | "expired" | "invalid"; expiresAt?: Date };

/**
 * Turns passwordless sudo on for a set time, or off, for the settings
 * page. The password is sent to sudo's stdin for each enable and never
 * stored or logged, and the rule is only written for the account the
 * service runs as. The rule is removed when it expires.
 */
export class PasswordlessSudo {
  private failures = 0;
  private lockedUntil = 0;
  private busy = false;
  private cancelExpiry?: Cancel;
  private readonly run: SudoRunner;
  private readonly now: () => number;
  private readonly user: string;
  private readonly group: string;
  private readonly file: string;
  private readonly schedule: Schedule;
  readonly audit: SudoAudit;

  constructor(options: PasswordlessSudoOptions = {}) {
    this.run = options.run ?? command;
    this.now = options.now ?? Date.now;
    this.user = options.user ?? os.userInfo().username;
    this.group = options.group ?? String(os.userInfo().gid);
    this.file = options.file ?? sudoersFile;
    this.schedule = options.schedule ?? defaultSchedule;
    this.audit = options.audit ?? new SudoAudit(undefined, this.now, this.schedule);
  }

  /** The rule file this instance writes. */
  get path() {
    return this.file;
  }

  async status(): Promise<SudoStatus> {
    const rule = await this.readRule();
    const installed = rule.state !== "absent" && rule.state !== "unknown";
    const expiresAt =
      installed && rule.expiresAt ? { expiresAt: rule.expiresAt.toISOString() } : {};
    try {
      // -k ignores cached credentials, so only a rule that needs no password counts.
      const { code } = await this.run("sudo", ["-k", "-n", "true"], {
        env: environment(),
        timeoutMs: 10_000,
        allowedCodes: [0, 1],
      });
      return { user: this.user, available: true, installed, passwordless: code === 0, ...expiresAt };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 503)
        return { user: this.user, available: false, installed, passwordless: false, ...expiresAt };
      throw error;
    }
  }

  /** Every enable needs the password and a duration; the rule records when it expires. */
  async enable(
    password: string,
    ttlSeconds: number = sudoTtlSeconds.default,
    context: Partial<SudoRequestContext> = {},
  ): Promise<SudoStatus> {
    const ttl = sudoTtlSchema.parse(ttlSeconds);
    const expiresAt = new Date(this.now() + ttl * 1000).toISOString();
    try {
      const status = await this.install(password, expiresAt);
      await this.audit.record({ event: "enable", ok: true, ...context, ttlSeconds: ttl, expiresAt });
      return status;
    } catch (error) {
      const reason = error instanceof SudoError ? error.reason : "failed";
      await this.audit.record({ event: "enable", ok: false, reason, ...context, ttlSeconds: ttl });
      throw error;
    } finally {
      password = "";
    }
  }

  /** Needs no password while BELL's rule is what allows it; the caller sees afterwards whether another rule still does. */
  async disable(context: Partial<SudoRequestContext> = {}): Promise<SudoStatus> {
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
    const removed = await this.removeRule();
    await this.audit.record({
      event: "disable",
      ok: removed,
      reason: removed ? null : "remove_failed",
      ...context,
    });
    if (!removed)
      throw new AppError((m) => m.sudo.removeManually({ file: this.file }), 409);
    return this.status();
  }

  /**
   * At server start: a rule that is still valid is removed when it
   * expires; an expired rule, or one without a valid expiry, is removed now.
   */
  async cleanUpAtStartup(): Promise<void> {
    const rule = await this.readRule();
    if (rule.state === "absent" || rule.state === "unknown") return;
    if (rule.state === "valid" && rule.expiresAt) {
      this.scheduleExpiry(rule.expiresAt);
      return;
    }
    const removed = await this.removeRule();
    await this.audit.record({
      event: "startup_cleanup",
      ok: removed,
      reason: removed ? rule.state : "remove_failed",
      expiresAt: rule.expiresAt?.toISOString() ?? null,
    });
  }

  /** Stops the expiry timer; the file stays until it expires at the next start. */
  stop() {
    this.cancelExpiry?.();
    this.cancelExpiry = undefined;
  }

  private scheduleExpiry(at: Date) {
    this.cancelExpiry?.();
    this.cancelExpiry = this.schedule(() => {
      this.cancelExpiry = undefined;
      return this.expire(at);
    }, Math.max(0, at.getTime() - this.now()));
  }

  private async expire(at: Date) {
    const removed = await this.removeRule().catch(() => false);
    await this.audit.record({
      event: "expire",
      ok: removed,
      reason: removed ? null : "remove_failed",
      expiresAt: at.toISOString(),
    });
  }

  private async fileState(): Promise<"present" | "absent" | "unknown"> {
    try {
      await stat(this.file);
      return "present";
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return code === "ENOENT" || code === "ENOTDIR" ? "absent" : "unknown";
    }
  }

  private async readRule(): Promise<RuleFile> {
    const state = await this.fileState();
    if (state !== "present") return { state };
    const text = await readFile(this.file, "utf8").catch(() => undefined);
    return sudoersExpiryState(text, this.now());
  }

  /** Removes the rule while it still allows sudo without a password; true once the file is gone. */
  private async removeRule(): Promise<boolean> {
    if ((await this.fileState()) === "absent") return true;
    await this.run("sudo", ["-k", "-n", "rm", "-f", "--", this.file], {
      env: environment(),
      timeoutMs: 10_000,
      allowedCodes: [0, 1],
    }).catch(() => undefined);
    return (await this.fileState()) === "absent";
  }

  private async install(password: string, expiresAt: string): Promise<SudoStatus> {
    this.checkLock();
    if (this.busy) throw new SudoError((m) => m.sudo.busy, 409, "busy");
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(this.user))
      throw new SudoError((m) => m.sudo.invalidUser, 422, "invalid_user");
    this.busy = true;
    let directory: string | undefined;
    // sudo skips files in sudoers.d whose name contains a dot, so the staged copy is inert.
    const staged = path.join(path.dirname(this.file), `.${path.basename(this.file)}.tmp`);
    let isStaged = false;
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), "bell-sudoers-"));
      const file = path.join(directory, "rule");
      await writeFile(file, rule(this.user, expiresAt), { mode: 0o600 });
      // visudo -c reads the file without privileges; a broken rule would break sudo for every account.
      const check = await this.run("visudo", ["-cf", file], {
        env: environment(true),
        timeoutMs: 10_000,
        allowedCodes: [0, 1],
      });
      if (check.code !== 0)
        throw new SudoError((m) => m.sudo.invalidRule, 500, "invalid_rule");
      await this.authenticated(
        ["install", "-m", "0440", "-o", "root", "-g", this.group, file, staged],
        password,
      );
      isStaged = true;
      // The copy next to the target is checked again, then renamed over it in one step.
      await this.authenticated(
        ["visudo", "-c", "-f", staged],
        password,
        () => new SudoError((m) => m.sudo.invalidRule, 500, "invalid_rule"),
      );
      await this.authenticated(["mv", "-f", "--", staged, this.file], password);
      isStaged = false;
      const status = await this.status();
      if (!status.passwordless) {
        await this.authenticated(["rm", "-f", "--", this.file], password);
        throw new SudoError((m) => m.sudo.overridden, 409, "overridden");
      }
      this.failures = 0;
      this.scheduleExpiry(new Date(expiresAt));
      return status;
    } finally {
      if (isStaged)
        await this.run("sudo", ["-S", "-k", "-p", "", "--", "rm", "-f", "--", staged], {
          env: environment(),
          input: `${password}\n`,
          timeoutMs: 30_000,
          allowedCodes: [0, 1],
        }).catch(() => undefined);
      password = "";
      this.busy = false;
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  private checkLock() {
    if (!this.lockedUntil) return;
    const remaining = this.lockedUntil - this.now();
    if (remaining > 0)
      throw new SudoError(
        (m) => m.sudo.locked({ minutes: Math.ceil(remaining / 60_000) }),
        429,
        "locked",
      );
    this.lockedUntil = 0;
    this.failures = 0;
  }

  /** The password goes to sudo's stdin only: never into arguments, the environment, or a log. */
  private async authenticated(args: string[], password: string, otherFailure?: () => AppError) {
    const result = await this.run(
      "sudo",
      ["-S", "-k", "-p", "", "--", ...args],
      {
        env: environment(),
        input: `${password}\n`,
        timeoutMs: 30_000,
        allowedCodes: [0, 1],
      },
    );
    if (result.code === 0) return;
    if (notInSudoers.test(result.stderr))
      throw new SudoError((m) => m.sudo.forbidden, 403, "forbidden");
    if (wrongPassword.test(result.stderr)) {
      this.failures += 1;
      if (this.failures >= maxFailures) {
        this.lockedUntil = this.now() + lockMs;
        throw new SudoError(
          (m) => m.sudo.locked({ minutes: lockMinutes }),
          429,
          "locked",
        );
      }
      throw new SudoError(
        (m) => m.sudo.wrongPassword({ remaining: maxFailures - this.failures, minutes: lockMinutes }),
        401,
        "wrong_password",
      );
    }
    if (otherFailure) throw otherFailure();
    throw new SudoError(
      (m) => m.sudo.failed({ detail: redact(result.stderr.trim()).slice(-300) }),
      422,
      "failed",
    );
  }
}
