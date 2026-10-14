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
  busySwitching: "Finishing the current action. You can switch in a moment.",
  dismissConnectionNotice: "Dismiss connection notice",
  dismissNotice: "Dismiss notification",
  /** Each page's name in the navigation and the breadcrumb. */
  pages: {
    workspace: "Workbench",
    repos: "Repositories",
    explore: "Project overview",
    discovery: "Discover",
    team: "Agent team",
    learning: "Learning notes",
    settings: "Settings",
  },
  sidebar: {
    closeNavigation: "Close navigation",
    home: `${product.name} home`,
    beta: "BETA",
    workspaceName: "My workspace",
    workspaceKind: "Personal workspace",
    navigationHeading: "WORKSPACE",
    mainNavigation: "Main navigation",
    newBadge: "NEW",
    recent: "Recent contributions",
    newTask: "New task",
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
    localFirst: "Local-first",
    openGitHub: "Open GitHub",
    profile: "Profile settings",
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
