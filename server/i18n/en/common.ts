/** Messages shared across the server. */
export default {
  /** A command, agent turn or job stopped because it was cancelled (409). */
  cancelled: "The operation was cancelled.",
  /** New work refused because the server is shutting down (503). */
  shuttingDown: "The server is shutting down. Try again in a moment.",
  /** An /api path that no route handles (404). */
  notFound: "API endpoint not found.",
  /** A request body that is not valid JSON (400). */
  invalidJson: "The request body is not valid JSON.",
  /** A request body over the size limit (413). */
  payloadTooLarge: "The request body is too large.",
  /** An unexpected server error; the details go to the local log only (500). */
  internalError: "The operation did not complete. Check the local service log.",
  /** A Host header that is not one of the trusted addresses (403). */
  hostNotAllowed: "This service address is not allowed.",
  /** A request from another origin (403). */
  crossOriginNotAllowed: "Cross-origin requests are not allowed.",
  /** A mutation sent without a JSON body (415). */
  jsonRequired: "Requests that change data must use application/json.",
  /** An agent provider the server does not know (400). */
  unsupportedProvider: "This agent type is not supported.",
};
