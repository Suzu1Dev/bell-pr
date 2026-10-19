/**
 * The privacy rule every captured state must pass: the page text may show no
 * owner identifier, no home or temp path and no e-mail address.
 *
 * The owner identifiers are built from fragments so that this file never
 * contains them (scripts/check-personal-info.mjs checks every tracked file).
 * Findings name the rule that matched, never the matched text, so a capture
 * log can be shared without leaking what it caught.
 */
const join = (...parts) => parts.join("");

/** Each rule: a name for the log and the source of its regular expression. */
export const privacyRules = [
  { name: "owner user name", source: join("ubuntu", "2604") },
  { name: "owner tailnet name", source: join("tail", "1efcdf") },
  { name: "owner handle", source: join("suzu", "1dev") },
  { name: "Linux home path", source: "\\/home\\/" },
  { name: "macOS home path", source: "\\/Users\\/" },
  { name: "temporary path", source: "\\/tmp\\/" },
  { name: "e-mail address", source: "@[\\w.-]+\\.(com|net|org)" },
];

/** The whole rule as one case-insensitive expression. */
export const privacyPattern = new RegExp(
  privacyRules.map((rule) => rule.source).join("|"),
  "i",
);

/**
 * Text removed before the check: none. The v1.1 cut films no view that
 * prints a home-like example path (the import dialog is not in it), so the
 * rule has no exemption at all.
 */
export const allowedPlaceholders = [];

/** The names of the rules `text` breaks, after the allowed placeholders go. */
export function privacyFindings(text, placeholders = allowedPlaceholders) {
  let checked = String(text);
  for (const placeholder of placeholders)
    checked = checked.split(placeholder).join("");
  if (!privacyPattern.test(checked)) return [];
  return privacyRules
    .filter((rule) => new RegExp(rule.source, "i").test(checked))
    .map((rule) => rule.name);
}
