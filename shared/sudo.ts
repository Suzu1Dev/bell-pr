/** The one rule file BELL writes. Doctor only checks that it exists. */
export const bellSudoersFile = "/etc/sudoers.d/bell-pr-agent";

/** What the settings page shows about passwordless sudo for the account BELL runs as. */
export interface SudoStatus {
  user: string;
  /** False when the sudo command does not exist on this machine. */
  available: boolean;
  /** BELL's own rule file is present; it may be absent while sudo is passwordless through another rule. */
  installed: boolean;
  /** `sudo -n` works without a password, whichever rule allows it. */
  passwordless: boolean;
}
