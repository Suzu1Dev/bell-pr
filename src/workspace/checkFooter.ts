import type { Run } from "../types";

/**
 * What the review footer says and does about the Explain-it-back check:
 * once every file is ticked, a required check that has not passed turns
 * the primary button into "Explain it back", which opens the check; the
 * status line says where the person stands, and before the ticks are done
 * the tooltip names both remaining steps. Keys of the `footer` messages.
 */
export function checkFooter(
  run: Pick<Run, "status" | "publishing">,
  allReviewed: boolean,
  check: { required: boolean; passed: boolean },
) {
  const open = ["review", "approved"].includes(run.status) && !run.publishing;
  const pending = open && check.required && !check.passed;
  return {
    explainFirst: allReviewed && pending,
    status: !allReviewed
      ? "learning"
      : run.status === "published"
        ? "allReviewed"
        : !check.required
          ? "checkOff"
          : check.passed
            ? "passed"
            : "allReviewed",
    needsReview: pending ? "needsReviewAndCheck" : "needsReview",
  } as const;
}
