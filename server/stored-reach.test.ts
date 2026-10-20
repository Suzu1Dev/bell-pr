// The reach BELL stores with each project rule (plan README §18.10): the
// server reads a ban's or reserved-issue rule's reach, and whether a ban
// stops the quoted confirm, from the stored quote at every rules read
// (classifier, rules card, checked list) and when it loads rules an older
// build stored, so the client reads the same values without the
// classifier. Both fields are optional and read leniently: a build that
// predates them keeps them through a load and save, and a value this
// build doesn't know still loads.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { PolicyFinding } from "../shared/contribution.js";
import { areaReach, banReach } from "../shared/policy-reach.js";
import { stopsQuotedConfirm, withStoredReach } from "../shared/project-policy.js";
import { policyFindings } from "./contribution-policy.js";
import { lenientRead } from "./persisted-schema.js";
import { policyRegistry, registryFindings } from "./policy-registry.js";
import { repositoryReadSchema, Store } from "./store.js";
import type { Database, Repository } from "./types.js";

const gentoo =
  "It is expressly forbidden to contribute to Gentoo any content that has been created with the assistance of Natural Language Processing artificial intelligence tools.";
const qemu =
  "Current QEMU project policy is to DECLINE any contributions which are believed to include or derive from AI generated content.";
const matplotlib = "On good first issues, pull requests that are AI generated will be closed.";
const disclose = "If you used AI tools, say so in the PR description.";

/** What the stored fields should be for a finding: read from its quote. */
const expectedFields = (finding: PolicyFinding) =>
  finding.kind === "ban"
    ? { reach: banReach(finding.quote), stopsConfirm: stopsQuotedConfirm(finding) ? true : undefined }
    : finding.kind === "area"
      ? { reach: areaReach(finding.quote), stopsConfirm: undefined }
      : { reach: undefined, stopsConfirm: undefined };
const storedFields = (finding: PolicyFinding) => ({ reach: finding.reach, stopsConfirm: finding.stopsConfirm });

test("every rules read stores each ban's and reserved-issue rule's reach, and the bans that stop the quoted confirm", () => {
  const document = ["# Contributing", "", qemu, "", gentoo, "", matplotlib, "", disclose, ""].join("\n");
  const findings = policyFindings([{ path: "CONTRIBUTING.md", kind: "contributing", content: document }]);
  assert.deepEqual(
    findings.map((finding) => [finding.kind, finding.reach, finding.stopsConfirm]),
    [
      ["ban", "output", undefined],
      ["ban", "assistance", true],
      ["area", "output", undefined],
      ["disclose", undefined, undefined],
    ],
  );
  for (const finding of findings) assert.deepEqual(storedFields(finding), expectedFields(finding), finding.quote);
  // The checked list's findings carry the reach their entry was signed with.
  const listed = policyRegistry.flatMap((entry) =>
    registryFindings(entry.key.replace("/*", "/any"), entry.checkedOn, [{ ...entry, signedOff: entry.checkedOn }]),
  );
  assert.ok(listed.length > 0);
  for (const finding of listed) {
    assert.deepEqual(storedFields(finding), expectedFields(finding), finding.quote);
    const signed = policyRegistry.flatMap((entry) => entry.findings).find((entry) => entry.quote === finding.quote);
    assert.equal(finding.reach, signed?.reach, finding.quote);
  }
});

test("a stored value from another build is never kept: the reach is read from the quote again", () => {
  const stale: PolicyFinding = { kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: gentoo, contribution: true, reach: "output" };
  assert.deepEqual(withStoredReach(stale), { ...stale, reach: "assistance", stopsConfirm: true });
  const area = { kind: "area", path: "CONTRIBUTING.md", line: 5, quote: matplotlib, contribution: true, stopsConfirm: true } as const;
  assert.deepEqual(withStoredReach(area), { kind: "area", path: "CONTRIBUTING.md", line: 5, quote: matplotlib, contribution: true, reach: "output" });
  const other: PolicyFinding = { kind: "disclose", path: "CONTRIBUTING.md", line: 9, quote: disclose, contribution: true };
  assert.equal(withStoredReach(other), other);
});

/** A repository whose rules carry both fields, as this build stores them. */
function repositoryWithReach(): Repository {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    name: "widgets",
    owner: "acme",
    fullName: "acme/widgets",
    path: "/tmp/widgets",
    defaultBranch: "main",
    url: "https://github.com/acme/widgets",
    contributionRules: {
      checkedAt: "2026-10-20T10:00:00.000Z",
      findings: [
        { kind: "ban", path: "CONTRIBUTING.md", line: 3, quote: qemu, contribution: true, reach: "output" },
        { kind: "ban", path: "CONTRIBUTING.md", line: 5, quote: gentoo, contribution: true, reach: "assistance", stopsConfirm: true },
        { kind: "area", path: "CONTRIBUTING.md", line: 7, quote: matplotlib, contribution: true, reach: "output" },
      ],
      filesRead: ["CONTRIBUTING.md"],
    },
  };
}

/** The repository read schema with one field of each finding left out: a build that predates it. */
function olderBuild(field: "reach" | "stopsConfirm") {
  const rules = repositoryReadSchema.shape.contributionRules.removeCatch().unwrap();
  return lenientRead(
    repositoryReadSchema.extend({
      contributionRules: rules
        .extend({ findings: z.array(rules.shape.findings.element.omit({ [field]: true } as never)).max(30) })
        .optional()
        .catch(undefined),
    }),
  );
}

for (const field of ["reach", "stopsConfirm"] as const)
  test(`a build that predates a finding's ${field} still reads rules that have it, and keeps it`, () => {
    const written = JSON.parse(JSON.stringify(repositoryWithReach()));
    const read = olderBuild(field).safeParse(written);
    assert.ok(read.success, read.success ? "" : read.error.message);
    assert.deepEqual(read.data, written);
  });

test("a reach this build doesn't know still loads, and a stopsConfirm it can't read is left out with the rest kept", () => {
  const repo = JSON.parse(JSON.stringify(repositoryWithReach())) as Repository;
  const [first, second] = repo.contributionRules!.findings;
  (first as unknown as Record<string, unknown>).reach = "later-reach";
  (second as unknown as Record<string, unknown>).stopsConfirm = "yes";
  const read = lenientRead(repositoryReadSchema).parse(repo);
  const [readFirst, readSecond, readThird] = read.contributionRules!.findings;
  assert.equal(readFirst.reach, "later-reach");
  assert.equal(readSecond.stopsConfirm, undefined);
  assert.equal(readSecond.reach, "assistance");
  assert.equal(readSecond.quote, gentoo);
  // Absent stays absent.
  delete readThird.reach;
  assert.equal("reach" in lenientRead(repositoryReadSchema).parse({ ...repo, contributionRules: { ...repo.contributionRules, findings: [readThird] } }).contributionRules!.findings[0], false);
});

/**
 * server/fixtures/state-v1.2-by-hand.json was written before the reach was
 * stored (v1.2-pre): its rules get it on load, a save writes it, and a
 * second load reads the same.
 */
test("rules a v1.2-pre build stored get each rule's reach on load, as a rules read gives it", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bell-stored-reach-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = JSON.parse(
    await readFile(path.join(import.meta.dirname, "fixtures", "state-v1.2-by-hand.json"), "utf8"),
  ) as Database;
  const rules = state.repos[0].contributionRules!;
  assert.ok(rules.findings.every((finding) => !("reach" in finding) && !("stopsConfirm" in finding)));
  // A rule an older build stored that refuses AI help itself, and one with another build's value.
  rules.findings.push(
    { kind: "ban", path: "CONTRIBUTING.md", line: 30, quote: gentoo, contribution: true },
    { kind: "area", path: "CONTRIBUTING.md", line: 32, quote: matplotlib, contribution: true, reach: "later-reach" as never },
  );
  await writeFile(path.join(directory, "state.json"), JSON.stringify(state));
  const store = new Store(directory);
  await store.initialize();
  assert.equal(store.recovery, undefined);
  const loaded = store.data.repos[0].contributionRules!.findings;
  assert.deepEqual(
    loaded.map((finding) => [finding.kind, finding.reach, finding.stopsConfirm]),
    [
      ["ban", "output", undefined],
      ["disclose", undefined, undefined],
      ["ban", "assistance", true],
      ["area", "output", undefined],
    ],
  );
  for (const finding of loaded) assert.deepEqual(storedFields(finding), expectedFields(finding), finding.quote);
  // Everything else is as it was stored.
  assert.deepEqual(
    loaded.map(({ reach: _reach, stopsConfirm: _stops, ...rest }) => rest),
    rules.findings.map(({ reach: _reach, stopsConfirm: _stops, ...rest }) => rest),
  );
  await store.save();
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8")) as Database;
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.repos[0].contributionRules!.findings, loaded);
  const reopened = new Store(directory);
  await reopened.initialize();
  assert.deepEqual(reopened.data.repos, store.data.repos);
});
