import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import type { DoctorReport } from "../../shared/doctor";
import type { LicenseSummary } from "../../shared/plans";
import type { DoctorState } from "../setup/useDoctor";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { Repo, RunSummary } from "../types";
import { HomePage, recentRuns } from "./HomePage";

type Props = Parameters<typeof HomePage>[0];

const repo = { id: "repo-1", fullName: "octo/widgets" } as Repo;
const run = (id: string, title: string, createdAt: string): RunSummary =>
  ({
    id,
    repoId: repo.id,
    title,
    status: "review",
    createdAt,
  }) as RunSummary;
const runs = [
  run("run-1", "Retry timeouts", "2026-10-01T00:00:00Z"),
  run("run-2", "Document the client", "2026-10-03T00:00:00Z"),
  run("run-3", "Fix the parser", "2026-10-02T00:00:00Z"),
];

const report: DoctorReport = {
  checks: [
    { id: "git", status: "ok", required: true },
    {
      id: "data-dir",
      status: "ok",
      required: true,
      params: { path: "/home/someone/.bellpr" },
    },
    {
      id: "git-identity",
      status: "warn",
      required: false,
      detail: "Guessed someone@example.com",
      params: { email: "someone@example.com" },
    },
  ],
  ready: true,
  checkedAt: "2026-10-14T09:00:00.000Z",
  platform: "linux",
};
const doctor: DoctorState = {
  report,
  checking: false,
  error: "",
  refresh: async () => undefined,
};
const free: LicenseSummary = { plan: "free", source: "none", status: "none" };

const element = (props: Partial<Props> = {}) =>
  createElement(HomePage, {
    runs: [],
    repos: [repo],
    doctor,
    license: free,
    discoveryLocked: true,
    presenting: false,
    maskUser: (value) => value,
    maskPath: (value) => value,
    openSample() {},
    openImport() {},
    openDiscovery() {},
    async chooseRun() {
      return true;
    },
    ...props,
  });

test("Home reads in English with no Chinese left", () => {
  const html = renderEn(element({ runs, lastRunId: "run-1" }));
  assert.match(html, /<svg class="home-logo"[^>]*role="img" aria-label="BELL PR"/);
  assert.match(html, /<h1 tabindex="-1">From vibe coding to knowing why\.<\/h1>/);
  assert.match(html, /<strong>Try the sample project<\/strong>/);
  assert.match(
    html,
    /Walk through a finished contribution: the project&#x27;s rules, the agent team&#x27;s plan, explaining the change back and the pull request draft\. No setup needed\./,
  );
  assert.match(html, /<strong>Import a repository<\/strong>/);
  assert.match(html, /<strong>Find a project to contribute to<\/strong>/);
  assert.match(html, /<h2 id="home-continue-heading">Continue where you left off<\/h2>/);
  assert.match(html, /<small>octo\/widgets · Ready for your review<\/small>/);
  assertNoHan(html);
  const zh = renderZh(element());
  assert.match(zh, /<strong>試試示範專案<\/strong>/);
  assert.match(zh, /<h1 tabindex="-1">從「憑感覺寫」到「知道為什麼」。<\/h1>/);
});

test("Home shows the plan, and on Free the PRO badge and an upgrade that opens the dialog", () => {
  const html = renderEn(element());
  assert.match(html, /<span class="home-plan-label">Your plan<\/span><span class="plan-chips"><span class="plan-chip plan-chip-free"/);
  // Without a pricing or purchase URL the upgrade is a button, never href="".
  assert.match(html, /<button type="button" class="home-upgrade">Upgrade to Pro<\/button>/);
  assert.doesNotMatch(html, /href=""/);
  assert.match(
    html,
    /<strong>Find a project to contribute to<\/strong><span class="pro-badge" role="img" aria-label="Pro feature"/,
  );
  assert.match(html, /See sample results on Free\./);

  const pro = renderEn(
    element({ license: { plan: "pro", source: "file", status: "active" }, discoveryLocked: false }),
  );
  assert.doesNotMatch(pro, /pro-badge|home-upgrade|sample results/);
  assert.match(pro, /plan-chip-pro/);
  // Until the license is known there is no plan row.
  assert.doesNotMatch(renderEn(element({ license: undefined })), /home-plan/);
});

test("Home summarizes the environment, linked to its settings, except while presenting", () => {
  const html = renderEn(element({ maskUser: () => "you" }));
  assert.match(html, /<h2 id="home-setup-heading">Your environment<\/h2>/);
  assert.match(html, /<a class="setup-checklist-link" href="#\/settings\/environment">/);
  assert.match(html, /Guessed you/);
  assert.doesNotMatch(html, /someone@example\.com/);
  const presenting = renderEn(element({ presenting: true }));
  assert.doesNotMatch(presenting, /setup-checklist|Your environment/);
});

test("the runs to continue start with the one opened last, then the newest", () => {
  assert.deepEqual(
    recentRuns(runs).map((item) => item.id),
    ["run-2", "run-3", "run-1"],
  );
  assert.deepEqual(
    recentRuns(runs, "run-1").map((item) => item.id),
    ["run-1", "run-2", "run-3"],
  );
  assert.deepEqual(
    recentRuns(runs, "demo-run", 2).map((item) => item.id),
    ["run-2", "run-3"],
  );
  const html = renderEn(element({ runs, lastRunId: "run-1" }));
  assert.match(html, /<strong>Retry timeouts<\/strong><small>[^<]*<\/small><\/span><span class="home-run-last">Last opened<\/span>/);
  assert.doesNotMatch(renderEn(element()), /home-continue-heading/);
});

test("a learn-by-hand run waiting for the person's own plan reads as their turn on Home", () => {
  const waiting = (learnByHand: boolean) => ({ ...run("run-9", "Cap retries", "2026-10-04T00:00:00Z"), status: "awaiting_plan", learnByHand }) as RunSummary;
  assert.match(renderEn(element({ runs: [waiting(true)] })), /<small>octo\/widgets · Your turn<\/small>/);
  assert.match(renderEn(element({ runs: [waiting(false)] })), /<small>octo\/widgets · Awaiting plan approval<\/small>/);
});

test("a learn-by-hand run the person still writes reads as their turn on Home, with the Learn-by-hand chip", () => {
  const writing = (phase: string, learnByHand = true) =>
    ({ ...run("run-9", "Cap retries", "2026-10-04T00:00:00Z"), status: "review", learnByHand, team: { phase } }) as unknown as RunSummary;
  // Never marked ready (an empty diff included): their turn, not "Ready for your review".
  const html = renderEn(element({ runs: [writing("developing")] }));
  assertNoHan(html);
  assert.match(html, /<small>octo\/widgets · Your turn<\/small>/);
  assert.match(html, /<span title="Learn by hand"><svg[^>]*lucide-hand[\s\S]*?<\/svg><span class="visually-hidden">Learn by hand<\/span><\/span>/);
  // Marked ready once: it waits for their review, as the run's own header says.
  assert.match(renderEn(element({ runs: [writing("complete")] })), /<small>octo\/widgets · Ready for your review<\/small>/);
  // An agent run is as it was, with no chip.
  const agent = renderEn(element({ runs: [writing("developing", false)] }));
  assert.match(agent, /<small>octo\/widgets · Ready for your review<\/small>/);
  assert.doesNotMatch(agent, /Learn by hand/);
  assert.match(renderZh(element({ runs: [writing("developing")] })), /換你寫/);
});
