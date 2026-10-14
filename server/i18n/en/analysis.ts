/** Project analysis, discovery, draft and explanation messages. */
export default {
  /** Project analysis (server/insights.ts). */
  insights: {
    /** A contribution setting's issue link failed validation. */
    issueUrlInvalid:
      "The related issue link must look like https://github.com/<owner>/<repo>/issues/<number>",
    duplicateRecommendationIds: "Recommendation ids must be unique.",
    /** Why a cited path was dropped; saved with the analysis. */
    citesUnsampledFile: ({ path }: { path: string }) =>
      `Cites ${path}, a file whose content was not sampled`,
    citesUnsuppliedFile: ({ path }: { path: string }) =>
      `Cites ${path}, a file that was not supplied`,
    quotePathNotInEvidence: ({ path, quote }: { path: string; quote: string }) =>
      `The quoted path ${path} is not in this recommendation's evidence list: "${quote}"`,
    quoteNotFound: ({ path, quote }: { path: string; quote: string }) =>
      `The quote was not found in ${path}: "${quote}"`,
    evidenceWithoutQuote: ({ path }: { path: string }) =>
      `The evidence path ${path} has no matching quote`,
    incompleteAnswer:
      "The AI analysis came back incomplete. Analyze again; the previous result is kept.",
    sensitiveAnswer:
      "The AI response appears to contain sensitive content, so the result was not saved.",
    unsuppliedCitation: ({ field, path }: { field: string; path: string }) =>
      `The AI analysis cited a file that was not supplied (${field}: ${path}). Analyze again; the previous result is kept.`,
    readingPathTooShort:
      "The reading path the AI suggested is too short. Analyze again; the previous result is kept.",
    duplicateIds: "The AI returned duplicate recommendation ids. Analyze again.",
    repositoryNotFound: "Repository not found.",
    cacheUnreadable:
      "The project analysis data cannot be read. Check the local insights data file.",
    modelSettingsUnreadable:
      "The model settings cannot be read. Check the local model-settings.json file.",
    analyzeFirst:
      "Analyze the project before you adjust its contribution recommendations.",
    recommendationsChanged:
      "Some contribution recommendations have changed. Refresh, then adjust them again.",
    cancelled: "The project analysis was cancelled.",
    noCommit: "The repository has no Git commit to analyze.",
    noTextFiles:
      "No tracked text files to analyze were found. Add a README or code and commit it first.",
    shuttingDown:
      "The server is shutting down, so a new project analysis cannot start.",
    alreadyRunning:
      "This project is already being analyzed. Wait for the current analysis to finish.",
    tooManyRunning:
      "At most two projects can be analyzed at the same time. Try again later.",
    reanalyzeBeforeMore:
      "Analyze the whole project again before you generate more contribution directions.",
    recommendationLimit: ({ max }: { max: number }) =>
      `This project already has ${max} contribution directions. Choose the ones you want to work on, or analyze the project again.`,
    agentUnavailable: ({ agent, login }: { agent: string; login: string }) =>
      `${agent} cannot be used. Check that its CLI is installed and run ${login}.`,
    /** Server log line when an analysis may wait longer than usual. */
    started: ({
      repository,
      runner,
      wait,
    }: {
      repository: string;
      runner: string;
      wait: string;
    }) => `Project analysis of ${repository} (${runner}) started; ${wait}.`,
    unfinished:
      "The AI analysis did not finish or its response was too large. Try again; the previous result is kept.",
    repositoryChanged:
      "The repository changed during the analysis. Analyze the latest version again.",
  },
};
