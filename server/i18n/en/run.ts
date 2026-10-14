/** Run pipeline messages: run logs, agent details and run errors. */
export default {
  /** Publishing a run's reviewed changes as a pull request. */
  publish: {
    commitMessageInvalid: "A commit message may only contain text and line breaks.",
    invalidBranch:
      "A GitHub branch name may only use letters, digits and . _ - /, must not contain .., and must not end with . or .lock.",
  },
};
