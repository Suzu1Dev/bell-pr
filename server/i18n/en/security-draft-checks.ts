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
    "The PR text contains a path on this computer, which can show your user name and how your folders are organised. Confirm that you want to publish it, or remove it.",
  localPath: ({ path }: { path: string }) => `Found: ${path}`,
  workflows:
    "This change edits GitHub Actions workflows or other CI configuration. Maintainers check such changes closely, and pushing a workflow file needs the GitHub CLI's workflow scope.",
  workflowFile: ({ path }: { path: string }) => `Changed: ${path}`,
  authorEmail: ({ emails }: { emails: string[] }) =>
    fmt.plural(emails.length) === "one"
      ? `The commit will carry the e-mail address ${fmt.list(emails)}, which anyone can read on GitHub. To keep it private, set your GitHub no-reply address with git config user.email; this is asked only once.`
      : `The commit will carry the e-mail addresses ${fmt.list(emails)}, which anyone can read on GitHub. To keep them private, set your GitHub no-reply address with git config user.email; this is asked only once per address.`,
};
