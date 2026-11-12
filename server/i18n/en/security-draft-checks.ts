import { formatters } from "../../../shared/i18n/locale.js";

const fmt = formatters("en");

/**
 * Checks on the text sent to GitHub, shown in the draft tab and publish
 * dialog (security.draftChecks). A file of their own, so that the browser
 * bundle, which runs the same checks (shared/draft-checks.ts), loads only
 * these messages.
 */
export default {
  secret: "Blocks common token formats and private keys before publishing.",
  /** Which field holds it. */
  secretIn: ({ field }: { field: "title" | "body" | "commitMessage" }) =>
    ({
      title: "In the title",
      body: "In the description",
      commitMessage: "In the commit message",
    })[field],
  localPaths:
    "The PR text contains a path on this computer, which can reveal your user name and folder layout. Confirm to publish it, or remove it.",
  localPath: ({ path }: { path: string }) => `Found: ${path}`,
  workflows:
    "This change edits GitHub Actions workflows or other CI config, which maintainers check closely. Pushing a workflow file needs the GitHub CLI's workflow scope.",
  workflowFile: ({ path }: { path: string }) => `Changed: ${path}`,
  authorEmail: ({ emails }: { emails: string[] }) =>
    fmt.plural(emails.length) === "one"
      ? `Anyone on GitHub can read the commit's e-mail address ${fmt.list(emails)}. To keep it private, set your GitHub no-reply address with git config user.email. You are asked once.`
      : `Anyone on GitHub can read the commit's e-mail addresses ${fmt.list(emails)}. To keep them private, set your GitHub no-reply address with git config user.email. You are asked once per address.`,
};
