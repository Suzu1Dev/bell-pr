import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { mergeSetupNeeds } from "../../shared/setup-needs";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import type { SessionMessage } from "../../shared/session";
import { latestSetupOutcomes, openSetupNeeds, runSetupNeeds, SetupNeeds, SetupResults } from "./SetupNeeds";

const render = (needs: ReturnType<typeof mergeSetupNeeds>) =>
  renderZh(createElement(SetupNeeds, { needs }));

const glib = (reason: string) => ({
  need: "GLib 開發標頭",
  command: "sudo apt install libglib2.0-dev",
  reason,
});

test("missing setup becomes a checklist of commands to verify and copy, and nothing shows when none is missing", () => {
  const html = render(
    mergeSetupNeeds([
      { from: "Teammate 1", needs: [glib("cargo test 需要。")] },
      { from: "Teammate 2", needs: [glib("同上。")] },
    ]),
  );
  assert.match(html, /需要你在這台機器準備的環境/);
  assert.match(html, /<code>sudo apt install libglib2\.0-dev<\/code>/);
  assert.match(html, /aria-label="複製指令：sudo apt install libglib2\.0-dev"/);
  assert.match(html, /回報者：Teammate 1、Teammate 2/);
  assert.match(html, /執行前請對照專案文件確認/);
  assert.equal(render([]), "");
});

test("the checklist reads in English and names teammates and follow-up rounds", () => {
  const run = {
    agents: [{ id: "member-1", name: "Teammate 1", role: "Developer", status: "complete" as const, detail: "" }],
    team: {
      config: { maxTeammates: 2 as const, requirePlanApproval: true, provider: "codex" as const, protocol: "bell-shared-tasks" as const, messageDelivery: "between-turns" as const },
      phase: "complete" as const,
      planSummary: "",
      messages: [],
      tasks: [
        {
          id: "fmt",
          title: "Format",
          description: "Format the code.",
          owner: "member-1",
          files: ["src/"],
          dependsOn: [],
          status: "complete" as const,
          setup: [{ need: "rustfmt", command: "rustup component add rustfmt", reason: "cargo fmt --check needs it." }],
        },
      ],
    },
    followUps: [
      { id: "r1", requestedAt: "", feedbackUrls: [], status: "published" as const, parentCommit: "p", setup: [{ need: "rustfmt", command: "rustup component add rustfmt", reason: "Again." }] },
    ],
  };
  const needs = runSetupNeeds(
    run,
    (number) => `Follow-up round ${number}`,
    (name, id) => `${name} (${id})`,
  );
  // The teammate's name, with the id the task board shows for it.
  assert.deepEqual(needs.map((need) => need.from), [["Teammate 1 (member-1)", "Follow-up round 1"]]);
  const html = renderEn(createElement(SetupNeeds, { needs }));
  assertNoHan(html);
  assert.match(html, /Setup this machine needs from you/);
  assert.match(html, /Reported by Teammate 1 \(member-1\), Follow-up round 1/);
  assert.match(html, /aria-label="Copy the command: rustup component add rustfmt"/);
});

test("the sample lists the setup its tester lacked, in both languages", () => {
  for (const locale of ["en", "zh-TW"] as const) {
    const { run, team } = getDemo(locale);
    const needs = runSetupNeeds({ ...run, team }, (number) => `round ${number}`);
    assert.equal(needs.length, 1);
    assert.equal(needs[0].command, "npx playwright install chromium");
    assert.deepEqual(needs[0].from, [run.agents.find((agent) => agent.id === "member-1")?.name ?? "member-1"]);
  }
  const en = renderEn(createElement(SetupNeeds, { needs: runSetupNeeds({ ...getDemo("en").run, team: getDemo("en").team }, String) }));
  assertNoHan(en);
  assert.match(en, /Chromium for the browser tests/);
  assert.match(en, /npm run test:browser/);
  const zh = renderZh(createElement(SetupNeeds, { needs: runSetupNeeds({ ...getDemo("zh-TW").run, team: getDemo("zh-TW").team }, String) }));
  assert.match(zh, /瀏覽器測試需要的 Chromium/);
});

const apt = { need: "GLib headers", command: "sudo apt-get install -y libglib2.0-dev", reason: "cargo test needs them." };
const pnpm = { need: "pnpm", command: "corepack enable", reason: "the lockfile is pnpm's." };
const deno = { need: "deno", command: "curl -fsSL https://deno.land/install.sh | sh", reason: "x" };
const message = (at: string, extra: object): SessionMessage => ({ id: at, role: "agent", content: "", at, ...extra });

test("the latest setup turn's report counts for each command, and a later turn that lists it again reopens it", () => {
  const outcomes = latestSetupOutcomes([
    message("2026-11-01T00:00:00Z", { setupResults: [{ ...apt, outcome: "failed", detail: "" }, { ...pnpm, outcome: "installed", detail: "" }] }),
    message("2026-11-02T00:00:00Z", { setupResults: [{ ...apt, outcome: "installed", detail: "apt" }] }),
    message("2026-11-03T00:00:00Z", { setup: [pnpm] }),
    message("2026-11-04T00:00:00Z", { setupResults: [{ need: "x", command: "x", outcome: "a-later-value", detail: "" }] }),
  ]);
  assert.deepEqual([...outcomes].map(([command, { outcome }]) => [command, outcome]), [
    [apt.command, "installed"],
    ["x", "unreported"],
  ]);
  const needs = mergeSetupNeeds([{ from: "member-1", needs: [apt, pnpm, deno] }]);
  assert.deepEqual(openSetupNeeds(needs, outcomes).map((entry) => entry.need), ["pnpm"]);
});

test("each item shows what the agent reported, an unsafe command says it stays the person's, and two lists keep their own headings", () => {
  const needs = mergeSetupNeeds([{ from: "member-1", needs: [apt, pnpm, deno] }]);
  const outcomes = latestSetupOutcomes([
    message("2026-11-02T00:00:00Z", { setupResults: [{ ...apt, outcome: "installed", detail: "" }, { ...pnpm, outcome: "unreported", detail: "" }] }),
  ]);
  const html = renderEn(createElement(SetupNeeds, { needs, outcomes, handOff: createElement("p", null, "HAND-OFF") }));
  assertNoHan(html);
  assert.match(html, /<p class="setup-outcome" data-outcome="installed">Agent reports: installed \(/);
  assert.match(html, /data-outcome="unreported">The setup turn at .* ended without a result for this item\./);
  assert.match(html, /BELL PR never hands this command to an agent: it downloads something and runs or chains it/);
  assert.match(html, /HAND-OFF/);
  // Without a hand-off the list stays copy-only.
  assert.doesNotMatch(renderEn(createElement(SetupNeeds, { needs })), /never hands this command/);
  assert.match(renderZh(createElement(SetupNeeds, { needs, outcomes })), /Agent 回報：已安裝/);
  const twice = renderEn(createElement("div", null, createElement(SetupNeeds, { needs }), createElement(SetupNeeds, { needs })));
  const ids = [...twice.matchAll(/<h2 id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 2);
});

test("a setup turn's results read in both languages, with the outcome in words", () => {
  const results = [
    { ...apt, outcome: "installed" as const, detail: "Installed with apt-get." },
    { ...pnpm, outcome: "needsYou" as const, detail: "" },
  ];
  const html = renderEn(createElement(SetupResults, { results }));
  assertNoHan(html);
  assert.match(html, /Setup results \(the agent&#x27;s report\)/);
  assert.match(html, /<li data-outcome="installed"><span class="setup-result-outcome">installed<\/span> <strong>GLib headers<\/strong> <code>sudo apt-get install -y libglib2\.0-dev<\/code><p>The agent&#x27;s note: Installed with apt-get\.<\/p><\/li>/);
  assert.match(html, /<span class="setup-result-outcome">needs you<\/span>/);
  assert.match(renderZh(createElement(SetupResults, { results })), /環境準備結果（Agent 回報）.*已安裝.*需要你處理/);
});

test("an item reported already present is closed, and a follow-up round started later opens it again", () => {
  const needs = mergeSetupNeeds([{ from: "member-1", needs: [apt, pnpm] }]);
  const reported = [message("2026-11-02T00:00:00Z", { setupResults: [{ ...pnpm, outcome: "present", detail: "" }] })];
  assert.deepEqual(openSetupNeeds(needs, latestSetupOutcomes(reported)).map((entry) => entry.need), ["GLib headers"]);
  const earlier = latestSetupOutcomes(reported, [{ requestedAt: "2026-11-01T00:00:00Z", setup: [pnpm] }]);
  assert.equal(earlier.get(pnpm.command)?.outcome, "present");
  const later = latestSetupOutcomes(reported, [{ requestedAt: "2026-11-03T00:00:00Z", setup: [pnpm] }]);
  assert.equal(later.has(pnpm.command), false);
  const zh = renderZh(
    createElement(SetupNeeds, {
      needs,
      outcomes: latestSetupOutcomes([message("2026-11-02T00:00:00Z", { setupResults: [{ ...apt, outcome: "unreported", detail: "" }] })]),
    }),
  );
  assert.match(zh, /的環境準備沒有回報這一項的結果。/);
});
