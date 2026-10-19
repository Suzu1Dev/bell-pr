import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { mergeSetupNeeds } from "../../shared/setup-needs";
import { getDemo } from "../demo";
import { assertNoHan, renderEn, renderZh } from "../test-utils/render";
import { runSetupNeeds, SetupNeeds } from "./SetupNeeds";

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
  const needs = runSetupNeeds(run, (number) => `Follow-up round ${number}`);
  assert.deepEqual(needs.map((need) => need.from), [["Teammate 1", "Follow-up round 1"]]);
  const html = renderEn(createElement(SetupNeeds, { needs }));
  assertNoHan(html);
  assert.match(html, /Setup this machine needs from you/);
  assert.match(html, /Reported by Teammate 1, Follow-up round 1/);
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
