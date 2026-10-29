import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSecretsHidden,
  fakeAssignment,
  fakeBearer,
  fakeHex,
  fakeSlack,
  redactSamples,
} from "./redact-samples.js";
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
    name: "URL without credentials",
    input: "see https://github.com/owner/repo/issues/1",
    masked: "see https://github.com/owner/repo/issues/1",
    blocks: false,
  },
  {
    name: "Slack bot token",
    input: `bot ${fakeSlack} leaked`,
    masked: "bot [REDACTED] leaked",
    blocks: true,
  },
  {
    name: "Slack token shorter than ten characters after the hyphen",
    input: `xox${"b"}-${"FAKE".repeat(2)}`,
    masked: `xox${"b"}-${"FAKE".repeat(2)}`,
    blocks: false,
  },
  {
    name: "64-hex install token",
    input: `id ${fakeHex} end`,
    masked: "id [REDACTED] end",
    blocks: false,
  },
  {
    name: "63-hex near miss",
    input: fakeHex.slice(0, 63),
    masked: fakeHex.slice(0, 63),
    blocks: false,
  },
  {
    name: "bell_token fragment",
    input: `open http://127.0.0.1:9/#bell_token=${fakeHex}`,
    masked: "open http://127.0.0.1:9/[REDACTED]",
    blocks: false,
  },
  {
    name: "bell_token query",
    input: `http://127.0.0.1:9/?bell_token=${fakeHex.slice(0, 8)}`,
    masked: "http://127.0.0.1:9/[REDACTED]",
    blocks: false,
  },
  {
    name: "X-Bell-Token header",
    input: `X-Bell-Token: ${fakeBearer}`,
    masked: "X-Bell-Token: [REDACTED]",
    blocks: false,
  },
  {
    name: "hyphenated token assignment",
    input: `bell-token-id=${fakeAssignment}`,
    masked: "bell-token-id=[REDACTED]",
    blocks: false,
  },
  {
    name: "camelCase key assignment",
    input: `apiKey=${fakeAssignment}`,
    masked: "apiKey=[REDACTED]",
    blocks: false,
  },
  {
    name: "monkey assignment is not a secret key",
    input: "monkey=bananas123",
    masked: "monkey=bananas123",
    blocks: false,
  },
  {
    name: "Bearer header",
    input: `Authorization: Bearer ${fakeBearer}`,
    masked: "Authorization: Bearer [REDACTED]",
    blocks: false,
  },
  {
    name: "GITHUB_TOKEN assignment",
    input: `GITHUB_TOKEN=${fakeAssignment}`,
    masked: `GITHUB_TOKEN=[REDACTED]`,
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

test("secrets: redact hides every shared sample", () => {
  for (const sample of redactSamples) {
    const masked = redact(`see ${sample.text} now`);
    assertSecretsHidden(masked);
    assert.match(masked, /\[REDACTED\]/, sample.name);
  }
});

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
