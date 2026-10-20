/**
 * Learn by hand: the guide's turns (server/by-hand-guide.ts). Its owner adds
 * the rest of the guide's messages here.
 */
const guide = {
  /** An answer of another entry that the model said is about the change. */
  aboutYourChange: "This is about your change; use Hint for the next step.",
  /** A hint rung more than one above the highest one given on the step. */
  rungTooHigh: "Ask for the hints of this step in order, one rung at a time.",
  /** Shown with every guide answer (DESIGN v1.2 F6). */
  canBeWrong: "The guide can be wrong. Check its pointers against the code and your tests.",
};

export default guide;
