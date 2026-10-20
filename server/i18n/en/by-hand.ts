/**
 * Learn by hand (DESIGN v1.2): the write guard, the canary, the early
 * refusals and the gates, in one namespace. Each W2 owner edits only its
 * own part: flow (server/by-hand.ts), guide (server/by-hand-guide.ts) and
 * tests (server/by-hand-tests.ts).
 */
import { product } from "../../../shared/product.js";
import flow from "./by-hand-flow.js";
import guide from "./by-hand-guide.js";
import tests from "./by-hand-tests.js";

const byHand = {
  flow,
  guide,
  tests,
  /** The write guard in runAgent: a write turn of a Learn-by-hand run. */
  noWriteTurn: `${product.name}'s agents have no write access in a Learn-by-hand run, so ${product.name} did not start this turn.`,
  /** The canary stopped a turn (DESIGN v1.2 F2). */
  agentWrite: `${product.name} stopped an agent that tried to change files in a Learn-by-hand run.`,
  /** A Learn-by-hand part this build does not have yet. */
  notYet: "This part of Learn by hand is not available in this build yet.",
  /** A Learn-by-hand route called on an agent run. */
  notByHand: "This is only for Learn-by-hand runs.",
  /** Retry of a Learn-by-hand run past its plan. */
  retryRefused:
    "A Learn-by-hand run goes on from your own edits, so there is no agent work to retry. Start a new run to begin again.",
  /** Retry of a failed or cancelled run with the guide's outline and no confirmed plan. */
  backToPlan: "Back to your plan: nothing runs until you confirm it.",
  /** An AI follow-up round on a Learn-by-hand run (until v1.2.1). */
  followUpRefused: `In Learn by hand, push follow-up commits from the run's folder with your own Git; ${product.name} takes them over at the next feedback read.`,
  /** The conflict agent on a Learn-by-hand run. */
  resolveByHand: `In Learn by hand, resolve the conflict markers by hand in the run's folder; ${product.name} finds the ones left each time it reads the change.`,
  /** Explanations, walkthroughs, the premise check and the review before Ready. */
  notReady: "Mark your changes ready for review first.",
  /** One guide turn or test job per run at a time. */
  busy: "The guide is already working on this run. Wait for it to finish, or stop it.",
  /** The attempt gate of the hint ladder. */
  attemptFirst: "Try something first: change the code, run the tests, or say what you tried.",
  /** Done after R3 or R4 without the person's own why. */
  whyFirst: "Say in one sentence why your change for this step works before you mark it done.",
  /** A second review without a test run at the current version. */
  testFirst: "Run your tests on this version first; the tests are the judge.",
  /** POST /api/runs with byHandFit when the case is no longer fitted. */
  fitUnavailable: ({ reason }: { reason: string }) =>
    `${product.name} can't fit this run to the project's rules any more: ${reason}. Check the rules again, or start with every kind of help.`,
  /** POST /api/runs with byHandFit but not learnByHand. */
  fitNeedsByHand: "Fitting the guide to the project's rules is only for Learn-by-hand runs.",
  /** The reason when the project's rules have no AI rule to fit to. */
  fitNothing: "the project's rules have no AI rule to fit the guide to",
  /** A kind of help outside a fitted run's help set (DESIGN v1.2 F12). */
  helpOutsideFit: ({ kind }: { kind: string }) =>
    `Not offered in this run: the project's text it is fitted to doesn't name ${kind}.`,
  /** The kinds of help, as helpOutsideFit names them. */
  helpKinds: {
    explain: "explanations",
    answer: "answers to questions",
    plan: "help with planning",
    review: "reviews",
    test: "explanations of test failures",
  },
};

export default byHand;
