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
];

export function redact(text: string): string {
  return secretPatterns.reduce(
    (result, { pattern, replacement }) =>
      result.replace(pattern, replacement),
    text,
  );
}

export function secretInPatch(patch: string): boolean {
  // String#search ignores the global flag's lastIndex, so the shared patterns stay stateless.
  return secretPatterns.some(
    ({ pattern, blocks }) => blocks && patch.search(pattern) !== -1,
  );
}
