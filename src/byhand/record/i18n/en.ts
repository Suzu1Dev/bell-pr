// The Learn-by-hand record and drafting helpers (English), in the byhand chunk only (DESIGN v1.2 §11.1, F11, F13).
import { product } from "../../../../shared/product";

const times = (count: number) => (count === 1 ? "once" : `${count} times`);
const en = {
  title: "Learn by hand record",
  badge: "Learn by hand",
  claim: `${product.name}'s agents had no write access and gave you no code for this change.`,
  quotes: "The guide showed only quotes of the project's code and of your own edits.",
  unclean: ({ reason }: { reason: string }) => `${product.name} makes no Learn-by-hand claim for this run: ${reason}.`,
  reasons: {
    "agent-writes": "an agent tried to change files",
    agents: "agents other than the guide, the reviewer and the test analyst joined it",
    tasks: "it was planned as team tasks",
    rounds: "an AI follow-up round ran on it",
    resolutions: "an agent resolved its merge conflicts",
  },
  removed: ({ count }: { count: number }) =>
    `${product.name} removed code from ${count === 1 ? "1 answer before you saw it" : `${count} answers before you saw them`}.`,
  kinds: { explain: "explanations", answer: "answers", plan: "planning help", review: "reviews", test: "test help" },
  helps: ({ list }: { list: string }) => `Help you used: ${list}.`,
  helpCount: ({ kind, count }: { kind: string; count: number }) => `${kind} (${count})`,
  noHelp: "The guide gave no help.",
  tests: ({ runs, more, right, judged }: { runs: number; more: boolean; right: number; judged: number }) =>
    `${product.name} ran your tests ${more ? "at least " : ""}${times(runs)}${judged ? `; your first prediction after each change was right ${right} of ${judged} times` : ""}.`,
  fitted: ({ kinds }: { kinds: string }) => `This run was fitted to the project's rules when it started: the guide offered only ${kinds}.`,
  otherTools: `${product.name} can't see other tools you used, such as editor autocomplete or another chat.`,
  forYou: "This record is for you. It isn't proof of who wrote the code.",
  helpers: `Your words: ${product.name} doesn't draft a Learn-by-hand pull request.`,
  template: "Start from the project's template",
  templateChoice: "Template",
  facts: `Facts for an AI note; ${product.name} never puts them into the description`,
  cli: ({ cli, model }: { cli: string; model?: string }) => `The guide ran on ${cli}; ${model ? `model ${model}, as the CLI reported it` : "the CLI didn't report its model"}.`,
  rule: ({ path, line, quote }: { path: string; line: number; quote: string }) => `The project asks for a disclosure: ${path}:${line}: "${quote}"`,
  ownWords: "Write your AI note in your own words.",
  unchecked: `${product.name} couldn't check this draft against the project's rules, so it can't publish it yet.`,
};

export default en;
