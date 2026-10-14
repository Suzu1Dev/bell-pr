/** Project analysis, discovery, draft and explanation messages. */
import type { DiscoverySort } from "../../../shared/discovery.js";

/** README, CONTRIBUTING or PR template: the documents discovery reads. */
type DiscoveryDocument = "readme" | "contributing" | "template";

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
  /** GitHub-wide discovery jobs (server/discovery.ts). */
  discovery: {
    incompleteAnswer:
      "The discovery analysis came back incomplete. Try again; the previous result is kept.",
    duplicateIds:
      "The discovery analysis returned duplicate opportunity ids. Try again.",
    unverifiedRepository:
      "A discovery suggestion cited a repository that was not verified. Try again.",
    skippedUnmatchedQuote: ({
      repository,
      title,
      sourceId,
    }: {
      repository: string;
      title: string;
      sourceId: string;
    }) =>
      `Skipped ${repository} "${title}": a quote does not match its source ${sourceId}.`,
    skippedNoIssueQuote: ({
      repository,
      title,
    }: {
      repository: string;
      title: string;
    }) =>
      `Skipped ${repository} "${title}": it has no issue quote that can be checked.`,
    skippedNoContributingQuote: ({
      repository,
      title,
    }: {
      repository: string;
      title: string;
    }) =>
      `Skipped ${repository} "${title}": it does not cite the CONTRIBUTING rules that were found.`,
    /** Replaces the model's popularity text with the fetched numbers. */
    popularity: ({
      stars,
      forks,
      pushedAt,
    }: {
      stars: string;
      forks: string;
      pushedAt: string;
    }) =>
      `GitHub snapshot: ${stars} stars, ${forks} forks, last pushed ${pushedAt}. Popularity does not guarantee that a proposal will be accepted.`,
    popularityWithoutPush: ({ stars, forks }: { stars: string; forks: string }) =>
      `GitHub snapshot: ${stars} stars, ${forks} forks, no last push date provided. Popularity does not guarantee that a proposal will be accepted.`,
    skippedDifficulty: ({ count }: { count: number }) =>
      count === 1
        ? "Skipped 1 suggestion above the chosen difficulty."
        : `Skipped ${count} suggestions above the chosen difficulty.`,
    fileTooLarge: "The saved discovery results file is too large to load safely.",
    /** A discovery job that was running when the server stopped. */
    interruptedError:
      "The server restarted and interrupted the discovery. The sources collected so far and the previous result are kept; you can run discovery again.",
    interrupted: "The last discovery was interrupted",
    shuttingDown: "The server is shutting down. Try discovery again later.",
    alreadyRunning:
      "A discovery is already running. Wait for it to finish or cancel it first.",
    searching: "Looking for GitHub projects that match your criteria",
    startFailed: "Discovery could not start",
    startSaveFailed:
      "The discovery job could not be saved. Check the local storage space and try again; the previous result is kept.",
    cancelled: "Discovery was cancelled.",
    duplicateRepository: "The discovery sources contain a duplicate repository.",
    skippedFilter: ({ repository }: { repository: string }) =>
      `Skipped ${repository}: it does not match the language or the minimum stars.`,
    duplicateSourceIds:
      "Discovery sources have duplicate ids, so quotes cannot be checked reliably.",
    skippedSensitiveSource:
      "Skipped a source that appears to contain sensitive information.",
    sourcesTruncated:
      "The sources are over the 30 KB limit, so whole sections were left out.",
    noEvidence:
      "No opportunity this time both matched your criteria and had issue evidence that can be checked.",
    analyzing:
      "Found real GitHub sources; analyzing which contribution opportunities fit",
    analyzingWithWait: ({ wait }: { wait: string }) =>
      `Found real GitHub sources; analyzing which contribution opportunities fit (${wait})`,
    unusableAnswer:
      "The AI discovery analysis did not finish, or its response cannot be used safely. Try again; the previous result is kept.",
    found: ({ count }: { count: number }) =>
      count === 1
        ? "Found 1 contribution opportunity backed by sources. Check the maintainers' interest and the scope of the work before you start."
        : `Found ${count} contribution opportunities backed by sources. Check the maintainers' interest and the scope of the work before you start.`,
    noneFound:
      "No contribution opportunity fits your criteria, the project rules and the available evidence this time. Adjust the criteria and run discovery again.",
    cancelledKept: "Discovery was cancelled; the previous result is kept.",
    failed: "Discovery failed. Try again later.",
    cancelledStatus: "Discovery cancelled",
    unfinishedStatus: "Discovery did not finish",
    saveFailed:
      "The discovery results could not be saved. Check the local storage space and try again.",
  },
  /** Public GitHub sources read for discovery (server/discovery-sources.ts). */
  discoverySources: {
    invalidInterests:
      "Interest keywords can be at most 300 characters and cannot contain control characters.",
    invalidLanguage:
      "Enter a single programming language name of at most 40 characters.",
    invalidMinStars: "Minimum stars must be between 0 and 1,000,000.",
    invalidDifficulty: "Invalid discovery difficulty.",
    invalidSort: "Invalid discovery sort order.",
    cancelled: "Contribution discovery was cancelled.",
    limitReached: "Discovery reached its request or time limit.",
    unreadableText: ({ title }: { title: string }) =>
      `Skipped ${title}: it is not text that can be read safely.`,
    maskedCredentials: ({ title }: { title: string }) =>
      `Masked what looks like a credential in ${title}.`,
    truncatedSource: ({ title, bytes }: { title: string; bytes: string }) =>
      `Kept only the first ${bytes} bytes of ${title}; the rest was not read.`,
    searching:
      "Searching for public, unarchived GitHub projects that match your criteria.",
    searchFailed:
      "The GitHub search did not finish, possibly because of permissions, the connection or API limits. This does not mean that no project matches.",
    partialResults:
      "GitHub returned partial search results, so this discovery is not a complete list.",
    noRepositories:
      "This bounded search found no public project that matches. Try fewer keywords, a lower stars threshold or another difficulty.",
    /** What discovery sampled, in the GitHub search order the person chose. */
    samplingScope: ({ sort }: { sort: DiscoverySort }) =>
      `At most 6 projects were sampled (${
        {
          relevance: "GitHub's best matches first",
          updated: "most recently updated first",
          stars: "most stars first",
        }[sort]
      }), with up to 3 open issues each and the last 3 comments on each issue. Labels do not guarantee the actual difficulty or that the work is still available. Only the README, CONTRIBUTING and PR template that GitHub's community profile finds in the root, .github or docs were read; account-wide defaults, folders of several templates and external links were not.`,
    screening: ({ repository }: { repository: string }) =>
      `Checking the issues, contribution documents and maintainer replies of ${repository}.`,
    repositoryUnconfirmed: ({ repository }: { repository: string }) =>
      `Skipped ${repository}: its public status and issue data could not be fully confirmed. This does not mean it has no contribution opportunities.`,
    profileFailed:
      "The contribution document index could not be read; this does not mean the project has no rules.",
    noBaseCommit:
      "No verifiable default-branch commit was found, so no documents were read.",
    documentNotIndexed: ({ document }: { document: DiscoveryDocument }) =>
      `No ${
        {
          readme: "README",
          contributing: "CONTRIBUTING",
          template: "PR template",
        }[document]
      } was found in the locations BELL reads; the project may still keep rules elsewhere.`,
    documentFailed: ({ path }: { path: string }) =>
      `${path} could not be read or is over the text size limit; its full content was not checked.`,
    /**
     * The facts BELL adds above an issue's text for the model. A missing
     * value was not confirmed by GitHub.
     */
    issueHeader: ({
      labels,
      updatedAt,
      assignees,
      locked,
      reactions,
    }: {
      labels: string;
      updatedAt?: string;
      assignees?: number;
      locked: boolean;
      reactions?: number;
    }) =>
      `GitHub status: OPEN; labels: ${labels || "none"}; updated: ${updatedAt ?? "unconfirmed"}; assignees: ${assignees ?? "unconfirmed"}; discussion locked: ${locked ? "yes" : "no"}; total reactions: ${reactions ?? "unconfirmed"} (not votes of support).`,
    commentTitle: ({
      number,
      association,
    }: {
      number: number;
      association: string;
    }) => `#${number} · ${association} comment`,
    noMatchingIssue:
      "This sample found no open issue with the difficulty label, so the concrete need and whether the work is still available are not confirmed.",
    noPushTime: "GitHub did not provide a verifiable last push time.",
    candidateBytesLimit:
      "The sources reached the 30 KB limit for each project; some content was not read.",
    requestLimit:
      "Discovery reached its limit of 36 requests or 90 seconds. The results so far are kept; the sources of the remaining candidates were not fully read.",
    noCandidates:
      "No candidate passed the public status and source checks, so there is no project to analyze this time. Try again later or adjust the criteria.",
  },
  /** Contribution rules read for a PR draft (server/draft-sources.ts). */
  draftSources: {
    invalidBase: "Reading the draft rules needs a valid base commit.",
    cancelled: "Reading the draft rules was cancelled.",
    unreadableText: ({ label }: { label: string }) =>
      `Skipped ${label}: it is not text that can be read safely.`,
    sensitive: ({ label }: { label: string }) =>
      `Skipped ${label}: it appears to contain sensitive information.`,
    totalLimit:
      "The rule sources reached the 80 KB limit; not every document and discussion was fully checked.",
    truncated: ({ label, bytes }: { label: string; bytes: string }) =>
      `Read only the first ${bytes} bytes of ${label}; the rest was not checked.`,
    /** Label of a document from the account-wide .github repository. */
    accountDefault: ({ path }: { path: string }) => `Account default · ${path}`,
    notRegularFile: ({ label }: { label: string }) =>
      `Skipped ${label}: only regular files are read, not symbolic links or submodules.`,
    tooLarge: ({ label }: { label: string }) =>
      `${label} is over the per-file read limit or its size is unknown; its content was not checked.`,
    documentLimit:
      "Document sampling reached its limit of 16 documents or 80 KB; not every rule was fully checked.",
    readFailed: ({ label }: { label: string }) =>
      `${label} could not be read; its rules were not checked.`,
    searchScope:
      "The local rule search covers the common contribution guides, READMEs, maintainer documents and PR templates in the base commit's root, .github, docs and documentation folders, AGENTS.md and CLAUDE.md in the root, and the .github/workflows files that check pull requests automatically. Links to other places in those documents are not followed.",
    automationLimit: ({ max, remaining }: { max: number; remaining: number }) =>
      remaining === 1
        ? `At most ${max} pull request check workflows are included; 1 more workflow was not checked.`
        : `At most ${max} pull request check workflows are included; ${remaining} more workflows were not checked.`,
    workflowScanLimit: ({ total, max }: { total: number; max: number }) =>
      `.github/workflows has ${total} files; only the first ${max} were checked for automatic pull request checks.`,
    workflowReadFailed: ({ path }: { path: string }) =>
      `${path} could not be read, so whether it checks pull requests automatically is not known.`,
    baseUnreadable:
      "The rule documents in the task's base commit could not be read; this does not mean the project has no rules.",
    noRemote:
      "No verifiable github.com project URL is available, so maintainer discussions and account-wide default rules on GitHub were not checked.",
    metadataFailed:
      "Maintainer discussions and account-wide information could not be read from GitHub, possibly because of permissions, the connection or API limits; this does not mean there are no further rules.",
    defaultsTruncated:
      "The file list of the account-wide .github repository was truncated; its default rules were not fully checked.",
    defaultsNotPublic:
      "The account-wide .github repository is not confirmed to be public, so its default rules were not used.",
    defaultsNoBranch:
      "The account-wide .github repository has no readable default branch, so its default rules were not checked.",
    defaultsFailed:
      "The default rules in the account-wide .github repository could not be read; whether any of them apply was not checked.",
    maintainerSample:
      "Maintainer preferences come from the 3 most recently updated merged PRs, with up to 5 comments and 5 reviews each. A merged PR is not an endorsed rule; check whether each preference applies.",
    maintainerComment: ({
      number,
      association,
    }: {
      number: number;
      association: string;
    }) => `PR #${number} · ${association} comment`,
    maintainerReview: ({
      number,
      association,
    }: {
      number: number;
      association: string;
    }) => `PR #${number} · ${association} review`,
    mergedExample: ({ number }: { number: number }) =>
      `PR #${number} · merged example (not a rule)`,
  },
  /** PR draft suggestions (server/drafts.ts). */
  drafts: {
    stale:
      "The code diff has changed. Generate a new PR draft suggestion for the current changes.",
    incompleteAnswer:
      "The PR draft suggestion came back incomplete. Generate it again.",
    commitMessageTrailer:
      "The suggested commit message cannot include sign-off trailers such as Signed-off-by. Only you can add your own sign-off.",
    commitMessageSource:
      "The suggested commit message cites a source that does not exist. Generate it again.",
    ruleQuoteMismatch:
      "A rule quoted in the PR draft does not match its source. Generate it again.",
    templateNotUsed:
      "The PR draft does not use the template the target project provides. Generate it again.",
    templateHeadingsMissing:
      "The PR draft is missing headings from the project's template. Generate it again.",
    rulesWithoutSource:
      "A draft that follows project rules needs a source those rules can be checked against. Generate it again.",
    linuxOverridesRules:
      "The project has applicable rules, so the Linux defaults cannot replace them. Generate the draft again.",
    certifiesForPerson:
      "A PR draft cannot sign off, endorse or tick confirmation items on your behalf.",
    placeholdersInBody: ({ count, lines }: { count: number; lines: string }) =>
      `The PR draft put to-dos or unfilled template fields into the description that is sent to GitHub (${count === 1 ? "line" : "lines"} ${lines}). Generate it again.`,
    /** Put above the summary when the Linux defaults stand in for rules not found. */
    provisionalLinuxPolicy:
      "Looking up the project's sources was limited or incomplete, so the Linux contribution writing principles are used for now. Check the project's own rules before you publish.",
    noSafeDiff: "There is no safe code diff to write a PR from yet.",
    diffTooLarge:
      "The diff is over the 100 KB limit for PR drafts. Split the change and try again.",
  },
  /** Per-file change explanations (server/explanations.ts). */
  explanations: {
    /** Saved on a file whose diff is too large to explain automatically. */
    tooLargeForAutomatic:
      "This diff is over the 100 KB limit for automatic explanations. Split the change and reload.",
    tooLarge: ({ path }: { path: string }) =>
      `The diff of "${path}" is over the 100 KB limit for explanations. Split the change and try again.`,
    incompleteAnswer:
      "The change explanations came back incomplete. Generate them again.",
    mismatchedFiles:
      "The change explanations did not match the files in this diff. Generate them again.",
  },
  /** Maintainer feedback read from a published PR (server/pr-feedback.ts). */
  prFeedback: {
    githubError: ({ message }: { message: string }) =>
      `GitHub returned an error: ${message}`,
    notFound: "This PR was not found on GitHub.",
    urlMismatch:
      "The PR URL GitHub returned does not match the one recorded for this run.",
    partialReviews: ({ shown, total }: { shown: number; total: number }) =>
      `Only the latest ${shown} of ${total} reviews were read.`,
    partialComments: ({ shown, total }: { shown: number; total: number }) =>
      `Only the latest ${shown} of ${total} conversation comments were read.`,
    partialThreadReplies: ({
      path,
      shown,
      total,
    }: {
      path: string;
      shown: number;
      total: number;
    }) => `Only the first ${shown} of ${total} replies on ${path} were read.`,
    partialUnnamedThreadReplies: ({
      shown,
      total,
    }: {
      shown: number;
      total: number;
    }) =>
      `Only the first ${shown} of ${total} replies in a review thread were read.`,
    partialThreads: ({ shown, total }: { shown: number; total: number }) =>
      `Only the latest ${shown} of ${total} code review threads were read.`,
    partialChecks: ({ shown, total }: { shown: number; total: number }) =>
      `Only the first ${shown} of ${total} CI checks were read.`,
    dropped: ({ count, limit }: { count: number; limit: number }) =>
      count === 1
        ? `1 comment was left out: it is over the limit of ${limit}, or its link does not belong to this PR.`
        : `${count} comments were left out: they are over the limit of ${limit}, or their links do not belong to this PR.`,
    partialLabels: ({ shown, total }: { shown: number; total: number }) =>
      `Only ${shown} of ${total} PR labels were read; the labels left out may include ones that start with needs:.`,
  },
  /** Model catalogs and model settings (server/models.ts). */
  models: {
    catalogUnavailable:
      "The Codex model list cannot be read right now. Check that the CLI is installed and signed in, then try again later.",
    /** Descriptions of the Claude Code model aliases. */
    claudeOpus:
      "Suited to complex code changes, reviews and multi-step reasoning.",
    claudeSonnet:
      "Balances speed and capability; suited to everyday development and analysis.",
    claudeFable:
      "The most capable model; one task may take longer. Your plan must include it.",
    claudeHaiku:
      "The fastest, with the lowest usage. It does not support reasoning effort settings.",
    invalidSettings: "The model settings are not valid. Choose them again.",
    providerMismatch:
      "The model list does not match the selected agent. Reload, then choose again.",
    unknownModel:
      "These model settings cannot be confirmed. Reload the model list and choose again.",
    unsupportedEffort:
      "The selected model does not support this reasoning effort. Choose another one.",
  },
};
