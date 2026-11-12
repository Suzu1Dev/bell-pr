/**
 * Test-only settings. The test preload (test/sudo-isolation.mjs) sets them
 * so no test reads the real rule file or runs the startup cleanup; the
 * server never sets them.
 */
export const sudoTestOverrides: {
  /** The file the doctor inspects when no path is given. */
  doctorSudoersFile?: string;
  /** Skips the startup cleanup in `startServer`. */
  skipStartupCleanup?: boolean;
} = {};
