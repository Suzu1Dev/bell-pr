import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { log } from "./log.js";

export type SudoAuditEvent = "enable" | "disable" | "expire" | "startup_cleanup" | "denied";
export type SudoTokenType = "host" | "device" | "none";

/** One line of `<dataDir>/audit/sudo.jsonl`. Every key is always present; unused ones are null. */
export interface SudoAuditEntry {
  ts: string;
  event: SudoAuditEvent;
  ok: boolean;
  reason: string | null;
  remoteAddr: string | null;
  host: string | null;
  tokenType: SudoTokenType | null;
  ttlSeconds: number | null;
  expiresAt: string | null;
}

/** Who asked, as the sudo route saw the request. */
export interface SudoRequestContext {
  remoteAddr: string | null;
  host: string | null;
  tokenType: SudoTokenType;
}

export type SudoAuditFields = Partial<Omit<SudoAuditEntry, "ts" | "event" | "ok">> &
  Pick<SudoAuditEntry, "event" | "ok">;

/** Cancels a scheduled call. */
export type Cancel = () => void;
/** Runs `callback` after `ms`; a promise it returns is for tests to wait on. */
export type Schedule = (callback: () => unknown, ms: number) => Cancel;

export const defaultSchedule: Schedule = (callback, ms) => {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return () => clearTimeout(timer);
};

/** Denied requests written per minute; the rest are counted in one later line. */
export const deniedPerMinute = 10;
const windowMs = 60_000;

/**
 * Appends sudo helper events to a JSONL file, one object per line, in the
 * order they happen. Without a file it records nothing.
 */
export class SudoAudit {
  private pending: Promise<void> = Promise.resolve();
  private windowStart = -Infinity;
  private deniedInWindow = 0;
  private suppressed = 0;
  private cancelFlush?: Cancel;

  constructor(
    private readonly file: string | undefined,
    private readonly now: () => number = Date.now,
    private readonly schedule: Schedule = defaultSchedule,
  ) {}

  record(fields: SudoAuditFields): Promise<void> {
    const entry: SudoAuditEntry = {
      ts: new Date(this.now()).toISOString(),
      event: fields.event,
      ok: fields.ok,
      reason: fields.reason ?? null,
      remoteAddr: fields.remoteAddr ?? null,
      host: fields.host ?? null,
      tokenType: fields.tokenType ?? null,
      ttlSeconds: fields.ttlSeconds ?? null,
      expiresAt: fields.expiresAt ?? null,
    };
    const file = this.file;
    if (!file) return this.pending;
    this.pending = this.pending
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await appendFile(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
      })
      .catch((error: unknown) => log.warn("sudo_audit.write_failed", { error }));
    return this.pending;
  }

  /** At most `deniedPerMinute` lines a minute; later ones become one `suppressed:<count>` line. */
  denied(context: SudoRequestContext, reason: string): Promise<void> {
    const now = this.now();
    if (now - this.windowStart >= windowMs) {
      this.flushSuppressed();
      this.windowStart = now;
      this.deniedInWindow = 0;
    }
    if (this.deniedInWindow < deniedPerMinute) {
      this.deniedInWindow += 1;
      return this.record({ event: "denied", ok: false, reason, ...context });
    }
    this.suppressed += 1;
    this.cancelFlush ??= this.schedule(() => {
      this.cancelFlush = undefined;
      this.flushSuppressed();
    }, this.windowStart + windowMs - now);
    return this.pending;
  }

  /** Resolves once every line recorded so far is written. */
  settled(): Promise<void> {
    return this.pending;
  }

  private flushSuppressed() {
    this.cancelFlush?.();
    this.cancelFlush = undefined;
    if (!this.suppressed) return;
    const count = this.suppressed;
    this.suppressed = 0;
    void this.record({ event: "denied", ok: false, reason: `suppressed:${count}` });
  }
}
