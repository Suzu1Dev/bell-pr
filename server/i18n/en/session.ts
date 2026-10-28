export default {
  name: "Pair",
  emptyMessage: "Enter a request for the agent.",
  notAllowed:
    "Collaborate with an agent only after development finishes and before publishing. For a published PR, use Address review.",
  followUpRunning:
    "This PR already has a follow-up round. Finish or discard it first.",
  busy: "An agent or review is still running for this contribution. Wait for it to finish before sending another message.",
  byHandRefused:
    "In Learn by hand, you write the code yourself. Use the guide for questions.",
  role: "Working session",
  description: "Collaborating with you on code and checks",
  requested: ({ text }: { text: string }) =>
    `Requested agent collaboration: ${text}`,
  notRunning: "No conversation turn is running.",
  limitationsUpdated:
    "Updated the PR draft's Limitations from this turn's results.",
  stopped: "This conversation turn was stopped",
  failed: "This conversation turn did not finish",
  editsKept: ({ reason }: { reason: string }) =>
    `${reason}. Edits remain in the working directory; inspect them in File changes.`,
  waiting: "Waiting for your next message",
  interrupted: "Conversation turn interrupted",
  draftStale:
    "The session added checks or edits. Generate a PR suggestion that matches the current state.",
  editing:
    "The agent is editing code. Wait for this conversation turn to finish before reviewing, editing or publishing.",
  restarted:
    "The service restarted and interrupted this conversation turn. The agent's edits remain in the working directory; inspect File changes before continuing.",
};
