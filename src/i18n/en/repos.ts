/**
 * Repositories (English): the repository list, the project explorer and the
 * import dialog.
 */
import { product } from "../../../shared/product";

const repos = {
  list: {
    title: "Projects",
    intro: "Open an imported project or add one.",
    import: "Import project",
    discoveryTitle: "Not sure which project to contribute to yet?",
    discoveryText:
      "Let AI find projects on GitHub with real needs that suit your first steps.",
    discoveryAction: "Find contributions",
    demoBadge: "Sample project",
    imported: "Imported",
    demoDescription:
      "Try a complete contribution and review with the SDK smart-retry sample.",
    languageFallback: "Git repository",
    openDemo: "Open the sample workbench",
    explore: "Open project",
    addTitle: "Import a project",
    addText: "A GitHub link or a local Git project",
    delete: "Delete project",
    deleteLabel: ({ name }: { name: string }) => `Delete project: ${name}`,
    deleteConfirm: ({ name }: { name: string }) =>
      `Delete ${name} from ${product.name}? Its contributions, their notes and the project analysis are deleted too. A copy ${product.name} downloaded is removed; a folder you imported from this computer stays where it is.`,
    deleteYes: "Delete",
    deleteNo: "Keep it",
    deleting: "Deleting…",
    deleted: ({ name }: { name: string }) => `Deleted ${name}.`,
  },
  explore: {
    intro:
      "Understand the users and problems first, then choose this contribution's direction.",
    chooseDirection: "Choose a contribution direction",
  },
  import: {
    title: "Import a project",
    subtitle: "From GitHub or from this computer.",
    source: "Project source",
    placeholder: "owner/repository or https://github.com/owner/repository",
    /** `example` is a path under the home directory, such as ~/projects/repository. */
    localPathHint: ({ example }: { example: string }) =>
      `Paste a GitHub link, owner/repository, or the full path of a local Git project, such as ${example}`,
    /**
     * Shown to Windows browsers under localPathHint. Worded as a condition:
     * the server may also run in Docker or on another computer.
     */
    wslPathHint: `If ${product.name} runs inside WSL2 on this computer, use the path in your Linux distribution: a Windows folder is under /mnt/c/, for example /mnt/c/projects/repository.`,
    callout:
      "GitHub projects are downloaded to this computer. Development then happens in separate working directories (Git worktrees), and the original stays as it is.",
    later: "Not now",
    importing: "Importing…",
    import: "Import project",
    cloning: "Cloning… large repositories can take a few minutes.",
    /** Names the list of the sample import's progress lines. */
    sampleProgress: "Importing the sample project",
    sampleImported: ({ name }: { name: string }) =>
      `Imported ${name}, the sample project.`,
  },
};

export default repos;
