/** The respect facts and checks on the server (server/contribution-facts.ts). */
const contribution = {
  /**
   * Why a GitHub fact could not be read. Each follows "Couldn't check
   * <what>:" in the publish dialog, the rules card and the task dialog, and
   * is stored with the facts in the language of the request that read them.
   */
  unknown: {
    ghMissing: "The GitHub CLI (gh) is not installed.",
    signedOut: "The GitHub CLI is not signed in. Run gh auth login, then check again.",
    timeout: "GitHub did not answer in time.",
    rateLimited: "GitHub's rate limit was reached. Wait a few minutes, then check again.",
    notFound: "GitHub did not find it, or it is not visible to your account.",
    forbidden: "GitHub refused the request for your account.",
    githubError: "GitHub answered with an error.",
    invalidAnswer: "GitHub's answer could not be read.",
    noGithubOrigin: "This project has no GitHub origin, so there is nothing to check on GitHub.",
    notAnIssue: "The link is not a GitHub issue.",
    filesUnreadable: "The project's files could not be read at its current commit.",
  },
  /** `gh pr create` refused because of GitHub's own limit on open pull requests. */
  prCap:
    "GitHub limits how many pull requests one person can have open in this repository, and you are at that limit. Finish or close one of your open pull requests here, then publish again.",
  /** PUT /api/runs/:id/test-reasons with a reason that is too short. */
  testReasonShort: "Give each reason in at least 3 words, so a maintainer can check it.",
};

export default contribution;
