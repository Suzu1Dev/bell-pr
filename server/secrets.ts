/**
 * Single source of secret shapes.
 *
 * redact() masks every shape so logs, Agent answers, draft bodies and PR
 * bodies never carry a credential. secretInPatch() only reports the shapes
 * that are unambiguous enough to block a patch or drop an imported source:
 * assignments such as `password = "example"` and URL credentials are masked
 * but never block, because fixtures and docs legitimately contain them.
 */
interface SecretPattern {
  pattern: RegExp;
  replacement: string;
  /** When true the shape also makes secretInPatch() return true. */
  blocks: boolean;
}

export const secretPatterns: readonly SecretPattern[] = [
  {
    // Provider tokens share one minimum length of 16 characters after the prefix.
    pattern:
      /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g,
    replacement: "[REDACTED]",
    blocks: true,
  },
  {
    // Slack bot, app, user, and session tokens. Ten characters after the hyphen keeps short placeholders.
    pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED]",
    blocks: true,
  },
  {
    // PEM private keys; a block cut off before its END marker is masked to the end of the text.
    pattern:
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/g,
    replacement: "[REDACTED]",
    blocks: true,
  },
  {
    // URL credentials. The user part never holds a colon, so the pattern stays linear on "http://a:a:a…".
    pattern: /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g,
    replacement: "$1[REDACTED]@",
    blocks: false,
  },
  {
    pattern:
      /((?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*["']?)[^\s"',;]{8,}/gi,
    replacement: "$1[REDACTED]",
    blocks: false,
  },
  {
    // Authorization and a bare Bearer token. Moved here from describeIssue.
    pattern:
      /\b((?:proxy-)?authorization\b["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token|digest|bot)\s+)?)[^\s"',;]{8,}/gi,
    replacement: "$1[REDACTED]",
    blocks: false,
  },
  {
    pattern: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: "$1[REDACTED]",
    blocks: false,
  },
  {
    // #bell_token= or ?bell_token= in a URL. The hex is the secret.
    pattern: /(?:#|\?)bell_token=[0-9a-fA-F]+/g,
    replacement: "[REDACTED]",
    blocks: false,
  },
  {
    pattern: /(X-Bell-Token\s*[:=]\s*)\S+/gi,
    replacement: "$1[REDACTED]",
    blocks: false,
  },
  {
    // api-token.ts writes 32 random bytes as lowercase hex.
    pattern: /\b[0-9a-f]{64}\b/g,
    replacement: "[REDACTED]",
    blocks: false,
  },
  {
    // Device tokens (device-tokens.ts): bpd_ and 64 hex; any base64url tail too.
    pattern: /\bbpd_[A-Za-z0-9_-]{16,}/g,
    replacement: "[REDACTED]",
    blocks: true,
  },
  {
    // A pairing code in a /pair?code= link (pair-qr.ts).
    pattern: /([?&]code=)[^&#\s"']+/gi,
    replacement: "$1[REDACTED]",
    blocks: false,
  },
  {
    // A pairing code as shown: XXXX-XXXX in Crockford base32 (pairing.ts).
    // Not a run inside a longer hyphenated id, such as a UUID.
    pattern: /(?<![0-9A-Za-z-])[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}(?![0-9A-Za-z-])/g,
    replacement: "[REDACTED]",
    blocks: false,
  },
];

/**
 * An assignment whose key has token, secret, key, or password as a whole
 * word (`GITHUB_TOKEN`, `bell-token-id`, `apiKey`). A letter sequence inside
 * another word (`monkey`) is not one. Hyphens belong to the key. The value
 * still needs eight characters, the same floor as the named assignment
 * above, so `password = "example"` stays.
 */
const assignmentKey =
  /(^|[^A-Za-z0-9_-])([A-Za-z_][A-Za-z0-9_-]*)(\s*=\s*["']?)([^\s"',;]{8,})/g;
const secretKeyWords = new Set(["token", "secret", "key", "password"]);

function assignmentKeyIsSecret(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => secretKeyWords.has(word));
}

function maskAssignments(text: string): string {
  return text.replace(
    assignmentKey,
    (match, lead: string, key: string, eq: string) =>
      assignmentKeyIsSecret(key) ? `${lead}${key}${eq}[REDACTED]` : match,
  );
}

export function redact(text: string): string {
  return maskAssignments(
    secretPatterns.reduce(
      (result, { pattern, replacement }) => result.replace(pattern, replacement),
      text,
    ),
  );
}

export function secretInPatch(patch: string): boolean {
  // String#search ignores the global flag's lastIndex, so the shared patterns stay stateless.
  return secretPatterns.some(
    ({ pattern, blocks }) => blocks && patch.search(pattern) !== -1,
  );
}
