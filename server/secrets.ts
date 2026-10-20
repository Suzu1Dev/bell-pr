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
    // BELL PR license keys: the BELLPR1 version tag, the payload and its signature.
    pattern: /BELLPR1\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{60,}/g,
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

/** Words of a name that make its value a secret on their own. */
const secretWords = new Set(["token", "secret", "password", "passwd", "credentials"]);
/** Last two words of a name that make its value a secret. */
const secretPairs = new Set(["api key", "access key", "private key", "secret key", "auth key"]);

/**
 * Whether a name (in a config dump, a .env file, a JSON or YAML object)
 * holds a secret, as the test runner's environment filter names them: its
 * words, split at _, -, . and at a lower-to-upper case change, are at
 * least two, and one is token, secret, password, passwd or credentials,
 * or the last two are api, access, private, secret or auth key. A single
 * word is left to the patterns above and to the header rule: "Unexpected
 * token: …" is a parser's message.
 */
function secretName(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean);
  return words.length > 1 && (words.some((word) => secretWords.has(word)) || secretPairs.has(words.slice(-2).join(" ")));
}

/** Where documentation shows a credential goes, never one: <token>, $TOKEN, ${TOKEN}, `…`, YOUR_TOKEN_HERE, ****. */
const placeholder = (value: string) => /[<>${}`*]/.test(value) || /^[A-Z_]+\W*$/.test(value);

/**
 * More credential shapes, masked but never blocking (test output first
 * showed them; README v1.2 §18.11 item 3), each linear in the text's
 * length: the value of an Authorization header or after "Bearer"; the
 * user and password of a URL of any scheme (postgres://, redis://…);
 * tokens with a known prefix (npm, Slack, Stripe, GitLab, Google, Hugging
 * Face); the value of an assignment to a secret name (secretName); and the
 * base64 lines a text starts with up to a private key's END line (its
 * BEGIN line was cut off before the text).
 */
const maskedShapes: readonly [RegExp, (...match: string[]) => string][] = [
  [
    /\b((?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:(?:bearer|basic|token|digest|bot)\s+)?)([^\s"',;]{6,})/gi,
    (match, prefix, value) => (placeholder(value) ? match : `${prefix}[REDACTED]`),
  ],
  [/\b(bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi, (match, prefix, value) => (placeholder(value) ? match : `${prefix}[REDACTED]`)],
  [/\b([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@:]*:[^\s/@]+@/gi, (_match, scheme) => `${scheme}[REDACTED]@`],
  [
    /\b(?:npm_[A-Za-z0-9]{36}|xox[abposr]-[A-Za-z0-9-]{10,}|[rs]k_(?:live|test)_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|hf_[A-Za-z0-9]{30,})/g,
    () => "[REDACTED]",
  ],
  [
    /(?<![\w.-])([\w.-]{1,100})(["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/g,
    (match, name, separator) => (secretName(name) ? `${name}${separator}[REDACTED]` : match),
  ],
  [/^(?:[A-Za-z0-9+/=]{1,100}\r?\n)+-----END (?:[A-Z]+ )?PRIVATE KEY-----/, () => "[REDACTED]"],
];

/** Masks every shape above: logs, agent answers, test output, draft and PR bodies never carry a credential. */
export function redact(text: string): string {
  const masked = secretPatterns.reduce(
    (result, { pattern, replacement }) =>
      result.replace(pattern, replacement),
    text,
  );
  return maskedShapes.reduce((result, [pattern, replace]) => result.replace(pattern, replace), masked);
}

export function secretInPatch(patch: string): boolean {
  // String#search ignores the global flag's lastIndex, so the shared patterns stay stateless.
  return secretPatterns.some(
    ({ pattern, blocks }) => blocks && patch.search(pattern) !== -1,
  );
}
