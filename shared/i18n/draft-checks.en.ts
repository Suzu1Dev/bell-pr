/**
 * Messages of the PR text checks in shared/draft-checks.ts (English). The
 * server, the draft tab and the publish dialog all show them.
 */
import { formatters } from "./locale.js";
import { product } from "../product.js";

const fmt = formatters("en");

const messages = {
  placeholder: ({ count }: { count: number }) =>
    `The PR description still has ${fmt.plural(count) === "one" ? "1 unfinished spot" : `${count} unfinished spots`}. This text is sent to GitHub exactly as written: replace it with the current facts or delete it, and keep to-dos in the checklist. If you are describing a TODO comment or file itself, wrap it in backticks, for example \`TODO\`.`,
  placeholderLine: ({ line, text }: { line: number; text: string }) =>
    `Line ${line}: "${text}"`,
  unchecked:
    "Every checkbox in these sections is unticked and will be sent as it is. The project's template or automated checks may require ticking them; tick only what you actually did or confirmed.",
  uncheckedSection: ({ heading, count }: { heading: string; count: number }) =>
    fmt.plural(count) === "one"
      ? `${heading}: its 1 item is unticked`
      : `${heading}: all ${count} items are unticked`,
  /** Stands in for the heading of task items above the first heading. */
  noHeading: "(no heading)",
  issue:
    "The project's rules ask for every PR to link an existing issue, and this description does not reference one.",
  /** A rule quoted from a contributing file or template, after its source label. */
  ruleQuote: ({ label, quote }: { label: string; quote: string }) =>
    `${label}: "${quote}"`,
  brevityUnrevised:
    `This description is still ${product.name}'s suggested text, unrevised, and the project asks for a short description in your own words.`,
  brevityOver: ({ words, budget }: { words: number; budget: number }) =>
    `This description is about ${words} words, more than the ${budget} ${product.name} suggests, and the project asks for short descriptions.`,
};

export default messages;
