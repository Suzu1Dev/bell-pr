/**
 * Learn by hand: the person's plan, Ready for review and the run's own
 * refusals (server/by-hand.ts), the job of the guide's review at Ready, and
 * taking over commits the person pushed (server/by-hand-takeover.ts).
 */
import { formatters } from "../../../shared/i18n/locale.js";
import { product } from "../../../shared/product.js";

const fmt = formatters("en");

const flow = {
  /** The log line when the person confirms their plan. */
  yourTurn: "Your turn: write the change.",
  /** "This is my plan" without a step the person wrote. */
  stepFirst: "Write at least one step of your own plan first.",
  /** "Send the plan back" in a Learn-by-hand run. */
  reviseRefused: `In Learn by hand the plan is yours: change your steps, or ask the guide "Questions on my plan".`,
  /** Draft preparation in a Learn-by-hand run (DESIGN v1.2 F11). */
  draftRefused: `In Learn by hand, the pull request text is yours; ${product.name} doesn't draft it.`,
  /** Ready for review with a change that moved since the dialog opened. */
  changed: "The change moved since you opened this. Look at it again, then mark it ready.",
  /** The log line after the orientation turn. */
  guideRead: "The guide read the project. Write the steps of your own plan first.",
  /** Saving the plan once the change is marked ready, approved or published. */
  planClosed:
    "You can change your plan before you confirm it, and while you write until you mark the change ready for review.",
  /** A reveal before the orientation turn stored the guide's outline. */
  noOutline: "The guide's outline isn't ready yet.",
  /** A step id the person's plan no longer has. */
  noStep: "This step is no longer in your plan.",
  /** Step state, check-ins and Ready outside the writing part of the run. */
  notWriting: "This works while you write your change, after you confirm your plan.",
  /** An R3 choice that is not one of the options the guide gave on the step. */
  noOption: "Pick one of the options the guide gave for this step.",
  /** Ready for review with no change in the run's folder. */
  nothingReady: "Write a change first: there is nothing to mark ready yet.",
  /** An explanation or a walkthrough of several files at once in Learn by hand. */
  oneFile: "Ask for one file at a time.",
  /** "How a reader sees your change" before the person's own answer for the file. */
  answerFirst:
    "Answer this file's Explain-it-back question first; then you can see how a reader sees your change.",
  /** Approving while BELL runs the person's tests. */
  testsRunning: "Wait for the tests to finish or stop them, then approve.",
  /** The log line of Ready for review. */
  readyMarked: "You marked your change ready for review.",
  /** The log line of Ready for review with the guide's review. */
  readyReview: "You marked your change ready for review and asked the guide to review it.",
  /** The log line of handing the task to the agent team. */
  left: "You handed this task to the agent team. This run stays as it is.",
  /** The job of the guide's review at Ready (the review itself is server/by-hand-guide.ts). */
  review: {
    done: "The guide reviewed your change.",
    stopped: "The guide's review stopped.",
    failed: ({ reason }: { reason: string }) => `The guide's review didn't finish: ${reason}`,
  },
  /** Commits the person made in the run's folder after publishing (DESIGN v1.2 F2, README §18.9). */
  takeover: {
    pushFirst: `Push your commits first; ${product.name} takes them over once they are on the pull request's branch.`,
    commitFirst: "Commit or discard your changes in the run's folder first.",
    pullFirst: `The pull request's branch has commits the run's folder doesn't have yet. Pull them into the run's folder first; ${product.name} takes your commits over once the folder matches the branch.`,
    adopted: ({ commits }: { commits: number }) =>
      `Took over ${fmt.number(commits)} ${fmt.plural(commits) === "one" ? "commit" : "commits"} you pushed from the run's folder to the pull request's branch.`,
  },
};

export default flow;
