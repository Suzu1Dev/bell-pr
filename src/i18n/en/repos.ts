/**
 * Repositories (English): the repository list, the project explorer and the
 * import dialog.
 */
import { product } from "../../../shared/product";

const repos = {
  list: {
    eyebrow: "YOUR REPOSITORIES",
    title: "Your next contribution starts here.",
    intro: "Bring in the projects you care about and turn ideas into real changes.",
    import: "Import repository",
    discoveryTitle: "Not sure which project to contribute to yet?",
    discoveryText:
      "Let AI find projects on GitHub with real needs that suit your first steps.",
    discoveryAction: "Recommend contributions",
    demoBadge: "Sample project",
    imported: "Imported",
    demoDescription:
      "Try a complete contribution and review with the SDK smart-retry sample.",
    languageFallback: "Git repository",
    openDemo: "Explore the demo workbench",
    explore: "Explore the project and directions",
    addTitle: "Add your repository",
    addText: "A GitHub link or a local Git project",
    delete: "Delete repository",
    deleteLabel: ({ name }: { name: string }) => `Delete ${name}`,
    deleteConfirm: ({ name }: { name: string }) =>
      `Delete ${name} from ${product.name}? Its contributions, their notes and the project analysis are deleted too. A copy ${product.name} downloaded is removed; a folder you imported from this computer stays where it is.`,
    deleteYes: "Delete",
    deleteNo: "Keep it",
    deleting: "Deleting…",
    deleted: ({ name }: { name: string }) => `Deleted ${name}.`,
  },
  explore: {
    eyebrow: "REPOSITORY EXPLORER",
    intro:
      "Understand the users and problems first, then choose this contribution's direction.",
    chooseDirection: "Choose a contribution direction",
  },
  import: {
    title: "Bring in your next contribution.",
    subtitle:
      "Paste a GitHub link or owner/repository, or the full path of a local Git project.",
    source: "Repository source",
    placeholder: "owner/repository or https://github.com/owner/repository",
    /** `example` is a path in this computer's style. */
    localPathHint: ({ example }: { example: string }) =>
      `Local Git projects work too: paste the full path, such as ${example}`,
    callout:
      "GitHub projects are downloaded to this computer; development then uses separate worktrees and leaves the original checkout as it is.",
    later: "Not now",
    importing: "Importing…",
    import: "Import repository",
    cloning: "Cloning… large repositories can take a few minutes.",
    /** Names the list of the sample import's progress lines. */
    sampleProgress: "Importing the sample project",
    sampleImported: ({ name }: { name: string }) =>
      `Imported ${name}, the sample project.`,
  },
};

export default repos;
