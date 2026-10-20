import assert from "node:assert/strict";
import test from "node:test";
import { redact, secretInPatch } from "./secrets.js";

interface Row {
  name: string;
  input: string;
  /** Expected redact() output; equal to input when nothing should be masked. */
  masked: string;
  /** Expected secretInPatch() result. */
  blocks: boolean;
}

const pem = (label: string, body = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC") =>
  `-----BEGIN ${label}PRIVATE KEY-----\n${body}\n-----END ${label}PRIVATE KEY-----`;

const rows: Row[] = [
  // Provider tokens: masked and blocking at 16+ characters after the prefix.
  {
    name: "GitHub classic token",
    input: `token ghp_${"a".repeat(36)} leaked`,
    masked: "token [REDACTED] leaked",
    blocks: true,
  },
  {
    name: "GitHub OAuth token at the 16-character minimum",
    input: `gho_${"b".repeat(16)}`,
    masked: "[REDACTED]",
    blocks: true,
  },
  {
    name: "GitHub fine-grained token",
    input: `Authorization: github_pat_${"c".repeat(24)}`,
    masked: "Authorization: [REDACTED]",
    blocks: true,
  },
  {
    name: "sk- API key",
    input: `export KEY=sk-${"d".repeat(20)}\n`,
    masked: "export KEY=[REDACTED]\n",
    blocks: true,
  },
  {
    name: "AWS access key id",
    input: "aws_access_key_id = AKIAIOSFODNN7EXAMPLE",
    masked: "aws_access_key_id = [REDACTED]",
    blocks: true,
  },
  // BELL PR license keys: version tag, payload and signature, masked and blocking.
  {
    name: "BELL PR license key",
    input: `BELLPR_LICENSE_KEY=BELLPR1.${"e".repeat(40)}.${"s".repeat(60)} in .env`,
    masked: "BELLPR_LICENSE_KEY=[REDACTED] in .env",
    blocks: true,
  },
  {
    name: "BELL PR license key with base64url payload and signature",
    input: `key BELLPR1.eyJ2IjoxLCJwbGFuIjoicHJvIiwiaWQiOiJhYmMtMTIzIn0_-Q.${"Ab9-_".repeat(18)}`,
    masked: "key [REDACTED]",
    blocks: true,
  },
  // PEM private keys.
  {
    name: "RSA private key block",
    input: `before\n${pem("RSA ")}\nafter`,
    masked: "before\n[REDACTED]\nafter",
    blocks: true,
  },
  {
    name: "unlabeled private key block",
    input: pem(""),
    masked: "[REDACTED]",
    blocks: true,
  },
  {
    name: "OpenSSH private key block",
    input: `key: ${pem("OPENSSH ")} end`,
    masked: "key: [REDACTED] end",
    blocks: true,
  },
  {
    name: "private key truncated before END is masked to the end of the text",
    input: "stderr tail: -----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIB\nMoreBase64",
    masked: "stderr tail: [REDACTED]",
    blocks: true,
  },
  // URL credentials and assignments are masked but never block.
  {
    name: "URL credentials",
    input: "git clone https://user:s3cretpass@github.com/owner/repo.git",
    masked: "git clone https://[REDACTED]@github.com/owner/repo.git",
    blocks: false,
  },
  {
    name: "password assignment",
    input: 'password = "hunter2hunter2"',
    masked: 'password = "[REDACTED]"',
    blocks: false,
  },
  {
    name: "api key assignment",
    input: "API_KEY: abcdefgh12345678 # production",
    masked: "API_KEY: [REDACTED] # production",
    blocks: false,
  },
  // Negatives: prose and short values stay untouched and never block.
  {
    name: "prose mentioning tokens and keys",
    input:
      "Never paste your PRIVATE KEY, password or GitHub token into an issue.",
    masked:
      "Never paste your PRIVATE KEY, password or GitHub token into an issue.",
    blocks: false,
  },
  {
    name: "fixture password shorter than eight characters",
    input: 'password = "example"',
    masked: 'password = "example"',
    blocks: false,
  },
  {
    name: "19-character ghp_ near miss",
    input: `ghp_${"a".repeat(15)}`,
    masked: `ghp_${"a".repeat(15)}`,
    blocks: false,
  },
  {
    name: "19-character AKIA near miss",
    input: `AKIA${"7".repeat(15)}`,
    masked: `AKIA${"7".repeat(15)}`,
    blocks: false,
  },
  {
    name: "short sk- value",
    input: "the stub uses sk-ant-test as a placeholder",
    masked: "the stub uses sk-ant-test as a placeholder",
    blocks: false,
  },
  {
    name: "certificate block is not a private key",
    input: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    masked: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    blocks: false,
  },
  {
    name: "BELL PR license key prefix with too short parts",
    input: `BELLPR1.${"e".repeat(39)}.${"s".repeat(60)} and BELLPR1.${"e".repeat(40)}.${"s".repeat(59)}`,
    masked: `BELLPR1.${"e".repeat(39)}.${"s".repeat(60)} and BELLPR1.${"e".repeat(40)}.${"s".repeat(59)}`,
    blocks: false,
  },
  {
    name: "URL without credentials",
    input: "see https://github.com/owner/repo/issues/1",
    masked: "see https://github.com/owner/repo/issues/1",
    blocks: false,
  },
];

for (const row of rows) {
  test(`secrets: ${row.name}`, () => {
    assert.equal(redact(row.input), row.masked);
    assert.equal(secretInPatch(row.input), row.blocks);
    // Masking removes every blocking shape, so "reject first, then mask" callers stay consistent.
    assert.equal(secretInPatch(redact(row.input)), false);
    // Repeated calls must not depend on regex state left behind by a previous match.
    assert.equal(secretInPatch(row.input), row.blocks);
  });
}

test("secrets: redact masks every shape in one text", () => {
  const text = [
    `ghp_${"a".repeat(20)}`,
    "AKIAIOSFODNN7EXAMPLE",
    pem("RSA "),
    "https://u:p@host/",
    "secret: topsecretvalue",
  ].join(" ");
  assert.equal(
    redact(text),
    "[REDACTED] [REDACTED] [REDACTED] https://[REDACTED]@host/ secret: [REDACTED]",
  );
});

test("secrets: the URL-credential shape takes linear time on a crafted line", () => {
  // The live test tail is masked on every poll; "http://a:a:a…" made the old pattern quadratic.
  const crafted = `http://${"a:".repeat(32 * 1024)}`;
  assert.equal(crafted.length >= 64 * 1024, true);
  const started = performance.now();
  assert.equal(redact(crafted), crafted);
  secretInPatch(crafted);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 50, `${elapsed.toFixed(1)} ms`);
  // A user name never holds a colon, so the password takes the rest: the whole pair is still masked.
  assert.equal(redact("https://user:pass:word@host/"), "https://[REDACTED]@host/");
});

test("secrets: redact masks the credential shapes test output shows, so logs and agent answers lose them too", () => {
  // The shapes the test runner's mask had alone (server/test-command.ts until README §18.11 item 3).
  const cases: [string, string][] = [
    ["  headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0' },", "  headers: { Authorization: 'Bearer [REDACTED]' },"],
    ['  "authorization": "Basic dXNlcjpwYXNz",', '  "authorization": "Basic [REDACTED]",'],
    ["sent Bearer abcdef0123456789abcdef0123456789 to the mock", "sent Bearer [REDACTED] to the mock"],
    ["connect ECONNREFUSED postgres://app:hunter2pass@127.0.0.1:5432/retry", "connect ECONNREFUSED postgres://[REDACTED]@127.0.0.1:5432/retry"],
    ["redis://:s3cretpassw0rd@cache:6379 refused", "redis://[REDACTED]@cache:6379 refused"],
    ["//registry.npmjs.org/:_authToken=npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789", "//registry.npmjs.org/:_authToken=[REDACTED]"],
    ["AWS_SESSION_TOKEN=IQoJb3JpZ2luX2VjEJrEXAMPLE", "AWS_SESSION_TOKEN=[REDACTED]"],
    ["DJANGO_SECRET_KEY=django-insecure-0123456789", "DJANGO_SECRET_KEY=[REDACTED]"],
    ["slack xoxb-123456789012-1234567890123-AbCdEf", "slack [REDACTED]"],
    ["AAAAB3NzaC1yc2EAAAADAQABAAABAQC7\r\nQ0FGRQ==\n-----END RSA PRIVATE KEY-----\nnext", "[REDACTED]\nnext"],
  ];
  for (const [input, masked] of cases) {
    assert.equal(redact(input), masked, input);
    // Never a block on its own: fixtures and docs hold such shapes.
    assert.equal(secretInPatch(input.replace(/-----END[^\n]*/, "")), false, input);
  }
});

test("secrets: redact keeps parser messages, counts, plain URLs and the placeholders of documentation", () => {
  const kept = [
    "SyntaxError: Unexpected token: identifierName",
    "max_tokens: 12345678, token_type: Bearer",
    "Tests: 12 passed, 0 failed (input_tokens: 123456789)",
    "author: Jane Doe <jane@example.com>, ssh git@github.com:org/repo.git",
    "see https://github.com/org/repo/issues/12 and postgres://localhost:5432/app",
    "password reset tests: 3 passing",
    "key: valueThatIsLong, monkey=bananas123",
    // A project's docs (draft sources, rules quotes) show where a credential goes, never one.
    "curl -H 'Authorization: Bearer <token>' https://api.example.com",
    'curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com',
    "Send `Authorization: Bearer ${TOKEN}` with every request.",
    "Set the header Authorization: Bearer YOUR_TOKEN_HERE.",
    "Authorization: ******** in the redacted log",
  ];
  for (const line of kept) assert.equal(redact(line), line);
  // An END line after other output masks nothing before it.
  const parser = "Error: expected the key to end with\n-----END PRIVATE KEY-----\nnext";
  assert.equal(redact(parser), parser);
});

test("secrets: redact takes time linear in the text's length, also on crafted text", () => {
  const n = 64 * 1024;
  const crafted = [
    "a".repeat(n),
    "a.".repeat(n / 2),
    "a://".repeat(n / 4),
    "x://u:" + "p".repeat(n),
    `my_token${" ".repeat(n)}`,
    `authorization:${" ".repeat(n)}`,
    "bearer ".repeat(n / 7),
    "npm_".repeat(n / 4),
    "-----END ".repeat(n / 9),
    "QUJD\n".repeat(n / 5),
    `${"A".repeat(99)}\n`.repeat(n / 100) + "x",
    "a_b-c.d".repeat(n / 7) + "=x",
  ];
  const started = Date.now();
  for (const text of crafted) redact(text);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 1_000, `${elapsed} ms`);
});
