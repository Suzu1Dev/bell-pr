/**
 * Learn by hand: the guide's turns (server/by-hand-guide.ts): its refusals,
 * what an answer shows when BELL removed everything, the chat answer's
 * quote labels, and the structured review rendered for the Reports tab.
 */
import { product } from "../../../shared/product.js";

const guide = {
  /** An answer of another entry that the model said is about the change. */
  aboutYourChange: "This is about your change; use Hint for the next step.",
  /** A hint rung more than one above the highest one given on the step. */
  rungTooHigh: "Ask for the hints of this step in order, one rung at a time.",
  /** Shown with every guide answer (DESIGN v1.2 F6). */
  canBeWrong: "The guide can be wrong. Check its pointers against the code and your tests.",
  /** A hint, a question or a failure explained outside the review status. */
  notNow: "The guide gives hints and answers questions while you write your change, not while the run plans or publishes.",
  /** Questions on the plan after it was confirmed, or before the guide read the project. */
  planOnly: "The guide asks about your plan before you confirm it.",
  /** Questions on the plan before the person saved a step. */
  planFirst: "Save at least one step of your own plan first; the guide asks about your plan, not its own.",
  /** A fourth plan-question turn. */
  planQuestionsUsed: "The guide has already asked about your plan three times in this run.",
  /** A hint without a step of the person's plan. */
  pickStep: "Choose a step of your plan for this hint.",
  /** "Explain this failure" without a failed test run. */
  noFailure: "There is no failed test run to explain. Run your tests first.",
  /** A guide turn while BELL runs the person's tests. */
  testsRunning: "Your tests are running. Ask the guide when they finish.",
  /** No rung left on the step in a fitted run: the next one gives a kind of help the lock lacks. */
  noRungLeft: ({ kind }: { kind: string }) =>
    `The guide has no more hints for this step in this run: the project's text it is fitted to doesn't name ${kind}. Try an exit instead: ask a human, make this step smaller, or talk it through.`,
  /** No rung left on the step: the last one was given. */
  lastRungGiven:
    "There is no hint after an example in this project. Try an exit instead: ask a human, make this step smaller, or talk it through.",
  /** An answer BELL removed every part of, with no place left to point to. */
  nothingLeft: `${product.name} removed code from this answer and nothing else was left. Ask again in other words, or ask for the next hint.`,
  /** The chat answer's line when the filter acted. */
  removedFromAnswer: `${product.name} removed code from this answer before you saw it.`,
  /** The headers of quotes in a chat answer. */
  fromBase: ({ place }: { place: string }) => `From the repository, ${place}:`,
  fromChange: ({ place }: { place: string }) => `From your change, ${place}:`,
  /** The structured review at Ready, as the Reports tab shows it. */
  review: {
    verified: "What the guide verified first",
    checked: "What it looked at",
    findings: "Findings",
    noFindings: "No findings.",
    evidence: {
      test: "Test run",
      rule: "Project rule",
      pattern: "Existing code",
    },
    why: "Why it matters",
    question: "Question",
    /** A finding without evidence (DESIGN v1.2 F8). */
    mayBeWrong: "I may be wrong about this; your tests decide.",
    /** The review's closing line (DESIGN v1.2 F8). */
    advice: "The guide's review is advice and can be wrong; your tests are the judge. It fixed nothing.",
  },
};

export default guide;
