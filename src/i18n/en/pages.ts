/** The discovery and agent team pages (English). */
import { providerLabels } from "../../../shared/models";

const pages = {
  discovery: {
    loading: "Loading contribution discovery…",
  },
  team: {
    title: "How the AI team works",
    intro:
      "From breaking down the problem to cross-review, specialized roles fit into how you already work.",
    assign: "Assign a new task",
    roles: {
      lead: {
        name: "Team lead",
        role: "A shared plan and dependency breakdown",
        text: "Builds a task board from the contribution direction, with explicit file scopes and dependencies, so you can approve the plan first.",
        scope: "Plan · Assign · Integrate",
      },
      teammates: {
        name: "Teammates",
        role: "Separate contexts, parallel work",
        text: "Each teammate has its own working directory; dependencies finish first, and work that does not conflict runs at the same time.",
        scope: "2 to 4 teammates · Shared task board",
      },
      inbox: {
        name: "Team inbox",
        role: "Teammates can share what they find",
        text: "Send to the Lead, one task's teammate or everyone; messages arrive at the next turn, and delivery is tracked.",
        scope: "Shared messages · Kept history",
      },
      review: {
        name: "Review & tests",
        role: "Independent review after integration",
        text: "Changes kept within their file scopes are integrated in order, then an independent Reviewer and Test analyst check the result.",
        scope: "Quality checks · You submit",
      },
    },
    noteTitle: "The Agents build; you keep the final say.",
    noteText: `Uses the ${providerLabels.codex}, ${providerLabels.claude} or ${providerLabels.antigravity} CLI signed in on this computer. Each task gets its own branch and goes to review when done; no PR is opened automatically.`,
  },
};

export default pages;
