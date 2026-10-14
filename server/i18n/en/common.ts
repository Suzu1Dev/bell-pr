/** Messages shared across the server. */
export default {
  /** A command, agent turn or job stopped because it was cancelled (409). */
  cancelled: "The operation was cancelled.",
  /** New work refused because the server is shutting down (503). */
  shuttingDown: "The server is shutting down. Try again in a moment.",
  /** An /api path that no route handles (404). */
  notFound: "API endpoint not found.",
};
