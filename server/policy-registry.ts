/**
 * BELL's checked list of AI rules that projects publish outside their
 * repositories (DESIGN v1.2 F14, owner answer 1 of 2026-10-20): curated,
 * dated entries keyed by GitHub `owner/name` or `owner/*`, shipped with
 * BELL (server only, no network).
 *
 * - **Owner-signed.** An entry is read only once the owner has signed it:
 *   `signedOff` is the owner's date, which only the lead records (plan
 *   README §18.4); agents never set it. An entry without it is a draft
 *   that the runtime never reads and `scripts/check-policy-registry.mjs`
 *   lists as awaiting the owner's sign-off.
 * - **Only adds.** Its findings are merged after the repository's own when
 *   the rules are read (import, Update project, "Check again"), so a
 *   project read before an entry existed gets it at its next read. It never
 *   removes, changes or downgrades a finding of the repository.
 * - **Its own carve-outs only.** An entry's `allows` (each with its own
 *   verbatim quote, signed per kind; never on a rule that restricts AI help
 *   itself) attach only to that entry's findings, and only the quoted
 *   confirm of a fitted, clean Learn-by-hand run reads them.
 * - **Dated.** `checkedOn` is when the quotes were last checked against
 *   the source. More than 90 days later the entry still applies and
 *   blocks, but never lifts (shared/by-hand-rules.ts).
 *
 * Quotes are verbatim from the source, 300 characters or fewer; a rule's
 * `reach` is the one the owner signs, and the check refuses an entry
 * whose quote BELL reads otherwise (`banReach`, `areaReach`), so what
 * BELL decides from the quote is what the owner signed.
 */
import { allHelpKinds, type HelpKind } from "../shared/by-hand.js";
import { carveOutKinds, registryStale } from "../shared/by-hand-rules.js";
import { policyKinds, type PolicyFinding, type PolicyKind } from "../shared/contribution.js";
import { areaReach, banReach, type AreaReach, type BanReach } from "../shared/policy-reach.js";
import { findingWeight, policyLimits } from "./contribution-policy.js";

/** One carve-out of an entry's rule, signed per kind: what the source says some uses of AI are fine for. */
export interface RegistryAllowance {
  kinds: HelpKind[];
  /** Verbatim, 300 characters or fewer. */
  quote: string;
  /** 1-based line in the source at `version`. */
  line: number;
}

/** One rule an entry quotes. */
export interface RegistryFinding {
  kind: PolicyKind;
  /** Verbatim, 300 characters or fewer. */
  quote: string;
  /** 1-based line in the source at `version`. */
  line: number;
  /** The rule is about a contribution (a ban that blocks publishing). */
  contribution: boolean;
  /** For a `ban` or `area` rule: what it restricts, as the owner signs it. */
  reach?: BanReach | AreaReach;
  /** At most 3; only on a `ban` or `area` rule that restricts AI output. */
  allows?: RegistryAllowance[];
}

/** One project's (or one account's) rules, as checked and signed. */
export interface RegistryEntry {
  /** GitHub `owner/name` or `owner/*`, lower case. */
  key: string;
  /** What the rules card names as the rule's place, such as `book.servo.org/policy/ai-usage`. */
  label: string;
  /** https only, 300 characters or fewer. */
  url: string;
  /** The source's commit or revision date, 80 characters or fewer. */
  version: string;
  /** The date (YYYY-MM-DD) the quotes were last checked against the source. */
  checkedOn: string;
  /** The date (YYYY-MM-DD) the owner signed the entry; only the lead records it. */
  signedOff?: string;
  findings: RegistryFinding[];
}

/** The shipped entries (drafts until the owner signs each one). */
export const policyRegistry: readonly RegistryEntry[] = [];

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar date written as YYYY-MM-DD. */
const validDate = (value: unknown): value is string =>
  typeof value === "string" &&
  isoDate.test(value) &&
  !Number.isNaN(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;

/** Signed: a valid sign-off date, not before the check, not after `now`. */
function signed(entry: RegistryEntry, now: string) {
  return (
    validDate(entry.signedOff) &&
    entry.signedOff >= entry.checkedOn &&
    Date.parse(entry.signedOff) <= Date.parse(now)
  );
}

/** Whether an entry's key names the repository `owner/name` (or its whole account). */
export function registryKeyMatches(key: string, fullName: string) {
  const name = fullName.toLowerCase();
  const wanted = key.toLowerCase();
  return wanted.endsWith("/*") ? name.startsWith(wanted.slice(0, -1)) && !name.endsWith("/") : name === wanted;
}

/**
 * The findings of the signed entries for the GitHub repository `fullName`
 * (from `parseGitHubSource(repo.url)`; none without one, as for a folder
 * import without a GitHub origin), as the rules card stores them: the
 * entry's label as `path`, its source, and its own carve-outs. An unsigned
 * entry yields nothing.
 */
export function registryFindings(
  fullName: string | undefined,
  now: string,
  entries: readonly RegistryEntry[] = policyRegistry,
): PolicyFinding[] {
  if (!fullName) return [];
  return entries
    .filter((entry) => signed(entry, now) && registryKeyMatches(entry.key, fullName))
    .flatMap((entry) =>
      entry.findings.map((finding) => ({
        kind: finding.kind,
        path: entry.label,
        line: finding.line,
        quote: finding.quote,
        contribution: finding.contribution,
        source: { registry: entry.key, url: entry.url, version: entry.version, checkedOn: entry.checkedOn },
        ...(finding.allows?.length
          ? {
              allows: finding.allows.map((allowance) => ({
                line: allowance.line,
                quote: allowance.quote,
                kinds: [...allowance.kinds],
              })),
            }
          : {}),
      })),
    );
}

/**
 * The repository's own findings, unchanged and all kept, then the checked
 * list's in the room left under the 30 the card stores (rules that block
 * publishing first).
 */
export function mergeRegistryFindings(own: readonly PolicyFinding[], listed: readonly PolicyFinding[]): PolicyFinding[] {
  const room = Math.max(0, policyLimits.findings - own.length);
  const kept = listed
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => findingWeight(a.finding) - findingWeight(b.finding) || a.index - b.index)
    .slice(0, room)
    .sort((a, b) => a.index - b.index)
    .map(({ finding }) => finding);
  return [...own, ...kept];
}

/** What the registry check reports: malformed entries, drafts, and entries to check again. */
export interface RegistryReport {
  errors: string[];
  /** Keys of the entries without the owner's sign-off. */
  awaiting: string[];
  /** Keys of the entries checked more than 90 days before `today`. */
  recheck: string[];
}

const banReaches: readonly string[] = ["assistance", "output", "unknown"];
const areaReaches: readonly string[] = ["use", "output", "automate", "unknown"];
const positiveLine = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
const quoteOk = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 300;

/** Checks one finding of an entry; returns what is wrong with it. */
function findingErrors(finding: RegistryFinding): string[] {
  const errors: string[] = [];
  if (!policyKinds.includes(finding.kind)) errors.push(`kind "${String(finding.kind)}" is not a PolicyKind`);
  if (!quoteOk(finding.quote)) errors.push("quote must be 1 to 300 characters");
  if (!positiveLine(finding.line)) errors.push("line must be a positive integer");
  if (typeof finding.contribution !== "boolean") errors.push("contribution must be true or false");
  const ruled = finding.kind === "ban" || finding.kind === "area";
  const read = typeof finding.quote !== "string" ? undefined : finding.kind === "area" ? areaReach(finding.quote) : banReach(finding.quote);
  if (ruled && !(finding.kind === "area" ? areaReaches : banReaches).includes(String(finding.reach)))
    errors.push(`a ${finding.kind} rule needs its reach`);
  else if (ruled && finding.reach !== read)
    errors.push(`reach "${finding.reach}" is not what BELL reads in the quote ("${read}")`);
  if (!ruled && finding.reach !== undefined) errors.push("only a ban or area rule has a reach");
  if (finding.allows === undefined) return errors;
  if (!ruled) errors.push("allows only on a ban or area rule");
  else if (finding.reach === "assistance") errors.push("allows on a rule that restricts AI help itself");
  else if (finding.reach !== "output" && finding.reach !== "automate") errors.push(`allows on a rule of reach "${finding.reach}", which never lifts`);
  if (!Array.isArray(finding.allows) || !finding.allows.length || finding.allows.length > 3)
    return [...errors, "allows must hold 1 to 3 carve-outs"];
  finding.allows.forEach((allowance, index) => {
    const at = `allows[${index}]`;
    if (!quoteOk(allowance.quote)) errors.push(`${at}: quote must be 1 to 300 characters`);
    if (!positiveLine(allowance.line)) errors.push(`${at}: line must be a positive integer`);
    const kinds: readonly string[] = Array.isArray(allowance.kinds) ? allowance.kinds : [];
    if (!kinds.length || kinds.length > 5 || new Set(kinds).size !== kinds.length)
      errors.push(`${at}: kinds must name 1 to 5 different kinds of help`);
    const unknown = kinds.filter((kind) => !(allHelpKinds as readonly string[]).includes(kind));
    if (unknown.length) errors.push(`${at}: ${unknown.join(", ")} not a HelpKind`);
    // Each kind needs its own words in its quote, by the F12 word table.
    const named: readonly string[] = typeof allowance.quote === "string" ? carveOutKinds(allowance.quote) : [];
    const unsupported = kinds.filter((kind) => !unknown.includes(kind) && !named.includes(kind));
    if (unsupported.length) errors.push(`${at}: its quote doesn't name ${unsupported.join(", ")}`);
  });
  return errors;
}

/**
 * The registry check (scripts/check-policy-registry.mjs, CI): every field,
 * quote length, kind and date, https URLs, unique keys, carve-outs only on
 * output rules and each with its own quote naming its kinds, a sign-off
 * not before the check; drafts and entries past 90 days are reported, not
 * errors.
 */
export function checkRegistry(entries: readonly RegistryEntry[], today: string): RegistryReport {
  const report: RegistryReport = { errors: [], awaiting: [], recheck: [] };
  const keys = new Set<string>();
  entries.forEach((entry, index) => {
    const name = typeof entry.key === "string" ? entry.key : `entry ${index}`;
    const fail = (message: string) => report.errors.push(`${name}: ${message}`);
    if (typeof entry.key !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,38})\/(?:\*|[a-z0-9_.-]{1,100})$/.test(entry.key))
      fail("key must be a lower-case GitHub owner/name or owner/*");
    else if (keys.has(entry.key)) fail("key is listed twice");
    else keys.add(entry.key);
    if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 120)
      fail("label must be 1 to 120 characters");
    let url: URL | undefined;
    try {
      url = new URL(entry.url);
    } catch {
      url = undefined;
    }
    if (url?.protocol !== "https:" || entry.url.length > 300) fail("url must be an https URL of 300 characters or fewer");
    if (typeof entry.version !== "string" || !entry.version.trim() || entry.version.length > 80)
      fail("version must be 1 to 80 characters");
    if (!validDate(entry.checkedOn)) fail("checkedOn must be a date (YYYY-MM-DD)");
    if (entry.signedOff !== undefined && !validDate(entry.signedOff)) fail("signedOff must be a date (YYYY-MM-DD)");
    else if (entry.signedOff !== undefined && validDate(entry.checkedOn) && entry.signedOff < entry.checkedOn)
      fail("signedOff is before checkedOn");
    if (!Array.isArray(entry.findings) || !entry.findings.length) fail("findings must not be empty");
    else entry.findings.forEach((finding, at) => findingErrors(finding).forEach((error) => fail(`findings[${at}]: ${error}`)));
    if (entry.signedOff === undefined) report.awaiting.push(name);
    if (validDate(entry.checkedOn) && registryStale(entry.checkedOn, today)) report.recheck.push(name);
  });
  return report;
}
