/**
 * Synthetic secrets for redaction tests. Pieces are joined at runtime so
 * the source does not hold one contiguous credential.
 */
function piece(...parts: string[]): string {
  return parts.join("");
}

/** Obviously fake Bearer value. */
export const fakeBearer = piece("FAKE", "BEARER", "TOKEN", "1234");
/** Obviously fake assignment value. */
export const fakeAssignment = piece("fake", "plain", "text", "value");
/** 64 lowercase hex characters, the shape api-token.ts writes. Not a real token. */
export const fakeHex = piece("ab").repeat(32);
/** Obviously fake Slack bot token (`xoxb-` plus 12 letters). */
export const fakeSlack = piece("xox", "b-", "FAKE", "FAKE", "FAKE");

export interface RedactSample {
  name: string;
  text: string;
  /** Substrings that must not remain after redaction. */
  secretParts: readonly string[];
}

export const redactSamples: readonly RedactSample[] = [
  {
    name: "Bearer header",
    text: `Authorization: Bearer ${fakeBearer}`,
    secretParts: [fakeBearer],
  },
  {
    name: "GITHUB_TOKEN assignment",
    text: `GITHUB_TOKEN=${fakeAssignment}`,
    secretParts: [fakeAssignment],
  },
  {
    name: "64-hex token",
    text: fakeHex,
    secretParts: [fakeHex],
  },
  {
    name: "bell_token fragment",
    text: `#bell_token=${fakeHex}`,
    secretParts: [fakeHex],
  },
  {
    name: "X-Bell-Token header",
    text: `X-Bell-Token: ${fakeBearer}`,
    secretParts: [fakeBearer],
  },
  {
    name: "Slack bot token",
    text: fakeSlack,
    secretParts: [fakeSlack, piece("xox", "b-")],
  },
];

/** Fails when any sample's secret material is still in `text`. The message names the sample, not the value. */
export function assertSecretsHidden(text: string): void {
  for (const sample of redactSamples)
    for (const part of sample.secretParts)
      if (text.includes(part))
        throw new Error(`redaction left a ${sample.name}`);
}
