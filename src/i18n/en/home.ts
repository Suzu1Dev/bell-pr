/** The Home page (English): where the app opens. */
const home = {
  /** The one-line value proposition under the logo. */
  tagline:
    "Contribute to open source with an AI team, and understand every line you ship.",
  plan: {
    /** Names the plan chip for screen readers. */
    label: "Your plan",
    upgrade: "Upgrade to Pro",
  },
  start: {
    heading: "Start here",
    sample: {
      title: "Try the sample project",
      text: "Walk through a finished contribution, from the agent team's plan to the pull request draft. No setup needed.",
    },
    import: {
      title: "Import a repository",
      text: "Bring a project from GitHub (owner/repo or a link) or a Git folder on this computer.",
    },
    discover: {
      title: "Find a project to contribute to",
      text: "Search GitHub for projects that welcome the kind of help you want to give.",
      /** On Free: discovery shows sample results only. */
      textFree:
        "See sample results on Free. Searching GitHub needs Pro or the 14-day trial.",
    },
  },
  setup: {
    heading: "Your environment",
  },
  continue: {
    heading: "Continue where you left off",
    /** Marks the run opened last. */
    lastOpened: "Last opened",
    /** The repository and the status under a run's title. */
    detail: ({ repo, status }: { repo: string; status: string }) =>
      repo ? `${repo} · ${status}` : status,
  },
};

export default home;
