import { AppError } from "./types.js";
import { cancelled, currentLocale, withLocale } from "./i18n/index.js";

export const defaultAgentProcessLimit = 3;

/**
 * Bounds how many agent CLI processes run at once across every run, project
 * analysis and discovery. Waiters are granted slots in FIFO order.
 */
export class AgentSlots {
  private activeCount = 0;
  private waiters: { grant: () => void }[] = [];

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1)
      throw new Error("AgentSlots limit must be a positive integer.");
  }

  get active() {
    return this.activeCount;
  }

  get waiting() {
    return this.waiters.length;
  }

  /** Resolves with an idempotent release function once a slot is free. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted)
      return Promise.reject(new AppError(cancelled(), 409));
    if (this.activeCount < this.limit) {
      this.activeCount++;
      return Promise.resolve(this.releaser());
    }
    // An abort listener runs in the scope of whoever aborted, so the
    // cancellation is worded in the locale of the work that waits here.
    const locale = currentLocale();
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AppError(withLocale(locale, cancelled), 409));
      };
      const waiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          this.activeCount++;
          resolve(this.releaser());
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private releaser() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;
      this.waiters.shift()?.grant();
    };
  }
}

/** Parses BELLPR_MAX_AGENT_PROCESSES; an unset variable means the default. */
export function parseAgentProcessLimit(value: string | undefined): number {
  if (value === undefined) return defaultAgentProcessLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 32)
    throw new Error("BELLPR_MAX_AGENT_PROCESSES must be between 1 and 32.");
  return limit;
}

export const defaultActiveRunLimit = 2;

/** Parses BELLPR_MAX_ACTIVE_RUNS; an unset variable means the default. */
export function parseActiveRunLimit(value: string | undefined): number {
  if (value === undefined) return defaultActiveRunLimit;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 8)
    throw new Error("BELLPR_MAX_ACTIVE_RUNS must be between 1 and 8.");
  return limit;
}
