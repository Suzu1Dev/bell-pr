/**
 * Learn by hand: the person's plan, Ready for review and the run's own
 * refusals (server/by-hand.ts). Its owner adds the rest of the flow's
 * messages here.
 */
import { product } from "../../../shared/product.js";

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
};

export default flow;
