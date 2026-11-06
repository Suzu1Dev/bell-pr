/** The one rule file BELL writes. Doctor reads only its expiry line. */
export const bellSudoersFile = "/etc/sudoers.d/bell-pr-agent";

/** How long an enabled rule lasts, in seconds: 1 minute to 8 hours, 1 hour by default. */
export const sudoTtlSeconds = { min: 60, default: 3600, max: 28_800 } as const;

/** The comment line in the rule file that records when it expires (ISO 8601, UTC). */
export const sudoersExpiryPrefix = "# bell-pr-expires-at: ";

const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/** The expiry time written in a rule file, or undefined when the line is missing or malformed. */
export function sudoersExpiry(text: string): Date | undefined {
  for (const line of text.split("\n")) {
    if (!line.startsWith(sudoersExpiryPrefix)) continue;
    const value = line.slice(sudoersExpiryPrefix.length).trim();
    const time = Date.parse(value);
    return isoUtc.test(value) && Number.isFinite(time) ? new Date(time) : undefined;
  }
  return undefined;
}

/**
 * The rule file's expiry as BELL wrote it. A time already past is expired;
 * a missing or unreadable line, or a time further away than the longest
 * allowed duration, is invalid.
 */
export function sudoersExpiryState(text: string | undefined, now: number) {
  const expiresAt = text === undefined ? undefined : sudoersExpiry(text);
  if (!expiresAt || expiresAt.getTime() > now + sudoTtlSeconds.max * 1000)
    return { state: "invalid" as const, expiresAt };
  if (expiresAt.getTime() <= now) return { state: "expired" as const, expiresAt };
  return { state: "valid" as const, expiresAt };
}

/** What the settings page shows about passwordless sudo for the account BELL runs as. */
export interface SudoStatus {
  user: string;
  /** False when the sudo command does not exist on this machine. */
  available: boolean;
  /** BELL's own rule file is present; it may be absent while sudo is passwordless through another rule. */
  installed: boolean;
  /** `sudo -n` works without a password, whichever rule allows it. */
  passwordless: boolean;
  /** When BELL's rule is removed (ISO 8601, UTC), if its file can be read. */
  expiresAt?: string;
}
