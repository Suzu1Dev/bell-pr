/**
 * Whether the target project's own rules ask contributors to disclose AI
 * assistance. BELL never mentions AI in a PR unless the person chooses to
 * (or a project rule asks for it), so the draft panel turns its disclosure
 * toggle on by default only when a rule like this is found, and quotes it.
 */
import {
  markdownProse,
  type DraftRuleQuote,
} from "../../shared/draft-checks";
import type { DraftSource } from "../../shared/drafts";

const aiTerm =
  "(?:AI|LLMs?|large language models?|generative|gen[- ]?AI|artificial intelligence|machine[- ]generated|Copilot|ChatGPT|Claude|Codex)\\b";
const discloseVerb =
  "(?:disclos\\w*|declar\\w*|mention|indicate|state|tell us|let us know)";
const disclosedPassive =
  "(?:disclosed|declared|mentioned|indicated|stated|labell?ed|marked|flagged|noted)";

/** Lines that ask for a disclosure, in either word order. */
const disclosurePattern = new RegExp(
  [
    // "Please disclose any use of AI tools", "tell us if you used an LLM".
    `\\b${discloseVerb}\\b[^.\\n]{0,80}\\b${aiTerm}`,
    // "AI-assisted contributions must be disclosed", "LLM use should be noted",
    // "if you use AI tools, you must disclose it".
    `\\b${aiTerm}[^.\\n]{0,80}\\b(?:must|should|please|needs? to|has to|have to|is required to|are required to|shall)\\b(?:[^.\\n]{0,40}\\b${disclosedPassive}\\b|\\s+(?:\\w+\\s+)?${discloseVerb}\\b)`,
  ].join("|"),
  "i",
);

/**
 * The patterns above also fit lines about an AI feature ("state whether
 * the AI module changed", "let us know if you need help with the AI
 * backend"), so a line counts only when it is about using AI to make the
 * contribution.
 */
const aiUse =
  /\b(?:us(?:e|es|ed|ing|age)|assist\w*|generated|wr(?:ote|itten)|authored|produced)\b/i;

/** A template heading or checkbox: "## AI disclosure", "[ ] AI usage disclosed". */
const disclosureHeading =
  /\b(?:AI|LLM)[- ](?:assistance |usage |use )?disclos\w*/i;

/** "Do not mention AI" and the like are not disclosure rules. */
const negated =
  /\b(?:do not|don't|never|no need to|not required to)\s+(?:\w+\s+){0,2}(?:disclos|declar|mention|state|indicate)/i;

/** Whether one line of prose asks contributors to disclose AI assistance. */
const asksForDisclosure = (prose: string) =>
  !negated.test(prose) &&
  (disclosureHeading.test(prose) ||
    (disclosurePattern.test(prose) && aiUse.test(prose)));

/**
 * The first contributing-guide or template line that asks for an
 * AI-assistance disclosure, with its source; code blocks and comments are
 * ignored, like the other rule quotes.
 */
export function disclosureRule(
  sources: readonly DraftSource[],
): DraftRuleQuote | undefined {
  for (const source of sources) {
    if (source.kind !== "contributing" && source.kind !== "template") continue;
    const lines = source.content.split("\n");
    const index = markdownProse(source.content).findIndex(asksForDisclosure);
    if (index < 0) continue;
    return {
      sourceId: source.id,
      label: source.label,
      quote: lines[index]
        .replace(/\*\*|__/g, "")
        .trim()
        .replace(/^[-*>#\s]+/, "")
        .replace(/^\[[ xX]\]\s*/, "")
        .slice(0, 200),
    };
  }
  return undefined;
}
