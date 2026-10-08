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
