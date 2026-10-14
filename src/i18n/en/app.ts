/**
 * The app shell (English): the document title, the sidebar, the top bar,
 * notices, the error fallback and the quick switch (command palette).
 */
import { formatters } from "../../../shared/i18n/locale";
import { product } from "../../../shared/product";

const { plural } = formatters("en");

const app = {
  /** The document title; `setLocale` applies it. */
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
    learning: "Learning notes",
    settings: "Settings",
  },
  sidebar: {
    closeNavigation: "Close navigation",
    home: `${product.name} home`,
    navigationHeading: "WORKSPACE",
    mainNavigation: "Main navigation",
    recent: "Recent contributions",
    newTask: "New task",
    /** Heads the sample project's row below the person's own runs. */
    sampleHeading: "Sample",
    /** The demo run's short name in the recent list. */
    demoRunTitle: "SDK smart retries",
    demoBadge: "Sample",
    allRuns: "View all contributions",
    learningTitle: "Every contribution teaches you something.",
    /** A line break ("\n") is kept where the text has one. */
    learningText:
      "Understand the thinking behind each change and build up your own experience.",
    learningAction: "Explore learning notes",
    help: "User guide",
    about: `About ${product.name}`,
    /** Shown in place of the GitHub user while none is signed in. */
    profileFallback: "My workspace",
    localWorkspace: "Local workspace",
    workspaceSettings: "Workspace settings",
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
    profile: "Profile settings",
  },
  /** Shown when the sign-in session ended (for example after a restart). */
  sessionEnded: {
    title: "Your session ended.",
    text: "Run this command in a terminal to get a new sign-in link and open it. This page stays as it is until then, so you can copy anything you typed.",
    /** The command that prints and opens a new sign-in link; never translated. */
    command: `${product.binNames[0]} open`,
  },
  /** Presentation mode (present=1). */
  presentation: {
    /** The badge that stays on screen while the sample project is shown. */
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
};

export default app;
