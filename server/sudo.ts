import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { SudoStatus } from "../shared/sudo.js";
import { command } from "./process.js";
import { redact } from "./secrets.js";
import { AppError } from "./types.js";

/** The one rule file BELL writes; deleting it undoes what enabling did. */
const sudoersFile = "/etc/sudoers.d/bell-pr-agent";

export const sudoPasswordSchema = z
  .object({
    password: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => !/[\r\n\0]/.test(value)),
  })
  .strict();

export type SudoRunner = typeof command;

interface PasswordlessSudoOptions {
  run?: SudoRunner;
  now?: () => number;
  user?: string;
  file?: string;
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

const rule = (user: string) =>
  `# Written by BELL PR so full-access agents can use sudo. Delete it in BELL's settings.\n${user} ALL=(ALL) NOPASSWD: ALL\n`;

/**
 * Turns passwordless sudo on or off for the settings page. The password is
 * sent to sudo's stdin once and never stored or logged, and the rule is only
 * written for the account the service runs as.
 */
export class PasswordlessSudo {
  private failures = 0;
  private lockedUntil = 0;
  private busy = false;
  private readonly run: SudoRunner;
  private readonly now: () => number;
  private readonly user: string;
  private readonly file: string;

  constructor(options: PasswordlessSudoOptions = {}) {
    this.run = options.run ?? command;
    this.now = options.now ?? Date.now;
    this.user = options.user ?? os.userInfo().username;
    this.file = options.file ?? sudoersFile;
  }

  async status(): Promise<SudoStatus> {
    const installed = await stat(this.file).then(
      () => true,
      () => false,
    );
    try {
      // -k ignores cached credentials, so only a rule that needs no password counts.
      const { code } = await this.run("sudo", ["-k", "-n", "true"], {
        env: environment(),
        timeoutMs: 10_000,
        allowedCodes: [0, 1],
      });
      return { user: this.user, available: true, installed, passwordless: code === 0 };
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 503)
        return { user: this.user, available: false, installed, passwordless: false };
      throw error;
    }
  }

  async enable(password: string): Promise<SudoStatus> {
    this.checkLock();
    if (this.busy) throw new AppError((m) => m.sudo.busy, 409);
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(this.user))
      throw new AppError((m) => m.sudo.invalidUser, 422);
    this.busy = true;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(os.tmpdir(), "bell-sudoers-"));
      const file = path.join(directory, "rule");
      await writeFile(file, rule(this.user), { mode: 0o600 });
      // visudo -c reads the file without privileges; a broken rule would break sudo for every account.
      const check = await this.run("visudo", ["-cf", file], {
        env: environment(true),
        timeoutMs: 10_000,
        allowedCodes: [0, 1],
      });
      if (check.code !== 0)
        throw new AppError((m) => m.sudo.invalidRule, 500);
      await this.authenticated(
        ["install", "-m", "0440", "-o", "root", "-g", "root", file, this.file],
        password,
      );
      const status = await this.status();
      if (!status.passwordless) {
        await this.authenticated(["rm", "-f", "--", this.file], password);
        throw new AppError(
          (m) => m.sudo.overridden,
          409,
        );
      }
      this.failures = 0;
      return status;
    } finally {
      this.busy = false;
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  /** Needs no password while BELL's rule is what allows it; the caller sees afterwards whether another rule still does. */
  async disable(): Promise<SudoStatus> {
    const removed = await this.run(
      "sudo",
      ["-k", "-n", "rm", "-f", "--", this.file],
      { env: environment(), timeoutMs: 10_000, allowedCodes: [0, 1] },
    );
    if (removed.code !== 0)
      throw new AppError((m) => m.sudo.removeManually({ file: this.file }), 409);
    return this.status();
  }

  private checkLock() {
    if (!this.lockedUntil) return;
    const remaining = this.lockedUntil - this.now();
    if (remaining > 0)
      throw new AppError(
        (m) => m.sudo.locked({ minutes: Math.ceil(remaining / 60_000) }),
        429,
      );
    this.lockedUntil = 0;
    this.failures = 0;
  }

  /** The password goes to sudo's stdin only: never into arguments, the environment, or a log. */
  private async authenticated(args: string[], password: string) {
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
      throw new AppError((m) => m.sudo.forbidden, 403);
    if (wrongPassword.test(result.stderr)) {
      this.failures += 1;
      if (this.failures >= maxFailures) {
        this.lockedUntil = this.now() + lockMs;
        throw new AppError(
          (m) => m.sudo.locked({ minutes: lockMinutes }),
          429,
        );
      }
      throw new AppError(
        (m) => m.sudo.wrongPassword({ remaining: maxFailures - this.failures, minutes: lockMinutes }),
        401,
      );
    }
    throw new AppError(
      (m) => m.sudo.failed({ detail: redact(result.stderr.trim()).slice(-300) }),
      422,
    );
  }
}
