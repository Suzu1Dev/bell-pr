/**
 * Dialogs (English): the dialog frame, the guide, the list of every run and
 * the new-task dialog.
 */
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";

const { plural } = formatters("en");

const modals = {
  close: "Close dialog",
  help: {
    title: "From an idea to your next PR.",
    subtitle: "Four steps that connect building, reviewing and learning.",
    steps: {
      import: {
        title: "Bring in a repository",
        text: "Import a GitHub link or a local path and pick the project to contribute to.",
      },
      team: {
        title: "Direct the agent team",
        text: "Describe what you need clearly, so the planning, building and review roles can split the work.",
      },
      understand: {
        title: "Understand every change",
        text: "Switch files to read the diff; click a line number, or hold Shift to select a block of code, and ask the agent. Mark the file as reviewed once you understand it.",
      },
      submit: {
        title: "Edit and submit the PR",
        text: "Adjust the title and description, save the draft, and confirm the submission once every file is reviewed.",
      },
    },
    start: "Start exploring",
    about: `About ${product.name}`,
  },
  runs: {
    title: "Every idea has its progress.",
    subtitle: "Switch tasks to see their status, code changes and PR draft.",
    demo: "Interactive demo",
    newContribution: "New contribution",
    freeSpace: "Free disk space",
    freeSpaceLabel: ({ title }: { title: string }) => `Free disk space: ${title}`,
    freeConfirm: `Remove this contribution's working files: its Git worktree, its teammates' checkouts and its branch in ${product.name}'s own copy of the project? The contribution, its notes and its explanations stay, but its changes can no longer be shown.`,
    freeYes: "Free disk space",
    /** Marks a run whose working files were removed. */
    filesRemoved: "Files removed",
    deleteRun: "Delete run",
    deleteRunLabel: ({ title }: { title: string }) => `Delete run: ${title}`,
    deleteConfirm:
      "Delete this contribution with its notes and working files? This cannot be undone.",
    deleteYes: "Delete run",
    working: "Working…",
    activeHint: "Stop this contribution before you free its space or delete it.",
    freed: "Disk space freed. The contribution and its notes stay.",
    deleted: "Contribution deleted.",
  },
  newTask: {
    title: "Hand your idea to your agent team.",
    subtitle: "Describe what you want to improve and how it should behave when it is done.",
    repo: "Target repository",
    chooseRepo: "Choose a repository",
    demoRepo: ({ name }: { name: string }) => `${name} (demo)`,
    importOther: "Import another project",
    recommendations: "See AI-recommended directions first",
    demoNote:
      "Demo settings can be changed freely; no real agent starts. The sample team plays its run again from the start. Import your repository to start building.",
    loadingSettings: "Loading this project's contribution settings…",
    reloadSettings: "Reload project settings",
    saveDefault: "Save as default settings",
    taskName: "Task name",
    taskPlaceholder: "For example: add smart retries to the API client",
    goal: "What do you want to get done?",
    goalPlaceholder:
      "Describe the need, related files, expected behavior and how to verify it…",
    lead: "Team lead",
    teammates: ({ count }: { count: number }) =>
      plural(count) === "one" ? `${count} teammate` : `${count} teammates`,
    reviewers: "Reviewer + Test analyst",
    /** The team size each plan allows. */
    teamLimit: "Free: 2 teammates · Pro: up to 4",
    usage: ({ provider }: { provider: string }) =>
      `The task runs with the ${provider} CLI signed in on this computer and counts against that account's usage. When it finishes, it waits for your review.`,
    saveDemo: "Play the sample team",
    planFirst: "Generate the team plan",
    start: "Start the agent team",
  },
};

export default modals;
