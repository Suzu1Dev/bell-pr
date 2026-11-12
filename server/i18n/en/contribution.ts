/** The respect facts and checks on the server (server/contribution-facts.ts). */
const contribution = {
  /** `gh pr create` refused because of GitHub's own limit on open pull requests. */
  prCap:
    "GitHub limits how many pull requests one person can have open in this repository, and you've hit it. Finish or close one, then publish again.",
  /** PUT /api/runs/:id/test-reasons with a reason that is too short. */
  testReasonShort: "Give each reason in at least 3 words, so a maintainer can check it.",
};

export default contribution;
