/**
 * Settings (English): the Settings page with its sections, and the shared
 * model settings dialog. The Claude Code and concurrency copy stays neutral
 * about the person's provider account and plan.
 */
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";
import type { SettingsSection } from "../../settings/sections";

const fmt = formatters("en");
const number = (value: number) => fmt.number(value);

const settings = {
  eyebrow: "SETTINGS",
  title: "Get your workspace ready.",
  intro:
    "Language, AI provider, agent safety, learning, limits and data. Everything you set here stays on this computer.",
  nav: { label: "Settings sections" },
  sections: {
    general: "General",
    provider: "AI provider",
    safety: "Agent safety",
    learning: "Learning",
    performance: "Performance",
    environment: "Environment",
    data: "Data & privacy",
    about: "About",
  } satisfies Record<SettingsSection, string>,
  state: {
    loading: "Loading…",
    saving: "Saving…",
    saved: "Saved.",
    loadFailed: ({ message }: { message: string }) =>
      `The settings did not load: ${message}`,
    retry: "Try again",
    cancel: "Cancel",
  },
  /** A setting that an environment variable fixes. */
  lock: {
    badge: "Set by environment",
    hint: ({ variable }: { variable: string }) =>
      `The ${variable} environment variable sets this. Change it there, then restart ${product.name}.`,
  },
  /** The state of an agent CLI or the GitHub CLI. */
  status: {
    checking: "Checking…",
    ready: "Ready",
    signedOut: "Not signed in",
    missing: "Not installed",
    notWorking: "Not working",
    disabled: "Disabled",
    connected: "Connected",
  },
  general: {
    devices: {
      unknown: "Unavailable",
      title: "Devices",
      text: "Any paired device can list and revoke any device.",
      current: "This device",
      created: "Created",
      lastUsed: "Last used",
      never: "Not yet used",
      revoke: "Revoke device",
      empty: "No paired devices.",
      access: "Lost or stolen device? Revoke it from another paired device, or run bell-pr token rotate on the host to invalidate all devices.",
    },
    language: {
      title: "Language",
      text: "The language of the interface, and of new contributions, analyses and answers to your questions. A contribution that already started keeps working in the language it started in, and existing text is not translated.",
      label: "Language",
    },
    browserAccess: {
      title: "Browser access",
      text: `New tabs share this browser's sign-in. Remembering is on when you first open ${product.name} from the command line.`,
      remember: "Remember this browser",
      rememberHelp: `Stay signed in while you use ${product.name}; access renews automatically and expires after about 30 days without use. Turn this off on a shared device for a session lasting up to 12 hours.`,
      signOut: "Sign out this browser",
      signOutHelp: "Signing out or revoking access does not stop running tasks.",
      revoke: "Revoke all access…",
      confirmTitle: "Revoke all access?",
      confirmText: "Every browser, including this one, will be signed out. All existing login links and API tokens will stop working.",
      confirmBack: `Run ${product.binNames[0]} on the host to reopen the app and sign back in.`,
      confirm: "Revoke all access and sign out",
    },
    sample: {
      title: "Sample project",
      text: "The sample project walks through a finished contribution with sample data, so you can try every step without tools or an account.",
      show: "Show the sample project",
      showHelp:
        "Keeps the sample in the sidebar after you start contributions of your own. When this is off, the sample hides once you have one.",
      reset: "Reset sample project",
      resetHelp:
        "Clears your review progress, draft and direction in the sample project, in this browser.",
      resetConfirm:
        "Start the sample project over? Your progress in it is cleared from this browser, and the page reloads.",
      resetYes: "Reset and reload",
      resetFailed:
        "This browser does not allow clearing the sample project's progress.",
    },
  },
  provider: {
    title: "AI provider",
    intro:
      "Agents work through an AI coding CLI on this computer: the Codex CLI or Claude Code, installed and signed in.",
    needOne:
      "You need at least one provider. Install and sign in to the Codex CLI or Claude Code; the commands are below.",
    readyWith: ({ providers }: { providers: string[] }) =>
      `Ready to work with ${fmt.list(providers)}.`,
    description: {
      codex:
        "Uses the Codex CLI you installed and signed in to. Usage counts against your own account.",
      claude:
        "Uses the Claude Code CLI you installed and signed in to (Claude plan or Anthropic API key). Usage counts against your own account.",
    },
    fixesTitle: "To set it up, run:",
    models: {
      loading: "Loading model settings…",
      reload: "Reload model settings",
      save: "Save model settings",
      saved: "Model settings saved.",
      current: "View the open contribution's models",
    },
  },
  safety: {
    title: "Agent safety",
    intro:
      "Agents run the project's code on this computer. These settings decide what they may reach.",
    sandbox: {
      title: "Claude Code sandbox",
      text: "Claude Code agents that edit files run every command in the operating-system sandbox: writes stay in the run's checkout and the network is closed. The Codex CLI uses its own sandbox.",
    },
    unsandboxed: {
      label: "Allow unsandboxed Claude Code agents",
      help: "Used only when the sandbox is unavailable. While this is off, a run that would need it is refused instead.",
      confirmTitle: "Allow agents without the sandbox?",
      confirmText:
        "When the sandbox is unavailable, Claude Code agents that edit files will run without it. They can then read and change anything your user account can, such as other projects, your SSH keys and the sign-ins of your tools. Allow it only for projects you trust.",
      confirmBadge:
        "Every run where an agent worked without the sandbox carries a badge in the workspace, and its log says so.",
      confirm: "Allow unsandboxed agents",
      cancel: "Keep the sandbox",
    },
    web: {
      title: "Web access",
      text: "Off unless you turn it on under AI provider. While it is on, agents in contribution runs and follow-up chat can search the web and read pages through the AI CLI's own web tools; project analysis and discovery never get it.",
      privacy:
        "Search queries go to the provider's search service, and pages are fetched from the sites that host them. Leave web access off for confidential code.",
      open: "Open the AI provider settings",
    },
    disclose: {
      title: "AI-assistance note",
      label: "Always add an AI-assistance note to my pull requests",
      help: "Off by default: pull request drafts mention AI only when the project's own rules ask for it.",
    },
  },
  /** The understanding check with its explicit off-switch, and the try-first prompts. */
  learning: {
    title: "Learning",
    intro: `How ${product.name} asks you to understand a change before you approve it, and how it prompts you while you review.`,
    check: {
      title: "Understanding check",
      text: "Before you approve a pull request, you explain the change back in your own words, answer a few questions about it and grade your answers against the reference yourself. No AI model grades you.",
      label: "Ask me to explain each change back before approval",
      help: "On by default. While it is on, approving and publishing wait until you have explained the latest version of the change back.",
      /** BELLPR_REQUIRE_UNDERSTANDING_CHECK=1 locks it on; no variable turns it off. */
      lockedBy: ({ variable }: { variable: string }) =>
        `Kept on by ${variable}. Remove the variable and restart ${product.name} to change this.`,
      confirmTitle: "Approve without explaining the change back?",
      /** What is lost. */
      confirmLost: "You will be able to approve a pull request you have not explained.",
      /** What stays mandatory. */
      confirmKept:
        "Every file still has to be reviewed, you still approve the pull request yourself, and every project-rule, issue and pacing check still applies.",
      /** What is recorded. */
      confirmRecorded:
        "Runs approved without the check are marked “Check off” for good: in the workspace, your learning record and the export.",
      confirmBack:
        "You can turn it back on any time; runs already approved are then held to it before they are published.",
      /** The first button of the dialog, so it has the focus. */
      keep: "Keep the check",
      turnOff: "Turn it off",
    },
    /** Counted on this computer from GET /api/learning/counts; hidden when it fails. */
    counts: {
      checkOff: ({ count }: { count: number }) =>
        `Runs approved without the check: ${number(count)}`,
      /** Shown from 3 timed checks on. */
      median: ({ count, minutes }: { count: number; minutes: number }) =>
        `Median time of your last ${number(count)} ${fmt.plural(count) === "one" ? "check" : "checks"}: ${fmt.number(minutes, { maximumFractionDigits: 1 })} min`,
      local: "Measured on this computer only.",
    },
    tryFirst: {
      title: "Try first",
      label: "Try-first prompts during review",
      help: "On by default: in each file's explanation you answer its question and guess another way to make the change, and in its code walkthrough you answer each Check yourself question, before the answers and the alternatives show. When this is off, they show behind a plain reveal, with nothing to fill in.",
    },
  },
  performance: {
    title: "Performance",
    intro: "How much work runs at once, and how long an agent turn may take.",
    maxActiveRuns: {
      label: "Runs at the same time",
      help: "1 to 8. Runs beyond the limit wait in the queue.",
    },
    maxAgentProcesses: {
      label: "Agent CLI processes at the same time",
      help: "1 to 32. Every teammate, Reviewer and Test analyst needs one, across all runs, project analyses and discovery.",
    },
    agentTimeoutScale: {
      label: "Agent timeout multiplier",
      help: "0.5 to 10. Raise it if large projects or higher reasoning efforts time out.",
    },
    queue: ({ count }: { count: number }) =>
      `Up to ${number(count)} runs can be running, queued or waiting for plan approval at once.`,
    usage:
      "Running many agents at once uses your provider account faster. Heavy parallel use of a personal Claude plan may exceed its intended individual use.",
    save: "Save limits",
    saved: "Limits saved.",
    invalid: ({ min, max }: { min: number; max: number }) =>
      `Enter a number from ${number(min)} to ${number(max)}.`,
    invalidWhole: ({ min, max }: { min: number; max: number }) =>
      `Enter a whole number from ${number(min)} to ${number(max)}.`,
  },
  environment: {
    title: "Environment",
    intro: `What ${product.name} needs on this computer, checked now, with the commands that fix what is missing.`,
    github: {
      title: "GitHub CLI",
      connectedAs: ({ user }: { user: string }) => `Connected as ${user}`,
      description: "Import projects, push branches and open Draft PRs",
    },
    advanced: {
      summary: "Advanced: environment variables",
      text: `A variable set before ${product.name} starts wins over the setting here, which then shows as set by the environment. Restart ${product.name} after changing one.`,
      /** The documentation link; hidden while the product has no docs URL. */
      documentation: "See the documentation.",
      variables: {
        BELLPR_DATA_DIR:
          "Where the data directory is (also --data-dir). The default is the .bellpr folder in your home directory.",
        BELLPR_MAX_ACTIVE_RUNS: "Runs at the same time: 1 to 8, default 2.",
        BELLPR_MAX_AGENT_PROCESSES:
          "Agent CLI processes at the same time: 1 to 32, default 3.",
        BELLPR_AGENT_TIMEOUT_SCALE:
          "Agent timeout multiplier: 0.5 to 10, default 1.",
        BELLPR_ALLOW_UNSANDBOXED_AGENTS:
          "1 allows unsandboxed Claude Code agents.",
        BELLPR_REQUIRE_UNDERSTANDING_CHECK:
          "1 keeps the understanding check on and locks the setting. No value turns it off.",
        BELLPR_RETENTION_DAYS:
          "Days to keep the files of stopped and failed runs: 1 to 365, default 14.",
        BELLPR_LOG_LEVEL:
          "How much the server logs: debug, info (the default), warn or error.",
      },
    },
  },
  data: {
    title: "Data & privacy",
    intro: `${product.name} keeps everything in one data directory on this computer. There is no ${product.name} cloud and no telemetry.`,
    dataDir: {
      title: "Data directory",
      copyLabel: "Copy the data directory's path",
    },
    storage: {
      title: "Storage",
      loading: "Measuring the data directory…",
      loadFailed: ({ message }: { message: string }) =>
        `Storage use did not load: ${message}`,
      measuredAt: ({ time }: { time: string }) => `Measured at ${time}`,
      refresh: "Measure again",
      total: "In total",
      clones: "Project clones",
      analyses: "Project analyses",
      logs: "Logs",
      runs: "Run files",
      runsHelp:
        "Each run's working copy and its teammates' checkouts. Freeing the space keeps the run's record, reports and notes.",
      published: "Published runs",
      publishedHelp:
        "Published runs keep their checkout, because follow-up rounds and syncing need it. Free one when you no longer need it.",
      others: "Other runs",
      noRuns: "No run has files on disk.",
      runMeta: ({ status, date }: { status: string; date: string }) =>
        `${status} · ${date}`,
      free: "Free space",
      freeLabel: ({ title }: { title: string }) => `Free the space of ${title}`,
      freeing: "Freeing…",
      freed: ({ size }: { size: string }) => `Freed ${size}.`,
      confirmFree:
        "Free this run's files? Its changes can no longer be reviewed or published here.",
      confirmPublished:
        "Free this published run's checkout? Follow-up rounds and syncing stop working for it.",
      outside: "Outside the data directory",
      busy: "In progress",
    },
    retention: {
      title: "Automatic cleanup",
      label: "Days to keep the files of stopped and failed runs",
      help: "1 to 365. After this many days without activity, a stopped or failed run's working files are removed; its record, reports and notes stay. Published runs are kept until you free them.",
      save: "Save",
    },
    erase: {
      title: "Delete all data",
      text: "Deletes every project, run, analysis, discovery result, log and backup in the data directory. Your settings stay. This cannot be undone.",
      open: "Delete all data…",
      label: "Type ERASE to confirm",
      button: "Delete all data",
      erasing: "Deleting…",
      done: "Everything was deleted. The page reloads.",
    },
    privacy: {
      title: "What leaves this computer",
      none: `${product.name} sends no telemetry, analytics or crash reports, and has no account or cloud service of its own.`,
      ai: "Your code and questions go to the provider of the AI coding CLI you use, under your own account.",
      github:
        "GitHub receives what the GitHub CLI and Git send under your account: clones and searches, and only after you approve, a branch and a draft pull request.",
      web: "Web access for agents is off unless you turn it on.",
      rest: "Everything else stays in the data directory.",
    },
  },
  about: {
    title: "About",
    text: `${product.name} is a local-first workbench for open-source contributions.`,
    version: "Version",
    open: `About ${product.name}`,
    docs: "Documentation",
    website: "Website",
  },
  modelDialog: {
    title: "Set contribution models",
    subtitle:
      "The agent, model and reasoning effort that every project shares, used by the tasks and project analyses you create from now on.",
    loading: "Loading model settings…",
    reload: "Reload model settings",
    close: "Close",
    saving: "Saving…",
    save: "Save settings",
  },
};

export default settings;
