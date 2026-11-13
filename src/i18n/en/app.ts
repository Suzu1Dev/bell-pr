/**
 * The app shell (English): the document title, the sidebar, the top bar,
 * notices, the error fallback and the quick switch (command palette).
 */
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";

const { plural } = formatters("en");

const app = {
  /** The document title outside a named page (navigation/route.ts titleFor). */
  title: `${product.name} — AI contribution workbench`,
  skipToContent: "Skip to main content",
  /** What a GitHub login, an account or an e-mail address reads while presenting (`present=1`). */
  maskedUser: "you",
  busySwitching: "Finishing the current action. You can switch in a moment.",
  dismissConnectionNotice: "Dismiss connection notice",
  dismissNotice: "Dismiss notification",
  /** Each page's name in the navigation and the breadcrumb. */
  pages: {
    home: "Home",
    workspace: "Workbench",
    repos: "Repositories",
    explore: "Project overview",
    discovery: "Explore contributions",
    team: "Agent team",
    group: "Group",
    learning: "Learning notes",
    settings: "Settings",
  },
  sidebar: {
    closeNavigation: "Close navigation",
    home: `${product.name} home`,
    navigationHeading: "WORKSPACE",
    mainNavigation: "Main navigation",
    recent: "Recent contributions",
    newTask: "New contribution",
    /** Heads the sample project's row below the person's own runs. */
    sampleHeading: "Sample",
    /** The demo run's short name in the recent list. */
    demoRunTitle: "SDK smart retries",
    allRuns: "View all contributions",
    /** On the Learning item while practice items are due; hidden at 0. */
    practiceReady: ({ count }: { count: number }) => `${count} ready`,
    practiceReadyLabel: ({ count }: { count: number }) =>
      plural(count) === "one"
        ? `${count} practice item ready`
        : `${count} practice items ready`,
    help: "User guide",
    about: `About ${product.name}`,
    /** Shown in place of the GitHub user while none is signed in. */
    profileFallback: "My workspace",
    localWorkspace: "Local workspace",
    workspaceSettings: "Settings",
  },
  topbar: {
    openNavigation: "Open navigation",
    expandSidebar: "Expand the sidebar",
    collapseSidebar: "Collapse the sidebar",
    root: "Workspace",
    quickSwitch: "Quick switch",
    quickSwitchLabel: "Switch projects and contributions",
    quickSwitchTitle: ({ shortcut }: { shortcut: string }) =>
      `Switch projects and contributions (${shortcut})`,
    /** The environment readiness pill; it links to Settings → Environment. */
    readiness: {
      ready: "Ready",
      steps: ({ count }: { count: number }) =>
        plural(count) === "one" ? `${count} setup step` : `${count} setup steps`,
      notReady: "Not ready",
      /** The pill's full name for screen readers and its tooltip. */
      label: ({ state }: { state: string }) =>
        `Environment: ${state}. Open the environment settings.`,
    },
    /** A text link to the open project's repository on GitHub. */
    openOnGitHub: "Open on GitHub",
    profile: "Settings",
    themeLight: "Switch to light mode",
    themeDark: "Switch to dark mode",
    themeLightShort: "Light",
    themeDarkShort: "Dark",
  },
  /** Presentation mode (present=1). */
  presentation: {
    /** The top bar's badge while the sample project is shown. */
    sampleBadge: "Sample project",
  },
  errorBoundary: {
    title: "Something went wrong",
    body: `This part of ${product.name} stopped working. Reload the page to try again.`,
    reload: "Reload",
    copyDiagnostics: "Copy diagnostics",
    copied: "Diagnostics copied.",
    copyFailed: "Could not copy. Select the text below instead.",
  },
  commandPalette: {
    title: "Switch projects and contributions",
    close: "Close quick switch",
    chooseProject: "Choose a project",
    projects: "Projects",
    project: ({
      name,
      count,
      current,
    }: {
      name: string;
      count: number;
      current: boolean;
    }) => {
      const contributions =
        plural(count) === "one"
          ? `${count} contribution`
          : `${count} contributions`;
      return current
        ? `${name}, ${contributions}, current project`
        : `${name}, ${contributions}`;
    },
    noProjects: "No projects imported yet",
    /** Commands below the projects: other places and the language. */
    goTo: "Go to",
    sample: "Sample project",
    settings: "Settings",
    about: `About ${product.name}`,
    /** Switches to the other UI language, whose name follows in its own script. */
    language: "Language",
    contributionList: "Contributions",
    search: "Search the selected project's contributions",
    searchPlaceholder: "Search contributions…",
    opening: "Opening",
    resultsFallback: "Contributions",
    resultCount: ({ count }: { count: number }) =>
      plural(count) === "one" ? `${count} item` : `${count} items`,
    results: "Matching contributions",
    current: "Current",
    noMatches: "No matching contributions",
    noContributions: "This project has no contributions yet",
    tryOtherWords: "Try other keywords.",
    lookAtOverview:
      "Look at the project overview and the directions worth improving first.",
    openFailed: "Could not open this contribution. Please try again.",
    openOverview: "Open project overview",
    shortcuts: "Keyboard shortcuts",
    selectHint: "Select contribution",
    openHint: "Open",
    switchProjectHint: "Switch project",
    closeHint: "Close",
  },
  /** The switcher between BELL products; it shows once BELLPR_SUITE_LINKS names one. */
  suite: {
    open: "Switch BELL product",
    title: "BELL Suite",
    searchPlaceholder: "Switch to a BELL tool…",
    noMatch: "No matching BELL product",
    personal: { name: "BELL Personal", summary: "Today, calendar and inbox" },
    explain: { name: "BELL Explain", summary: "Concept breakdown and spaced review" },
    /** What this product is for; its name comes from shared/product.ts. */
    prSummary: "Open-source contributions and code review",
    reader: { name: "BELL Web Reader", summary: "Web capture and margin notes" },
    campaign: { name: "BELL Campaign", summary: "Countdown timeline and team coordination" },
    current: "Current",
    notLinked: "Not linked",
    footerNavigate: "↑↓ Navigate",
    footerOpen: "Enter Open",
    footerClose: "Esc Close",
    sendToSuite: "Send to BELL",
    sendTargets: {
      explain: "Break down in BELL Explain",
      personal: "Add to BELL Personal tasks",
      reader: "Read in BELL Web Reader",
      campaign: "Track in BELL Campaign",
    },
    handoffFrom: ({ app }: { app: string }) => `From ${app}`,
    handoffBack: ({ app }: { app: string }) => `Back to ${app}`,
    handoffTruncated: "Clipped to 2,000 characters",
    handoffApply: "Start contribution with draft",
    handoffRejected: "That Suite handoff link was incomplete and could not be imported.",
  },
};

export default app;
