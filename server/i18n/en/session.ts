import { product } from "../../../shared/product.js";

export default {
  name: "Collaborator",
  emptyMessage: "Enter a request for the agent.",
  notAllowed:
    'Collaborate with an agent only after development finishes and before publishing. For a published PR, use "Keep fixing from feedback" in the PR draft tab.',
  followUpRunning:
    "This PR already has a follow-up round. Finish or discard it first.",
  busy: "An agent or review is still running for this contribution. Wait for it to finish before sending another message.",
  byHandRefused:
    "In Learn by hand, you write the code yourself. Use the guide for questions.",
  role: "Collaboration",
  description: "Collaborating with you on code and checks",
  requested: ({ text }: { text: string }) =>
    `Requested agent collaboration: ${text}`,
  notRunning: "No conversation turn is running.",
  /** The person's message of a setup turn (BELL's words: a count, never the commands). */
  setupRequested: ({ count }: { count: number }) =>
    count === 1
      ? "Set up this machine: 1 item from the setup checklist, then rerun the check it blocked."
      : `Set up this machine: ${count} items from the setup checklist, then rerun the checks they blocked.`,
  setupFullAccessOnly:
    "Only a run that started with Full access can hand its setup to an agent. Run the commands yourself, or start a new contribution with Full access.",
  setupNotListed: "That setup item is no longer on this run's list. Reload the run and choose again.",
  setupUnsafe: `${product.name} never hands an agent a command that downloads something and runs or chains it, or pipes into a shell or another interpreter. Check it and run it yourself.`,
  draftUpdated:
    "Updated the PR draft's verification results and remaining limitations.",
  stopped: "This conversation turn was stopped",
  failed: "This conversation turn did not finish",
  editsKept: ({ reason }: { reason: string }) =>
    `${reason.replace(/[.\u3002]+$/u, "")}. Edits remain in the working directory; inspect them in Code changes.`,
  waiting: "Waiting for your next message",
  interrupted: "Conversation turn interrupted",
  draftStale:
    "The session added checks or edits. Generate a PR suggestion that matches the current state.",
  editing:
    "The agent is working in this working directory. Wait for this conversation turn to finish before reviewing, editing or publishing.",
  restarted:
    "The service restarted and interrupted this conversation turn. The agent's edits remain in the working directory; inspect Code changes before continuing.",
};
