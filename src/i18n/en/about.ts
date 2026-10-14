/** The About dialog (English). */
import { product } from "../../../shared/product";

const about = {
  title: `About ${product.name}`,
  subtitle:
    "The versions, your plan, where your data lives, and where to find help and the legal documents.",
  appVersion: "App version",
  serverVersion: "Server version",
  checking: "Checking…",
  unavailable: "Not available",
  /** The page and the server it talks to come from different builds. */
  mismatch: ({ app, server }: { app: string; server: string }) =>
    `This page is version ${app}, but the server runs version ${server}. Reload the page; if the versions still differ, restart ${product.name}.`,
  plan: "Plan",
  licensee: ({ name }: { name: string }) => `Licensed to ${name}`,
  dataDir: "Data directory",
  copyDataDir: "Copy the data directory's path",
  copy: "Copy",
  copied: "Copied.",
  copyFailed: "Could not copy. Select the text instead.",
  help: "Help and updates",
  links: {
    docs: "Documentation",
    changelog: "Changelog",
    security: "Report a security issue",
    issue: "Report an issue",
  },
  documents: "Legal documents",
  documentNames: {
    eula: "End User License Agreement",
    privacy: "Privacy policy",
    terms: "Terms of sale and responsible use",
    refund: "Refund and delivery policy",
    security: "Security policy",
    notices: "Third-party licenses",
  },
  diagnostics: {
    copy: "Copy diagnostics",
    collecting: "Collecting diagnostics…",
    copied:
      "Diagnostics copied. Secrets, paths and your GitHub login are replaced, so you can paste them into a support request.",
    copyFailed: "Could not copy. Select the text below instead.",
    failed: ({ message }: { message: string }) =>
      `Diagnostics could not be collected: ${message}`,
  },
  close: "Close",
};

export default about;
