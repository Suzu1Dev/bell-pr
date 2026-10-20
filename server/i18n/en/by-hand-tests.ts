/**
 * Learn by hand: the test command the person confirmed and BELL's runs of
 * it (server/by-hand-tests.ts). Its owner adds the rest of the runner's
 * messages here.
 */
import { product } from "../../../shared/product.js";

const tests = {
  /** Run with no command confirmed for the project. */
  noCommand: "Confirm a test command for this project first.",
  /** A second run while one is running. */
  running: "Your tests are already running. Wait for them to finish, or stop them.",
  /** A run outside review, or while publishing. */
  notNow: "Tests run while the change waits for your review, not while the run plans or publishes.",
  /** A command to confirm that spans lines or holds control characters. */
  commandInvalid: "Write the test command on one line, without control characters.",
  /** The run's log when a test run wrote more output than BELL keeps reading. */
  tooMuchOutput: ({ megabytes }: { megabytes: number }) =>
    `Your tests wrote more than ${megabytes} MB of output, so ${product.name} stopped them. The end of the output is kept.`,
  /** The run's log when the shell could not start the command. */
  couldNotStart: ({ reason }: { reason: string }) => `Your test command could not start: ${reason}`,
  /** The run's log when the command ended without an exit code (a signal stopped it). */
  noExitCode: "Your tests ended without an exit code; a signal stopped them.",
};

export default tests;
