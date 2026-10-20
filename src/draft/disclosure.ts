/**
 * Whether the target project's own rules ask contributors to disclose AI
 * assistance. BELL never mentions AI in a PR unless the person chooses to
 * (or a project rule asks for it), so the draft panel turns its disclosure
 * toggle on by default only when a rule like this is found, and quotes it.
 * The rule lives in shared/project-policy.ts, so publishing enforces the
 * same one the panel shows.
 */
export { disclosureRule } from "../../shared/project-policy";
