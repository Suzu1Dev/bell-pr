/**
 * Learn by hand: the test command the person confirmed and BELL's runs of
 * it (server/by-hand-tests.ts). Its owner adds the rest of the runner's
 * messages here.
 */
const tests = {
  /** Run with no command confirmed for the project. */
  noCommand: "Confirm a test command for this project first.",
  /** A second run while one is running. */
  running: "Your tests are already running. Wait for them to finish, or stop them.",
  /** A run outside review, or while publishing. */
  notNow: "Tests run while the change waits for your review, not while the run plans or publishes.",
};

export default tests;
