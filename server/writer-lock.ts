/**
 * The data directory's lock as coordination needs it (coordination.ts):
 * taken under the strict rule (index.ts acquireWriterLock) and asked,
 * before each write, whether the lock file is still this process's. Only
 * index.ts issues one, so a stand-in such as a function that answers true
 * is refused; this keeps tests honest and is no defence against code
 * running in the same process.
 */
export interface WriterLock {
  /** The data directory it locks, resolved. */
  readonly dataDir: string;
  /** Whether this process holds the lock and the lock file still names it. */
  holds(): boolean;
  /** Gives the lock up, removing its file while it is still this one's. */
  release(): void;
}

const issued = new WeakSet<object>();

/** index.ts only: the lock it took under the strict rule. */
export function issueWriterLock(lock: WriterLock): WriterLock {
  const frozen = Object.freeze({ ...lock });
  issued.add(frozen);
  return frozen;
}

/** Whether `value` is a lock that index.ts issued. */
export function isWriterLock(value: unknown): value is WriterLock {
  return typeof value === "object" && value !== null && issued.has(value);
}
