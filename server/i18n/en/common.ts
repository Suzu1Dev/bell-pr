/** Messages shared across the server. */
import { product } from "../../../shared/product.js";

const bin = product.binNames[0];

export default {
  /** A command, agent turn or job stopped because it was cancelled (409). */
  cancelled: "The operation was cancelled.",
  /** New work refused because the server is shutting down (503). */
  shuttingDown: "The service is shutting down. Try again in a moment.",
  /** An /api path that no route handles (404). */
  notFound: "API endpoint not found.",
  /** A request body that is not valid JSON (400). */
  invalidJson: "The request body is not valid JSON.",
  /** A request body over the size limit (413). */
  payloadTooLarge: "The request body is too large.",
  /** An unexpected server error; the details go to the local log only (500). */
  internalError: "The operation did not complete. Check the local service log.",
  /** A Host header that is not one of the trusted addresses (403). */
  hostNotAllowed: `${product.name} rejects this address. Use the startup address (\`${bin} open\` prints it again) or set BELLPR_PUBLIC_URL to use another.`,
  /** A request from another origin (403). */
  crossOriginNotAllowed: "Cross-origin requests are not allowed.",
  /** A mutation sent without a JSON body (415). */
  jsonRequired: "Requests that change data must use application/json.",
  /** An API request without this install's token (401). */
  apiTokenRequired: `Missing this ${product.name}'s API token. On this computer, \`${bin} open\` opens the app with it; API clients send Authorization: Bearer <token> or an X-Bell-Token header.`,
  /** An agent provider the server does not know (400). */
  unsupportedProvider: "This AI provider is not supported.",
  /**
   * What BELL PR tells the other BELL products (docs/bell-suite.md). Their
   * contract caps `summary` at 40 characters and each `detail` at 80.
   */
  suite: {
    summary: "Contributions and review",
    /** The title of a run that has none. */
    untitled: "Untitled run",
    /** A run's state in the Today feed. */
    detail: {
      followUpRunning: "Follow-up in progress",
      followUpReady: "Follow-up ready for you",
      byHandPlan: "Your turn: write the plan",
      planReady: "Plan ready for your approval",
      byHandChange: "Your turn: make the change",
      review: "Ready for your review",
      publishing: "Publishing",
      approved: "Approved, not published yet",
      failed: "Failed",
      queued: "Queued",
      running: "In progress",
    },
  },
};
